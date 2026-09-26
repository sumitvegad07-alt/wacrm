import { describe, expect, test } from "vitest";
import { computeTotals, isPricePageCrowded } from "./totals";
import type { LineItem } from "./types";

/**
 * The Shaahi Niti Masale proposal (docs/proposals/proposal.html) is the
 * reference document: 5 field users + 1 admin at ₹3,600/user/year.
 */
const SHAAHI_NITI: LineItem[] = [
  { label: "OZZO SFA — Field Salesman", subLabel: "Android app", users: 5, rate: 3600 },
  { label: "OZZO SFA — Admin / Manager", subLabel: "Web dashboard", users: 1, rate: 3600 },
];

describe("computeTotals", () => {
  test("reproduces the Shaahi Niti figures with GST off", () => {
    const t = computeTotals(SHAAHI_NITI, { gstEnabled: false, gstRate: 18 });

    expect(t.usersTotal).toBe(6);
    expect(t.lineAmounts).toEqual([18000, 3600]);
    expect(t.subtotal).toBe(21600);
    expect(t.grandTotal).toBe(21600);
  });

  test("still computes the 18% figure with GST off, because the document shows it as the saving", () => {
    const t = computeTotals(SHAAHI_NITI, { gstEnabled: false, gstRate: 18 });

    expect(t.gstAmount).toBe(3888);
  });

  test("adds GST to the grand total when enabled", () => {
    const t = computeTotals(SHAAHI_NITI, { gstEnabled: true, gstRate: 18 });

    expect(t.subtotal).toBe(21600);
    expect(t.gstAmount).toBe(3888);
    expect(t.grandTotal).toBe(25488);
  });

  test("derives the per-month figure printed on the price hero", () => {
    const t = computeTotals(SHAAHI_NITI, { gstEnabled: false, gstRate: 18 });

    expect(t.headlineRate).toBe(3600);
    expect(t.perUserPerMonth).toBe(300);
  });

  test("rounds the per-month figure to whole rupees", () => {
    const t = computeTotals([{ label: "x", subLabel: "", users: 2, rate: 3500 }], {
      gstEnabled: false,
      gstRate: 18,
    });

    // 3500 / 12 = 291.66…
    expect(t.perUserPerMonth).toBe(292);
  });

  test("takes the highest rate as the headline when rows are priced differently", () => {
    const t = computeTotals(
      [
        { label: "field", subLabel: "", users: 5, rate: 3600 },
        { label: "admin", subLabel: "", users: 1, rate: 4800 },
      ],
      { gstEnabled: false, gstRate: 18 },
    );

    expect(t.headlineRate).toBe(4800);
    expect(t.perUserPerMonth).toBe(400);
    expect(t.subtotal).toBe(22800);
  });

  test("ignores rows with no users when choosing the headline rate", () => {
    const t = computeTotals(
      [
        { label: "field", subLabel: "", users: 5, rate: 3600 },
        { label: "unused add-on", subLabel: "", users: 0, rate: 9000 },
      ],
      { gstEnabled: false, gstRate: 18 },
    );

    expect(t.headlineRate).toBe(3600);
  });

  test("returns zeros rather than NaN for an empty table", () => {
    const t = computeTotals([], { gstEnabled: true, gstRate: 18 });

    expect(t).toMatchObject({
      usersTotal: 0,
      lineAmounts: [],
      subtotal: 0,
      gstAmount: 0,
      grandTotal: 0,
      headlineRate: 0,
      perUserPerMonth: 0,
    });
  });

  test("treats blank and missing numbers as zero instead of producing NaN", () => {
    const rows = [
      { label: "typed nothing yet", subLabel: "", users: "" as unknown as number, rate: undefined as unknown as number },
      { label: "real row", subLabel: "", users: 2, rate: 1200 },
    ];

    const t = computeTotals(rows, { gstEnabled: false, gstRate: 18 });

    expect(t.lineAmounts).toEqual([0, 2400]);
    expect(t.subtotal).toBe(2400);
    expect(t.usersTotal).toBe(2);
  });

  test("honours a GST rate other than 18", () => {
    const t = computeTotals(SHAAHI_NITI, { gstEnabled: true, gstRate: 5 });

    expect(t.gstAmount).toBe(1080);
    expect(t.grandTotal).toBe(22680);
  });

  test("rounds GST to paise rather than carrying float error", () => {
    const t = computeTotals([{ label: "x", subLabel: "", users: 1, rate: 1999 }], {
      gstEnabled: true,
      gstRate: 18,
    });

    // 1999 × 0.18 = 359.82
    expect(t.gstAmount).toBe(359.82);
    expect(t.grandTotal).toBe(2358.82);
  });
});

describe("isPricePageCrowded", () => {
  test("the reference proposal is comfortably within the page", () => {
    expect(isPricePageCrowded(2, false)).toBe(false);
    expect(isPricePageCrowded(2, true)).toBe(false);
  });

  test("five priced rows still fit once GST adds its three totals rows", () => {
    expect(isPricePageCrowded(5, true)).toBe(false);
  });

  test("six priced rows with GST overflow the page", () => {
    expect(isPricePageCrowded(6, true)).toBe(true);
  });

  test("without GST there is room for two more rows", () => {
    expect(isPricePageCrowded(7, false)).toBe(false);
    expect(isPricePageCrowded(8, false)).toBe(true);
  });
});
