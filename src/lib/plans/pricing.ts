// ============================================================
// OZZO billing terms + the one price calculator.
//
// `catalog.ts` answers "what does this plan unlock". This file answers "what
// does it cost", and is the only place that knows it. The superadmin billing
// page, the founder's price calculator and the proposal builder all read from
// here, because the same three multipliers written in three places is exactly
// how a proposal ends up quoting a price the billing page does not recognise.
//
// Commercial model (founder's decision, 27 September 2026):
//   Yearly is the base price. Shorter terms cost more, because the customer is
//   buying less commitment: quarterly +40%, half-yearly +20%.
//   Every plan has a minimum user count, which is how "plans start at ₹5,000"
//   is enforced rather than merely advertised.
//
// Pure data and pure functions only: no DB, no React, no Supabase.
// ============================================================

import { PLAN_PRICE, type PlanId } from "./catalog";

export type BillingTerm = "quarterly" | "half_yearly" | "yearly";

export const BILLING_TERMS: readonly BillingTerm[] = [
  "quarterly",
  "half_yearly",
  "yearly",
] as const;

/** Human label, as shown on quotes, proposals and invoices. */
export const TERM_LABEL: Record<BillingTerm, string> = {
  quarterly: "Quarterly",
  half_yearly: "Half-Yearly",
  yearly: "Yearly",
};

