// ============================================================
// The same proposal, priced on every billing term.
//
// The founder's price calculator answers this from `plan + users + term`.
// A proposal cannot: its price rows are editable, so the rate on the sheet is
// whatever was negotiated, not the list rate. Re-deriving the comparison from
// plan and users would print a yearly figure the proposal's own price table
// does not agree with — the one failure that matters in a document a customer
// signs.
//
// So the comparison is computed FROM the proposal's own rows, scaling each
// one's negotiated discount across terms exactly the way `changeTerm` does:
// a row at 90% of the yearly list rate stays at 90% of the quarterly list rate.
// Switching the proposal's term and reading its new total always produces the
// same number this table printed.
// ============================================================

import {
  BILLING_TERMS,
  TERM_MONTHS,
  asTerm,
  termRatePerMonth,
  type BillingTerm,
} from "@/lib/plans/pricing";
import type { PlanId } from "@/lib/plans/catalog";
import type { LineItem } from "./types";

/** Blank inputs arrive from the form as "" or undefined; never print NaN. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export interface TermComparisonInput {
  plan: PlanId;
  lineItems: LineItem[];
  /** The term actually being charged — the row the table marks "(quoted)". */
  quotedTerm: BillingTerm;
}

export interface TermComparisonRow {
  term: BillingTerm;
  months: number;
  /** True for the term this proposal charges. */
  quoted: boolean;
  /** Highest per-user-per-month rate charged on this term. Ignores empty rows. */
  ratePerMonth: number;
  /** Per seat for one whole invoice on this term. */
  ratePerUser: number;
  /** One invoice, before GST. */
  subtotal: number;
  /** Twelve months of service on this term, before GST. */
  annualised: number;
  /** What staying on this term saves against paying quarterly. 0 for quarterly. */
  savingVsQuarterly: number;
}

/**
 * One line's rate on another term, keeping its discount proportional.
 *
 * A plan whose list rate cannot be read (0, which real plans never are) leaves
 * the rate exactly as typed: a proposal we cannot re-price safely is better
 * left alone than re-priced on a guess.
 */
function rateOnTerm(
  rate: number,
  plan: PlanId,
  from: BillingTerm,
  to: BillingTerm,
): number {
  if (from === to) return rate;

  const fromList = termRatePerMonth(plan, from);
  const toList = termRatePerMonth(plan, to);
  if (!fromList || !toList) return rate;

  return Math.round(toList * (rate / fromList));
}

/** Money is rounded to paise, so float error never surfaces as ₹359.81999. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The deal on quarterly, half-yearly and yearly — in that order, which is how
 * the quote sheet reads: most expensive first, so the saving grows down the
 * table.
 */
export function compareProposalTerms(input: TermComparisonInput): TermComparisonRow[] {
  const plan = input.plan;
  const quotedTerm = asTerm(input.quotedTerm);
  const rows = (input.lineItems ?? []).map((item) => ({
    users: num(item?.users),
    rate: num(item?.rate),
  }));

  const priced = BILLING_TERMS.map((term) => {
    const months = TERM_MONTHS[term];
    const onTerm = rows.map((r) => ({
      users: r.users,
      rate: rateOnTerm(r.rate, plan, quotedTerm, term),
    }));

    const subtotal = round2(
      onTerm.reduce((sum, r) => sum + r.users * r.rate * months, 0),
    );

    // One printed rate needs one answer: the highest anyone is charged. Rows
    // carrying no users are ignored, so a priced-but-untaken add-on cannot
    // become the headline.
    const charged = onTerm.filter((r) => r.users > 0).map((r) => r.rate);
    const ratePerMonth = charged.length ? Math.max(...charged) : 0;

    return {
      term,
      months,
      quoted: term === quotedTerm,
      ratePerMonth,
      ratePerUser: ratePerMonth * months,
      subtotal,
      annualised: round2(subtotal * (12 / months)),
      savingVsQuarterly: 0,
    };
  });

  const base = priced.find((r) => r.term === "quarterly")?.annualised ?? 0;

  return priced.map((r) => ({
    ...r,
    savingVsQuarterly: r.term === "quarterly" ? 0 : round2(base - r.annualised),
  }));
}

export interface ListDiscount {
  /** What the same rows would cost at the plan's list rate for this term. */
  listSubtotal: number;
  /** listSubtotal − what is actually charged. Never negative. */
  discountAmount: number;
  /** The same thing as a percentage of list. 0 when nothing was given away. */
  discountPct: number;
}

/**
 * How much has been knocked off list price.
 *
 * A proposal has no discount field — a discount is given by typing a lower rate
 * into a price row — so the ladder's discount line has to be derived. Only rows
 * priced BELOW list contribute: a row the founder priced above list (a training
 * day, a premium tier) is counted at its own rate, so it neither creates a
 * discount nor cancels one given elsewhere.
 */
export function listDiscount(input: {
  plan: PlanId;
  lineItems: LineItem[];
  term: BillingTerm;
}): ListDiscount {
  const term = asTerm(input.term);
  const months = TERM_MONTHS[term];
  const list = termRatePerMonth(input.plan, term);

  let listSubtotal = 0;
  let charged = 0;

  for (const item of input.lineItems ?? []) {
    const users = num(item?.users);
    const rate = num(item?.rate);
    listSubtotal += users * Math.max(rate, list) * months;
    charged += users * rate * months;
  }

  const discountAmount = round2(Math.max(0, listSubtotal - charged));

  return {
    listSubtotal: round2(listSubtotal),
    discountAmount,
    discountPct: listSubtotal > 0 ? round2((discountAmount / listSubtotal) * 100) : 0,
  };
}
