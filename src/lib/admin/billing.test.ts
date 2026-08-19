import { describe, expect, it } from "vitest";
import {
  BillingValidationError,
  MIN_BILLABLE_SEATS,
  monthlyRevenue,
  validateBillingChange,
  type AccountBillingState,
} from "./billing";
import { defaultModuleSettings } from "@/lib/plans/catalog";

function account(over: Partial<AccountBillingState> = {}): AccountBillingState {
  return {
    subscription_plan: "CRM_SFA", // full-access plan by default
    subscription_status: "active",
    subscription_expires_at: null,
    user_count: 5,
    module_settings: { whatsapp: true, route: false },
    ...over,
  };
}

describe("validateBillingChange", () => {
  it("returns an empty patch when nothing changes", () => {
    expect(validateBillingChange(account(), { plan: "CRM_SFA" }, 3)).toEqual({});
  });

  it("accepts a plan change and seeds that plan's default modules", () => {
    const out = validateBillingChange(
      account({ subscription_plan: "CRM" }),
      { plan: "CRM_SFA" },
      3,
    );
    expect(out.subscription_plan).toBe("CRM_SFA");
    expect(out.module_settings).toEqual(defaultModuleSettings("CRM_SFA"));
  });

  it("rejects an unknown plan or status", () => {
    expect(() => validateBillingChange(account(), { plan: "Platinum" }, 3)).toThrow(
      BillingValidationError,
    );
    expect(() => validateBillingChange(account(), { status: "vibing" }, 3)).toThrow(
      BillingValidationError,
    );
  });

  it("does not reject a save that leaves a legacy plan value untouched", () => {
    // A legacy 'Free' account edited for seats only must still save even though
    // 'Free' is not one of the new sellable plans.
    const out = validateBillingChange(
      account({ subscription_plan: "Free" }),
      { plan: "Free", userCount: 6 },
      5,
    );
    expect(out.subscription_plan).toBeUndefined();
    expect(out.user_count).toBe(6);
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
    expect(() => validateBillingChange(account(), { userCount: 2 }, 7)).toThrow(
      /already has 7 users/,
    );
  });

  it("rejects a non-integer or zero seat count", () => {
    expect(() => validateBillingChange(account(), { userCount: 2.5 }, 1)).toThrow(
      BillingValidationError,
    );
    expect(() => validateBillingChange(account(), { userCount: 0 }, 0)).toThrow(
      BillingValidationError,
    );
  });

  it("hard-locks: an off-plan module can never be written true", () => {
    // A CRM tenant tries to enable payment (an SFA module) and quotation.
    const out = validateBillingChange(
      account({ subscription_plan: "CRM", module_settings: { whatsapp: true } }),
      { modules: { payment: true, quotation: true } },
      3,
    );
    expect(out.module_settings?.payment).toBe(false); // clamped
    expect(out.module_settings?.quotation).toBe(true); // allowed on CRM
    expect(out.module_settings?.whatsapp).toBe(true); // preserved
  });

  it("keeps allowed modules editable within the plan", () => {
    const out = validateBillingChange(account(), { modules: { route: true } }, 3);
    expect(out.module_settings?.route).toBe(true);
  });

  it("ignores unknown module keys instead of writing them", () => {
    const out = validateBillingChange(
      account(),
      { modules: { teleportation: true } as never },
      3,
    );
    expect(out.module_settings).toBeDefined();
    expect("teleportation" in (out.module_settings ?? {})).toBe(false);
  });

  it("rejects modules sent as an array", () => {
    expect(() => validateBillingChange(account(), { modules: ["route"] }, 3)).toThrow(
      BillingValidationError,
    );
  });

  it("combines several changes in one patch", () => {
    const out = validateBillingChange(
      account(),
      { plan: "SFA", status: "active", userCount: 12 },
      5,
    );
    expect(out.subscription_plan).toBe("SFA");
    expect(out.user_count).toBe(12);
    expect(out.module_settings).toEqual(defaultModuleSettings("SFA"));
  });
});

describe("monthlyRevenue", () => {
  it("prices by plan and seat count", () => {
    expect(monthlyRevenue("CRM_WFA", 10)).toBe(2000); // ₹200 × 10
  });

  it("applies the seat floor", () => {
    expect(monthlyRevenue("CRM", 1)).toBe(100 * MIN_BILLABLE_SEATS);
    expect(monthlyRevenue("CRM", null)).toBe(100 * MIN_BILLABLE_SEATS);
  });

  it("values Trial, legacy and unknown plans at zero", () => {
    expect(monthlyRevenue("Trial", 50)).toBe(0);
    expect(monthlyRevenue(null, 50)).toBe(0);
    expect(monthlyRevenue("Enterprise", 50)).toBe(0); // legacy → priced by the billing page
  });
});
