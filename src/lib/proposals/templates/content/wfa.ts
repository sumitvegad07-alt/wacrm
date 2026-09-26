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

  cover: {
    headline: "See your field team,",
    headlineAccent: "live.",
    subline:
      "Attendance, location, visits and expenses from one mobile app — so you know where your team is and what the day produced, without a single phone call.",
    highlights: [
      { k: "Attendance", v: "Selfie + GPS punch, auto-classified" },
      { k: "Location", v: "Live map & full day timeline" },
      { k: "Visits", v: "Geo-tagged, geo-fenced check-ins" },
      { k: "Money", v: "Expense claims with proof & approval" },
    ],
  },

  questions: {
    eyebrow: "Five questions every field manager asks",
    heading: "The questions you can't answer today —",
    headingAccent: "answered.",
    rows: [
      {
        q: "Who is on duty right now?",
        a: "Selfie + GPS punch-in, **auto-classified** as present, late, short or absent.",
      },
      {
        q: "Where is my team at this moment?",
        a: "**Live location** for every punched-in person, with the full day timeline.",
      },
      {
        q: "Did they actually reach the customer?",
        a: "**Geo-tagged, geo-fenced visits** — check-in only works at the location.",
      },
      {
        q: "How far did they really travel?",
        a: "**Distance from GPS and odometer**, so travel claims match the day's movement.",
      },
      {
        q: "What are we paying out in expenses?",
        a: "Claims with **photo proof and an approval flow** — no loose slips at month-end.",
      },
    ],
    signoff:
      "One system, updated in real time — **no attendance register, no phone calls to ask where someone is, no guesswork on travel claims.** The rest of this proposal shows exactly what you get and what it costs.",
  },

  toolkit: {
    eyebrow: "The complete workforce toolkit",
    heading: "Everything your field team runs on —",
    headingAccent: "in one app.",
    tiles: [
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
          "Full day timeline per person",
          "Historical track report",
        ],
      },
      {
        h: "Tracking Health",
        li: [
          "Flags a dead or drifting device",
          "Know when data is missing, not just late",
          "Trust the map before you act on it",
        ],
      },
      {
        h: "Geo-tagged Visits",
        li: [
          "Every visit stamped with GPS & time",
          "Geo-fencing — check-in only at the location",
          "Visit purpose, notes and photos",
        ],
      },
      {
        h: "Tasks & Follow-ups",
        li: [
          "Unlimited tasks with owner & due date",
          "Follow-ups nobody has to remember",
          "Custom fields on every record",
        ],
      },
      {
        h: "Territory Management",
        li: [
          "Country → state → city → area tree",
          "Area-wise assignment of people & customers",
          "Everyone sees only their own patch",
        ],
      },
      {
        h: "Distance & Odometer",
        li: [
          "Distance travelled from GPS",
          "Odometer capture on punch in / out",
          "Auto travel-distance expense claim",
        ],
      },
      {
        h: "Expenses & Travel",
        li: [
          "Submit claims on mobile with proof",
          "Custom expense categories & limits",
          "Multi-level manager approval flow",
        ],
      },
      {
        h: "Team & Hierarchy",
        li: [
          "Reporting hierarchy — manager & approver",
          "Leave management & approval flow",
          "Holiday calendar & announcements",
        ],
      },
      {
        h: "Reports & Day Report",
        li: [
          "Per-person day report of visits & hours",
          "Attendance, Visit & Expense reports",
          "Configurable report engine — save & export",
        ],
      },
    ],
  },

  band: {
    eyebrow: "The one that ends the phone calls",
    heading: "No attendance register, no",
    headingAccent: "“where are you?” calls.",
    innerHeading: "The day records",
    innerHeadingAccent: "itself.",
    sub: "Most {industry} manage a field team on trust and phone calls, then reconstruct the month from memory. OZZO records the day as it happens — punch, movement, visits and expenses — from the phone already in their pocket. Nothing is re-keyed.",
    stepper: [
      { ev: "Punch in", rz: "**attendance ✓** · **tracking on**" },
      { ev: "Visit check-in", rz: "**location stamped**" },
      { ev: "Punch out", rz: "**hours & distance ✓**" },
    ],
    boxes: [
      {
        dot: "#5ea1ff",
        h: "Attendance — automatic",
        p: "A selfie and a GPS point decide present, late or short — not a register signed at the end of the week. The muster is ready before you ask for it, every day.",
      },
      {
        dot: "#ec5fe6",
        h: "Travel — automatic",
        p: "Distance comes from the day's own movement and the odometer reading, so a travel claim is checked against where the person actually went rather than what they remember.",
      },
    ],
    splitEyebrow: "Web + Mobile",
    splitHeading: "You supervise. They work.",
    splitHeadingAccent: "Same data.",
    panes: [
      {
        cap: "Admin · Web dashboard",
        h: "Command centre for the office",
        p: "See live locations, plan beats and territory, approve leave and expenses, and open any report for the whole team.",
      },
      {
        cap: "Field · Android app",
        h: "Everything a field person needs",
        p: "Mark attendance, check in at each location with a photo, log the visit and raise expense claims — syncing the moment the network returns.",
      },
    ],
  },

  included: {
    eyebrow: "Plan & pricing — what's included",
    heading: "One plan.",
    headingAccent: "Every workforce feature.",
    headingTail: "No add-on modules.",
    sub: "Your price of ₹{rate} per user, per year unlocks the entire OZZO WFA feature set for every login — field or admin. Nothing below is a paid extra.",
  },

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
