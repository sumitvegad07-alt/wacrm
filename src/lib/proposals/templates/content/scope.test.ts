import { describe, expect, test } from "vitest";
import { PLAN_LINES, type PlanId } from "@/lib/plans/catalog";
import { getTemplate, listTemplates } from "../../registry";
import { includedGroupsForPlan } from "../../plan-features";
import type { PlanContent } from "../content-types";

// ---------------------------------------------------------------------------
// A proposal is a promise. If a CRM proposal advertises order capture, the
// customer pays for something the plan will not unlock — plan gating is
// enforced in the database, so they would simply not have it.
//
// These tests read every word of each plan's content pack and fail if it
// claims a capability belonging to a product line that plan does not turn on.
// ---------------------------------------------------------------------------

/** Every string in a content pack, flattened. */
function allCopy(content: PlanContent): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(content);
  return parts.join(" • ");
}

/**
 * Capability phrases owned by each product line. Deliberately phrases, not
 * bare words: "in order" is ordinary English, "order capture" is a promise.
 */
const LINE_CLAIMS: Record<"crm" | "wfa" | "sfa", string[]> = {
  crm: [
    "lead lands",
    "Leads &",
    "Leads,",
    "deal pipeline",
    "Deal Pipelines",
    "Kanban",
    "WhatsApp team inbox",
    "WhatsApp Team Inbox",
    "shared WhatsApp inbox",
    "Shared WhatsApp inbox",
    "AI assistant",
    "AI Assistant",
    "quotation",
    "Quotation",
  ],
  wfa: [
    "GPS",
    "live location",
    "Live location",
    "Live Location",
    "geo-fenc",
    "Geo-fenc",
    "geo-tagged",
    "Geo-tagged",
    "territory",
    "Territory",
    "odometer",
    "Odometer",
    "expense claim",
    "Expense claims",
    "attendance muster",
  ],
  sfa: [
    "beat planner",
    "Beat &",
    "Beat,",
    "beat routes",
    "Route Management",
    "route planner",
    "Route compliance",
    "assigned routes",
    "order capture",
    "Order capture",
    "Offline order capture",
    "orders at the counter",
    "Take orders",
    "outstanding",
    "Outstanding",
    "stock ledger",
    "Stock ledger",
    "closing stock",
    "Closing stock",
    "Ageing",
    "scheme",
    "Scheme",
    "dispatch",
    "Dispatch",
    "Daily Sales Report",
    "price list",
    "Price list",
    "trade level",
    "Trade Hierarchy",
    "collection",
    "Collection",
  ],
};

describe("plan content packs", () => {
  test("every sellable plan has a template", () => {
    expect(listTemplates().map((t) => t.plan)).toEqual([
      "CRM",
      "WFA",
      "CRM_WFA",
      "SFA",
      "CRM_SFA",
    ]);
  });

  test("an unknown plan has no template", () => {
    expect(getTemplate("NOPE")).toBeUndefined();
  });

  const plans: PlanId[] = ["CRM", "WFA", "CRM_WFA", "SFA", "CRM_SFA"];

  for (const plan of plans) {
    describe(plan, () => {
      const template = getTemplate(plan)!;
      const copy = allCopy(template.content);
      const lines = PLAN_LINES[plan];

      for (const line of ["crm", "wfa", "sfa"] as const) {
        if (lines[line]) continue;

        test(`claims nothing from the ${line.toUpperCase()} line, which this plan does not include`, () => {
          const claimed = LINE_CLAIMS[line].filter((phrase) => copy.includes(phrase));
          expect(claimed, `${plan} must not promise ${line.toUpperCase()} capabilities`).toEqual([]);
        });
      }

      test("names itself after the plan", () => {
        expect(template.content.planName).toContain("OZZO");
        expect(template.label).toBeTruthy();
      });

      test("has the feature groups and benefit lines the two-page layout expects", () => {
        expect(includedGroupsForPlan(plan).length).toBeGreaterThanOrEqual(3);
        // The sixth "why" tile is the client-specific built-for line.
        expect(template.content.why).toHaveLength(5);
      });

      test("has a tagline for the page-1 heading", () => {
        expect(template.content.tagline.length).toBeGreaterThan(30);
      });

      test("starts from the catalog list price", () => {
        const data = template.defaults("2026-09-26");
        expect(data.lineItems.length).toBeGreaterThan(0);
        for (const item of data.lineItems) {
          expect(item.rate).toBe(template.listRatePerMonth);
        }
      });
    });
  }

  test("list prices are the catalog monthly price on the yearly term", () => {
    expect(getTemplate("CRM")!.listRatePerMonth).toBe(100);
    expect(getTemplate("WFA")!.listRatePerMonth).toBe(150);
    expect(getTemplate("CRM_WFA")!.listRatePerMonth).toBe(200);
    expect(getTemplate("SFA")!.listRatePerMonth).toBe(300);
    expect(getTemplate("CRM_SFA")!.listRatePerMonth).toBe(400);
  });
});
