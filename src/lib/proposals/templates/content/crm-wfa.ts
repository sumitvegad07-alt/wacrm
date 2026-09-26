// ============================================================
// CRM + WFA — front office plus field visibility.
//
// Scope check: both the CRM and WFA lines are on, so leads, deals, the
// WhatsApp inbox, quotations, attendance, live location, visits, routes,
// territory and expenses are all fair to claim. The SFA line is OFF: no order
// capture, no payment collection, no outstanding, no stock, no schemes and no
// Daily Sales Report. Nothing below may promise those.
// ============================================================

import type { PlanContent } from "../content-types";

export const CRM_WFA_CONTENT: PlanContent = {
  eyebrow: "CRM + Workforce Automation · Proposal",
  footerLabel: "CRM + Workforce Proposal",
  planName: "OZZO CRM + WFA — Complete",

  cover: {
    headline: "Your front office and",
    headlineAccent: "your field team.",
    subline:
      "Enquiries, follow-ups and quotations in the office; attendance, location and visits in the field — on one shared customer record.",
    highlights: [
      { k: "Capture", v: "Every enquiry in one pipeline" },
      { k: "Converse", v: "Shared WhatsApp inbox + AI assistant" },
      { k: "Field", v: "Selfie + GPS attendance & live location" },
      { k: "Visits", v: "Geo-tagged, geo-fenced check-ins" },
    ],
  },

  questions: {
    eyebrow: "Five questions every owner asks",
    heading: "The questions you can't answer today —",
    headingAccent: "answered.",
    rows: [
      {
        q: "Where did that enquiry go?",
        a: "Every lead lands in **one pipeline with an owner** — not in someone's personal phone.",
      },
      {
        q: "Who followed up, and when?",
        a: "**One customer timeline** — office calls, WhatsApp, quotations and field visits together.",
      },
      {
        q: "Where is my field team right now?",
        a: "Selfie + GPS attendance and **live location** for every person, all day.",
      },
      {
        q: "Did they actually meet the customer?",
        a: "**Geo-tagged, geo-fenced visits** — check-in only works at the customer's location.",
      },
      {
        q: "What are we paying out in expenses?",
        a: "Claims with **photo proof and an approval flow**, checked against the day's real movement.",
      },
    ],
    signoff:
      "One shared record, updated as the office and the field both work — **no lost enquiries, no attendance register, no re-typing.** The rest of this proposal shows exactly what you get and what it costs.",
  },

  toolkit: {
    eyebrow: "The complete CRM + workforce toolkit",
    heading: "Office and field on one system —",
    headingAccent: "in one app.",
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
        h: "WhatsApp Team Inbox",
        li: [
          "One shared number, not five personal phones",
          "Approved templates for common replies",
          "AI assistant on your own knowledge base",
        ],
      },
      {
        h: "Quotations",
        li: [
          "Branded PDF quotations in minutes",
          "Version trail — what was quoted, when",
          "Your letterhead & document templates",
        ],
      },
      {
        h: "Customer 360",
        li: [
          "One timeline per customer and lead",
          "Office conversations and field visits together",
          "Anyone can pick up where a colleague left off",
        ],
      },
      {
        h: "Attendance & Shifts",
        li: [
          "Selfie + GPS check-in / check-out",
          "Present / Late / Short / Absent auto-classified",
          "Shifts, rosters & attendance muster",
        ],
      },
      {
        h: "Live Location",
        li: [
          "Live map of every punched-in person",
          "Full day timeline & historical track",
          "Tracking Health flags a dead device",
        ],
      },
      {
        h: "Geo-tagged Visits",
        li: [
          "Every visit stamped with GPS & time",
          "Geo-fencing — check-in only at the customer",
          "Visit purpose, notes and photos",
        ],
      },
      {
        h: "Beats, Routes & Territory",
        li: [
          "Monthly beat planner & assigned routes",
          "Route compliance — a skip needs a reason",
          "Territory tree: state → city → area",
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
        h: "Reports & Dashboards",
        li: [
          "Lead, Deal & Quotation reports",
          "Attendance, Visit & Expense reports",
          "Configurable report engine — save & export",
        ],
      },
    ],
  },

  band: {
    eyebrow: "The one that joins the two halves",
    heading: "One customer record for the office",
    headingAccent: "and the field.",
    innerHeading: "The two halves keep",
    innerHeadingAccent: "each other honest.",
    sub: "Most {industry} run the office on one system and the field on phone calls, so nobody can see the whole customer. OZZO puts the enquiry, the conversation and the visit on the same record, as they happen. Nothing is re-keyed.",
    stepper: [
      { ev: "Enquiry arrives", rz: "**lead created** · **owner set**" },
      { ev: "Field visit", rz: "**stamped on the customer**" },
      { ev: "Quotation sent", rz: "**deal moves forward**" },
    ],
    boxes: [
      {
        dot: "#5ea1ff",
        h: "The office — never in the dark",
        p: "When a rep checks in at a customer, the office sees it on the same timeline as the WhatsApp thread and the last quotation. No status call is needed to find out what happened.",
      },
      {
        dot: "#ec5fe6",
        h: "The field — never re-typing",
        p: "Attendance, movement, visits and expenses record themselves from the phone in their pocket, so the day reaches the office without anyone filling in a form at 9pm.",
      },
    ],
    splitEyebrow: "Web + Mobile",
    splitHeading: "You manage. They work.",
    splitHeadingAccent: "Same data.",
    panes: [
      {
        cap: "Admin · Web dashboard",
        h: "Command centre for the office",
        p: "Work the pipeline, reply from the shared inbox, send quotations, watch live locations, approve leave and expenses, and open any report for the whole team.",
      },
      {
        cap: "Field · Android app",
        h: "Everything your team needs",
        p: "Mark attendance, follow the day's route, check in at customers, log a call, update a deal and raise expense claims — syncing the moment the network returns.",
      },
    ],
  },

  included: {
    eyebrow: "Plan & pricing — what's included",
    heading: "One plan.",
    headingAccent: "Office and field.",
    headingTail: "No add-on modules.",
    sub: "Your price of ₹{rate} per user, per year unlocks the entire OZZO CRM and Workforce feature set for every login — office or field. Nothing below is a paid extra.",
    groups: [
      {
        h: "Leads & Deals",
        li: [
          "Lead capture with source & owner",
          "Visual deal pipelines (Kanban)",
          "Tasks and follow-up reminders",
          "Branded PDF quotations",
        ],
      },
      {
        h: "WhatsApp & AI",
        li: [
          "Shared WhatsApp team inbox",
          "Approved message templates",
          "AI assistant on your knowledge base",
          "Chat history on the customer record",
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
        h: "Expenses & Travel",
        li: [
          "Claims with photo proof",
          "Auto travel-distance claim",
          "Custom categories & limits",
          "Multi-level approval flow",
        ],
      },
      {
        h: "Team & Reports",
        li: [
          "Lead · Deal · Quotation reports",
          "Attendance · Visit · Expense reports",
          "Reporting hierarchy (manager / approver)",
          "Leave, Holiday & Announcements",
        ],
      },
      {
        h: "Platform",
        li: [
          "Web dashboard + Android app",
          "Full offline capture & auto-sync",
          "Role-based access & data-scoping",
          "Onboarding, data setup & training",
          "WhatsApp & email support",
        ],
      },
    ],
  },

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
