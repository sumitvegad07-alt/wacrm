import { describe, expect, it } from "vitest";
import { PLAN_IDS } from "@/lib/plans/catalog";
import { getTemplate } from "@/lib/proposals/registry";
import { quotablePlans } from "./quotable-plans";

// ---------------------------------------------------------------------------
// The calculator is a quoting tool, so it must only offer plans whose price is
// approved. lib/plans/pricing.ts says the FSM prices are PROVISIONAL
// placeholders, and lib/proposals/registry.ts already encodes the same rule:
// a plan is proposable only once its sales copy and price exist.
//
// Without this, adding the FSM line to PLAN_IDS silently put three unapproved
// prices in front of the founder mid-call, and offered a "Create proposal"
// button that cannot produce a document.
// ---------------------------------------------------------------------------

describe("quotablePlans", () => {
  it("offers the five approved plans", () => {
    expect(quotablePlans()).toEqual(["CRM", "WFA", "CRM_WFA", "SFA", "CRM_SFA"]);
  });

  it("never offers a plan that cannot produce a proposal", () => {
    for (const plan of quotablePlans()) {
      expect(getTemplate(plan)).toBeDefined();
    }
  });

  it("leaves out plans whose price is not approved", () => {
    const unpriced = PLAN_IDS.filter((p) => !getTemplate(p));
    expect(unpriced.length).toBeGreaterThan(0); // the FSM line, today
    for (const plan of unpriced) {
      expect(quotablePlans()).not.toContain(plan);
    }
  });
});
