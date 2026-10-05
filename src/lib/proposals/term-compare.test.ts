import { describe, expect, test } from "vitest";
import { compareProposalTerms, listDiscount } from "./term-compare";
import { changeTerm } from "./change-plan";
import { computeTotals } from "./totals";
import { getTemplate } from "./registry";
import { termRatePerMonth } from "@/lib/plans/pricing";
import type { LineItem } from "./types";

// ---------------------------------------------------------------------------
// The comparison table sits on the same sheet as the price table. If the two
// disagree — if the row marked "(quoted)" is not the price the proposal
// charges, or if its "Yearly" figure is not what switching the proposal to
// yearly would produce — the customer is reading two prices for one deal.
//
// These tests pin exactly that: agreement with computeTotals, and agreement
// with changeTerm.
// ---------------------------------------------------------------------------

const SFA_LIST_YEARLY = termRatePerMonth("SFA", "yearly"); // 300
const SFA_LIST_QUARTERLY = termRatePerMonth("SFA", "quarterly"); // 420

const SEATS: LineItem[] = [
  { label: "OZZO SFA — Field Salesman", subLabel: "Android app", users: 5, rate: 300 },
  { label: "OZZO SFA — Admin / Manager", subLabel: "Web dashboard", users: 1, rate: 300 },
];

describe("compareProposalTerms", () => {
  test("returns quarterly, half-yearly and yearly in that order", () => {
    const rows = compareProposalTerms({ plan: "SFA", lineItems: SEATS, quotedTerm: "yearly" });
    expect(rows.map((r) => r.term)).toEqual(["quarterly", "half_yearly", "yearly"]);
  });

  test("marks exactly one row as the quoted term", () => {
    const rows = compareProposalTerms({ plan: "SFA", lineItems: SEATS, quotedTerm: "half_yearly" });
    expect(rows.filter((r) => r.quoted).map((r) => r.term)).toEqual(["half_yearly"]);
  });

  test("the quoted row is exactly what the price table charges", () => {
    const rows = compareProposalTerms({ plan: "SFA", lineItems: SEATS, quotedTerm: "yearly" });
    const quoted = rows.find((r) => r.quoted)!;
    const totals = computeTotals(SEATS, { gstEnabled: false, gstRate: 18, term: "yearly" });

    expect(quoted.subtotal).toBe(totals.subtotal);
    expect(quoted.ratePerMonth).toBe(totals.headlineRate);
  });

  test("at list price the other rows are the catalog's own term rates", () => {
    const rows = compareProposalTerms({ plan: "SFA", lineItems: SEATS, quotedTerm: "yearly" });
    const byTerm = Object.fromEntries(rows.map((r) => [r.term, r]));

    expect(byTerm.yearly.ratePerMonth).toBe(SFA_LIST_YEARLY); // 300
    expect(byTerm.quarterly.ratePerMonth).toBe(SFA_LIST_QUARTERLY); // 420
    expect(byTerm.half_yearly.ratePerMonth).toBe(termRatePerMonth("SFA", "half_yearly")); // 360

    // 6 users × 300 × 12
    expect(byTerm.yearly.subtotal).toBe(21_600);
    // 6 users × 420 × 3
    expect(byTerm.quarterly.subtotal).toBe(7_560);
  });

  test("annualises every term onto the same twelve months", () => {
    const rows = compareProposalTerms({ plan: "SFA", lineItems: SEATS, quotedTerm: "yearly" });
    const byTerm = Object.fromEntries(rows.map((r) => [r.term, r]));

    expect(byTerm.quarterly.annualised).toBe(30_240); // 7,560 × 4
    expect(byTerm.half_yearly.annualised).toBe(25_920); // 12,960 × 2
    expect(byTerm.yearly.annualised).toBe(21_600);
  });

  test("the saving is measured against paying quarterly", () => {
    const rows = compareProposalTerms({ plan: "SFA", lineItems: SEATS, quotedTerm: "yearly" });
    const byTerm = Object.fromEntries(rows.map((r) => [r.term, r]));

    expect(byTerm.quarterly.savingVsQuarterly).toBe(0);
    expect(byTerm.half_yearly.savingVsQuarterly).toBe(30_240 - 25_920);
    expect(byTerm.yearly.savingVsQuarterly).toBe(30_240 - 21_600);
  });

  test("a negotiated discount is carried across every term as a proportion", () => {
    // 10% off list: 270 instead of 300.
    const discounted: LineItem[] = SEATS.map((s) => ({ ...s, rate: 270 }));
    const rows = compareProposalTerms({
      plan: "SFA",
      lineItems: discounted,
      quotedTerm: "yearly",
    });
    const byTerm = Object.fromEntries(rows.map((r) => [r.term, r]));

    expect(byTerm.yearly.ratePerMonth).toBe(270);
    expect(byTerm.quarterly.ratePerMonth).toBe(Math.round(SFA_LIST_QUARTERLY * 0.9)); // 378
    expect(byTerm.half_yearly.ratePerMonth).toBe(
      Math.round(termRatePerMonth("SFA", "half_yearly") * 0.9), // 324
    );
  });

  test("every row equals what switching the proposal to that term would charge", () => {
    // The guarantee that makes the table safe to print: the comparison and the
    // editor's own term switch are the same arithmetic.
    const data = {
      ...getTemplate("SFA")!.defaults("2026-10-05"),
      billingTerm: "yearly" as const,
      lineItems: SEATS,
    };
    const rows = compareProposalTerms({ plan: "SFA", lineItems: SEATS, quotedTerm: "yearly" });

    for (const row of rows) {
      const switched = changeTerm(data, row.term);
      const totals = computeTotals(switched.lineItems, {
        gstEnabled: false,
        gstRate: 18,
        term: row.term,
      });
      expect(totals.subtotal, `${row.term} subtotal`).toBe(row.subtotal);
    }
  });

  test("rows carrying no users never become the headline rate", () => {
    const rows = compareProposalTerms({
      plan: "SFA",
      lineItems: [
        { label: "Seats", subLabel: "", users: 4, rate: 300 },
        { label: "Priced but not taken", subLabel: "", users: 0, rate: 9_000 },
      ],
      quotedTerm: "yearly",
    });
    expect(rows.find((r) => r.term === "yearly")!.ratePerMonth).toBe(300);
  });

  test("an empty proposal prints zeros, not NaN", () => {
    const rows = compareProposalTerms({ plan: "SFA", lineItems: [], quotedTerm: "yearly" });
    for (const row of rows) {
      expect(Number.isFinite(row.subtotal)).toBe(true);
      expect(row.subtotal).toBe(0);
      expect(row.ratePerMonth).toBe(0);
      expect(row.savingVsQuarterly).toBe(0);
    }
  });

  test("blank users and rates from a half-filled form are read as zero", () => {
    const rows = compareProposalTerms({
      plan: "SFA",
      lineItems: [{ label: "", subLabel: "", users: NaN, rate: undefined as unknown as number }],
      quotedTerm: "yearly",
    });
    expect(rows.every((r) => r.subtotal === 0)).toBe(true);
  });
});

