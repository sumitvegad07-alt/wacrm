import { describe, expect, test } from "vitest";
import {
  computeTotals,
  extraDescriptionLines,
  offerLineCount,
  isPricePageCrowded,
  lineMonths,
  priceSheetClearance,
} from "./totals";
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

describe("the page-2 budget", () => {
  // Every expectation below is a cell measured in a browser at A4 — see the
  // tables over BASE_CLEARANCE. They are here so that changing the formula
  // without re-measuring fails the build.
  const rows = (n: number, descLines: number): LineItem[] =>
    Array.from({ length: n }, (_, i) => ({
      label: `row ${i + 1}`,
      subLabel: Array.from({ length: descLines }, (_, k) => `line ${k + 1}`).join("\n"),
      users: 4,
      rate: 390,
    }));

  /** The sheet the grid was measured on: bank block printing, no Offer, no signature. */
  const grid = (showAllTerms: boolean) => ({ showAllTerms, hasBankBlock: true });

  /**
   * The formula is a straight-line fit to measurements a browser rounded to
   * whole pixels, so it is held to within 5px of each measured cell rather than
   * to the cell exactly — tuning the constants to hit integers would be fitting
   * the noise, not the sheet.
   */
  const near = (actual: number, measured: number) =>
    expect(Math.abs(actual - measured)).toBeLessThanOrEqual(5);

  test("reproduces the measured clearances for one billing period", () => {
    near(priceSheetClearance(rows(3, 1), grid(false)), 109);
    near(priceSheetClearance(rows(4, 1), grid(false)), 54);
    near(priceSheetClearance(rows(5, 1), grid(false)), 0);
    near(priceSheetClearance(rows(4, 2), grid(false)), -3);
    near(priceSheetClearance(rows(3, 4), grid(false)), -19);
    near(priceSheetClearance(rows(5, 3), grid(false)), -142);
  });

  test("reproduces the measured clearances with all three periods shown", () => {
    near(priceSheetClearance(rows(3, 1), grid(true)), 46);
    near(priceSheetClearance(rows(3, 2), grid(true)), 4);
    near(priceSheetClearance(rows(4, 1), grid(true)), -8);
    near(priceSheetClearance(rows(5, 2), grid(true)), -133);
    near(priceSheetClearance(rows(5, 4), grid(true)), -275);
  });

  // ----------------------------------------------------------------
  // The blocks BELOW the price table. These are the trap: they come from
  // Invoice Settings and the Offer box, not from the rows, so a quotation that
  // fitted yesterday can clip today because a signature was uploaded.
  // ----------------------------------------------------------------

  test("the How-to-pay block costs the measured 104px", () => {
    const bare = priceSheetClearance(rows(3, 1), { showAllTerms: false });
    near(bare - priceSheetClearance(rows(3, 1), grid(false)), 104);
  });

  test("the signature block costs the measured 98px — nearly two rows", () => {
    const without = priceSheetClearance(rows(3, 1), grid(false));
    const withSig = priceSheetClearance(rows(3, 1), { ...grid(false), hasSignature: true });

    near(without - withSig, 98);
    // Four rows fit without a signature and do not fit with one. This is the
    // whole reason the signature is an input rather than an assumption.
    expect(isPricePageCrowded(rows(4, 1), grid(false))).toBe(false);
    expect(isPricePageCrowded(rows(4, 1), { ...grid(false), hasSignature: true })).toBe(true);
  });

  test("the Offer box costs 57px, then 16px a line", () => {
    const none = priceSheetClearance(rows(3, 1), grid(false));
    const one = priceSheetClearance(rows(3, 1), { ...grid(false), offerLines: 1 });
    const two = priceSheetClearance(rows(3, 1), { ...grid(false), offerLines: 2 });

    near(none - one, 57);
    near(one - two, 16);
  });

  test("reproduces the fully loaded sheet measured end to end", () => {
    // Two rows, descriptions of 3 and 1 lines, both carrying dates, bank block
    // printing, a two-line Offer, no signature. Measured: +31px.
    const items: LineItem[] = [
      {
        label: "OZZO SFA — Field Salesman",
        subLabel: ["PLAN: SFA", "USER: 5", "Android app"].join("\n"),
        users: 5,
        rate: 300,
        months: 12,
        periodStart: "2026-11-01",
        periodEnd: "2027-10-31",
      },
      {
        label: "OZZO SFA — 2 users added mid-term",
        subLabel: "Charged for the 9 months remaining",
        users: 2,
        rate: 270,
        months: 9,
        periodStart: "2027-02-01",
        periodEnd: "2027-10-31",
      },
    ];

    near(priceSheetClearance(items, { showAllTerms: false, hasBankBlock: true, offerLines: 2 }), 31);
    expect(isPricePageCrowded(items, { showAllTerms: false, hasBankBlock: true, offerLines: 2 })).toBe(
      false,
    );
  });

  test("at one description line the budget is what it always was", () => {
    // Four rows on one period, three when all three are shown — unchanged, so
    // no proposal written before rows had periods starts warning.
    expect(isPricePageCrowded(rows(4, 1), grid(false))).toBe(false);
    // Five rows measured at 0px — it touches the footer, so it is not "fits".
    expect(isPricePageCrowded(rows(5, 1), grid(false))).toBe(true);
    expect(isPricePageCrowded(rows(3, 1), grid(true))).toBe(false);
    expect(isPricePageCrowded(rows(4, 1), grid(true))).toBe(true);
  });

  test("the reference proposal is comfortably within the page", () => {
    expect(isPricePageCrowded(SHAAHI_NITI, grid(false))).toBe(false);
    expect(isPricePageCrowded(SHAAHI_NITI, grid(true))).toBe(false);
  });

  test("a long description costs the sheet rows", () => {
    expect(isPricePageCrowded(rows(4, 1), grid(false))).toBe(false);
    expect(isPricePageCrowded(rows(4, 2), grid(false))).toBe(true);
    expect(isPricePageCrowded(rows(3, 3), grid(false))).toBe(false);
    expect(isPricePageCrowded(rows(3, 4), grid(false))).toBe(true);
  });

  test("a row's printed dates cost a line of their own", () => {
    const dated: LineItem[] = rows(4, 1).map((r) => ({
      ...r,
      periodStart: "2026-11-01",
      periodEnd: "2027-07-31",
    }));

    near(priceSheetClearance(rows(4, 1), grid(false)), 54);
    near(priceSheetClearance(dated, grid(false)), -3);
  });

  test("a row with no description at all is counted as one line, never zero", () => {
    // The safe direction: warning early beats a proposal whose terms are cut
    // off in the client's inbox.
    expect(extraDescriptionLines([{ label: "x", subLabel: "", users: 1, rate: 1 }])).toBe(0);
  });

  test("offerLineCount counts what the document prints, dropping blank lines", () => {
    expect(offerLineCount(undefined)).toBe(0);
    expect(offerLineCount("")).toBe(0);
    expect(offerLineCount("   ")).toBe(0);
    expect(offerLineCount("one")).toBe(1);
    expect(offerLineCount("one" + "\n" + "\n" + "two" + "\n")).toBe(2);
  });
});

