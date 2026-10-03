// ============================================================
// Data access for the MCP OAuth surface: dynamically registered clients,
// single-use authorization codes, and one connection per connected AI tool.
//
// Everything here runs through the service-role client, because the OAuth
// tables carry RLS with no policy at all (deny-all for every normal role) —
// only these server-side routes may touch them.
//
// Token discipline mirrors api_keys (migration 026): we store the SHA-256 of
// every bearer token we issue and never the plaintext, so a database dump
// does not hand someone a working connection. The admin's own Supabase
// refresh token is different — we must be able to replay it, so it is
// AES-256-GCM encrypted with ENCRYPTION_KEY rather than hashed.
// ============================================================
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

/** Prefix on every access/refresh token we issue. Self-identifying for
 *  secret scanners, and tells a leaked string apart from an API key. */
export const MCP_TOKEN_PREFIX = "ozzo_mcp_";

/** Access tokens live an hour and are refreshed silently by the AI tool. */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;

/** Authorization codes are short-lived by design — the client exchanges one
 *  within seconds of the redirect. */
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

/** A connection unused for this long is dead, even though its refresh token
 *  has no fixed expiry. Enforced on read, so no cron job is needed. */
export const CONNECTION_IDLE_DAYS = 90;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Fail early and by name when ENCRYPTION_KEY is missing.
 *
 * Without this, the first thing an admin sees after clicking Allow is a
 * createCipheriv crash from deep inside node:crypto, which names nothing and
 * looks like an OZZO outage. The variable is already required by the
 * WhatsApp integration, so a deployment that has one has the other — but a
 * local or preview environment may not.
 */
function assertEncryptionConfigured(): void {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !key.trim()) {
    throw new Error(
      "ENCRYPTION_KEY is not set, so the OZZO connection cannot be stored securely. " +
        "Set it in this environment (it is the same key the WhatsApp integration uses).",
    );
  }
}

function newToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export interface DcrClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ConnectionRow {
  id: string;
  account_id: string;
  profile_id: string;
  client_id: string;
  client_name: string;
  /** Decrypted — callers get the usable Supabase refresh token. */
  sb_refresh_token: string;
  access_expires_at: string;
  /** Lets the caller skip a write when it is already recent. */
  last_used_at: string | null;
  /** The shared live Supabase access token, decrypted, or null. */
  sb_access_token: string | null;
  sb_access_expires_at: string | null;
}

// ── Clients (RFC 7591) ──────────────────────────────────────

export async function registerClient(
  name: string,
  redirectUris: string[],
): Promise<DcrClient> {
  const db = supabaseAdmin();
  const row = {
    client_id: `mcp_${randomBytes(16).toString("hex")}`,
    client_name: name,
    redirect_uris: redirectUris,
  };
  const { error } = await db.from("mcp_oauth_clients").insert(row);
  if (error) throw new Error(`client registration failed: ${error.message}`);
  return row;
}

export async function getClient(clientId: string): Promise<DcrClient | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as DcrClient | null) ?? null;
}

// ── Authorization codes ─────────────────────────────────────

export async function createAuthCode(input: {
  clientId: string;
  accountId: string;
  profileId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  sbRefreshToken: string;
}): Promise<string> {
  assertEncryptionConfigured();
  const db = supabaseAdmin();
  const code = randomBytes(32).toString("base64url");
  const { error } = await db.from("mcp_oauth_codes").insert({
    code,
    client_id: input.clientId,
    account_id: input.accountId,
    profile_id: input.profileId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    sb_refresh_encrypted: encrypt(input.sbRefreshToken),
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`could not issue authorization code: ${error.message}`);
  return code;
}

export interface ConsumedCode {
  client_id: string;
  account_id: string;
  profile_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  sb_refresh_token: string;
}

/**
 * Single-use: the UPDATE that stamps consumed_at is conditioned on it still
 * being null, so two simultaneous exchanges of one code cannot both win.
 * Returns null for unknown, expired or already-consumed codes — the caller
 * collapses all of those into one invalid_grant, so nothing leaks about
 * which check failed.
 */
export async function consumeAuthCode(code: string): Promise<ConsumedCode | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("mcp_oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code", code)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select(
      "client_id, account_id, profile_id, redirect_uri, code_challenge, code_challenge_method, sb_refresh_encrypted",
    )
    .maybeSingle();
  if (error || !data) return null;

  const row = data as Record<string, string>;
  return {
    client_id: row.client_id,
    account_id: row.account_id,
    profile_id: row.profile_id,
    redirect_uri: row.redirect_uri,
    code_challenge: row.code_challenge,
    code_challenge_method: row.code_challenge_method,
    sb_refresh_token: decrypt(row.sb_refresh_encrypted),
  };
}

// ── Connections ─────────────────────────────────────────────

