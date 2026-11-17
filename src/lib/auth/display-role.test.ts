import { describe, expect, it } from "vitest";

import {
  NO_ROLE_LABEL,
  displayRoleName,
  hasFullAccess,
} from "./display-role";

// The bug these guard against: the superadmin Members list and the
// Settings → Overview chip printed `profiles.account_role` straight to
// the screen, so a Sales Executive read as "agent" and the person who
// signed up read as "owner" — two words that name no role in this
// product. Every assertion below is really one assertion: the words
// "owner", "agent" and "viewer" never come out of this module.

describe("displayRoleName", () => {
  it("shows the admin-created role name whenever there is one", () => {
    expect(displayRoleName("Sales Executive", "agent")).toBe("Sales Executive");
    expect(displayRoleName("Admin", "owner")).toBe("Admin");
    expect(displayRoleName("Area Sales Manager", "agent")).toBe(
      "Area Sales Manager",
    );
  });

  it("never prints the internal account_role flag", () => {
    for (const flag of ["owner", "admin", "agent", "viewer", "OWNER", null]) {
      const out = displayRoleName(null, flag).toLowerCase();
      expect(out).not.toContain("owner");
      expect(out).not.toContain("agent");
      expect(out).not.toContain("viewer");
    }
  });

  it("falls back to Admin for a full-access profile with no role linked", () => {
    expect(displayRoleName(null, "owner")).toBe("Admin");
    expect(displayRoleName(undefined, "admin")).toBe("Admin");
    expect(displayRoleName("   ", "Owner")).toBe("Admin");
  });

  it("says so plainly when a profile has no role at all", () => {
    expect(displayRoleName(null, "agent")).toBe(NO_ROLE_LABEL);
    expect(displayRoleName("", "viewer")).toBe(NO_ROLE_LABEL);
    expect(displayRoleName(null, null)).toBe(NO_ROLE_LABEL);
    expect(displayRoleName(null, undefined)).toBe(NO_ROLE_LABEL);
  });
});

describe("hasFullAccess", () => {
  it("is true only for the two full-access flags", () => {
    expect(hasFullAccess("owner")).toBe(true);
    expect(hasFullAccess("admin")).toBe(true);
    expect(hasFullAccess("Admin")).toBe(true);
    expect(hasFullAccess("agent")).toBe(false);
    expect(hasFullAccess("viewer")).toBe(false);
    expect(hasFullAccess(null)).toBe(false);
    expect(hasFullAccess(undefined)).toBe(false);
  });
});
