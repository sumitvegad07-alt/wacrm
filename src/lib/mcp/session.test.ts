import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────
// The store and the Supabase SDK are the two real dependencies. Everything
// else under test here is sequencing, which is exactly what has to be right:
// a refresh that races itself invalidates the admin's token and bricks the
// connection, and that failure is invisible under a single-call test.

const store = vi.hoisted(() => ({
  findConnectionByAccessToken: vi.fn(),
  touchConnection: vi.fn(async () => {}),
  updateStoredSbRefresh: vi.fn(async () => {}),
  claimRefresh: vi.fn(async () => true),
  readStoredSession: vi.fn(
    async (): Promise<{ accessToken: string | null; expiresAt: string | null }> => ({
      accessToken: null,
      expiresAt: null,
    }),
  ),
  storeRefreshedSession: vi.fn(async () => {}),
  releaseRefreshClaim: vi.fn(async () => {}),
}));
vi.mock("./oauth/store", () => store);

const limits = vi.hoisted(() => ({
  assertDailyBudget: vi.fn(async () => {}),
  clampLimit: (n?: number) => n ?? 1000,
  wasTruncated: () => false,
  MCP_ROW_CEILING: 1000,
  MCP_DAILY_CALL_BUDGET: 2000,
}));
vi.mock("./limits", () => limits);

const sdk = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  rows: new Map<string, unknown>(),
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    sdk.createClient(...args);
    return {
      auth: { refreshSession: sdk.refreshSession },
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({
            data: sdk.rows.get(table) ?? null,
            error: sdk.rows.has(table) ? null : { message: `no ${table}` },
          }),
        };
        return builder;
      },
    };
  },
}));

import {
  McpAuthError,
  RECONNECT_MESSAGE,
  __resetMcpSessionCacheForTests,
  requireMcpContext,
} from "./session";

const CONNECTION = {
  id: "conn-1",
  account_id: "acct-1",
  profile_id: "prof-1",
  client_id: "mcp_abc",
  client_name: "Claude",
  sb_refresh_token: "sb-refresh-stored",
  access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  last_used_at: new Date().toISOString(),
  // No shared session yet, so the happy path performs a refresh.
  sb_access_token: null as string | null,
  sb_access_expires_at: null as string | null,
};

const req = (headers: Record<string, string> = {}) =>
  new Request("https://app.ozzo.co.in/api/mcp", { method: "POST", headers });

const authed = () => req({ authorization: "Bearer ozzo_mcp_good" });

function happyPath(
  over: {
    profile?: Record<string, unknown> | null;
    account?: Record<string, unknown> | null;
    connection?: Record<string, unknown>;
  } = {},
) {
  store.findConnectionByAccessToken.mockResolvedValue({ ...CONNECTION, ...(over.connection ?? {}) });
  store.claimRefresh.mockResolvedValue(true);
  store.readStoredSession.mockResolvedValue({ accessToken: null, expiresAt: null });
  sdk.refreshSession.mockResolvedValue({
    data: {
      session: {
        access_token: "sb-access-fresh",
        refresh_token: "sb-refresh-rotated",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    },
    error: null,
  });
  sdk.rows.clear();
  const profile =
    over.profile === undefined
      ? { id: "prof-1", account_id: "acct-1", account_role: "admin" }
      : over.profile;
  const account =
    over.account === undefined
      ? {
          id: "acct-1",
          name: "Shah Traders",
          subscription_plan: "CRM_SFA",
          module_settings: { quotation: false, route: true },
          settings: { timezone: "Asia/Kolkata" },
        }
      : over.account;
  if (profile) sdk.rows.set("profiles", profile);
  if (account) sdk.rows.set("accounts", account);
}

beforeEach(() => {
  __resetMcpSessionCacheForTests();
  vi.clearAllMocks();
  sdk.rows.clear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("requireMcpContext — rejecting", () => {
  it("rejects a request with no Authorization header", async () => {
    await expect(requireMcpContext(req())).rejects.toThrow(/no ozzo access token/i);
  });

  it("rejects a non-Bearer scheme", async () => {
    await expect(
      requireMcpContext(req({ authorization: "Basic abc123" })),
    ).rejects.toThrow(/no ozzo access token/i);
  });

  it("rejects an empty Bearer value", async () => {
    await expect(
      requireMcpContext(req({ authorization: "Bearer   " })),
    ).rejects.toThrow(/no ozzo access token/i);
  });

  it("accepts a lowercase bearer scheme, as some clients send", async () => {
    happyPath();
    const ctx = await requireMcpContext(req({ authorization: "bearer ozzo_mcp_good" }));
    expect(ctx.accountId).toBe("acct-1");
  });

  it("rejects an unknown, revoked or expired token with the reconnect message", async () => {
    store.findConnectionByAccessToken.mockResolvedValue(null);
    await expect(requireMcpContext(authed())).rejects.toThrow(RECONNECT_MESSAGE);
  });

  it("gives the reconnect message verbatim when the Supabase session is dead", async () => {
    // A password change or sign-out-everywhere lands here. The admin can only
    // reconnect, so the message must say that and nothing else.
    happyPath();
    sdk.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid Refresh Token" },
    });
    await expect(requireMcpContext(authed())).rejects.toThrow(RECONNECT_MESSAGE);
  });

  it("never leaks the underlying Supabase error text", async () => {
    happyPath();
    sdk.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: "JWT expired at 1790000000 for user deadbeef" },
    });
    await expect(requireMcpContext(authed())).rejects.not.toThrow(/deadbeef/);
  });

  it("refuses a demoted admin immediately, not at next refresh", async () => {
    happyPath({ profile: { id: "prof-1", account_id: "acct-1", account_role: "user" } });
    await expect(requireMcpContext(authed())).rejects.toThrow(/only an admin/i);
  });

  it.each(["user", "manager", "viewer", "", "Admin "])(
    "refuses account_role %j",
    async (role) => {
      happyPath({ profile: { id: "prof-1", account_id: "acct-1", account_role: role } });
      await expect(requireMcpContext(authed())).rejects.toThrow(McpAuthError);
    },
  );

  it.each(["admin", "owner", "superadmin", "Admin", "OWNER"])(
    "allows account_role %j",
    async (role) => {
      happyPath({ profile: { id: "prof-1", account_id: "acct-1", account_role: role } });
      await expect(requireMcpContext(authed())).resolves.toBeTruthy();
    },
  );

  it("refuses when the profile cannot be read at all", async () => {
    happyPath({ profile: null });
    await expect(requireMcpContext(authed())).rejects.toThrow(/no longer exists/i);
  });

  it("refuses when the account cannot be read", async () => {
    happyPath({ account: null });
    await expect(requireMcpContext(authed())).rejects.toThrow(/could not be read/i);
  });

  it("propagates a budget refusal", async () => {
    happyPath();
    limits.assertDailyBudget.mockRejectedValueOnce(new Error("budget spent"));
    await expect(requireMcpContext(authed())).rejects.toThrow(/budget spent/);
  });

  it("carries an HTTP status on every refusal", async () => {
    store.findConnectionByAccessToken.mockResolvedValue(null);
    await expect(requireMcpContext(authed())).rejects.toMatchObject({ status: 401 });
    happyPath({ profile: { id: "prof-1", account_id: "acct-1", account_role: "user" } });
    await expect(requireMcpContext(authed())).rejects.toMatchObject({ status: 403 });
  });
});