describe("listDiscount", () => {
  test("is nothing when the proposal quotes list price", () => {
    const d = listDiscount({ plan: "SFA", lineItems: SEATS, term: "yearly" });
    expect(d.discountAmount).toBe(0);
    expect(d.discountPct).toBe(0);
  });

  test("measures what was knocked off list, over the whole term", () => {
    const discounted: LineItem[] = SEATS.map((s) => ({ ...s, rate: 270 }));
    const d = listDiscount({ plan: "SFA", lineItems: discounted, term: "yearly" });

    expect(d.listSubtotal).toBe(21_600); // 6 × 300 × 12
    expect(d.discountAmount).toBe(2_160); // 6 × 30 × 12
    expect(d.discountPct).toBe(10);
  });

  test("uses the quoted term's list rate, not the yearly one", () => {
    // 6 users at 378 against a 420 quarterly list = 10% off, over 3 months.
    const d = listDiscount({
      plan: "SFA",
      lineItems: SEATS.map((s) => ({ ...s, rate: 378 })),
      term: "quarterly",
    });
    expect(d.listSubtotal).toBe(6 * SFA_LIST_QUARTERLY * 3); // 7,560
    expect(d.discountAmount).toBe(6 * (SFA_LIST_QUARTERLY - 378) * 3); // 756
    expect(d.discountPct).toBe(10);
  });

  test("a row priced above list adds no discount and cancels none", () => {
    const d = listDiscount({
      plan: "SFA",
      lineItems: [
        { label: "Seats", subLabel: "", users: 6, rate: 270 }, // 30 below list
        { label: "Premium tier", subLabel: "", users: 2, rate: 500 }, // above list
      ],
      term: "yearly",
    });
    // Only the discounted row contributes: 6 × 30 × 12.
    expect(d.discountAmount).toBe(2_160);
  });

  test("an empty proposal has no discount and does not divide by zero", () => {
    const d = listDiscount({ plan: "SFA", lineItems: [], term: "yearly" });
    expect(d).toEqual({ listSubtotal: 0, discountAmount: 0, discountPct: 0 });
  });
});
