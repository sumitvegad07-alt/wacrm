// ============================================================
// Lifecycle test for the OAuth store, against the real database.
//
// The plan called this layer "thin I/O, no unit test needed", but two of its
// behaviours are security-critical and genuinely hard to get right in a
// single statement: an authorization code must be usable exactly once even
// under a concurrent double-exchange, and a refresh token must stop working
// the instant it is rotated. Both are expressed as conditional UPDATEs, and a
// mocked client would only prove the mock agrees with itself.
//
// Scope discipline: this writes ONLY to the module's own mcp_* tables, never
// to business data, and deletes everything it created in afterAll (plus any
// leftovers from an interrupted earlier run, matched by the test client name).
// It reads one existing account/profile to satisfy the foreign keys and
// changes nothing about them.
// ============================================================
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDbTarget } from "../test-db";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  consumeAuthCode,
  createAuthCode,
  createConnection,
  findConnectionByAccessToken,
  getClient,
  registerClient,
  revokeConnection,
  rotateByRefreshToken,
  updateStoredSbRefresh,
} from "./store";

const target = testDbTarget();
const canRun = "target" in target;
if (!canRun) {
  console.warn(`[mcp] skipping live OAuth store test: ${target.reason}`);
}
const url = canRun ? target.target.url : "";
const key = canRun ? target.target.key : "";

/** Marks every row this file creates, so cleanup can find them all. */
const TEST_CLIENT_NAME = "vitest-mcp-store-lifecycle";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