export async function createConnection(input: {
  accountId: string;
  profileId: string;
  clientId: string;
  clientName: string;
  sbRefreshToken: string;
}): Promise<IssuedTokens> {
  assertEncryptionConfigured();
  const db = supabaseAdmin();
  const accessToken = newToken();
  const refreshToken = newToken();
  const { error } = await db.from("mcp_connections").insert({
    account_id: input.accountId,
    profile_id: input.profileId,
    client_id: input.clientId,
    client_name: input.clientName,
    access_token_hash: sha256(accessToken),
    refresh_token_hash: sha256(refreshToken),
    sb_refresh_encrypted: encrypt(input.sbRefreshToken),
    access_expires_at: new Date(
      Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
    ).toISOString(),
    last_used_at: new Date().toISOString(),
  });
  if (error) throw new Error(`could not create connection: ${error.message}`);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Resolve a bearer token to its connection, or null when it must not be
 * honoured. Rejects revoked connections, expired access tokens, and
 * connections idle for CONNECTION_IDLE_DAYS — the idle rule is enforced here
 * rather than by a scheduled job so there is no window where a forgotten
 * connection still works.
 */
export async function findConnectionByAccessToken(
  token: string,
): Promise<ConnectionRow | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  const db = supabaseAdmin();
  const { data } = await db
    .from("mcp_connections")
    .select(
      "id, account_id, profile_id, client_id, client_name, sb_refresh_encrypted, access_expires_at, last_used_at, revoked_at, sb_access_encrypted, sb_access_expires_at",
    )
    .eq("access_token_hash", sha256(token))
    .maybeSingle();
  if (!data) return null;

  const row = data as Record<string, string | null>;
  if (row.revoked_at) return null;
  if (!row.access_expires_at || new Date(row.access_expires_at) <= new Date()) {
    return null;
  }
  const idleSince = row.last_used_at ?? row.access_expires_at;
  const idleCutoff = Date.now() - CONNECTION_IDLE_DAYS * 86_400_000;
  if (new Date(idleSince).getTime() < idleCutoff) return null;

  return {
    id: row.id as string,
    account_id: row.account_id as string,
    profile_id: row.profile_id as string,
    client_id: row.client_id as string,
    client_name: row.client_name as string,
    sb_refresh_token: decrypt(row.sb_refresh_encrypted as string),
    access_expires_at: row.access_expires_at,
    last_used_at: (row.last_used_at as string | null) ?? null,
    sb_access_token: row.sb_access_encrypted
      ? safeDecrypt(row.sb_access_encrypted as string)
      : null,
    sb_access_expires_at: (row.sb_access_expires_at as string | null) ?? null,
  };
}

/**
 * Exchange a refresh token for a fresh pair. The old refresh token is
 * invalidated by the same UPDATE that issues the new one, and the UPDATE is
 * conditioned on the old hash, so a replayed refresh token finds no row.
 */
export async function rotateByRefreshToken(
  token: string,
): Promise<IssuedTokens | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  const db = supabaseAdmin();
  const accessToken = newToken();
  const refreshToken = newToken();
  const { data, error } = await db
    .from("mcp_connections")
    .update({
      access_token_hash: sha256(accessToken),
      refresh_token_hash: sha256(refreshToken),
      access_expires_at: new Date(
        Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
      last_used_at: new Date().toISOString(),
    })
    .eq("refresh_token_hash", sha256(token))
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error || !data) return null;
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** Persist the rotated Supabase refresh token. Supabase rotates it on every
 *  use, so failing to write it back bricks the connection on the next call. */
/** A stored value encrypted under a different key must not break the call. */
function safeDecrypt(value: string): string | null {
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

/**
 * Try to become the one instance that refreshes this connection.
 *
 * The UPDATE only succeeds when nobody else holds the claim, or when a
 * previous holder is older than the stale window (so a crashed instance
 * cannot wedge the connection forever). Returns true when this caller won.
 */
export async function claimRefresh(
  connectionId: string,
  staleAfterMs = 20_000,
): Promise<boolean> {
  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
  const { data } = await db
    .from("mcp_connections")
    .update({ sb_refresh_lock_at: new Date().toISOString() })
    .eq("id", connectionId)
    .or(`sb_refresh_lock_at.is.null,sb_refresh_lock_at.lt.${cutoff}`)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

/** Re-read just the shared session, for an instance that lost the claim. */
export async function readStoredSession(
  connectionId: string,
): Promise<{ accessToken: string | null; expiresAt: string | null }> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("mcp_connections")
    .select("sb_access_encrypted, sb_access_expires_at")
    .eq("id", connectionId)
    .maybeSingle();
  const row = (data ?? {}) as Record<string, string | null>;
  return {
    accessToken: row.sb_access_encrypted ? safeDecrypt(row.sb_access_encrypted) : null,
    expiresAt: row.sb_access_expires_at ?? null,
  };
}

/**
 * Persist a freshly refreshed session and release the claim, in ONE write.
 *
 * Both tokens move together: storing the rotated refresh token without its
 * access token is what left instances redeeming an already-spent token.
 */
export async function storeRefreshedSession(input: {
  connectionId: string;
  sbAccessToken: string;
  sbRefreshToken: string;
  accessExpiresAt: string;
}): Promise<void> {
  assertEncryptionConfigured();
  const db = supabaseAdmin();
  await db
    .from("mcp_connections")
    .update({
      sb_access_encrypted: encrypt(input.sbAccessToken),
      sb_access_expires_at: input.accessExpiresAt,
      sb_refresh_encrypted: encrypt(input.sbRefreshToken),
      sb_refresh_lock_at: null,
    })
    .eq("id", input.connectionId);
}

/** Release the claim without storing anything, after a failed refresh. */
export async function releaseRefreshClaim(connectionId: string): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("mcp_connections")
    .update({ sb_refresh_lock_at: null })
    .eq("id", connectionId);
}

export async function updateStoredSbRefresh(
  connectionId: string,
  sbRefreshToken: string,
): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("mcp_connections")
    .update({ sb_refresh_encrypted: encrypt(sbRefreshToken) })
    .eq("id", connectionId);
}

export async function revokeConnection(connectionId: string): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("mcp_connections")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", connectionId);
}

export async function touchConnection(connectionId: string): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("mcp_connections")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", connectionId);
}
