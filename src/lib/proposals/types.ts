// ============================================================
// Types for the founder-only sales proposal builder.
//
// A stored proposal is one row in `platform_proposals`: a plan line, a few
// denormalised columns the history list reads, and this payload as JSONB.
// Everything the founder types lives in `ProposalData`; everything that can be
// calculated from it lives in `ProposalTotals` and is never stored in the
// payload, because the source document repeats most figures in two or more
// places and a stale copy is how a proposal ends up contradicting itself.
// ============================================================

import type { BillingTerm } from "@/lib/plans/pricing";

export type { BillingTerm };

/** A row of the Investment page price table. */
export interface LineItem {
  /** Bold product line, e.g. "OZZO SFA — Field Salesman". */
  label: string;
  /** Muted line beneath it, e.g. "Android app · full field toolkit". */
  subLabel: string;
  users: number;
  /**
   * Rate per user per MONTH, in rupees. Whatever was negotiated for THIS row —
   * never forced to the plan's list rate.
   *
   * Was per-year until terms existed. Per-month is the only basis that works
   * across any period without the number changing meaning: the line amount is
   * `users × rate × months`.
   */
  rate: number;
  /**
   * How many months THIS row is charged for.
   *
   * The whole reason the row exists separately from the document's billing
   * term: two users added three months into a yearly subscription are charged
   * for the nine months that remain, not for twelve. The term now only supplies
   * the DEFAULT for a new row — it is no longer the law for every row.
   *
   * Optional, because this is a stored JSONB payload. A quotation written
   * before per-row periods existed has no such key, and `lineMonths()` reads a
   * missing one as the document's term — so every existing quotation prints
   * exactly the figures it printed before.
   */
  months?: number;
  /**
   * Optional ISO dates (yyyy-mm-dd) for the span this row covers, printed under
   * the item name. Presentation only: `months` is what multiplies, never the
   * gap between these two, so a typed date can never silently move the money.
   */
  periodStart?: string;
  periodEnd?: string;
}

/** The three sentences that would otherwise name the wrong industry. */
export interface ProposalVoice {
  /** Page 2 sub: "You've built a trusted spices & masala brand across …". */
  built: string;
  /** Page 4, drops into "Most ___ buy a second accounting package …". */
  industryPlural: string;
  /** Page 6 first tile: "Built for FMCG distribution — trade levels, …". */
  builtFor: string;
}

export interface ProposalClient {
  name: string;
  /** Used where the full legal name reads long, e.g. "Why ___ chooses OZZO". */
  shortName: string;
  industry: string;
  website: string;
  address: string;
}

export interface ProposalPreparedBy {
  name: string;
  phone: string;
  email: string;
}

export interface ProposalData {
  ref: string;
  /**
   * Which billing term is being quoted. Drives the months every line amount is
   * multiplied by, and the document's own wording.
   *
   * Optional because this is a stored JSONB payload: proposals written before
   * terms existed have no such key, and `asTerm()` reads a missing one as
   * yearly — the base rate, so an old proposal can never be silently up-priced.
   */
  billingTerm?: BillingTerm;
  /**
   * Whether the PDF prints all three billing terms side by side, or only the
   * one being charged.
   *
   * Optional, and read as false, because this is a stored JSONB payload:
   * proposals written before the comparison table existed have no such key,
   * and the safe reading is the quieter document — one term, the one quoted.
   */
  showAllTerms?: boolean;
  /**
   * Free text for this one quotation, printed verbatim under the price ladder.
   *
   * Deliberately one open box rather than a field per thing: what goes here is
   * whatever needs saying on this deal — "2 months free subscription", the
   * subscription period, a user count, a condition. Each line is printed as its
   * own line. It never touches a figure: the totals above it stay exactly as
   * calculated, so a stated concession can never silently change what is owed.
   *
   * Optional, because this is a stored JSONB payload — quotations written
   * before the box existed have no such key, and a missing one prints nothing.
   */
  offer?: string;
  /** ISO date (yyyy-mm-dd). Rendered in the account's own wording, not UTC. */
  proposalDate: string;
  validDays: number;
  client: ProposalClient;
  preparedBy: ProposalPreparedBy;
  voice: ProposalVoice;
  lineItems: LineItem[];
  gstEnabled: boolean;
  /** Percent. Stored so a rate change is data, not a code change. */
  gstRate: number;
}

