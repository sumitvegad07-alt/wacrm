// ============================================================
// CRM — the front office, on its own.
//
// Scope check against the entitlement map (plans/catalog.ts, mirrored in
// ozzo-site/src/lib/plans.ts): the CRM line owns leads, deals, the WhatsApp
// inbox, the AI assistant and quotations. It does NOT include GPS attendance,
// live location, routes, territory, expenses (WFA), or orders, payments,
// outstanding, stock and schemes (SFA). Nothing below may promise those.
//
// Leave, holiday, announcements, custom fields, roles, data-scoping, the
// report engine, offline capture and the Android app are "base" rows — every
// plan has them — so they are fair to claim here.
// ============================================================

import type { PlanContent } from "../content-types";

export const CRM_CONTENT: PlanContent = {
  eyebrow: "Customer Relationship Management · Proposal",
  footerLabel: "CRM Proposal",
  planName: "OZZO CRM — Complete",

  /** The one-line promise under the page-1 heading. */
  tagline:
    "Every lead, chat, follow-up and quotation on one shared customer record — instead of scattered across personal phones and notebooks.",

  why: [
    "**One shared inbox** — customer chat belongs to the business, not a handset.",
    "**Quotations in minutes** — branded PDFs, not re-typed Word files.",
    "**Made in India, priced for India** — ₹{permonth}/user/month, all in.",
    "**Live in days** — we import your customers and set up your team.",
    "**Real support** — over WhatsApp & email, from real people.",
  ],

  seats: [
    { label: "OZZO CRM — Sales / Support User", subLabel: "Web + Android · full CRM toolkit", users: 5 },
    { label: "OZZO CRM — Admin / Manager", subLabel: "Web dashboard · reports & rights", users: 1 },
  ],

  defaultVoice: {
    built:
      "You've built a business that runs on relationships and repeat enquiries. As it grows, the simple questions get hard — who followed up, what did we quote, which deal is closing. OZZO answers each one, live.",
    industryPlural: "growing businesses",
    builtFor: "Built for enquiry-driven sales — pipelines, quotations & WhatsApp out of the box.",
  },
};
