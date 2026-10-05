// ============================================================
// WFA — Workforce Automation, on its own.
//
// Scope check: the WFA line owns attendance, live location, tracking health,
// geo-tagged visits, territory, expenses and the reporting
// hierarchy. It does NOT include orders, payments, outstanding, stock,
// schemes or Route Management (SFA — RTM moved there on 2026-09-26), nor
// leads, deals, the WhatsApp inbox or quotations (CRM).
//
// The Daily Sales Report is an SFA row; on WFA the equivalent is a visit-based
// day report, which is what this pack claims.
// ============================================================

import type { PlanContent } from "../content-types";

export const WFA_CONTENT: PlanContent = {
  eyebrow: "Workforce Automation · Proposal",
  footerLabel: "Workforce Automation Proposal",
  planName: "OZZO WFA — Complete",

  /** The one-line promise under the page-1 heading. */
  tagline:
    "Attendance, location, visits and expenses from one mobile app — so you know where your team is and what the day produced, without a single phone call.",

  why: [
    "**Attendance that cannot be faked** — selfie, GPS and geo-fence together.",
    "**Works offline** — the day records itself with or without a signal.",
    "**Made in India, priced for India** — ₹{permonth}/user/month, all in.",
    "**Live in days** — we set up your team, areas & customers for you.",
    "**Real support** — over WhatsApp & email, from real people.",
  ],

  seats: [
    { label: "OZZO WFA — Field Staff", subLabel: "Android app · attendance, visits & expenses", users: 5 },
    { label: "OZZO WFA — Admin / Manager", subLabel: "Web dashboard · live map & approvals", users: 1 },
  ],

  defaultVoice: {
    built:
      "You've built a team that works away from the office every day. As it grows, the simple questions get hard — who is on duty, where are they, what did the day produce. OZZO answers each one, live.",
    industryPlural: "field teams",
    builtFor: "Built for field operations — attendance, live location & beats out of the box.",
  },
};
