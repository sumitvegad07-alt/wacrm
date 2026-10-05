import { describe, expect, test } from "vitest";
import { PLAN_LINES, type PlanId } from "@/lib/plans/catalog";
import {
  ALL_CATEGORIES,
  CRM_FEATURES,
  HEADING_REQUIRES,
  SFA_OWN_FEATURES,
  WFA_FEATURES,
  featuresForPlan,
  includedGroupsForPlan,
} from "./plan-features";

// The sheet is what the customer is being sold. If a feature on it never
// reaches the document, the proposal under-sells; if the document invents one,
// it over-promises. Both are caught here.

const PLANS: PlanId[] = ["CRM", "WFA", "CRM_WFA", "SFA", "CRM_SFA"];
const lower = (s: string) => s.toLowerCase();

describe("featuresForPlan", () => {
  test("WFA is exactly the WFA column", () => {
    expect(featuresForPlan("WFA")).toEqual([...WFA_FEATURES]);
  });

  test("CRM is exactly the CRM column", () => {
    expect(featuresForPlan("CRM")).toEqual([...CRM_FEATURES]);
  });

  test("SFA includes every WFA feature, as the sheet states", () => {
    const sfa = featuresForPlan("SFA").map(lower);
    for (const f of WFA_FEATURES) {
      expect(sfa, `SFA is missing "${f}"`).toContain(lower(f));
    }
  });

  test("SFA adds its own column on top", () => {
    const sfa = featuresForPlan("SFA").map(lower);
    for (const f of SFA_OWN_FEATURES) {
      expect(sfa, `SFA is missing "${f}"`).toContain(lower(f));
    }
  });

  test("SFA does not include the CRM-only features", () => {
    const sfa = featuresForPlan("SFA").map(lower);
    expect(sfa).not.toContain(lower("WhatsApp Inbox"));
    expect(sfa).not.toContain(lower("Unlimited Leads"));
    expect(sfa).not.toContain(lower("Visual Kanban Pipelines"));
  });

  test("WFA does not include order or money features", () => {
    const wfa = featuresForPlan("WFA").map(lower);
    expect(wfa).not.toContain(lower("Order collection"));
    expect(wfa).not.toContain(lower("Payment collection"));
    expect(wfa).not.toContain(lower("Live Stock Management"));
  });

  test("Route Management is sold with SFA, not WFA", () => {
    const rtm = lower("Route Management (RTM)");
    expect(featuresForPlan("WFA").map(lower)).not.toContain(rtm);
    expect(featuresForPlan("CRM_WFA").map(lower)).not.toContain(rtm);
    expect(featuresForPlan("SFA").map(lower)).toContain(rtm);
    expect(featuresForPlan("CRM_SFA").map(lower)).toContain(rtm);
  });

  test("CRM + WFA is the union of both columns", () => {
    const combo = featuresForPlan("CRM_WFA").map(lower);
    for (const f of [...WFA_FEATURES, ...CRM_FEATURES]) {
      expect(combo, `CRM+WFA is missing "${f}"`).toContain(lower(f));
    }
  });

  test("CRM + SFA is everything", () => {
    const combo = featuresForPlan("CRM_SFA").map(lower);
    for (const f of [...WFA_FEATURES, ...SFA_OWN_FEATURES, ...CRM_FEATURES]) {
      expect(combo, `CRM+SFA is missing "${f}"`).toContain(lower(f));
    }
  });

  test("lists a feature once even when two columns carry it", () => {
    // "Quotation Management" appears in both the CRM and SFA columns.
    const combo = featuresForPlan("CRM_SFA");
    const quotes = combo.filter((f) => lower(f) === lower("Quotation Management"));
    expect(quotes).toHaveLength(1);

    expect(new Set(combo.map(lower)).size).toBe(combo.length);
  });
});

