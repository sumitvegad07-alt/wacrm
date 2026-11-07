import { describe, it, expect } from "vitest";
import {
  friendlyAuthError,
  friendlyDbError,
  planPortalGrant,
  validatePortalLogin,
} from "./route";

describe("portal login validation", () => {
  it("requires an email-shaped address, even though it is never delivered to", () => {
    expect(validatePortalLogin("ramesh", "secret12")).toMatch(/email/i);
    expect(validatePortalLogin("xyz@abc.com", "secret12")).toBeNull();
  });

  it("requires a password of at least 8 characters", () => {
    expect(validatePortalLogin("xyz@abc.com", "short")).toMatch(/8/);
  });

  it("turns the duplicate-email error from Supabase into something an admin can act on", () => {
    expect(
      friendlyAuthError("A user with this email address has already been registered")
    ).toBe(
      "That login is already taken. Portal logins are shared across all of OZZO, so pick another address."
    );
  });

  it("passes other errors through rather than inventing a message", () => {
    expect(friendlyAuthError("Password is too weak")).toBe("Password is too weak");
    const seats = "All 1 portal logins are in use. Remove access from another customer, or buy more.";
    expect(friendlyAuthError(seats)).toBe(seats);
  });
});

describe("planPortalGrant", () => {
  const none = { portal_user_id: null, portal_access: null, portal_access_revoked_at: null, portal_email: null };
  const live = { portal_user_id: "u1", portal_access: true, portal_access_revoked_at: null, portal_email: "a@b.co" };
  const revoked = {
    portal_user_id: "u1",
    portal_access: false,
    portal_access_revoked_at: "2026-11-01T00:00:00Z",
    portal_email: "a@b.co",
  };

  it("creates when there is no login yet, validating email and password", () => {
    expect(planPortalGrant(none, "a@b.co", "secret12").kind).toBe("create");
    expect(planPortalGrant(none, "bad", "secret12").kind).toBe("refuse");
    expect(planPortalGrant(none, "a@b.co", "").kind).toBe("refuse");
  });

  it("refuses when a working login exists and points at the password reset", () => {
    const p = planPortalGrant(live, "a@b.co", "secret12");
    expect(p.kind).toBe("refuse");
    expect((p as { error: string }).error).toMatch(/Reset the password/);
  });

  it("restores a revoked login without needing email or password", () => {
    expect(planPortalGrant(revoked, undefined, undefined)).toEqual({ kind: "restore", password: null });
  });

  it("restores when access is off, or when a revocation stamp is present", () => {
    expect(planPortalGrant({ ...live, portal_access: false }, undefined, "").kind).toBe("restore");
    expect(planPortalGrant({ ...live, portal_access_revoked_at: "x" }, undefined, "").kind).toBe("restore");
  });

  it("carries a new password on restore, and rejects a short one", () => {
    expect(planPortalGrant(revoked, "A@B.co", "secret12")).toEqual({ kind: "restore", password: "secret12" });
    expect(planPortalGrant(revoked, undefined, "short").kind).toBe("refuse");
  });

  it("refuses a different email on restore", () => {
    expect(planPortalGrant(revoked, "other@b.co", "secret12").kind).toBe("refuse");
  });
});

describe("friendlyDbError", () => {
  it("maps our own per-account unique index to a same-account sentence", () => {
    expect(
      friendlyDbError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "contacts_portal_email_idx"',
      })
    ).toBe("Another customer in your account already uses that login.");
  });

  it("does not catch an unrelated unique violation, and passes trigger text through", () => {
    const other = 'duplicate key value violates unique constraint "contacts_something_else_key"';
    expect(friendlyDbError({ code: "23505", message: other })).toBe(other);
    const seats = "All 1 portal logins are in use. Remove access from another customer, or buy more.";
    expect(friendlyDbError({ message: seats })).toBe(seats);
  });
});
