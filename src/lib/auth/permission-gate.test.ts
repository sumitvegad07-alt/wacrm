// ============================================================
// The bug this encodes, measured on production 2026-10-27:
//
// Cold-load /team/roles and sample every 100ms. At 3636ms the page
// renders "Access Denied" with a stripped sidebar and a placeholder
// user; at 4310ms it corrects itself. A 674ms false denial, on every
// cold load, for a user who is the account owner.
//
// Why: `use-auth` deliberately flips session `loading` to false without
// waiting for the profile row, and says so — "it sees the
// `{ loading: false, profile: null }` window during initial load and may
// take the branch incorrectly". In that window `permissions` is null AND
// `accountRole` is null, so the context's `hasPermission()` returns false
// for everyone — the isOwner/isAdmin short-circuit reads the same null
// profile, so even a superadmin is denied.
//
// Sixteen full-page gates called `hasPermission()` with no profileLoading
// check and rendered their denial branch into that window.
//
// The rule: a gate has THREE states, not two. "I don't know yet" is not
// "no". `components/auth/require-role.tsx` already got this right for
// roles; this is the same rule for permissions.
// ============================================================
import { describe, expect, it } from "vitest";
import { permissionGateState } from "./permission-gate";

describe("permissionGateState", () => {
  it("waits instead of denying while the profile is still loading", () => {
    // The regression. `allowed` is false here ONLY because permissions
    // have not arrived yet — denying on it is what put "Access Denied"
    // in front of the account owner.
    expect(permissionGateState({ profileLoading: true, allowed: false })).toBe(
      "loading",
    );
  });

  it("waits even when the permission already reads as granted", () => {
    // Fail closed on the other side too: never flash gated content to a
    // user we have not finished identifying. Same reasoning as RequireRole.
    expect(permissionGateState({ profileLoading: true, allowed: true })).toBe(
      "loading",
    );
  });

  it("allows once the profile has settled and the permission is granted", () => {
    expect(permissionGateState({ profileLoading: false, allowed: true })).toBe(
      "allowed",
    );
  });

  it("denies once the profile has settled and the permission is absent", () => {
    // The real denial still has to work — this is the whole point of the
    // gate, and the case a naive "always show a spinner" fix would break.
    expect(permissionGateState({ profileLoading: false, allowed: false })).toBe(
      "denied",
    );
  });

  it("denies rather than hanging when the profile settled but never arrived", () => {
    // The stuck variant: `fetchProfile` threw, so the catch logged and the
    // finally set profileLoading=false with profile still null — no retry,
    // no error state. The gate cannot tell that from a genuine denial, so
    // it denies. Documented deliberately: making this "loading" would hang
    // the page forever. Distinguishing the two needs an error state on the
    // auth context, which is a separate change.
    expect(permissionGateState({ profileLoading: false, allowed: false })).toBe(
      "denied",
    );
  });
});