/** Months covered by one invoice on each term. */
export const TERM_MONTHS: Record<BillingTerm, number> = {
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

/**
 * Price uplift over the yearly rate, as a fraction.
 *
 * Quarterly is 40%, not 30%. The two numbers were inconsistent: ₹5,000 for four
 * SFA seats for a quarter is ₹417 per user per month, a 38.9% uplift on ₹300. At
 * 30% the published minimum was quietly charging more than the published rate.
 *
 * Half-yearly is 20% by the founder's decision. Noted at the time: a 6-month
 * buyer therefore pays only a fifth more than a 12-month one while committing to
 * half the term, which weakens the annual close.
 */
export const TERM_UPLIFT: Record<BillingTerm, number> = {
  quarterly: 0.4,
  half_yearly: 0.2,
  yearly: 0,
};

/**
 * The RECOMMENDED number of users to sell each plan to — not a floor.
 *
 * Founder's ruling, 27 September 2026: never block a deal on this. In sales you
 * cannot know in advance what has to be offered to win an account, so a quote
 * for fewer users must still price out. The quote reports `belowRecommended` and
 * the UI says so loudly; the arithmetic charges exactly what was asked for.
 *
 * The counts themselves are derived, not chosen: at the quarterly rate every one
 * of them produces the *same* entry ticket of ₹5,040, which is what makes a
 * single "from ₹5,000" headline honest across all five plans. `entryTicket()`
 * exposes the figure, and a test pins the invariant, so changing a base rate
 * without re-deriving these counts fails the build rather than the marketing.
 */
export const MIN_USERS: Record<PlanId, number> = {
  CRM: 12,
  WFA: 8,
  CRM_WFA: 6,
  SFA: 4,
  CRM_SFA: 3,
};

/**
 * The advertised minimum purchase, pre-GST, for one quarter of service.
 *
 * Like MIN_USERS this is advisory: a quote below it is flagged, never refused.
 * What must never happen is going under it by accident while the website says
 * otherwise.
 */
export const MIN_TICKET = 5000;

/** Default GST rate. Stored per quote so a rate change is data, not a deploy. */
export const DEFAULT_GST_RATE = 18;

function isTerm(value: unknown): value is BillingTerm {
  return typeof value === "string" && (BILLING_TERMS as readonly string[]).includes(value);
}

/**
 * A stored or user-supplied term, narrowed to a real one.
 * Anything unrecognised reads as yearly — the base price, never an uplifted one,
 * so a bad value can only ever under-charge, which is the safe direction.
 */
export function asTerm(value: unknown): BillingTerm {
  return isTerm(value) ? value : "yearly";
}

/** Rupees per user per month on a given term, rounded to the rupee. */
export function termRatePerMonth(plan: PlanId, term: BillingTerm): number {
  return Math.round(PLAN_PRICE[plan] * (1 + TERM_UPLIFT[term]));
}

/** Rupees per user for one whole term — what one invoice charges per seat. */
export function ratePerUserForTerm(plan: PlanId, term: BillingTerm): number {
  return termRatePerMonth(plan, term) * TERM_MONTHS[term];
}

/** The smallest order accepted on a plan and term, at list price. */
export function entryTicket(plan: PlanId, term: BillingTerm): number {
  return ratePerUserForTerm(plan, term) * MIN_USERS[plan];
}

export interface QuoteInput {
  plan: PlanId;
  /** What the customer asked for. Charged as asked — never clamped upward. */
  users: number;
  term: BillingTerm;
  /** Percent, 0–100. The founder's call, per deal — never a list price. */
  discountPct?: number;
  /** Percent. Pass 0 for a customer who is not charged GST. */
  gstRate?: number;
}

export interface Quote {
  plan: PlanId;
  term: BillingTerm;
  months: number;
  /** What was asked for, after cleaning. */
  usersRequested: number;
  /** What is charged. Exactly what was asked for — this is not clamped. */
  usersBilled: number;
  /** The recommended floor for this plan. Advisory only. */
  minUsers: number;
  /** True when the quote is under the recommendation. The UI must say so loudly. */
  belowRecommended: boolean;
  /** How many more users would reach the recommendation. 0 when at or above it. */
  usersToRecommended: number;
  ratePerMonth: number;
  ratePerUser: number;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  net: number;
  gstRate: number;
  gstAmount: number;
  total: number;
  /** What the customer is really paying per user per month, after discount. */
  effectiveRatePerMonth: number;
  /** The "less than a cup of chai" line. One decimal place. */
  perUserPerDay: number;
  /** Net cost across 12 months on this term — the figure that compares terms. */
  annualised: number;
  /** True when a discount has taken the net under the advertised minimum. */
  belowMinTicket: boolean;
}

/** Blank or nonsense input must never reach a quote as NaN. */
function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round0(value: number): number {
  return Math.round(value);
}

/**
 * Everything a quote shows, from four inputs.
 *
 * Deliberately whole-rupee: a proposal that prints ₹26,082.40 invites a
 * conversation about forty paise. GST is rounded once, on the net, rather than
 * per line, so the printed figures always add up to the printed total.
 */
export function quote(input: QuoteInput): Quote {
  const plan = input.plan;
  const term = asTerm(input.term);
  const months = TERM_MONTHS[term];
  const min = MIN_USERS[plan];

  // Charged as asked. The recommendation is surfaced, never enforced — a deal the
  // founder has decided to take below it must still produce a real number.
  const requested = Math.max(0, Math.floor(num(input.users)));
  const usersBilled = requested;

  const discountPct = Math.min(100, Math.max(0, num(input.discountPct)));
  const gstRate = Math.max(0, num(input.gstRate, DEFAULT_GST_RATE));

  const ratePerMonth = termRatePerMonth(plan, term);
  const ratePerUser = ratePerMonth * months;

  const subtotal = ratePerUser * usersBilled;
  const discountAmount = round0((subtotal * discountPct) / 100);
  const net = subtotal - discountAmount;
  const gstAmount = round0((net * gstRate) / 100);

  const userMonths = usersBilled * months;

  return {
    plan,
    term,
    months,
    usersRequested: requested,
    usersBilled,
    minUsers: min,
    belowRecommended: requested > 0 && requested < min,
    usersToRecommended: requested > 0 && requested < min ? min - requested : 0,
    ratePerMonth,
    ratePerUser,
    subtotal,
    discountPct,
    discountAmount,
    net,
    gstRate,
    gstAmount,
    total: net + gstAmount,
    effectiveRatePerMonth: userMonths ? round0(net / userMonths) : 0,
    perUserPerDay: userMonths ? Math.round((net / (userMonths * 30)) * 10) / 10 : 0,
    annualised: round0(net * (12 / months)),
    belowMinTicket: net < MIN_TICKET,
  };
}

/**
 * The same deal on every term, quarterly first.
 *
 * This is the annual close in one table: identical users and identical discount,
 * so the only thing that moves is the commitment. `savingVsQuarterly` is what
 * the customer keeps by paying for longer.
 */
export function compareTerms(
  input: Omit<QuoteInput, "term">,
): Array<Quote & { savingVsQuarterly: number }> {
  const quotes = BILLING_TERMS.map((term) => quote({ ...input, term }));
  const quarterly = quotes.find((q) => q.term === "quarterly");
  const base = quarterly ? quarterly.annualised : 0;

  return quotes.map((q) => ({
    ...q,
    savingVsQuarterly: q.term === "quarterly" ? 0 : base - q.annualised,
  }));
}

/** The date one term from a start date — when this subscription comes round again. */
export function renewalDate(start: Date, term: BillingTerm): Date {
  const d = new Date(start.getTime());
  d.setMonth(d.getMonth() + TERM_MONTHS[term]);
  return d;
}
