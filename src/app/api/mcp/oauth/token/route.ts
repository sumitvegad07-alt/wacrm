// ============================================================
// Token endpoint: authorization_code exchange and refresh rotation.
//
// Every failure in the code path returns the same invalid_grant with the
// same wording. That is deliberate: distinguishing "no such code" from
// "wrong PKCE verifier" from "redirect_uri mismatch" tells an attacker which
// half of a guess was right. The server logs the real reason; the client
// learns only that it failed.
// ============================================================
import { NextResponse } from "next/server";
import { verifyPkce } from "@/lib/mcp/oauth/pkce";
import {
  consumeAuthCode,
  createConnection,
  rotateByRefreshToken,
} from "@/lib/mcp/oauth/store";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function oauthError(error: string, description: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: NO_STORE },
  );
}

/** One wording for every code-path failure. See the file header. */
function invalidGrant(reason: string): NextResponse {
  console.warn(`[mcp] token exchange refused: ${reason}`);
  return oauthError(
    "invalid_grant",
    "The authorization is no longer valid. Please reconnect OZZO in your AI tool.",
  );
}

/**
 * Accept both encodings. Most OAuth clients send form-encoded, as the spec
 * requires, but several MCP clients send JSON, and rejecting them would look
 * like an OZZO outage rather than a client bug.
 */
async function readParams(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  const form = await request.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function POST(request: Request) {
  let params: Record<string, string>;
  try {
    params = await readParams(request);
  } catch {
    return oauthError("invalid_request", "Could not read the request body.");
  }

  const grantType = params.grant_type;

  if (grantType === "authorization_code") {
    const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier } =
      params;

    if (!code || !verifier) {
      return oauthError("invalid_request", "code and code_verifier are required.");
    }

    // Single-use: this both reads and burns the code, so a replay finds
    // nothing even if the checks below fail.
    const consumed = await consumeAuthCode(code);
    if (!consumed) return invalidGrant("unknown, expired or already-used code");

    if (clientId && clientId !== consumed.client_id) {
      return invalidGrant("client_id does not match the code");
    }
    if (redirectUri && redirectUri !== consumed.redirect_uri) {
      return invalidGrant("redirect_uri does not match the code");
    }
    if (
      !verifyPkce(verifier, consumed.code_challenge, consumed.code_challenge_method)
    ) {
      return invalidGrant("PKCE verifier does not match the challenge");
    }

    try {
      const tokens = await createConnection({
        accountId: consumed.account_id,
        profileId: consumed.profile_id,
        clientId: consumed.client_id,
        clientName: await clientNameFor(consumed.client_id),
        sbRefreshToken: consumed.sb_refresh_token,
      });
      return NextResponse.json(
        {
          access_token: tokens.accessToken,
          token_type: "Bearer",
          expires_in: tokens.expiresIn,
          refresh_token: tokens.refreshToken,
          scope: "ozzo.read",
        },
        { headers: NO_STORE },
      );
    } catch (err) {
      console.error("[mcp] could not create connection:", err);
      return oauthError(
        "server_error",
        "OZZO could not complete the connection. Please try again.",
        500,
      );
    }
  }

  if (grantType === "refresh_token") {
    const token = params.refresh_token;
    if (!token) return oauthError("invalid_request", "refresh_token is required.");

    const tokens = await rotateByRefreshToken(token);
    if (!tokens) return invalidGrant("unknown, rotated or revoked refresh token");

    return NextResponse.json(
      {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: "ozzo.read",
      },
      { headers: NO_STORE },
    );
  }

  return oauthError(
    "unsupported_grant_type",
    'Only "authorization_code" and "refresh_token" are supported.',
  );
}

/** The display name shown on the "Connected AI tools" screen. */
async function clientNameFor(clientId: string): Promise<string> {
  const { getClient } = await import("@/lib/mcp/oauth/store");
  const client = await getClient(clientId);
  return client?.client_name ?? "An AI tool";
}

export async function GET() {
  return NextResponse.json(
    { error: "invalid_request", error_description: "Use POST." },
    { status: 405, headers: { Allow: "POST", ...NO_STORE } },
  );
}