describe.skipIf(!canRun)("OAuth store lifecycle", () => {
  let db: SupabaseClient;
  let accountId: string;
  let profileId: string;
  const createdClientIds: string[] = [];

  async function purge() {
    // Connections and codes cascade from the client row.
    const { data } = await db
      .from("mcp_oauth_clients")
      .select("client_id")
      .eq("client_name", TEST_CLIENT_NAME);
    const ids = (data ?? []).map((r: { client_id: string }) => r.client_id);
    if (ids.length) {
      await db.from("mcp_oauth_clients").delete().in("client_id", ids);
    }
  }

  beforeAll(async () => {
    db = createClient(url, key);
    await purge(); // clear leftovers from any interrupted earlier run

    const { data: profile, error } = await db
      .from("profiles")
      .select("id, account_id")
      .not("account_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (error || !profile) throw new Error("no profile available to anchor the FKs");
    profileId = (profile as { id: string }).id;
    accountId = (profile as { account_id: string }).account_id;
  });

  afterAll(async () => {
    await purge();
  });

  async function freshClient() {
    const c = await registerClient(TEST_CLIENT_NAME, ["https://example.com/cb"]);
    createdClientIds.push(c.client_id);
    return c;
  }

  it("registers a client and reads it back", async () => {
    const c = await freshClient();
    const got = await getClient(c.client_id);
    expect(got?.client_name).toBe(TEST_CLIENT_NAME);
    expect(got?.redirect_uris).toEqual(["https://example.com/cb"]);
  });

  it("returns null for an unknown client rather than throwing", async () => {
    expect(await getClient("mcp_does_not_exist")).toBeNull();
  });

  it("round-trips the Supabase refresh token through encryption", async () => {
    const c = await freshClient();
    const secret = `sb-refresh-${randomBytes(8).toString("hex")}`;
    const code = await createAuthCode({
      clientId: c.client_id,
      accountId,
      profileId,
      redirectUri: "https://example.com/cb",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      sbRefreshToken: secret,
    });

    // Never stored in the clear.
    const { data: raw } = await db
      .from("mcp_oauth_codes")
      .select("sb_refresh_encrypted")
      .eq("code", code)
      .maybeSingle();
    const stored = (raw as { sb_refresh_encrypted: string }).sb_refresh_encrypted;
    expect(stored).not.toContain(secret);
    expect(stored.split(":")).toHaveLength(3); // AES-GCM: iv:ciphertext:tag

    const consumed = await consumeAuthCode(code);
    expect(consumed?.sb_refresh_token).toBe(secret);
    expect(consumed?.account_id).toBe(accountId);
    expect(consumed?.code_challenge).toBe("challenge");
  });

  it("lets an authorization code be used exactly once", async () => {
    const c = await freshClient();
    const code = await createAuthCode({
      clientId: c.client_id,
      accountId,
      profileId,
      redirectUri: "https://example.com/cb",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      sbRefreshToken: "sb-refresh",
    });
    expect(await consumeAuthCode(code)).not.toBeNull();
    expect(await consumeAuthCode(code)).toBeNull();
  });

  it("lets only one of two concurrent exchanges win", async () => {
    const c = await freshClient();
    const code = await createAuthCode({
      clientId: c.client_id,
      accountId,
      profileId,
      redirectUri: "https://example.com/cb",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      sbRefreshToken: "sb-refresh",
    });
    const results = await Promise.all([consumeAuthCode(code), consumeAuthCode(code)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("refuses an expired authorization code", async () => {
    const c = await freshClient();
    const code = await createAuthCode({
      clientId: c.client_id,
      accountId,
      profileId,
      redirectUri: "https://example.com/cb",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      sbRefreshToken: "sb-refresh",
    });
    await db
      .from("mcp_oauth_codes")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("code", code);
    expect(await consumeAuthCode(code)).toBeNull();
  });

  it("refuses an unknown authorization code", async () => {
    expect(await consumeAuthCode("nope-not-a-code")).toBeNull();
  });

  it("issues a connection whose tokens are stored only as hashes", async () => {
    const c = await freshClient();
    const t = await createConnection({
      accountId,
      profileId,
      clientId: c.client_id,
      clientName: TEST_CLIENT_NAME,
      sbRefreshToken: "sb-refresh",
    });
    expect(t.accessToken).toMatch(/^ozzo_mcp_/);
    expect(t.refreshToken).toMatch(/^ozzo_mcp_/);
    expect(t.accessToken).not.toBe(t.refreshToken);
    expect(t.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);

    const { data } = await db
      .from("mcp_connections")
      .select("access_token_hash, refresh_token_hash")
      .eq("access_token_hash", sha256(t.accessToken))
      .maybeSingle();
    expect(data).not.toBeNull();
    // The plaintext appears nowhere.
    const { data: leak } = await db
      .from("mcp_connections")
      .select("id")
      .eq("access_token_hash", t.accessToken)
      .maybeSingle();
    expect(leak).toBeNull();
  });

  it("resolves a live access token to its connection", async () => {
    const c = await freshClient();
    const t = await createConnection({
      accountId,
      profileId,
      clientId: c.client_id,
      clientName: TEST_CLIENT_NAME,
      sbRefreshToken: "sb-refresh-live",
    });
    const conn = await findConnectionByAccessToken(t.accessToken);
    expect(conn?.account_id).toBe(accountId);
    expect(conn?.sb_refresh_token).toBe("sb-refresh-live");
  });

  it("refuses a token that is not ours without hitting the database", async () => {
    expect(await findConnectionByAccessToken("wacrm_live_something")).toBeNull();
    expect(await findConnectionByAccessToken("")).toBeNull();
  });

  it("refuses an unknown bearer token", async () => {
    expect(await findConnectionByAccessToken("ozzo_mcp_nonexistent")).toBeNull();
  });

  it("refuses a revoked connection immediately", async () => {
    const c = await freshClient();
    const t = await createConnection({
      accountId,
      profileId,
      clientId: c.client_id,
      clientName: TEST_CLIENT_NAME,
      sbRefreshToken: "sb-refresh",
    });
    const conn = await findConnectionByAccessToken(t.accessToken);
    await revokeConnection(conn!.id);
    expect(await findConnectionByAccessToken(t.accessToken)).toBeNull();
  });

  it("refuses an expired access token", async () => {
    const c = await freshClient();
    const t = await createConnection({
      accountId,
      profileId,
      clientId: c.client_id,
      clientName: TEST_CLIENT_NAME,
      sbRefreshToken: "sb-refresh",
    });
    await db
      .from("mcp_connections")
      .update({ access_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("access_token_hash", sha256(t.accessToken));
    expect(await findConnectionByAccessToken(t.accessToken)).toBeNull();
  });

  it("refuses a connection idle for more than 90 days", async () => {
    const c = await freshClient();
    const t = await createConnection({
      accountId,
      profileId,
      clientId: c.client_id,
      clientName: TEST_CLIENT_NAME,
      sbRefreshToken: "sb-refresh",
    });
    await db
      .from("mcp_connections")
      .update({ last_used_at: new Date(Date.now() - 91 * 86_400_000).toISOString() })
      .eq("access_token_hash", sha256(t.accessToken));
    expect(await findConnectionByAccessToken(t.accessToken)).toBeNull();
  });

  it("rotates the token pair and kills the old refresh token", async () => {
    const c = await freshClient();
    const first = await createConnection({
      accountId,
      profileId,
      clientId: c.client_id,
      clientName: TEST_CLIENT_NAME,
      sbRefreshToken: "sb-refresh",
    });
    const second = await rotateByRefreshToken(first.refreshToken);
    expect(second).not.toBeNull();
    expect(second!.accessToken).not.toBe(first.accessToken);

    // New access token works; old one does not.
    expect(await findConnectionByAccessToken(second!.accessToken)).not.toBeNull();
    expect(await findConnectionByAccessToken(first.accessToken)).toBeNull();

    // A replayed refresh token finds no row.
    expect(await rotateByRefreshToken(first.refreshToken)).toBeNull();
  });

  it("refuses to rotate a revoked connection", async () => {
    const c = await freshClient();
    const t = await createConnection({
      accountId,
      profileId,
      clientId: c.client_id,
      clientName: TEST_CLIENT_NAME,
      sbRefreshToken: "sb-refresh",
    });
    const conn = await findConnectionByAccessToken(t.accessToken);
    await revokeConnection(conn!.id);
    expect(await rotateByRefreshToken(t.refreshToken)).toBeNull();
  });

  it("persists a rotated Supabase refresh token", async () => {
    const c = await freshClient();
    const t = await createConnection({
      accountId,
      profileId,
      clientId: c.client_id,
      clientName: TEST_CLIENT_NAME,
      sbRefreshToken: "sb-refresh-old",
    });
    const conn = await findConnectionByAccessToken(t.accessToken);
    await updateStoredSbRefresh(conn!.id, "sb-refresh-new");
    const again = await findConnectionByAccessToken(t.accessToken);
    expect(again?.sb_refresh_token).toBe("sb-refresh-new");
  });
});
