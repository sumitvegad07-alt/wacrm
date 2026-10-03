// ============================================================
// RFC 7591 Dynamic Client Registration.
//
// This is the endpoint that removes manual setup: the AI tool introduces
// itself, gets a client_id back, and the admin only ever pastes one URL.
// It is unauthenticated by design — there is no login yet at this point in
// the flow — so it carries its own per-IP ceiling and validates redirect
// URIs strictly, because a redirect URI accepted here is honoured later at
// /authorize when an authorization code is delivered.
// ============================================================
import { NextResponse } from "next/server";
import { checkRedirectUris } from "@/lib/mcp/oauth/redirect-uri";
import { registerClient } from "@/lib/mcp/oauth/store";
import { RATE_LIMITS, checkRateLimit } from "@/lib/rate-limit";

/** Longest client_name we will store, to keep the Allow screen readable. */
const MAX_CLIENT_NAME = 120;

/** Best-effort client IP — leftmost x-forwarded-for entry, as elsewhere. */
function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

function oauthError(
  error: string,
  description: string,
  status = 400,
): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const rate = checkRateLimit(
    `mcp:register:${getClientIp(request)}`,
    RATE_LIMITS.mcpRegister,
  );
  if (!rate.success) {
    return NextResponse.json(
      {
        error: "temporarily_unavailable",
        error_description: "Too many registration attempts. Try again later.",
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000))),
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON.");
  }

  const uris = checkRedirectUris(body.redirect_uris);
  if (!uris.ok) {
    return oauthError("invalid_redirect_uri", uris.problem ?? "Invalid redirect_uris.");
  }

  // Public clients only. A client claiming it can authenticate would expect
  // its secret to be checked at the token endpoint, and we never issue one.
  const authMethod = body.token_endpoint_auth_method ?? "none";
  if (authMethod !== "none") {
    return oauthError(
      "invalid_client_metadata",
      'token_endpoint_auth_method must be "none"; OZZO issues no client secrets.',
    );
  }

  const grantTypes = body.grant_types;
  if (Array.isArray(grantTypes)) {
    const unsupported = grantTypes.filter(
      (g) => g !== "authorization_code" && g !== "refresh_token",
    );
    if (unsupported.length) {
      return oauthError(
        "invalid_client_metadata",
        `Unsupported grant_types: ${unsupported.join(", ")}.`,
      );
    }
  }

  const responseTypes = body.response_types;
  if (Array.isArray(responseTypes) && responseTypes.some((r) => r !== "code")) {
    return oauthError("invalid_client_metadata", 'Only the "code" response type is supported.');
  }

  const rawName = typeof body.client_name === "string" ? body.client_name.trim() : "";
  // The name is shown to the admin on the Allow screen, so it must never be
  // empty — "wants to read your OZZO data" with no subject is unanswerable.
  const clientName = (rawName || "An AI tool").slice(0, MAX_CLIENT_NAME);

  try {
    const client = await registerClient(clientName, body.redirect_uris as string[]);
    return NextResponse.json(
      {
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "ozzo.read",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[mcp] client registration failed:", err);
    return oauthError(
      "invalid_client_metadata",
      "Registration failed. Please try again.",
      500,
    );
  }
}

/** Anything other than POST. RFC 7591 defines only client registration here. */
export async function GET() {
  return NextResponse.json(
    { error: "invalid_request", error_description: "Use POST to register a client." },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
