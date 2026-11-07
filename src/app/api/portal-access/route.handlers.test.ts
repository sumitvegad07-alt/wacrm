// Handler-level tests: what the ROUTE does with a success or a refusal.
// The seat cap, add-on check and hierarchy guard are database rules, covered by
// the SQL suite; here the "refusal" is just an error object the fake returns.
import { describe, it, expect, vi, beforeEach } from "vitest";

type R = { data: unknown; error: { message: string; code?: string } | null };

const h = vi.hoisted(() => ({
  contact: null as Record<string, unknown> | null,
  profile: { id: "profile-1" } as Record<string, unknown> | null,
  updateResult: { data: [{ id: "c1" }], error: null } as R,
  createUserResult: { data: { user: { id: "new-auth-id" } }, error: null } as {
    data: { user: { id: string } } | null;
    error: { message: string } | null;
  },
  updateUserByIdResult: { error: null } as { error: { message: string } | null },
  deleteUser: vi.fn(),
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  writes: [] as { table: string; payload: unknown; filters: string[] }[],
}));

vi.mock("@/lib/supabase/service-role-key", () => ({ serviceRoleKey: () => "test-key" }));

vi.mock("@/lib/auth/account", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/account")>("@/lib/auth/account");
  return {
    ...actual,
    requireRole: vi.fn(async () => ({ userId: "auth-user-1", accountId: "acct-1", role: "admin" })),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      const b = {
        mode: "select" as "select" | "update",
        payload: undefined as unknown,
        filters: [] as string[],
        select() {
          return b;
        },
        update(payload: unknown) {
          b.mode = "update";
          b.payload = payload;
          h.writes.push({ table, payload, filters: b.filters });
          return b;
        },
        eq(col: string) {
          b.filters.push("eq:" + col);
          return b;
        },
        is(col: string) {
          b.filters.push("is:" + col);
          return b;
        },
        async maybeSingle() {
          return { data: table === "profiles" ? h.profile : h.contact, error: null };
        },
        then(resolve: (v: R) => unknown) {
          return Promise.resolve(h.updateResult).then(resolve);
        },
      };
      return b;
    },
    auth: {
      admin: {
        createUser: (a: unknown) => {
          h.createUser(a);
          return Promise.resolve(h.createUserResult);
        },
        updateUserById: (id: string, a: unknown) => {
          h.updateUserById(id, a);
          return Promise.resolve(h.updateUserByIdResult);
        },
        deleteUser: (id: string) => {
          h.deleteUser(id);
          return Promise.resolve({ error: null });
        },
      },
    },
  }),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/portal-access", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

const NEW_CONTACT = {
  id: "c1",
  account_id: "acct-1",
  portal_user_id: null,
  portal_access: null,
  portal_access_revoked_at: null,
  portal_email: null,
};
const REVOKED_CONTACT = {
  ...NEW_CONTACT,
  portal_user_id: "existing-auth-id",
  portal_access: false,
  portal_access_revoked_at: "2026-11-01T00:00:00Z",
  portal_email: "a@b.co",
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  h.contact = { ...NEW_CONTACT };
  h.profile = { id: "profile-1" };
  h.updateResult = { data: [{ id: "c1" }], error: null };
  h.createUserResult = { data: { user: { id: "new-auth-id" } }, error: null };
  h.updateUserByIdResult = { error: null };
  h.deleteUser.mockClear();
  h.createUser.mockClear();
  h.updateUserById.mockClear();
  h.writes = [];
});

describe("POST /api/portal-access handler", () => {
  it("restore where the contact update succeeds but the password step fails: 200, ok:true, warning", async () => {
    h.contact = { ...REVOKED_CONTACT };
    h.updateUserByIdResult = { error: { message: "Password is too weak" } };
    const res = await post({ contact_id: "c1", password: "secret12" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.restored).toBe(true);
    expect(body.warning).toMatch(/Access was restored/);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("successful create: 2xx and the new auth user is kept", async () => {
    const res = await post({ contact_id: "c1", email: "x@y.co", password: "secret12" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, portal_user_id: "new-auth-id" });
    expect(h.deleteUser).not.toHaveBeenCalled();
    // metadata keeps handle_new_user from minting an account or a profile
    expect(h.createUser.mock.calls[0][0].user_metadata.skip_account_provision).toBe("true");
    // the audit column gets profiles.id, not the auth user id
    const link = h.writes.find((w) => w.table === "contacts")!;
    expect((link.payload as Record<string, unknown>).portal_access_set_by).toBe("profile-1");
  });

  it("create whose contact update is refused: non-2xx, DB text verbatim, deleteUser called with createUser's id", async () => {
    const msg = "All 1 portal logins are in use. Remove access from another customer, or buy more.";
    h.updateResult = { data: null, error: { message: msg } };
    const res = await post({ contact_id: "c1", email: "x@y.co", password: "secret12" });
    const body = await res.json();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBe(msg);
    expect(h.deleteUser).toHaveBeenCalledTimes(1);
    expect(h.deleteUser).toHaveBeenCalledWith("new-auth-id");
  });

  it("create race loser (update matches zero rows): non-2xx and deleteUser called", async () => {
    h.updateResult = { data: [], error: null };
    const res = await post({ contact_id: "c1", email: "x@y.co", password: "secret12" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.deleteUser).toHaveBeenCalledWith("new-auth-id");
    // and the update really carried the portal_user_id IS NULL guard
    const link = h.writes.find((w) => w.table === "contacts")!;
    expect(link.filters).toContain("is:portal_user_id");
  });

  it("restore whose contact update is refused: non-2xx and deleteUser NEVER called, createUser never called", async () => {
    h.contact = { ...REVOKED_CONTACT };
    h.updateResult = { data: null, error: { message: "All 1 portal logins are in use." } };
    const res = await post({ contact_id: "c1" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("restore refused with zero rows updated also never deletes anything", async () => {
    h.contact = { ...REVOKED_CONTACT };
    h.updateResult = { data: [], error: null };
    const res = await post({ contact_id: "c1" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("a customer in another account: 403 and no write attempted", async () => {
    h.contact = { ...NEW_CONTACT, account_id: "some-other-account" };
    const res = await post({ contact_id: "c1", email: "x@y.co", password: "secret12" });
    expect(res.status).toBe(403);
    expect(h.writes).toHaveLength(0);
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("an unmatched createUser error passes through readably", async () => {
    h.createUserResult = { data: null, error: { message: "Signups not allowed for this instance" } };
    const res = await post({ contact_id: "c1", email: "x@y.co", password: "secret12" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Signups not allowed for this instance");
    expect(h.deleteUser).not.toHaveBeenCalled();
  });
});
