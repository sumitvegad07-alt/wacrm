// ============================================================
// What differs between one plan's proposal and another's.
//
// The eight pages are one component; a content pack supplies the words. The
// cover, terms and thank-you pages are structural and shared — only pages 2-5
// and the plan's own naming change per plan.
//
// Copy may use **bold** (see RichText) and three tokens:
//   {industry}   the "Industry, plural" field, e.g. "spices businesses"
//   {rate}       the headline per-user rate, formatted, e.g. "3,600"
//   {permonth}   the same rate per month, formatted, e.g. "300"
// ============================================================

import type { ProposalVoice } from "../types";

export interface CoverHighlight {
  k: string;
  v: string;
}

export interface QuestionRow {
  q: string;
  a: string;
}

export interface FeatureTile {
  h: string;
  li: string[];
}

export interface BandBox {
  dot: string;
  h: string;
  p: string;
}

export interface SplitPane {
  cap: string;
  h: string;
  p: string;
}

export interface PlanContent {
  /** Cover eyebrow, e.g. "Sales Force Automation · Proposal". */
  eyebrow: string;
  /** Page footers: "OZZO · <footerLabel>". */
  footerLabel: string;
  /** Page 5 plan hero and the Investment page's product naming. */
  planName: string;

  cover: {
    headline: string;
    headlineAccent: string;
    /** The sentence before "A tailored proposal for <client>." */
    subline: string;
    highlights: CoverHighlight[];
  };

  /** Page 2 — the five questions. */
  questions: {
    eyebrow: string;
    heading: string;
    headingAccent: string;
    rows: QuestionRow[];
    signoff: string;
  };

  /** Page 3 — the ten capability tiles. */
  toolkit: {
    eyebrow: string;
    heading: string;
    headingAccent: string;
    tiles: FeatureTile[];
  };

  /** Page 4 — the differentiator band plus the web/mobile split. */
  band: {
    eyebrow: string;
    heading: string;
    headingAccent: string;
    innerHeading: string;
    innerHeadingAccent: string;
    sub: string;
    stepper: { ev: string; rz: string }[];
    boxes: BandBox[];
    splitEyebrow: string;
    splitHeading: string;
    splitHeadingAccent: string;
    panes: SplitPane[];
  };

  /** Page 5 — what the plan includes. */
  included: {
    eyebrow: string;
    heading: string;
    headingAccent: string;
    headingTail: string;
    sub: string;
    /**
     * NOT here: the feature list comes from plan-features.ts (the founder's
     * pricing sheet), so the document always lists exactly what the plan is
     * sold. The pack only supplies the framing copy around it.
     */
  };

  /** Page 6 — the "Why <client> chooses OZZO" tiles. Supports **bold**. */
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
