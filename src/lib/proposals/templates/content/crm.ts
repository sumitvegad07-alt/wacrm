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

  cover: {
    headline: "Never lose an",
    headlineAccent: "enquiry again.",
    subline:
      "Every lead, chat, follow-up and quotation on one shared customer record — instead of scattered across personal phones and notebooks.",
    highlights: [
      { k: "Capture", v: "Every enquiry lands in one pipeline" },
      { k: "Converse", v: "Shared WhatsApp inbox + AI assistant" },
      { k: "Quote", v: "Branded PDF quotations in minutes" },
      { k: "Anywhere", v: "Web dashboard + Android app" },
    ],
  },

  questions: {
    eyebrow: "Five questions every business owner asks",
    heading: "The questions you can't answer today —",
    headingAccent: "answered.",
    rows: [
      {
        q: "Where did that enquiry go?",
        a: "Every lead lands in **one pipeline with an owner** — not in someone's personal phone.",
      },
      {
        q: "Who followed up, and when?",
        a: "**One customer timeline** — every call, message, note and quotation, in order.",
      },
      {
        q: "What exactly did we quote them?",
        a: "**Branded PDF quotations** with a version trail, so nobody argues about the last price.",
      },
      {
        q: "Which deals will actually close?",
        a: "**Visual Kanban pipelines** by stage, owner and value — the month at a glance.",
      },
      {
        q: "Who is talking to our customers?",
        a: "A **shared WhatsApp team inbox** with templates — and an AI assistant on your own answers.",
      },
    ],
    signoff:
      "One shared record, updated as your team works — **no lost enquiries, no re-typing, no customer history trapped on a personal phone.** The rest of this proposal shows exactly what you get and what it costs.",
  },

  toolkit: {
    eyebrow: "The complete CRM toolkit",
    heading: "Everything your front office runs on —",
    headingAccent: "in one place.",
    tiles: [
      {
        h: "Leads & Enquiry Capture",
        li: [
          "Every enquiry captured with source & owner",
          "Assign, re-assign and never drop a lead",
          "Custom fields for how you qualify",
        ],
      },
      {
        h: "Deal Pipelines",
        li: [
          "Visual Kanban by stage and value",
          "Drag a deal forward as it progresses",
          "See the month's pipeline at a glance",
        ],
      },
      {
        h: "WhatsApp Team Inbox",
        li: [
          "One shared number, not five personal phones",
          "Approved templates for common replies",
          "Full chat history on the customer record",
        ],
      },
      {
        h: "AI Assistant",
        li: [
          "Answers drawn from your own knowledge base",
          "Drafts replies your team can edit and send",
          "Keeps tone and pricing consistent",
        ],
      },
      {
        h: "Quotations",
        li: [
          "Branded PDF quotations in minutes",
          "Version trail — what was quoted, when",
          "Your letterhead and document template",
        ],
      },
      {
        h: "Customer 360",
        li: [
          "One timeline per customer and lead",
          "Calls, messages, notes and documents together",
          "Anyone can pick up where a colleague left off",
        ],
      },
      {
        h: "Tasks & Follow-ups",
        li: [
          "Follow-ups with owner, date and priority",
          "Nothing waits on someone's memory",
          "Overdue work is visible, not buried",
        ],
      },
      {
        h: "Custom Fields & Records",
        li: [
          "Add your own fields on every record type",
          "Bulk import your existing customer data",
          "Shape OZZO to how you already work",
        ],
      },
      {
        h: "Roles, Rights & Scoping",
        li: [
          "Per-module view / create / edit / delete rights",
          "Data-scoping: own records, team or company",
          "Your data stays yours, and exportable",
        ],
      },
      {
        h: "Reports & Dashboards",
        li: [
          "Lead, Deal and Quotation reports",
          "Configurable report engine — save & export",
          "Leave, Holiday & Announcements built in",
        ],
      },
    ],
  },

  band: {
    eyebrow: "The one that saves you customers",
    heading: "No customer history stuck on a",
    headingAccent: "personal phone.",
    innerHeading: "The record keeps",
    innerHeadingAccent: "itself.",
    sub: "Most {industry} lose enquiries not because nobody cared, but because the conversation lived in one person's phone. OZZO puts every message, note and quotation on a shared record as your team works. Nothing is re-keyed.",
    stepper: [
      { ev: "Enquiry arrives", rz: "**lead created** · **owner set**" },
      { ev: "Team replies", rz: "**timeline updates**" },
      { ev: "Quotation sent", rz: "**deal moves forward**" },
    ],
    boxes: [
      {
        dot: "#5ea1ff",
        h: "Follow-ups — never forgotten",
        p: "Every lead carries an owner and a next step. Overdue follow-ups surface on the dashboard instead of waiting for someone to remember, so an enquiry cannot quietly go cold.",
      },
      {
        dot: "#ec5fe6",
        h: "History — always shared",
        p: "Chats, notes, tasks and quotations attach themselves to the customer. When someone is on leave or leaves, the relationship stays with your business, not with their handset.",
      },
    ],
    splitEyebrow: "Web + Mobile",
    splitHeading: "You manage. They sell.",
    splitHeadingAccent: "Same data.",
    panes: [
      {
        cap: "Admin · Web dashboard",
        h: "Command centre for the office",
        p: "Work the pipeline, reply from the shared inbox, approve and send quotations, manage users and rights, and open any report for the whole team.",
      },
      {
        cap: "Team · Android app",
        h: "Your customers in your pocket",
        p: "Add a lead, log a call, update a deal and check a customer's history from anywhere — syncing the moment the network returns.",
      },
    ],
  },

  included: {
    eyebrow: "Plan & pricing — what's included",
    heading: "One plan.",
    headingAccent: "Every CRM feature.",
    headingTail: "No add-on modules.",
    sub: "Your price of ₹{rate} per user, per year unlocks the entire OZZO CRM feature set for every login. Nothing below is a paid extra.",
    groups: [
      {
        h: "Leads & Deals",
        li: [
          "Lead capture with source & owner",
          "Visual deal pipelines (Kanban)",
          "Stage, value & probability tracking",
          "Tasks and follow-up reminders",
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
        h: "Quotations & Documents",
        li: [
          "Branded PDF quotations",
          "Version trail on every quote",
          "Your letterhead & document templates",
        ],
      },
      {
        h: "Customers & Data",
        li: [
          "One customer & lead timeline",
          "Custom fields on every record",
          "Bulk import framework",
          "Full export — your data is yours",
        ],
      },
      {
        h: "Team & Reports",
        li: [
          "Lead · Deal · Quotation reports",
          "Configurable report engine",
          "Basic attendance & leave management",
          "Holiday calendar & announcements",
        ],
      },
      {
        h: "Platform",
        li: [
          "Web dashboard + Android app",
          "Real-time sync (web ↔ mobile)",
          "Role-based access & data-scoping",
          "Onboarding, data setup & training",
          "WhatsApp & email support",
        ],
      },
    ],
  },

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
