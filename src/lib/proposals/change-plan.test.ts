import { describe, expect, test } from "vitest";
import { changePlan } from "./change-plan";
import { getTemplate } from "./registry";
import type { ProposalData } from "./types";

// Switching a proposal's plan rewrites the document. The question these tests
// pin down is what happens to everything the founder already typed.

function sfaProposal(over: Partial<ProposalData> = {}): ProposalData {
  return {
    ...getTemplate("CRM_SFA")!.defaults("2026-09-26"),
    ref: "OZZO/2026/09/ACM-01",
    client: {
      name: "Acme Industries",
      shortName: "Acme",
      industry: "Engineering",
      website: "acme.example",
      address: "Pune",
    },
    ...over,
  };
}

describe("changePlan", () => {
  test("keeps everything the founder typed about the client", () => {
    const before = sfaProposal();
    const after = changePlan(before, "CRM_SFA", "CRM");

    expect(after.client).toEqual(before.client);
    expect(after.ref).toBe(before.ref);
    expect(after.proposalDate).toBe(before.proposalDate);
    expect(after.validDays).toBe(before.validDays);
    expect(after.preparedBy).toEqual(before.preparedBy);
  });

  test("re-labels the price rows for the new plan", () => {
    const after = changePlan(sfaProposal(), "CRM_SFA", "CRM");

    // Leaving "OZZO CRM + SFA — Field Salesman" on a CRM proposal is exactly
    // the kind of stale detail that goes out to a client unnoticed.
    expect(after.lineItems[0].label).toContain("CRM");
    expect(after.lineItems[0].label).not.toContain("SFA");
    for (const item of after.lineItems) {
      expect(item.label).not.toContain("SFA");
    }
  });

  test("re-bases the rate to the new plan's list price", () => {
    const after = changePlan(sfaProposal(), "CRM_SFA", "CRM");

    for (const item of after.lineItems) {
      expect(item.rate).toBe(1200);
    }
  });

  test("keeps the team size — that is about the client, not the plan", () => {
    const before = sfaProposal({
      lineItems: [
        { label: "OZZO CRM + SFA — Field Salesman", subLabel: "x", users: 14, rate: 4800 },
        { label: "OZZO CRM + SFA — Admin / Manager", subLabel: "y", users: 3, rate: 4800 },
      ],
    });
    const after = changePlan(before, "CRM_SFA", "CRM");

    expect(after.lineItems.map((i) => i.users)).toEqual([14, 3]);
  });

  test("keeps extra rows the founder added, re-priced but not renamed away", () => {
    const before = sfaProposal({
      lineItems: [
        { label: "OZZO CRM + SFA — Field Salesman", subLabel: "x", users: 5, rate: 4800 },
        { label: "OZZO CRM + SFA — Admin / Manager", subLabel: "y", users: 1, rate: 4800 },
        { label: "Onsite training day", subLabel: "one-off", users: 2, rate: 5000 },
      ],
    });
    const after = changePlan(before, "CRM_SFA", "CRM");

    expect(after.lineItems).toHaveLength(3);
    expect(after.lineItems[2].label).toBe("Onsite training day");
    expect(after.lineItems[2].users).toBe(2);
  });

  test("leaves a founder-added row's own price alone", () => {
    // A one-off training day is not a plan seat, so its price is not
    // plan-derived — re-basing it to the per-user rate would be wrong.
    const before = sfaProposal({
      lineItems: [
        { label: "OZZO CRM + SFA — Field Salesman", subLabel: "x", users: 5, rate: 4800 },
        { label: "OZZO CRM + SFA — Admin / Manager", subLabel: "y", users: 1, rate: 4800 },
        { label: "Onsite training day", subLabel: "one-off", users: 2, rate: 5000 },
      ],
    });
    const after = changePlan(before, "CRM_SFA", "CRM");

    expect(after.lineItems[2].rate).toBe(5000);
    expect(after.lineItems[0].rate).toBe(1200);
  });

  test("adds rows when the new plan seats more kinds of user than the old one", () => {
    const before = sfaProposal({
      lineItems: [{ label: "OZZO CRM — User", subLabel: "x", users: 9, rate: 1200 }],
    });
    const after = changePlan(before, "CRM", "CRM_SFA");

    expect(after.lineItems.length).toBeGreaterThanOrEqual(1);
    expect(after.lineItems[0].users).toBe(9);
    for (const item of after.lineItems) expect(item.rate).toBe(4800);
  });

  describe("industry wording", () => {
    test("swaps it when it is still the old plan's untouched default", () => {
      const before = sfaProposal();
      const after = changePlan(before, "CRM_SFA", "WFA");

      expect(after.voice).toEqual(getTemplate("WFA")!.defaults("2026-09-26").voice);
    });

    test("never overwrites wording the founder has edited", () => {
      const mine = {
        built: "You've built a lubricants brand across 200 garages.",
        industryPlural: "lubricant distributors",
        builtFor: "Built for garage networks — beats & schemes out of the box.",
      };
      const after = changePlan(sfaProposal({ voice: mine }), "CRM_SFA", "CRM");

      expect(after.voice).toEqual(mine);
    });

    test("treats a part-edited voice as edited", () => {
      const before = sfaProposal();
      const partly = { ...before.voice, industryPlural: "machine shops" };
      const after = changePlan({ ...before, voice: partly }, "CRM_SFA", "CRM");

      expect(after.voice).toEqual(partly);
    });
  });

  test("leaves GST alone — it is about the customer, not the plan", () => {
    const after = changePlan(sfaProposal({ gstEnabled: true, gstRate: 18 }), "CRM_SFA", "CRM");

    expect(after.gstEnabled).toBe(true);
    expect(after.gstRate).toBe(18);
  });

  test("returns the data untouched when the plan has not actually changed", () => {
    const before = sfaProposal({
      lineItems: [{ label: "Negotiated seat", subLabel: "", users: 4, rate: 3333 }],
    });

    expect(changePlan(before, "CRM_SFA", "CRM_SFA")).toEqual(before);
  });

  test("returns the data untouched for an unknown target plan", () => {
    const before = sfaProposal();

    expect(changePlan(before, "CRM_SFA", "NOPE")).toEqual(before);
  });
});
