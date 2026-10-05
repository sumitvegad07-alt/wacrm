// ============================================================
// What differs between one plan's proposal and another's.
//
// The two pages are one component; a content pack supplies the words. The
// header, the price table and the terms are structural and shared — only the
// plan's own naming and its benefit lines change per plan.
//
// Trimmed on 5 October 2026, when the document went from eight pages to two:
// the cover headline, the five questions, the ten capability tiles, the
// differentiator band and the "what's included" framing all belonged to pages
// that no longer exist. Their fields were removed rather than left unused —
// unused sales copy is copy that drifts out of date unnoticed and comes back
// wrong the next time someone revives a page.
//
// Copy may use **bold** (see RichText) and three tokens:
//   {industry}   the "Industry, plural" field, e.g. "spices businesses"
//   {rate}       the headline per-user rate, formatted, e.g. "3,600"
//   {permonth}   the same rate per month, formatted, e.g. "300"
// ============================================================

import type { ProposalVoice } from "../types";

export interface PlanContent {
  /** Page 1 eyebrow, e.g. "Sales Force Automation · Proposal". */
  eyebrow: string;
  /** Page footers: "OZZO · <footerLabel>". */
  footerLabel: string;
  /** How the plan names itself on the page-1 feature header and the price table. */
  planName: string;

  /** The one-line promise under the page-1 heading. */
  tagline: string;

  /** The "Why <client> chooses OZZO" lines. Supports **bold**. */
  why: string[];

  /**
   * The price-table rows a new proposal starts with. The rate is not here: it
   * comes from the plan catalog so the form always opens at list price and any
   * discount is a deliberate edit.
   */
  seats: { label: string; subLabel: string; users: number }[];

  /**
   * Starting values for the three industry-wording fields. Written for the
   * kind of business that buys this plan, so the founder edits rather than
   * invents — and never sends a CRM proposal talking about godowns.
   */
  defaultVoice: ProposalVoice;
}
