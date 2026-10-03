import { NextResponse } from "next/server";
import { issuerBaseUrl } from "@/lib/mcp/oauth/issuer";

/**
 * RFC 8414 authorization-server metadata.
 *
 * OAuth 2.1 shape: S256 PKCE only (no "plain"), Dynamic Client Registration
 * advertised so the AI tool can introduce itself with no manual setup, and
 * token_endpoint_auth_method "none" because these are public clients that
 * cannot hold a secret.
 */
export async function GET(request: Request) {
  const base = issuerBaseUrl(request);
  return NextResponse.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/api/mcp/oauth/authorize`,
      token_endpoint: `${base}/api/mcp/oauth/token`,
      registration_endpoint: `${base}/api/mcp/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["ozzo.read"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