export interface ProposalTotals {
  usersTotal: number;
  /**
   * The DEFAULT months, from the billing term — 3, 6 or 12.
   *
   * What a new row starts at and what the term-comparison table prices on. It
   * is no longer what every row is multiplied by: see `lineMonths`.
   */
  months: number;
  /** Months actually charged per row, in the same order as the rows. */
  lineMonths: number[];
  /**
   * True when the rows do not all cover the same number of months.
   *
   * The document's wording turns on this: "per user for the year" is a lie the
   * moment one row runs for nine months, so a mixed quotation prints each row's
   * own period instead of one period for the sheet.
   */
  mixedMonths: boolean;
  /** Per line item, in the same order — `users × rate × its own months`. */
  lineAmounts: number[];
  subtotal: number;
  /**
   * Always computed. Shown as the charge when GST is on, as the saving when off.
   * Whole rupees, the same as `quote()` in lib/plans/pricing.ts.
   */
  gstAmount: number;
  grandTotal: number;
  /** Highest per-user-per-month rate anyone is charged. Drives the price hero. */
  headlineRate: number;
  /** Same as headlineRate now that rates are monthly. Kept for the templates. */
  perUserPerMonth: number;
  /**
   * Net cost across twelve months at the quoted rates. What the forecast counts,
   * and the only figure comparable between a quarterly and a yearly proposal.
   *
   * Summed per row as `users × rate × 12` rather than scaling the subtotal by
   * `12 / months`, which stopped meaning anything once rows could cover
   * different periods. For a quotation whose rows all share one period the two
   * formulas agree exactly, so no stored proposal's forecast figure moves.
   */
  annualised: number;
}

/**
 * Where the money goes, and who signed, on a printed quotation.
 *
 * Read live from Invoice Settings at print time rather than stored on the
 * proposal: Invoice Settings is already the one place these details are
 * maintained, and a quotation is a live offer — if the bank account changes, the
 * right thing is for an unsent quotation to print the new one. (An *invoice* is
 * the opposite and freezes its seller snapshot at save time, by design.)
 */
export interface ProposalPayee {
  firmName: string;
  bankName: string;
  bankAccountNo: string;
  ifsc: string;
  upiId: string;
  signatureUrl: string | null;
}

/**
 * The plans a proposal can be written for — the app's own sellable plans, so a
 * proposal can never quote something the product does not sell.
 */
export type { PlanId as ProposalPlan } from "@/lib/plans/catalog";

/** One editable field, used to build the form without hand-writing inputs. */
export interface ProposalField {
  /** Dot path into ProposalData, e.g. "client.shortName". */
  path: string;
  label: string;
  kind: "text" | "textarea" | "date" | "number";
  /** Shown under the input — what this actually changes in the document. */
  hint?: string;
}

export interface ProposalFieldGroup {
  title: string;
  fields: ProposalField[];
}

/** A summary row for the history list. */
export interface ProposalListRow {
  id: string;
  ref: string;
  plan: string;
  client_name: string;
  proposal_date: string;
  users_total: number;
  /** Which term was quoted, so the list never implies everything is yearly. */
  billing_term: string;
  /** Net on one invoice — what the customer actually pays on that term. */
  term_total: number;
  /** Annualised run-rate, so quarterly and yearly rows are comparable. */
  annual_total: number;
  grand_total: number;
  gst_enabled: boolean;
  status: string;
  sent_at: string | null;
  /** When it was marked won or lost — the month the business counts in. */
  decided_at: string | null;
  updated_at: string;
}
