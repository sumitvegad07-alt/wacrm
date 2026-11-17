import { describe, expect, it } from "vitest";

import type { ProductLine } from "@/lib/plans/catalog";
import type { GateContext } from "@/lib/plans/surface-gates";
import { dsrReportConfig } from "./dsrReportConfig";
import { allowedMeasureKeys, allowedMeasures } from "./measure-gates";

// The bug: the founder removed CRM from his demo account, keeping SFA, and
// the DSR still offered New Leads, Lead Visits, Quotation Amount, New Deals
// and Deal Amount. `ReportMeasure.requiredModule` was declared in types.ts
// from the day the report engine was written (2026-08-12) and read by
// NOTHING — `git log -S requiredModule` on report-viewer.tsx is empty for
// the file's whole history. So every report has always offered every column
// on every plan.
//
// These tests are per product line rather than per plan id, because that is
// what the column actually depends on: the table its SQL reads.

const ctx = (owns: Partial<Record<ProductLine, boolean>>): GateContext => ({
  owns: {
    crm: false,
    wfa: false,
    sfa: false,
    fsm: false,
    dms: false,
    ...owns,
  },
  // Module toggles are a separate, independent gate; these tests are about
  // the plan line, so everything the account could own is switched on.
  isModuleEnabled: () => true,
});

/** Source table per measure, read off 20260818180000_dsr_report_module.sql. */
const CRM_ONLY = [
  "new_leads", // leads
  "quotation_amount", // quotations — CRM-only by founder ruling 2026-10-18
  "approved_quotation_amount",
  "new_deals", // deals
  "deal_amount",
];

const SFA_ONLY = [
  "order_count", // orders
  "order_amount",
  "order_quantity",
  "payment_collected", // payments
  "payment_approved",
  "payment_pending",
  "payment_rejected",
  "payment_cancelled",
];

const WFA_ONLY = [
  "visited_customers", // site_visits
  "missed_customers",
  "total_visits",
  "days_present", // tracking_sessions
  "leave_days",
  "distance_km",
  "expense_claimed", // expenses
  "expense_approved",
  "expense_pending",
  "expense_rejected",
];

/** Reads two tables, so neither line alone can produce one. */
const BOTH_LINES: Record<string, ProductLine[]> = {
  lead_visits: ["wfa", "crm"], // site_visits WHERE target_type = 'Lead'
  productive_visits: ["wfa", "sfa"], // site_visits with EXISTS(orders)
};

/** `contacts` exists on every plan, so these are never gated. */
const ALWAYS = ["assigned_customers", "new_customers"];

describe("DSR columns follow the plan line", () => {
  it("hides every CRM column from an SFA-only account", () => {
    const keys = allowedMeasureKeys(dsrReportConfig.measures, ctx({ sfa: true }));
    for (const key of CRM_ONLY) expect(keys.has(key)).toBe(false);
    // Lead Visits needs leads AND visits — no CRM, no column.
    expect(keys.has("lead_visits")).toBe(false);
  });

  it("hides every SFA column from a CRM-only account", () => {
    const keys = allowedMeasureKeys(dsrReportConfig.measures, ctx({ crm: true }));
    for (const key of SFA_ONLY) expect(keys.has(key)).toBe(false);
    expect(keys.has("productive_visits")).toBe(false);
  });

  it("hides every WFA column from an account without WFA", () => {
    const keys = allowedMeasureKeys(dsrReportConfig.measures, ctx({ crm: true, sfa: true }));
    for (const key of WFA_ONLY) expect(keys.has(key)).toBe(false);
  });

  it("needs BOTH lines for a column that reads two modules", () => {
    for (const [key, lines] of Object.entries(BOTH_LINES)) {
      const [a, b] = lines;
      expect(allowedMeasureKeys(dsrReportConfig.measures, ctx({ [a]: true })).has(key)).toBe(false);
      expect(allowedMeasureKeys(dsrReportConfig.measures, ctx({ [b]: true })).has(key)).toBe(false);
      expect(
        allowedMeasureKeys(dsrReportConfig.measures, ctx({ [a]: true, [b]: true })).has(key),
      ).toBe(true);
    }
  });

  it("keeps customer columns on every plan", () => {
    for (const owns of [{ crm: true }, { wfa: true }, { sfa: true }]) {
      const keys = allowedMeasureKeys(dsrReportConfig.measures, ctx(owns));
      for (const key of ALWAYS) expect(keys.has(key)).toBe(true);
    }
  });

  it("drops nothing when the account owns every line", () => {
    const all = ctx({ crm: true, wfa: true, sfa: true, fsm: true, dms: true });
    expect(allowedMeasures(dsrReportConfig.measures, all)).toHaveLength(
      dsrReportConfig.measures.length,
    );
  });

  // THE RATCHET. This is the guard that would have caught the original bug and
  // is the one to keep: a new DSR column added without a line is a new leak on
  // every plan, and nothing else in the build would notice. Adding a column now
  // means either tagging its line or saying here, in writing, why it has none.
  //
  // Only the DSR needs per-measure gates: every other report has ONE base table
  // and is gated as a whole route in surface-gates.ts. The DSR is the only
  // cross-module report in the suite.
  it("forces every DSR column to declare its product line", () => {
    const ungatedByDesign = new Set([
      // `contacts` — customers exist on every plan, so these two never gate.
      "assigned_customers",
      "new_customers",
    ]);
    const undeclared = dsrReportConfig.measures
      .filter((m) => !m.gate && !ungatedByDesign.has(m.key))
      .map((m) => m.key);
    expect(
      undeclared,
      `DSR columns with no plan line: ${undeclared.join(", ")}. Give each a ` +
        `gate ({ line } or { allLines }) matching the table its SQL reads in ` +
        `20260818180000_dsr_report_module.sql, or add it to ungatedByDesign ` +
        `above with a reason.`,
    ).toEqual([]);
  });

  it("leaves an ungated report untouched", () => {
    const ungated = [
      { key: "a", label: "A", type: "number" as const },
      { key: "b", label: "B", type: "number" as const },
    ];
    expect(allowedMeasures(ungated, ctx({}))).toHaveLength(2);
  });
});