describe("requireMcpContext — succeeding", () => {
  it("builds a full context for an admin", async () => {
    happyPath();
    const ctx = await requireMcpContext(authed());
    expect(ctx).toMatchObject({
      connectionId: "conn-1",
      accountId: "acct-1",
      profileId: "prof-1",
      clientName: "Claude",
      accountName: "Shah Traders",
      timezone: "Asia/Kolkata",
    });
  });

  it("reads module toggles from the top-level column, not from settings", async () => {
    happyPath();
    const ctx = await requireMcpContext(authed());
    expect(ctx.tenant.moduleSettings).toEqual({ quotation: false, route: true });
  });

  it("passes the plan through raw, so legacy plans keep full access", async () => {
    happyPath({
      account: {
        id: "acct-1",
        name: "Old Co",
        subscription_plan: "Enterprise",
        module_settings: {},
        settings: {},
      },
    });
    const ctx = await requireMcpContext(authed());
    expect(ctx.tenant.plan).toBe("Enterprise");
  });

  it("defaults the timezone to IST when the account has not set one", async () => {
    happyPath({
      account: {
        id: "acct-1",
        name: "No TZ Co",
        subscription_plan: "CRM",
        module_settings: {},
        settings: {},
      },
    });
    const ctx = await requireMcpContext(authed());
    expect(ctx.timezone).toBe("Asia/Kolkata");
  });

  it("keeps the workforce switch off unless it is exactly true", async () => {
    for (const value of [undefined, false, "true", 1, null]) {
      happyPath({
        account: {
          id: "acct-1",
          name: "Co",
          subscription_plan: "CRM_SFA",
          module_settings: {},
          settings: { mcp_allow_workforce_data: value },
        },
      });
      const ctx = await requireMcpContext(authed());
      expect(ctx.tenant.allowWorkforceData, `value=${String(value)}`).toBe(false);
    }
  });

  it("turns the workforce switch on when it is true", async () => {
    happyPath({
      account: {
        id: "acct-1",
        name: "Co",
        subscription_plan: "CRM_SFA",
        module_settings: {},
        settings: { mcp_allow_workforce_data: true },
      },
    });
    const ctx = await requireMcpContext(authed());
    expect(ctx.tenant.allowWorkforceData).toBe(true);
  });

  it("ignores a malformed module_settings value rather than throwing", async () => {
    for (const bad of ["nope", 42, [], null]) {
      happyPath({
        account: {
          id: "acct-1",
          name: "Co",
          subscription_plan: "CRM",
          module_settings: bad,
          settings: {},
        },
      });
      const ctx = await requireMcpContext(authed());
      expect(ctx.tenant.moduleSettings).toEqual({});
    }
  });

  it("drops non-boolean module toggle values", async () => {
    happyPath({
      account: {
        id: "acct-1",
        name: "Co",
        subscription_plan: "CRM",
        module_settings: { route: true, quotation: "false", stock: null },
        settings: {},
      },
    });
    const ctx = await requireMcpContext(authed());
    expect(ctx.tenant.moduleSettings).toEqual({ route: true });
  });
});

