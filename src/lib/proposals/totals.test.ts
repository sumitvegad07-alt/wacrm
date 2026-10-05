import { describe, expect, test } from "vitest";
import { computeTotals, isPricePageCrowded } from "./totals";
import type { LineItem } from "./types";

/**
 * The Shaahi Niti Masale proposal (docs/proposals/proposal.html) is the
 * reference document: 5 field users + 1 admin at ₹300/user/month on the yearly
 * term — the same ₹21,600 it always was. Rates are monthly since billing terms
 * exist; the reference figures are unchanged, which is the point.
 */
const SHAAHI_NITI: LineItem[] = [
  { label: "OZZO SFA — Field Salesman", subLabel: "Android app", users: 5, rate: 300 },
  { label: "OZZO SFA — Admin / Manager", subLabel: "Web dashboard", users: 1, rate: 300 },
];

const YEARLY = { gstEnabled: false, gstRate: 18, term: "yearly" } as const;

describe("computeTotals", () => {
  test("reproduces the Shaahi Niti figures with GST off", () => {
    const t = computeTotals(SHAAHI_NITI, YEARLY);

    expect(t.usersTotal).toBe(6);
    expect(t.months).toBe(12);
    expect(t.lineAmounts).toEqual([18000, 3600]);
    expect(t.subtotal).toBe(21600);
    expect(t.grandTotal).toBe(21600);
  });

  test("still computes the 18% figure with GST off, because the document shows it as the saving", () => {
    expect(computeTotals(SHAAHI_NITI, YEARLY).gstAmount).toBe(3888);
  });

  test("adds GST to the grand total when enabled", () => {
    const t = computeTotals(SHAAHI_NITI, { ...YEARLY, gstEnabled: true });

    expect(t.subtotal).toBe(21600);
    expect(t.gstAmount).toBe(3888);
    expect(t.grandTotal).toBe(25488);
  });

  test("the rate IS the per-month figure printed on the price hero", () => {
    const t = computeTotals(SHAAHI_NITI, YEARLY);

    expect(t.headlineRate).toBe(300);
    expect(t.perUserPerMonth).toBe(300);
  });

  test("rounds the per-month figure to whole rupees", () => {
    const t = computeTotals([{ label: "x", subLabel: "", users: 2, rate: 291.66 }], YEARLY);

    expect(t.perUserPerMonth).toBe(292);
  });

  test("takes the highest rate as the headline when rows are priced differently", () => {
    const t = computeTotals(
      [
        { label: "field", subLabel: "", users: 5, rate: 300 },
        { label: "admin", subLabel: "", users: 1, rate: 400 },
      ],
      YEARLY,
    );

    expect(t.headlineRate).toBe(400);
    expect(t.perUserPerMonth).toBe(400);
    expect(t.subtotal).toBe(22800);
  });

  test("ignores rows with no users when choosing the headline rate", () => {
    const t = computeTotals(
      [
        { label: "field", subLabel: "", users: 5, rate: 300 },
        { label: "unused add-on", subLabel: "", users: 0, rate: 750 },
      ],
      YEARLY,
    );

    expect(t.headlineRate).toBe(300);
  });

  test("returns zeros rather than NaN for an empty table", () => {
    const t = computeTotals([], { gstEnabled: true, gstRate: 18, term: "yearly" });

    expect(t).toMatchObject({
      usersTotal: 0,
      lineAmounts: [],
      subtotal: 0,
      gstAmount: 0,
      grandTotal: 0,
      headlineRate: 0,
      perUserPerMonth: 0,
      annualised: 0,
    });
  });

  test("treats blank and missing numbers as zero instead of producing NaN", () => {
    const rows = [
      {
        label: "typed nothing yet",
        subLabel: "",
        users: "" as unknown as number,
        rate: undefined as unknown as number,
      },
      { label: "real row", subLabel: "", users: 2, rate: 100 },
    ];

    const t = computeTotals(rows, YEARLY);

    expect(t.lineAmounts).toEqual([0, 2400]);
    expect(t.subtotal).toBe(2400);
    expect(t.usersTotal).toBe(2);
  });

  test("honours a GST rate other than 18", () => {
    const t = computeTotals(SHAAHI_NITI, { ...YEARLY, gstEnabled: true, gstRate: 5 });

    expect(t.gstAmount).toBe(1080);
    expect(t.grandTotal).toBe(22680);
  });

  // Whole rupees, not paise: the proposal builder and the founder's price
  // calculator (quote() in lib/plans/pricing.ts) price the same deal, so they
  // have to agree to the rupee, and a PDF printing "GST @ 18% ₹1,079.46"
  // invites a conversation about forty-six paise.
  test("rounds GST to whole rupees, as quote() does, rather than printing paise", () => {
    const t = computeTotals([{ label: "x", subLabel: "", users: 1, rate: 1999 }], {
      gstEnabled: true,
      gstRate: 18,
      term: "quarterly",
    });

    // 1999 × 3 months = 5997; × 0.18 = 1079.46, charged as ₹1,079.
    expect(t.subtotal).toBe(5997);
    expect(t.gstAmount).toBe(1079);
    expect(t.grandTotal).toBe(7076);
  });

  test("the money ladder adds up even when a typed rate leaves paise in the subtotal", () => {
    const t = computeTotals([{ label: "x", subLabel: "", users: 1, rate: 1999.5 }], {
      gstEnabled: true,
      gstRate: 18,
      term: "quarterly",
    });

    // The ladder prints the subtotal, the GST and the total; the first two must
    // make the third, so the total is rounded once on the sum, not on its own.
    expect(t.subtotal).toBe(5998.5);
    expect(t.gstAmount).toBe(1080);
    expect(t.grandTotal).toBe(7078.5);
    expect(t.grandTotal).toBe(t.subtotal + t.gstAmount);
  });
});

