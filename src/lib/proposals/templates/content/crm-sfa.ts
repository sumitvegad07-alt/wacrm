// ============================================================
// CRM + SFA — the complete platform.
//
// Scope check: all three lines are on (SFA always includes WFA), so every
// capability in the matrix is fair to claim. This is the only pack with no
// exclusions — which is exactly why it must not read like a longer SFA
// proposal: what the client is buying over SFA alone is the front office.
// ============================================================

import type { PlanContent } from "../content-types";

export const CRM_SFA_CONTENT: PlanContent = {
  eyebrow: "CRM + Sales Force Automation · Proposal",
  footerLabel: "CRM + Sales Force Automation Proposal",
  planName: "OZZO CRM + SFA — Complete",

  /** The one-line promise under the page-1 heading. */
  tagline:
    "Enquiries and quotations in the office, orders and collections in the field, outstanding and stock keeping themselves — on one platform.",

  why: [
    "**One platform, not three** — front office, field and accounts on one record.",
    "**No second software** — outstanding & stock included, not extra.",
    "**Made in India, priced for India** — ₹{permonth}/user/month, all in.",
    "**Live in days** — we import your customers, products & team for you.",
    "**Real support** — over WhatsApp & email, from real people.",
  ],

  seats: [
    { label: "OZZO CRM + SFA — Field Salesman", subLabel: "Android app · full field toolkit", users: 5 },
    { label: "OZZO CRM + SFA — Admin / Manager", subLabel: "Web dashboard · pipeline, reports & approvals", users: 1 },
  ],

  defaultVoice: {
    built:
      "You've built a business that wins customers in the office and serves them in the field. As it grows, the simple questions get hard — who followed up, what did we quote, what was booked, who still owes us. OZZO answers each one, live.",
    industryPlural: "distribution businesses",
    builtFor: "Built for end-to-end selling — pipelines, beats, orders & collections out of the box.",
  },
};
