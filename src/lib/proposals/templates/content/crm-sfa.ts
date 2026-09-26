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

  cover: {
    headline: "Win the customer.",
    headlineAccent: "Then serve them.",
    subline:
      "Enquiries and quotations in the office, orders and collections in the field, outstanding and stock keeping themselves — on one platform.",
    highlights: [
      { k: "Capture", v: "Every enquiry in one pipeline" },
      { k: "Field", v: "Attendance, visits & live location" },
      { k: "Sales", v: "Offline order capture with branded PDF" },
      { k: "Money", v: "Self-calculating outstanding & stock" },
    ],
  },

  questions: {
    eyebrow: "Five questions every sales owner asks",
    heading: "The questions you can't answer today —",
    headingAccent: "answered.",
    rows: [
      {
        q: "Where did that enquiry go?",
        a: "Every lead lands in **one pipeline with an owner**, and stays on the customer's record for life.",
      },
      {
        q: "Where is my sales team right now?",
        a: "Selfie + GPS attendance and **live location** for every rep, all day.",
      },
      {
        q: "What did they book today?",
        a: "Orders captured at the counter — **even offline** — with a branded PDF.",
      },
      {
        q: "How much is still outstanding?",
        a: "**Self-calculates** from orders & collections — plus an Ageing report.",
      },
      {
        q: "How much stock is really left?",
        a: "A **live stock ledger** derives closing stock — no godown guessing.",
      },
    ],
    signoff:
      "One platform from first enquiry to final collection — **no lost leads, no paper, no re-typing, no separate accounting software.** The rest of this proposal shows exactly what you get and what it costs.",
  },

  toolkit: {
    eyebrow: "The complete OZZO platform",
    heading: "From first enquiry to final rupee —",
    headingAccent: "in one system.",
    tiles: [
      {
        h: "Leads & Deal Pipelines",
        li: [
          "Every enquiry captured with source & owner",
          "Visual Kanban by stage and value",
          "Tasks and follow-ups that nobody forgets",
        ],
      },
      {
        h: "WhatsApp & Quotations",
        li: [
          "Shared WhatsApp inbox + AI assistant",
          "Branded PDF quotations with a version trail",
          "Chat history on the customer record",
        ],
      },
      {
        h: "Attendance & Live Location",
        li: [
          "Selfie + GPS check-in / check-out",
          "Present / Late / Short / Absent auto-classified",
          "Live location & day route per rep",
        ],
      },
      {
        h: "Beat, Route & Territory",
        li: [
          "Monthly beat planner & assigned routes",
          "Route compliance — a skip needs a reason",
          "Territory tree: state → city → area",
        ],
      },
      {
        h: "Geo-tagged Visits",
        li: [
          "Every visit stamped with GPS & time",
          "Geo-fencing — check-in only at the outlet",
          "Productive visit = a visit that booked an order",
        ],
      },
      {
        h: "Orders & Dispatch",
        li: [
          "Take orders at the counter — works offline",
          "Catalogue with GST / HSN & multi-unit",
          "Branded order PDF + dispatch tracking",
        ],
      },
      {
        h: "Collection & Outstanding",
        li: [
          "Record collections in the field with proof",
          "Outstanding per customer, self-calculating",
          "Ageing report — who owes, how long",
        ],
      },
      {
        h: "Stock & Schemes",
        li: [
          "Live stock ledger & derived closing stock",
          "Quantity & value based trade schemes",
          "Customer-specific price lists",
        ],
      },
      {
        h: "Expenses & Travel",
        li: [
          "Claims on mobile with photo proof",
          "Auto travel-distance from GPS & odometer",
          "Multi-level manager approval flow",
        ],
      },
      {
        h: "Reports & Daily Sales Report",
        li: [
          "Per-rep Daily Sales Report (DSR)",
          "Lead, Deal, Quotation & Sales reports",
          "Order, Payment, Visit, Ageing & Expense reports",
        ],
      },
    ],
  },

  band: {
    eyebrow: "The one that closes the loop",
    heading: "One record from first enquiry to",
    headingAccent: "final collection.",
    innerHeading: "The whole journey keeps",
    innerHeadingAccent: "itself.",
    sub: "Most {industry} run the front office, the field and the accounts as three disconnected systems, then reconcile them by hand. OZZO carries one customer record through all three — enquiry, order, collection — and derives outstanding and stock as it goes. Nothing is re-keyed.",
    stepper: [
      { ev: "Enquiry won", rz: "**lead → customer**" },
      { ev: "Order booked", rz: "**outstanding ↑** · **stock ↓**" },
      { ev: "Payment collected", rz: "**outstanding ↓**" },
    ],
    boxes: [
      {
        dot: "#5ea1ff",
        h: "The front office — connected",
        p: "The lead you won, the quotation you sent and the orders that followed sit on the same customer. Your team can see what was promised before they take the next order.",
      },
      {
        dot: "#ec5fe6",
        h: "The accounts — automatic",
        p: "Every order raises a party's balance and moves stock; every collection lowers it. Outstanding, Ageing and closing stock update the instant a rep books or collects — no month-end, no accountant.",
      },
    ],
    splitEyebrow: "Web + Mobile",
    splitHeading: "You manage. They sell.",
    splitHeadingAccent: "Same data.",
    panes: [
      {
        cap: "Admin · Web dashboard",
        h: "Command centre for the office",
        p: "Work the pipeline, send quotations, see live locations, approve routes & payments, manage products, prices & schemes, and open any report for the whole team.",
      },
      {
        cap: "Field · Android app",
        h: "Everything a salesman needs",
        p: "Mark attendance, follow the beat, check in at outlets, take orders offline, collect payments and share a branded PDF — syncing the moment the network returns.",
      },
    ],
  },

  included: {
    eyebrow: "Plan & pricing — what's included",
    heading: "One plan.",
    headingAccent: "The whole platform.",
    headingTail: "No add-on modules.",
    sub: "Your price of ₹{rate} per user, per year unlocks every OZZO line — CRM, Workforce and Sales Force Automation — for every login. Nothing below is a paid extra.",
    groups: [
      {
        h: "Front Office",
        li: [
          "Leads, deals & visual pipelines",
          "Shared WhatsApp inbox + AI assistant",
          "Branded PDF quotations",
          "One customer timeline, office + field",
        ],
      },
      {
        h: "Field Operations",
        li: [
          "Selfie + GPS attendance",
          "Live location tracking",
          "Geo-tagged & geo-fenced visits",
          "Beat & route planner",
          "Territory management",
        ],
      },
      {
        h: "Sales & Orders",
        li: [
          "Offline order capture",
          "Product catalogue (GST / HSN)",
          "Multi-unit & branded order PDF",
          "Dispatch tracking",
          "Order guardrails (credit / stock)",
        ],
      },
      {
        h: "Money & Stock",
        li: [
          "Field payment collection",
          "Self-calculating outstanding",
          "Ageing report",
          "Live stock ledger & closing stock",
          "Expense & travel claims",
        ],
      },
      {
        h: "Customers & Pricing",
        li: [
          "Distributor / dealer / retailer levels",
          "Customer-specific price lists",
          "Schemes & discounts",
          "Custom fields on every record",
          "Data import",
        ],
      },
      {
        h: "Team, Reports & Platform",
        li: [
          "Daily Sales Report (per rep)",
          "Lead · Deal · Sales · Payment · Ageing reports",
          "Web dashboard + Android app",
          "Role-based access & data-scoping",
          "Onboarding, training & support",
        ],
      },
    ],
  },

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
