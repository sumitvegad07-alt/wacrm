// ============================================================
// Every figure the proposal prints that is not typed by hand.
//
// The reference document repeats most of them: the annual total appears in the
// price table, the savings panel, the "covers everything" heading and the terms
// page, and the per-month rate appears both on the price hero and inside a
// page-6 bullet. Calculating them in one place is the whole reason this builder
// exists — hand-editing is what leaves a proposal quoting two different prices.
// ============================================================

import type { LineItem, ProposalTotals } from "./types";

/** Blank inputs arrive from the form as "" or undefined; never let that reach the page as NaN. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Money is rounded to paise, so float error never surfaces as ₹359.81999. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeTotals(
  lineItems: LineItem[],
  opts: { gstEnabled: boolean; gstRate: number },
): ProposalTotals {
  const rows = (lineItems ?? []).map((item) => ({
    users: num(item?.users),
    rate: num(item?.rate),
  }));

  const lineAmounts = rows.map((r) => round2(r.users * r.rate));
  const usersTotal = rows.reduce((sum, r) => sum + r.users, 0);
  const subtotal = round2(lineAmounts.reduce((sum, amount) => sum + amount, 0));

  // The hero prints one rate, so a differently-priced table needs a single
  // answer: the highest rate anyone is actually being charged. Never understate
  // the price, and ignore rows carrying no users — an add-on priced but not
  // taken must not become the headline.
  const chargedRates = rows.filter((r) => r.users > 0).map((r) => r.rate);
  const headlineRate = chargedRates.length ? Math.max(...chargedRates) : 0;

  // Computed whether or not GST is charged: with GST off the document shows the
  // same figure as the saving ("you save 18%").
  const gstAmount = round2((subtotal * num(opts?.gstRate)) / 100);
  const grandTotal = round2(subtotal + (opts?.gstEnabled ? gstAmount : 0));

  return {
    usersTotal,
    lineAmounts,
    subtotal,
    gstAmount,
    grandTotal,
    headlineRate,
    perUserPerMonth: Math.round(headlineRate / 12),
  };
}

/**
 * The Investment page is a fixed A4 sheet with `overflow:hidden`, so a long
 * price table does not paginate — it silently clips the "why" tiles and the
 * page footer out of the PDF.
 *
 * Measured in the browser: the content collides with the footer once the table
 * carries nine rows, counting the totals rows the table adds itself (one with
 * GST off; subtotal + GST + total with it on).
 */
export const PRICE_TABLE_ROW_BUDGET = 8;

export function isPricePageCrowded(lineItemCount: number, gstEnabled: boolean): boolean {
  return lineItemCount + (gstEnabled ? 3 : 1) > PRICE_TABLE_ROW_BUDGET;
}