describe("refresh-token handling", () => {
  it("stores the rotated refresh token together with its access token", async () => {
    // Supabase rotates on every use. Writing the refresh token without the
    // access token is what let instances redeem an already-spent token.
    happyPath();
    await requireMcpContext(authed());
    expect(store.storeRefreshedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-1",
        sbAccessToken: "sb-access-fresh",
        sbRefreshToken: "sb-refresh-rotated",
      }),
    );
  });

  it("uses the shared stored session instead of refreshing at all", async () => {
    // The fix for the dead-connection bug: a warm shared token means a cold
    // instance never redeems the single-use refresh token.
    happyPath({
      connection: {
        sb_access_token: "sb-access-shared",
        sb_access_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    });
    await requireMcpContext(authed());
    expect(sdk.refreshSession).not.toHaveBeenCalled();
    expect(store.claimRefresh).not.toHaveBeenCalled();
  });

  it("refreshes when the shared session is nearly spent", async () => {
    happyPath({
      connection: {
        sb_access_token: "sb-access-shared",
        sb_access_expires_at: new Date(Date.now() + 10_000).toISOString(),
      },
    });
    await requireMcpContext(authed());
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("ignores a shared session with an unreadable expiry", async () => {
    happyPath({
      connection: { sb_access_token: "sb-access-shared", sb_access_expires_at: "not-a-date" },
    });
    await requireMcpContext(authed());
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("does not redeem the refresh token when another instance holds the claim", async () => {
    // The race that killed the first real connection: two instances each
    // redeeming the same single-use token.
    happyPath();
    store.claimRefresh.mockResolvedValue(false);
    store.readStoredSession.mockResolvedValue({
      accessToken: "sb-access-from-winner",
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    await requireMcpContext(authed());
    expect(sdk.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes anyway if the claim holder never stores a session", async () => {
    // Better to risk one wasted refresh than to fail the admin's question
    // because another instance crashed mid-refresh.
    happyPath();
    store.claimRefresh.mockResolvedValue(false);
    store.readStoredSession.mockResolvedValue({ accessToken: null, expiresAt: null });
    await expect(requireMcpContext(authed())).resolves.toBeTruthy();
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the refresh fails, so it cannot wedge", async () => {
    happyPath();
    sdk.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: "boom" },
    });
    await expect(requireMcpContext(authed())).rejects.toThrow(RECONNECT_MESSAGE);
    expect(store.releaseRefreshClaim).toHaveBeenCalledWith("conn-1");
  });

  it("refreshes exactly once for two concurrent calls on one connection", async () => {
    // Each call redeeming the same refresh token means the loser gets an
    // invalid-token error and the connection dies.
    happyPath();
    const [a, b] = await Promise.all([
      requireMcpContext(authed()),
      requireMcpContext(authed()),
    ]);
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
    expect(a.accountId).toBe("acct-1");
    expect(b.accountId).toBe("acct-1");
  });

  it("refreshes once for five concurrent calls", async () => {
    happyPath();
    await Promise.all(Array.from({ length: 5 }, () => requireMcpContext(authed())));
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("reuses a cached session on a later sequential call", async () => {
    happyPath();
    await requireMcpContext(authed());
    await requireMcpContext(authed());
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("refreshes again once the cached session is nearly expired", async () => {
    happyPath();
    sdk.refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: "sb-access-nearly-dead",
          refresh_token: "sb-refresh-rotated",
          // Inside the 60s skew window, so it must not be reused.
          expires_at: Math.floor(Date.now() / 1000) + 10,
        },
      },
      error: null,
    });
    await requireMcpContext(authed());
    await requireMcpContext(authed());
    expect(sdk.refreshSession).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed refresh", async () => {
    happyPath();
    sdk.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "boom" },
    });
    await expect(requireMcpContext(authed())).rejects.toThrow(RECONNECT_MESSAGE);
    // Second attempt must try again rather than serving a poisoned cache.
    await expect(requireMcpContext(authed())).resolves.toBeTruthy();
    expect(sdk.refreshSession).toHaveBeenCalledTimes(2);
  });

  it("sends the admin's access token on data requests, never the anon key alone", async () => {
    happyPath();
    await requireMcpContext(authed());
    const authHeaders = sdk.createClient.mock.calls
      .map((c) => (c[2] as { global?: { headers?: Record<string, string> } })?.global?.headers)
      .filter(Boolean);
    expect(authHeaders).toContainEqual({ Authorization: "Bearer sb-access-fresh" });
  });

  it("records use of the connection without blocking the answer", async () => {
    happyPath();
    store.touchConnection.mockRejectedValueOnce(new Error("write failed"));
    await expect(requireMcpContext(authed())).resolves.toBeTruthy();
  });
});
