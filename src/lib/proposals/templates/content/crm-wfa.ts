// ============================================================
// CRM + WFA — front office plus field visibility.
//
// Scope check: both the CRM and WFA lines are on, so leads, deals, the
// WhatsApp inbox, quotations, attendance, live location, visits,
// territory and expenses are all fair to claim. The SFA line is OFF: no order
// capture, no payment collection, no outstanding, no stock, no schemes, no
// Route Management (RTM moved to SFA on 2026-09-26) and no Daily Sales
// Report. Nothing below may promise those.
// ============================================================

import type { PlanContent } from "../content-types";

export const CRM_WFA_CONTENT: PlanContent = {
  eyebrow: "CRM + Workforce Automation · Proposal",
  footerLabel: "CRM + Workforce Proposal",
  planName: "OZZO CRM + WFA — Complete",

  /** The one-line promise under the page-1 heading. */
  tagline:
    "Enquiries, follow-ups and quotations in the office; attendance, location and visits in the field — on one shared customer record.",

  why: [
    "**One record, both halves** — the office sees the field without a phone call.",
    "**Works offline** — the day records itself with or without a signal.",
    "**Made in India, priced for India** — ₹{permonth}/user/month, all in.",
    "**Live in days** — we import your customers and set up your team & areas.",
    "**Real support** — over WhatsApp & email, from real people.",
  ],

  seats: [
    { label: "OZZO CRM + WFA — Field Staff", subLabel: "Android app · attendance, visits & customers", users: 5 },
    { label: "OZZO CRM + WFA — Admin / Manager", subLabel: "Web dashboard · pipeline, live map & approvals", users: 1 },
  ],

  defaultVoice: {
    built:
      "You've built a business where the office wins the customer and the field keeps them. As it grows, the simple questions get hard — who followed up, who visited, what did the day produce. OZZO answers each one, live.",
    industryPlural: "growing businesses with field teams",
    builtFor: "Built for office-plus-field operations — pipelines, attendance & visits out of the box.",
  },
};
