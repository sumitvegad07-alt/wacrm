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

  cover: {
    headline: "Put your field team",
    headlineAccent: "on autopilot.",
    subline:
      "Attendance, visits, orders and collections from one mobile app — while outstanding and stock keep themselves.",
    highlights: [
      { k: "Field", v: "Selfie + GPS attendance & live location" },
      { k: "Sales", v: "Offline order capture with branded PDF" },
      { k: "Money", v: "Self-calculating outstanding & stock" },
      { k: "Anywhere", v: "Web dashboard + Android app" },
    ],
  },

  questions: {
    eyebrow: "Five questions every sales owner asks",
    heading: "The questions you can't answer today —",
    headingAccent: "answered.",
    rows: [
      {
        q: "Where is my sales team right now?",
        a: "Selfie + GPS attendance and **live location** for every rep, all day.",
      },
      {
        q: "Did they actually visit the outlet?",
        a: "**Geo-tagged, geo-fenced visits** — check-in only works at the shop.",
      },
      {
        q: "What did they book?",
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
      "One system, updated in real time — **no paper, no re-typing, no separate accounting software.** The rest of this proposal shows exactly what you get and what it costs.",
  },

  toolkit: {
    eyebrow: "The complete SFA toolkit",
    heading: "Everything your field sales runs on —",
    headingAccent: "in one app.",
    tiles: [
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
          "Rep sees “My Route” & outlets to visit",
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
        h: "Stock in Hand",
        li: [
          "Live stock ledger per product",
          "Closing stock derived automatically",
          "No register, no separate software",
        ],
      },
      {
        h: "Trade Hierarchy & Pricing",
        li: [
          "Distributor / dealer / retailer levels",
          "Customer-specific price lists",
          "Discounts controlled centrally",
        ],
      },
      {
        h: "Schemes & Offers",
        li: [
          "Quantity & value based schemes",
          "Auto-applied on the order screen",
          "Season / festival offer control",
        ],
      },
      {
        h: "Expenses & Travel",
        li: [
          "Submit travel & expense claims on mobile",
          "Odometer & proof attachments",
          "Manager review & approval",
        ],
      },
      {
        h: "Reports & Daily Sales Report",
        li: [
          "Per-rep Daily Sales Report (DSR)",
          "Sales, Order, Payment, Visit, Ageing, Expense",
          "Leave, Holiday & Announcements built in",
        ],
      },
    ],
  },

  band: {
    eyebrow: "The one that saves you money",
    heading: "No accounting software for",
    headingAccent: "outstanding & stock.",
    innerHeading: "The numbers keep",
    innerHeadingAccent: "themselves.",
    sub: "Most {industry} buy a second accounting package only to answer two questions. OZZO derives both — live — from the orders and payments your team already enters. Nothing is re-keyed.",
    stepper: [
      { ev: "Order booked", rz: "**outstanding ↑** · **stock ↓**" },
      { ev: "Payment collected", rz: "**outstanding ↓**" },
      { ev: "Goods received", rz: "**stock ↑**" },
    ],
    boxes: [
      {
        dot: "#5ea1ff",
        h: "Outstanding — automatic",
        p: "Every order raises a party's balance; every collection lowers it. The figure and the Ageing report update the instant a rep books or collects — no month-end, no accountant.",
      },
      {
        dot: "#ec5fe6",
        h: "Stock — automatic",
        p: "A live ledger moves with every inward and dispatch. Closing stock is a running balance per product, so “what's left” is always a number you can trust.",
      },
    ],
    splitEyebrow: "Web + Mobile",
    splitHeading: "You manage. They sell.",
    splitHeadingAccent: "Same data.",
    panes: [
      {
        cap: "Admin · Web dashboard",
        h: "Command centre for the office",
        p: "See live locations, approve routes & payments, manage products, prices & schemes, and open any report for the whole team.",
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
    headingAccent: "Every feature.",
    headingTail: "No add-on modules.",
    sub: "Your price of ₹{rate} per user, per year unlocks the entire OZZO SFA feature set for every login — field or admin. Nothing below is a paid extra.",
    groups: [
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
          // Was "Quotations" — that is a CRM-line capability the SFA plan does
          // not unlock, so the original document promised something an SFA
          // tenant cannot use. Order guardrails are genuinely SFA.
          "Order guardrails (credit & stock)",
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
        h: "Team & Reports",
        li: [
          "Daily Sales Report (per rep)",
          "Sales · Order · Payment · Visit reports",
          "Attendance & leave classification",
          "Leave, Holiday & Announcements",
        ],
      },
      {
        h: "Platform",
        li: [
          "Web dashboard + Android app",
          "Real-time sync (web ↔ mobile)",
          "Role-based access control",
          "Onboarding, data setup & training",
          "WhatsApp & email support",
        ],
      },
    ],
  },

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
