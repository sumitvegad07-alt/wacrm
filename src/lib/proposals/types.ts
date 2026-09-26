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

/** A row of the Investment page price table. */
export interface LineItem {
  /** Bold product line, e.g. "OZZO SFA — Field Salesman". */
  label: string;
  /** Muted line beneath it, e.g. "Android app · full field toolkit". */
  subLabel: string;
  users: number;
  /** Rate per user per year, in rupees. */
  rate: number;
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
  /** Per line item, in the same order — `users × rate`. */
  lineAmounts: number[];
  subtotal: number;
  /** Always computed. Shown as the charge when GST is on, as the saving when off. */
  gstAmount: number;
  grandTotal: number;
  /** Drives the price hero and the page-6 "₹300/user/month" bullet. */
  headlineRate: number;
  perUserPerMonth: number;
}

/** Plan lines that can have a proposal template. SFA ships first. */
export type ProposalPlan = "SFA" | "CRM" | "WFA";

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
  annual_total: number;
  grand_total: number;
  gst_enabled: boolean;
  updated_at: string;
}