describe("includedGroupsForPlan", () => {
  for (const plan of PLANS) {
    describe(plan, () => {
      const groups = includedGroupsForPlan(plan);

      test("prints every feature the plan is sold", () => {
        const printed = new Set(groups.flatMap((g) => g.li.map(lower)));
        const missing = featuresForPlan(plan).filter((f) => !printed.has(lower(f)));

        expect(missing, `${plan} sells these but the document never lists them`).toEqual([]);
      });

      test("prints nothing the plan is not sold", () => {
        const sold = new Set(featuresForPlan(plan).map(lower));
        const extra = groups.flatMap((g) => g.li).filter((f) => !sold.has(lower(f)));

        expect(extra, `${plan} lists features it does not include`).toEqual([]);
      });

      test("has no empty group and no repeated feature", () => {
        for (const g of groups) expect(g.li.length, g.h).toBeGreaterThan(0);

        const all = groups.flatMap((g) => g.li.map(lower));
        expect(new Set(all).size).toBe(all.length);
      });

      test("fits the page: between three and ten groups", () => {
        expect(groups.length).toBeGreaterThanOrEqual(3);
        expect(groups.length).toBeLessThanOrEqual(10);
      });

      test("no heading promises a product line this plan does not include", () => {
        const lines = PLAN_LINES[plan];

        const liars = groups
          .map((g) => g.h)
          .filter((h) => {
            const needs = HEADING_REQUIRES[h];
            // A heading with no entry is plan-neutral; one with an entry needs
            // at least one of its lines to be sold.
            return needs ? !needs.some((line) => lines[line]) : false;
          });

        expect(liars, `${plan} prints headings it cannot deliver`).toEqual([]);
      });
    });
  }

  // Hand-checked against the founder's pricing sheet. A change here is a change
  // to what a proposal claims, so it has to be deliberate — which is the point
  // of pinning the exact list rather than a rule.
  const EXPECTED_HEADINGS: Record<string, string[]> = {
    CRM: [
      "Leads & Deals",
      "Customers, Tasks & Follow-ups",
      "Quotations & Documents",
      "WhatsApp & Automation",
      "Attendance & Leave",
      "Platform, Reports & AI",
    ],
    WFA: [
      "Customers, Tasks & Follow-ups",
      "Attendance & Leave",
      "Field Discipline & Expenses",
      "Location & Visits",
      "Platform, Reports & AI",
    ],
    CRM_WFA: [
      "Leads & Deals",
      "Customers, Tasks & Follow-ups",
      "Quotations & Documents",
      "WhatsApp & Automation",
      "Attendance & Leave",
      "Field Discipline & Expenses",
      "Location & Visits",
      "Platform, Reports & AI",
    ],
    SFA: [
      "Customers, Tasks & Follow-ups",
      "Quotations & Documents",
      "Attendance & Leave",
      "Field Discipline & Expenses",
      "Location & Visits",
      "Orders & Distribution",
      "Money, Stock & Pricing",
      "Platform, Reports & AI",
    ],
    CRM_SFA: [
      "Leads & Deals",
      "Customers, Tasks & Follow-ups",
      "Quotations & Documents",
      "WhatsApp & Automation",
      "Attendance & Leave",
      "Field Discipline & Expenses",
      "Location & Visits",
      "Orders & Distribution",
      "Money, Stock & Pricing",
      "Platform, Reports & AI",
    ],
  };

  for (const plan of PLANS) {
    test(`${plan} prints exactly the headings it should`, () => {
      expect(includedGroupsForPlan(plan).map((g) => g.h)).toEqual(EXPECTED_HEADINGS[plan]);
    });
  }

  test("a plan without the CRM line never sees a leads, deals or WhatsApp heading", () => {
    for (const plan of PLANS) {
      if (PLAN_LINES[plan].crm) continue;
      const headings = includedGroupsForPlan(plan).map((g) => g.h).join(" | ");
      expect(headings, plan).not.toMatch(/lead|deal|kanban|whatsapp|pipeline/i);
    }
  });

  test("a plan without the SFA line never sees an order, stock or pricing heading", () => {
    for (const plan of PLANS) {
      if (PLAN_LINES[plan].sfa) continue;
      const headings = includedGroupsForPlan(plan).map((g) => g.h).join(" | ");
      expect(headings, plan).not.toMatch(/order|dispatch|stock|pricing|scheme|route/i);
    }
  });

  test("a plan without the WFA line never sees a field, location or visit heading", () => {
    for (const plan of PLANS) {
      if (PLAN_LINES[plan].wfa) continue;
      const headings = includedGroupsForPlan(plan).map((g) => g.h).join(" | ");
      expect(headings, plan).not.toMatch(/field|location|visit|geo|track/i);
    }
  });

  test("every heading that can appear is covered by HEADING_REQUIRES or is plan-neutral", () => {
    // Plan-neutral headings are listed here on purpose: adding a category
    // without deciding which lines earn it should fail, not pass silently.
    const NEUTRAL = ["Customers, Tasks & Follow-ups", "Attendance & Leave", "Platform, Reports & AI"];

    const undeclared = ALL_CATEGORIES.map((c) => c.h).filter(
      (h) => !(h in HEADING_REQUIRES) && !NEUTRAL.includes(h),
    );
    expect(undeclared, "new category: say which product lines earn its heading").toEqual([]);
  });

  test("no plan sells more features than the page can print", () => {
    // The "what's included" page is a fixed A4 sheet with overflow:hidden, so
    // a list that outgrows it is clipped silently. Measured in the browser:
    // the roomy two-column grid holds about 40 features, the dense
    // three-column grid about 55. If this fails, the sheet has grown — re-check
    // the page rather than raising the number.
    for (const plan of PLANS) {
      const count = featuresForPlan(plan).length;
      expect(count, `${plan} sells ${count} features`).toBeLessThanOrEqual(55);
    }
  });

  test("the plans sit either side of the density threshold as measured", () => {
    // SFA fits the roomy grid; CRM+SFA needs the dense one. The component
    // switches at 40, so these counts are what makes the layout hold.
    expect(featuresForPlan("SFA").length).toBeLessThanOrEqual(40);
    expect(featuresForPlan("CRM_SFA").length).toBeGreaterThan(40);
  });

  test("every category feature belongs to some plan", () => {
    const everything = new Set(featuresForPlan("CRM_SFA").map(lower));
    const orphans = ALL_CATEGORIES.flatMap((c) => c.li).filter((f) => !everything.has(lower(f)));

    expect(orphans, "categorised but not sold on any plan").toEqual([]);
  });

  test("a feature is categorised only once", () => {
    const all = ALL_CATEGORIES.flatMap((c) => c.li.map(lower));
    expect(new Set(all).size).toBe(all.length);
  });
});
