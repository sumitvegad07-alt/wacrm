// ============================================================
// The MCP endpoint: JSON-RPC 2.0 over HTTP.
//
// Implemented directly rather than through the MCP SDK, whose HTTP transport
// expects Node's IncomingMessage/ServerResponse. Next's App Router hands
// route handlers a Web Request instead, and bridging the two is more
// fragile than the small, fully specified surface we actually need:
// initialize, tools/list and tools/call. The spec permits a plain JSON
// response for a single request, which is exactly this shape.
//
// Every tool call writes one audit row, including when it fails. That log is
// the only way a leaked token would ever be noticed.
// ============================================================
import { NextResponse } from "next/server";
import { logCall } from "@/lib/mcp/audit";
import { McpAuthError, requireMcpContext, type McpContext } from "@/lib/mcp/session";
import { MCP_TOOLS, callTool, dataSetOf } from "@/lib/mcp/tools";

/** The MCP revision this server implements. */
const PROTOCOL_VERSION = "2025-06-18";

/** JSON-RPC 2.0 reserved codes, plus the ones MCP clients expect. */
const JSON_RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const NO_STORE = { "Cache-Control": "no-store" };

function rpcResult(id: string | number | null, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: NO_STORE });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  httpStatus = 200,
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: httpStatus, headers: NO_STORE },
  );
}

/**
 * A 401 must carry WWW-Authenticate pointing at the metadata document, or an
 * MCP client has no way to discover where to authenticate and simply reports
 * that the server is unreachable.
 */
function unauthorized(request: Request, message: string): NextResponse {
  const base = new URL(request.url).origin;
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: JSON_RPC.invalidRequest, message } },
    {
      status: 401,
      headers: {
        ...NO_STORE,
        "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

export async function POST(request: Request) {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, JSON_RPC.parseError, "Request body is not valid JSON.");
  }

  const id = body.id ?? null;
  const method = body.method;
  if (!method) {
    return rpcError(id, JSON_RPC.invalidRequest, "Missing JSON-RPC method.");
  }

  // `initialize` and the notifications around it are part of the handshake
  // and are answered before authentication, so a client can discover the
  // server and be told where to log in.
  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "OZZO", version: "1.0.0" },
      instructions:
        "OZZO holds this company's CRM, field-sales and workforce data, read-only. " +
        "Call list_data first to see what exists and to learn the account's timezone, " +
        "then describe_data before fetching a data set you have not used. " +
        "Dates are always named periods — OZZO resolves them in the account's timezone.",
    });
  }

  // Notifications carry no id and expect no response body.
  if (method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202, headers: NO_STORE });
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  let ctx: McpContext;
  try {
    ctx = await requireMcpContext(request);
  } catch (err) {
    const message =
      err instanceof McpAuthError
        ? err.message
        : "OZZO could not verify this connection. Please reconnect OZZO in your AI tool.";
    const status = err instanceof McpAuthError ? err.status : 401;
    if (status === 401) return unauthorized(request, message);
    return rpcError(id, JSON_RPC.invalidRequest, message, status);
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: MCP_TOOLS });
  }

  if (method === "tools/call") {
    const params = body.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = params.arguments ?? {};
    if (!name) {
      return rpcError(id, JSON_RPC.invalidParams, "tools/call needs a tool name.");
    }

    const startedAt = Date.now();
    let rowCount: number | undefined;
    let truncated: boolean | undefined;
    let errorCode: string | undefined;

    try {
      const result = await callTool(name, args, ctx);
      const asResult = result as { row_count?: number; truncated?: boolean };
      rowCount = asResult?.row_count;
      truncated = asResult?.truncated;

      // MCP returns tool output as content blocks. JSON in a text block is
      // what every current client reads most reliably.
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      });
    } catch (err) {
      errorCode = err instanceof Error ? err.name : "Error";
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong reading OZZO data.";
      // Returned as a tool result rather than a protocol error, so the AI can
      // read the sentence and relay it — "Route data needs the SFA plan" is
      // an answer the admin can act on.
      return rpcResult(id, {
        content: [{ type: "text", text: message }],
        isError: true,
      });
    } finally {
      // AWAITED, not fire-and-forget. A serverless function can be frozen
      // the moment it returns a response, killing any promise still in
      // flight — which is exactly what happened on 2026-10-04: the slower
      // `visits` calls left no audit row while faster ones did. The audit
      // log is the only way a leaked token would ever be noticed, so an
      // unreliable one is worse than none. logCall never throws.
      await logCall({
        connectionId: ctx.connectionId,
        accountId: ctx.accountId,
        profileId: ctx.profileId,
        clientName: ctx.clientName,
        tool: name,
        dataSet: dataSetOf(name, args),
        rowCount,
        truncated,
        durationMs: Date.now() - startedAt,
        errorCode,
      });
    }
  }

  return rpcError(id, JSON_RPC.methodNotFound, `Unsupported method "${method}".`);
}

export async function GET(request: Request) {
  // Some clients probe with GET to open an SSE stream. We answer single
  // requests only, so say so in a way the client can act on.
  return unauthorized(
    request,
    "OZZO's MCP endpoint accepts JSON-RPC over POST. Connect using the OAuth flow.",
  );
}
