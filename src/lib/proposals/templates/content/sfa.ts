// ============================================================
// SFA — Sales Force Automation.
//
// This is the copy from the Shaahi Niti Masale proposal, unchanged. It is the
// reference against which the other four packs were written, and
// sfa-proposal.test.tsx asserts these sentences verbatim.
// ============================================================

import type { PlanContent } from "../content-types";

export const SFA_CONTENT: PlanContent = {
  eyebrow: "Sales Force Automation · Proposal",
  footerLabel: "Sales Force Automation Proposal",
  planName: "OZZO SFA — Complete",

  /** The one-line promise under the page-1 heading. */
  tagline:
    "Attendance, visits, orders and collections from one mobile app — while outstanding and stock keep themselves.",

  why: [
    "**No second software** — outstanding & stock included, not extra.",
    "**Works offline** — orders never wait for a signal.",
    "**Made in India, priced for India** — ₹{permonth}/user/month, all in.",
    "**Live in days** — we set up your products & team for you.",
    "**Real support** — over WhatsApp & email, from real people.",
  ],

  seats: [
    { label: "OZZO SFA — Field Salesman", subLabel: "Android app · full field toolkit", users: 5 },
    { label: "OZZO SFA — Admin / Manager", subLabel: "Web dashboard · reports & approvals", users: 1 },
  ],

  defaultVoice: {
    built:
      "You've built a trusted spices & masala brand across a growing dealer and retailer network. As it grows, the simple questions get hard. OZZO answers each one, live.",
    industryPlural: "spices businesses",
    builtFor: "Built for FMCG distribution — trade levels, beats & schemes out of the box.",
  },
};
