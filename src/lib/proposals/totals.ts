// ============================================================
// Every figure the proposal prints that is not typed by hand.
//
// The reference document repeats most of them: the term total appears in the
// price table, the savings panel, the "covers everything" heading and the terms
// page, and the per-month rate appears both on the price hero and inside a
// page-6 bullet. Calculating them in one place is the whole reason this builder
// exists — hand-editing is what leaves a proposal quoting two different prices.
//
// Since billing terms exist, a line's `rate` is per user per MONTH and the
// amount is `users × rate × months in term`. The months come from the one
// pricing engine in lib/plans/pricing.ts, never from a literal here.
// ============================================================

import { TERM_MONTHS, asTerm, type BillingTerm } from "@/lib/plans/pricing";
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

/** Tax is rounded to the rupee — see the note over `gstAmount`. */
function round0(value: number): number {
  return Math.round(value);
}

export function computeTotals(
  lineItems: LineItem[],
  opts: { gstEnabled: boolean; gstRate: number; term?: BillingTerm },
): ProposalTotals {
  const term = asTerm(opts?.term);
  const months = TERM_MONTHS[term];

  const rows = (lineItems ?? []).map((item) => ({
    users: num(item?.users),
    rate: num(item?.rate),
  }));

  const lineAmounts = rows.map((r) => round2(r.users * r.rate * months));
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
  //
  // Whole rupees, matching `quote()` in lib/plans/pricing.ts: the two engines
  // price the same deal, so the proposal and the founder's calculator have to
  // agree to the rupee. Its reasoning holds here too — a proposal that prints
  // "GST @ 18% ₹3,499.2" invites a conversation about twenty paise.
  const gstAmount = round0((subtotal * num(opts?.gstRate)) / 100);
  // Rounded once, on the sum, rather than independently: the page-2 money ladder
  // prints the subtotal, the GST and this, and the three have to add up.
  const grandTotal = round2(subtotal + (opts?.gstEnabled ? gstAmount : 0));

  return {
    usersTotal,
    months,
    lineAmounts,
    subtotal,
    gstAmount,
    grandTotal,
    headlineRate,
    perUserPerMonth: Math.round(headlineRate),
    annualised: round2(subtotal * (12 / months)),
  };
}

/**
 * The Investment page is a fixed A4 sheet with `overflow:hidden`, so a long
 * price table does not paginate — it silently clips the terms and the page
 * footer out of the PDF.
 *
 * The budget shrank when the document went to two pages on 5 October 2026: the
 * sheet now also carries the headline tiles, the term comparison and all six
 * terms & conditions, which the old terms page held on its own. GST no longer
 * costs rows — the money ladder took the totals out of the table — but showing
 * all three billing terms costs two comparison rows, which costs one price row.
 *
 * MEASURED, not estimated, in a browser at A4 against the fullest sheet the
 * document can produce: CRM + SFA, GST on, a discount showing, two-line row
 * labels. Clearance above the page footer, in pixels:
 *
 *     rows         3     4     5
 *     one term  +114   +40   -34
 *     all terms  +40   -34  -108
 *
 * So four rows, or three when all three terms are shown. Re-measured after the
 * column headers were renamed on 5 October 2026 — two-line headers cost the
 * sheet 60px, which is most of a row. Anything added to page 2 has to be
 * measured again, not reasoned about.
 */
export const PRICE_TABLE_ROW_BUDGET = 4;

export function isPricePageCrowded(
  lineItemCount: number,
  opts: { showAllTerms: boolean },
): boolean {
  return lineItemCount > PRICE_TABLE_ROW_BUDGET - (opts.showAllTerms ? 1 : 0);
}
