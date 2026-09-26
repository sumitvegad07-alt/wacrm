// ============================================================
// What each plan is SOLD — transcribed from the founder's
// "OZZO Pricing, Packages & Plans" sheet (2026-09-26).
//
// This is the commercial packaging, and it is what a proposal may promise. It
// is deliberately separate from plans/catalog.ts, which is the technical
// entitlement map the app enforces: the two should agree, and where they do
// not, the mismatch is a bug worth knowing about rather than something to
// paper over in a client-facing document.
//
// Transcription notes — the sheet's wording is kept except for spelling, since
// this text is printed in front of a customer:
//   "Pipelline" → Pipelines, "Chatboats" → Chatbots, "Whatsapp Inox" →
//   WhatsApp Inbox, "attendace" → Attendance, "Whatsapp" → WhatsApp.
// Two features are worded differently in the WFA and CRM columns and are
// normalised so a combo plan does not print the same thing twice:
//   "Follow-ups Management" / "Follow-up Management" → the latter,
//   "Attendance, Leaves & ..." / "Attendance, Leave & ..." → the latter.
// Per the sheet: SFA = "Includes All WFA Features" plus its own list; the two
// combo plans are the unions of their lines.
// ============================================================

import type { PlanId } from "@/lib/plans/catalog";

/** WFA column of the sheet (150 PUPM). */
export const WFA_FEATURES = [
  "Unlimited Customers",
  "Unlimited Tasks",
  "Follow-up Management",
  "Location tracking",
  "Live Feed Dashboard",
  "Location Dashboard",
  "Travelled Route & Distance",
  "Tracking Health",
  "Customer Visit Management",
  "Attendance, Leave & Holiday Management",
  "Geo-tagging",
  "Geo-Fencing for visits",
  "Selfie punch-in and punch-out",
  "Expense / allowances",
  "Odometer with photo",
  "User hierarchy",
  "Custom Fields",
  "AI Implementation",
  "Reports",
  "Smart Dashboard",
  "Announcements",
] as const;

/** SFA column (300 PUPM). The sheet states SFA includes all WFA features. */
export const SFA_OWN_FEATURES = [
  "Unlimited Products",
  "Unlimited Price Lists",
  "Price Floor",
  "Salesman Level Discount options",
  "Order collection",
  "Dispatch Management",
  "Primary / Secondary Sales Management",
  "Scheme Management",
  "Payment collection",
  "Live Stock Management",
  "Live Outstanding Management",
  "Route Management (RTM)",
  "Multi-unit Ordering system",
  "Quotation Management",
  "Multiple Customizable Templates",
  "GST & HSN Code Management",
  "Customer Credit Management",
] as const;

/** CRM column (100 PUPM). */
export const CRM_FEATURES = [
  "Unlimited Leads",
  "Unlimited Customers",
  "Unlimited Products",
  "Unlimited Tasks",
  "Visual Kanban Pipelines",
  "Follow-up Management",
  "Custom Fields",
  "Quotation Management",
  "WhatsApp Broadcasting",
  "WhatsApp Chatbots",
  "WhatsApp Template creation",
  "Workflow Automation",
  "WhatsApp Inbox",
  "AI Knowledge base",
  "Smart Dashboard",
  "Announcements",
  "Attendance, Leave & Holiday Management",
  "AI Implementation",
  "Reports",
] as const;

/** Every feature a plan is sold, de-duplicated, in sheet order. */
export function featuresForPlan(plan: PlanId): string[] {
  const lists: string[][] = [];

  if (plan === "WFA" || plan === "CRM_WFA" || plan === "SFA" || plan === "CRM_SFA") {
    lists.push([...WFA_FEATURES]);
  }
  if (plan === "SFA" || plan === "CRM_SFA") {
    lists.push([...SFA_OWN_FEATURES]);
  }
  if (plan === "CRM" || plan === "CRM_WFA" || plan === "CRM_SFA") {
    lists.push([...CRM_FEATURES]);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const feature of lists.flat()) {
    const key = feature.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(feature);
  }
  return out;
}

// ------------------------------------------------------------
// Presentation: the plan's features grouped for the "what's included" page.
//
// One master category table, filtered per plan. A feature belongs to exactly
// one category, so nothing is printed twice and — enforced by the tests —
// nothing the customer is sold goes missing from the document.
// ------------------------------------------------------------

export interface FeatureGroup {
  h: string;
  li: string[];
}

const CATEGORIES: FeatureGroup[] = [
  {
    h: "Leads, Deals & Quotations",
    li: [
      "Unlimited Leads",
      "Visual Kanban Pipelines",
      "Follow-up Management",
      "Quotation Management",
      "Multiple Customizable Templates",
    ],
  },
  {
    h: "WhatsApp & Automation",
    li: [
      "WhatsApp Inbox",
      "WhatsApp Broadcasting",
      "WhatsApp Chatbots",
      "WhatsApp Template creation",
      "Workflow Automation",
      "AI Knowledge base",
    ],
  },
  {
    h: "Attendance & Field Discipline",
    li: [
      "Selfie punch-in and punch-out",
      "Attendance, Leave & Holiday Management",
      "Geo-tagging",
      "Geo-Fencing for visits",
      "Odometer with photo",
      "Expense / allowances",
    ],
  },
  {
    h: "Location & Visits",
    li: [
      "Location tracking",
      "Live Feed Dashboard",
      "Location Dashboard",
      "Travelled Route & Distance",
      "Tracking Health",
      "Customer Visit Management",
    ],
  },
  {
    h: "Orders & Distribution",
    li: [
      "Order collection",
      "Multi-unit Ordering system",
      "Route Management (RTM)",
      "Dispatch Management",
      "Primary / Secondary Sales Management",
      "GST & HSN Code Management",
    ],
  },
  {
    h: "Money, Stock & Pricing",
    li: [
      "Payment collection",
      "Live Outstanding Management",
      "Live Stock Management",
      "Customer Credit Management",
      "Unlimited Price Lists",
      "Price Floor",
      "Salesman Level Discount options",
      "Scheme Management",
    ],
  },
  {
    h: "Platform, Reports & AI",
    li: [
      "Unlimited Customers",
      "Unlimited Products",
      "Unlimited Tasks",
      "Custom Fields",
      "User hierarchy",
      "Smart Dashboard",
      "Reports",
      "Announcements",
      "AI Implementation",
    ],
  },
];

/** The plan's features, grouped for the document. Empty groups are dropped. */
export function includedGroupsForPlan(plan: PlanId): FeatureGroup[] {
  const allowed = new Set(featuresForPlan(plan).map((f) => f.toLowerCase()));

  return CATEGORIES.map((cat) => ({
    h: cat.h,
    li: cat.li.filter((f) => allowed.has(f.toLowerCase())),
  })).filter((g) => g.li.length > 0);
}

/** Exposed for the completeness test. */
export const ALL_CATEGORIES = CATEGORIES;