// ============================================================
// Per-row periods — the founder's case: two users added three months into a
// yearly subscription are charged for the nine months that remain.
// ============================================================

describe("per-row months", () => {
  const MID_TERM: LineItem[] = [
    { label: "OZZO SFA — Field Salesman", subLabel: "", users: 5, rate: 300, months: 12 },
    { label: "OZZO SFA — 2 added users", subLabel: "", users: 2, rate: 270, months: 9 },
  ];

  test("charges each row for its own months", () => {
    const t = computeTotals(MID_TERM, YEARLY);

    expect(t.lineAmounts).toEqual([18000, 4860]);
    expect(t.subtotal).toBe(22860);
    expect(t.lineMonths).toEqual([12, 9]);
  });

  test("a row with no months of its own falls back to the term", () => {
    const t = computeTotals(
      [{ label: "x", subLabel: "", users: 2, rate: 300 }],
      { gstEnabled: false, gstRate: 18, term: "quarterly" },
    );

    expect(t.lineMonths).toEqual([3]);
    expect(t.subtotal).toBe(1800);
  });

  test("every quotation saved before per-row periods prices exactly as it did", () => {
    // No `months` key anywhere — the shape every stored proposal has today.
    const legacy = computeTotals(SHAAHI_NITI, YEARLY);

    expect(legacy.subtotal).toBe(21600);
    expect(legacy.annualised).toBe(21600);
    expect(legacy.mixedMonths).toBe(false);
  });

  test("a row explicitly set to zero months is free, not reset to the term", () => {
    const t = computeTotals(
      [{ label: "free trial month", subLabel: "", users: 4, rate: 300, months: 0 }],
      YEARLY,
    );

    expect(t.subtotal).toBe(0);
  });

  test("flags a quotation whose rows cover different periods", () => {
    expect(computeTotals(MID_TERM, YEARLY).mixedMonths).toBe(true);
    expect(computeTotals(SHAAHI_NITI, YEARLY).mixedMonths).toBe(false);
  });

  test("a priced row nobody is taking does not make the quotation mixed", () => {
    const t = computeTotals(
      [
        { label: "field", subLabel: "", users: 5, rate: 300, months: 12 },
        { label: "unused add-on", subLabel: "", users: 0, rate: 750, months: 3 },
      ],
      YEARLY,
    );

    expect(t.mixedMonths).toBe(false);
  });

  test("annualised is the run-rate, counting a part-period row at its full year", () => {
    // 5 × 300 × 12 = 18,000 and 2 × 270 × 12 = 6,480 — what a whole year of the
    // same deal costs, which is the only figure comparable across quotations.
    expect(computeTotals(MID_TERM, YEARLY).annualised).toBe(24480);
  });
});

describe("lineMonths", () => {
  test("a missing, null or blank value reads as the document's term", () => {
    expect(lineMonths({}, 12)).toBe(12);
    expect(lineMonths({ months: undefined }, 6)).toBe(6);
    expect(lineMonths({ months: "" as unknown as number }, 3)).toBe(3);
  });

  test("nonsense reads as the term rather than poisoning the total with NaN", () => {
    expect(lineMonths({ months: "abc" as unknown as number }, 12)).toBe(12);
    expect(lineMonths({ months: -4 }, 12)).toBe(12);
  });

  test("a real value wins", () => {
    expect(lineMonths({ months: 9 }, 12)).toBe(9);
    expect(lineMonths({ months: 0 }, 12)).toBe(0);
  });
});