// The whole reason rates became monthly: the same table has to produce three
// different invoice totals without any number in it changing meaning.
describe("billing terms", () => {
  const rows: LineItem[] = [{ label: "SFA", subLabel: "", users: 10, rate: 420 }];

  test("the term decides how many months each line covers", () => {
    expect(computeTotals(rows, { gstEnabled: false, gstRate: 18, term: "quarterly" }).subtotal).toBe(12600);
    expect(computeTotals(rows, { gstEnabled: false, gstRate: 18, term: "half_yearly" }).subtotal).toBe(25200);
    expect(computeTotals(rows, { gstEnabled: false, gstRate: 18, term: "yearly" }).subtotal).toBe(50400);
  });

  test("reports the months so the document can say them", () => {
    expect(computeTotals(rows, { gstEnabled: false, gstRate: 18, term: "quarterly" }).months).toBe(3);
    expect(computeTotals(rows, { gstEnabled: false, gstRate: 18, term: "half_yearly" }).months).toBe(6);
  });

  test("annualised is the same on every term for the same monthly rate", () => {
    const annualised = (term: "quarterly" | "half_yearly" | "yearly") =>
      computeTotals(rows, { gstEnabled: false, gstRate: 18, term }).annualised;

    expect(annualised("quarterly")).toBe(50400);
    expect(annualised("half_yearly")).toBe(50400);
    expect(annualised("yearly")).toBe(50400);
  });

  test("a missing term reads as yearly, so a legacy payload is never up-priced", () => {
    const t = computeTotals(rows, { gstEnabled: false, gstRate: 18 });
    expect(t.months).toBe(12);
    expect(t.subtotal).toBe(50400);
  });
});

describe("isPricePageCrowded", () => {
  // The numbers come from measuring the real sheet in a browser; see the
  // clearance table over PRICE_TABLE_ROW_BUDGET.
  test("the reference proposal is comfortably within the page", () => {
    expect(isPricePageCrowded(2, { showAllTerms: false })).toBe(false);
    expect(isPricePageCrowded(2, { showAllTerms: true })).toBe(false);
  });

  test("four priced rows are the most the sheet holds", () => {
    expect(isPricePageCrowded(4, { showAllTerms: false })).toBe(false);
    expect(isPricePageCrowded(5, { showAllTerms: false })).toBe(true);
  });

  test("showing all three terms costs one price row", () => {
    expect(isPricePageCrowded(3, { showAllTerms: true })).toBe(false);
    expect(isPricePageCrowded(4, { showAllTerms: true })).toBe(true);
  });

  test("GST no longer costs rows — the money ladder took the totals out of the table", () => {
    expect(isPricePageCrowded(4, { showAllTerms: false })).toBe(false);
  });
});
