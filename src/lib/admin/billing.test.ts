import { describe, expect, it } from "vitest";
import {
  BillingValidationError,
  MIN_BILLABLE_SEATS,
  monthlyRevenue,
  validateBillingChange,
  type AccountBillingState,
} from "./billing";

function account(over: Partial<AccountBillingState> = {}): AccountBillingState {
  return {
    subscription_plan: "Basic",
    subscription_status: "active",
    subscription_expires_at: null,
    user_count: 5,
    module_settings: { whatsapp: true, route: false },
    ...over,
  };
}

describe("validateBillingChange", () => {
  it("returns only the fields that actually changed", () => {
    // A no-op change must produce an empty patch so the audit entry does not
    // claim something moved when nothing did.
    expect(validateBillingChange(account(), { plan: "Basic" }, 3)).toEqual({});
  });

  it("accepts an upgrade and a downgrade", () => {
    expect(validateBillingChange(account(), { plan: "Pro" }, 3)).toEqual({
      subscription_plan: "Pro",
    });
    expect(
      validateBillingChange(account({ subscription_plan: "Pro" }), { plan: "Basic" }, 3),
    ).toEqual({ subscription_plan: "Basic" });
  });

  it("rejects an unknown plan or status", () => {
    expect(() => validateBillingChange(account(), { plan: "Platinum" }, 3)).toThrow(
      BillingValidationError,
    );
    expect(() => validateBillingChange(account(), { status: "vibing" }, 3)).toThrow(
      BillingValidationError,
    );
  });

  it("normalises a trial extension to an ISO timestamp", () => {
    const out = validateBillingChange(account(), { expiresAt: "2026-12-31" }, 3);
    expect(out.subscription_expires_at).toBe(
      new Date(Date.parse("2026-12-31")).toISOString(),
    );
  });

  it("clears the expiry when passed null or empty string", () => {
    expect(
      validateBillingChange(account(), { expiresAt: null }, 3).subscription_expires_at,
    ).toBeNull();
    expect(
      validateBillingChange(account(), { expiresAt: "" }, 3).subscription_expires_at,
    ).toBeNull();
  });

  it("rejects an unparseable expiry", () => {
    expect(() =>
      validateBillingChange(account(), { expiresAt: "next tuesday" }, 3),
    ).toThrow(BillingValidationError);
  });

  it("refuses a seat count below the users who already exist", () => {
    // Under-setting the limit silently locks the tenant out of managing their
    // own team, because employee creation enforces it.
    expect(() => validateBillingChange(account(), { userCount: 2 }, 7)).toThrow(
      /already has 7 users/,
    );
  });

  it("allows a seat count equal to the current user total", () => {
    expect(validateBillingChange(account(), { userCount: 7 }, 7)).toEqual({
      user_count: 7,
    });
  });

  it("rejects a non-integer or zero seat count", () => {
    expect(() => validateBillingChange(account(), { userCount: 2.5 }, 1)).toThrow(
      BillingValidationError,
    );
    expect(() => validateBillingChange(account(), { userCount: 0 }, 0)).toThrow(
      BillingValidationError,
    );
  });

  it("merges module toggles over the existing settings rather than replacing them", () => {
    // Replacing wholesale would silently re-enable every module the caller
    // omitted from the request.
    const out = validateBillingChange(account(), { modules: { route: true } }, 3);
    expect(out.module_settings).toEqual({ whatsapp: true, route: true });
  });

  it("rejects an unknown module key or a non-boolean value", () => {
    expect(() =>
      validateBillingChange(account(), { modules: { teleportation: true } }, 3),
    ).toThrow(/Unknown module/);
    expect(() =>
      validateBillingChange(account(), { modules: { route: "yes" } }, 3),
    ).toThrow(BillingValidationError);
  });

  it("rejects modules sent as an array", () => {
    expect(() => validateBillingChange(account(), { modules: ["route"] }, 3)).toThrow(
      BillingValidationError,
    );
  });

  it("handles an account with no module settings yet", () => {
    const out = validateBillingChange(
      account({ module_settings: null }),
      { modules: { payment: false } },
      3,
    );
    expect(out.module_settings).toEqual({ payment: false });
  });

  it("combines several changes in one patch", () => {
    const out = validateBillingChange(
      account(),
      { plan: "Enterprise", status: "active", userCount: 12 },
      5,
    );
    expect(out).toEqual({ subscription_plan: "Enterprise", user_count: 12 });
  });
});

describe("monthlyRevenue", () => {
  it("prices by plan and seat count", () => {
    expect(monthlyRevenue("Pro", 10)).toBe(2000);
  });

  it("applies the seat floor", () => {
    expect(monthlyRevenue("Basic", 1)).toBe(100 * MIN_BILLABLE_SEATS);
    expect(monthlyRevenue("Basic", null)).toBe(100 * MIN_BILLABLE_SEATS);
  });

  it("values Trial and unknown plans at zero", () => {
    expect(monthlyRevenue("Trial", 50)).toBe(0);
    expect(monthlyRevenue(null, 50)).toBe(0);
    expect(monthlyRevenue("Legacy", 50)).toBe(0);
  });
});
