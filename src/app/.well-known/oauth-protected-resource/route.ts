import { NextResponse } from "next/server";
import { issuerBaseUrl } from "@/lib/mcp/oauth/issuer";

/**
 * RFC 9728 protected-resource metadata. Tells an MCP client which
 * authorization server guards /api/mcp.
 *
 * ChatGPT reads this before it will connect, and rejects a slightly
 * off-spec document with an unhelpful error, so the field names here are
 * deliberately verbatim from the RFC.
 */
export async function GET(request: Request) {
  const base = issuerBaseUrl(request);
  return NextResponse.json(
    {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      scopes_supported: ["ozzo.read"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
