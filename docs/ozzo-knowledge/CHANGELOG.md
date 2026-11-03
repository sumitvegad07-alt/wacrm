# Changelog — this knowledge base

What changed here, when, and what it was based on. Newest first.

This is the history of the *documentation*, not of the product. A product change is recorded here
only where it changed what this knowledge base says.

---

## 2026-10-27 (evening) — three defects fixed and deployed

The three camera-facing defects were fixed before any filming, pushed to `main`, and re-verified
in a browser on a production build.

| Commit | Fix |
| --- | --- |
| `372802b` | **F-016** — Broadcasts crashed for every tenant. Two early returns sat above a `useMemo`, so the first render ran one hook fewer than the second and React refused the component |
| `8341d46` | **F-007** — Getting Started printed six raw database keys. One label map beside the resolvers now serves both panels, with a test that fails if any resolver has no label |
| `6d28edc` | **F-014** — the customer page repeated thirteen predefined fields, all empty. Now shows only the ones not drawn above, with their real values |

**Matrix: 83 PASS → 86, 8 FAIL → 5.**

### Two things worth keeping

- **`npm run lint` already caught F-016**, naming it exactly. It shipped because lint was not
  clean. Every component was then swept for the same rule: **one violation in the whole
  codebase**, so no other page is crashing this way.
- **Neither F-007 nor F-014 was fixed where it was reported.** F-007's real cause was two label
  maps untied to the metric list, so adding the six missing entries would have left the next
  metric to break it again; F-014 had already been solved on the product detail page, so that
  shape was reused rather than a new one invented.

---

## 2026-10-27 (later still) — Stage F planned

The videos are catalogued, not yet filmed.

- **`video-dictionary.md`** — new. **37 films across three tracks**: 8 to sell (prospects), 11 to
  start (a new customer's first week), 18 to use (existing customers, one job each). Each in
  English and Hindi, so 74 cuts. Includes the eight to make first, chosen to either close deals
  or stop calls.
- **`demo-scenarios.md`** — new. The ten journeys the films are recorded from, written end to end
  and **explicitly marked as not yet walked**.

### Decisions recorded

- **Two production methods, for two kinds of film.** Concept films use the existing HTML
  animation pipeline in `docs/marketing/video/`, which already produces 1080p30 cuts locked to a
  measured voiceover in both languages. How-to films are screen recordings of the real product,
  because a how-to that does not show the product is not a how-to.
- **Claude cannot record the screen** — automated capture is blocked in this project by design.
  The split: scripts, shot lists, title cards and fact-checking here; recording and assembly by
  the founder.
- **Film on a demo tenant, never on 001001, and not on 001288** — 001288 has customers and
  products but no transactions at all, so every screen that matters is empty.
- **Three defects must be fixed before filming** — F-016, F-007 and F-014 are on camera-facing
  screens, and a film is permanent in a way a document is not.

---

## 2026-10-27 (later) — Stage E, the support rehearsal

Twenty-two real support questions put to the knowledge base and answered **from it alone**.
**10 answered, 6 half-answered, 6 missed.**

**Every single miss was about the account's life, not about a screen** — renewal, seats, leavers,
deletion and recovery, data custody, passwords. The knowledge base had been built by walking the
UI, so it knew the UI; it did not know what happens when a customer stops paying, because that is
not a screen anyone walks.

### Fixed

- **`feature-catalogue.md`** — a new **Account lifecycle** section: expiry (the portal is replaced
  by one card, no grace period, **nothing is deleted**), the seat limit and its exact message,
  what a plan change does to modules and data, deactivating versus removing an employee, soft
  delete and Re-activate, what Export CSV really exports, passwords, the retention figures and
  their two safeguards, and the account time zone.
- **`feature-catalogue.md`** — Payments gained the four rules that decide whether a payment
  reduces a balance, including **oldest-first allocation**.
- **`troubleshooting.md`** — six new symptoms, **15 → 21**.
- **`support-rehearsal.md`** — new: the full scorecard and what it taught.

### Two product findings

- **The account time zone has no editor.** Used for every day boundary; no settings panel writes
  it.
- **There is no self-service account-wide export.**

### Still thin, and said so

Two click paths are documented as rules rather than steps — setting a data scope for one
employee, and creating a second holiday list for a team. Both need a pass through the settings
screens rather than a guess.

---

## 2026-10-27 — Stages B, C and D

The largest single pass so far. Three things happened: the browser sweep was finished, the
behaviour and access documents were written, and the overview and guides were added.

### Stage B — finished the verification sweep

Walked the app on a **production build** (the 23 October pass was on `next dev`, which produced
three false findings).

| | 23 Oct | 27 Oct |
| --- | --- | --- |
| Screens examined | 28 | **91** of 171 routes |
| PASS | 30 | **83** |
| FAIL | 1 | **8** |
| BLOCKED, with a reason | 21 | 76 |
| Never opened | 119 | **4** |

- Re-ran `scripts/knowledge-inventory.mjs`: **171 routes**, up from 167.
- Opened the five WhatsApp screens that had been written off on 24 October because the browser
  pane could not be shown. Showing the pane removed the blockage entirely.
- Marked the 29 founder-only `/admin` routes and the record-dependent ones BLOCKED **with stated
  reasons**, rather than leaving them as an undifferentiated "not tested".

### Nine new findings

| # | What | Severity |
| --- | --- | --- |
| F-016 | **Broadcasts crashes for every tenant** — React refuses to render it | high |
| F-012 | **Add Task opened by URL** has fourteen empty dropdowns and a raw id | high |
| F-013 | **The account owner is bounced out of Add Product** by URL | high |
| F-011 | Document Templates settings cannot be opened from its own URL | medium |
| F-014 | The customer detail page repeats thirteen fields, all empty | medium |
| F-008 | Task report tiles count records the table refuses to show | medium |
| F-009 | Two Ageing report tiles print no number at all | low |
| F-010 | The Visits list has neither a heading nor an empty state | low |
| F-015 | An employee's email is title-cased on the detail page | low |

Plus two method notes: **N-006** (the console buffer is cumulative, so a console error alone
proves nothing) and **N-005** (import keys are plural, custom-field keys singular).

### Three questions closed, one finding withdrawn

`/custom-fields`, `/team` and `/location-tracking/track-report` all redirect correctly on a
production build. **The blank pages recorded on 23 October were a dev-server artefact**, not a
product defect (Q-004, Q-005, Q-007). The FAIL against `/custom-fields` was withdrawn.

### Product changes recorded

- **F-005 fixed** in the product (commit `9b0a358`) — permission gates no longer refuse during
  the profile-load window. Confirmed in the browser. Two lesser symptoms of the same window
  remain, and **F-012 and F-013 are the same mistake in two places the fix did not reach**.
- **F-007 re-confirmed** — still open, now reproduced in a browser rather than only in code.
- Four new routes appeared since 23 October and were added to the matrix.

### Stage C — behaviour and access

- **`access-control-matrix.md`** — new. The gates, in the order they apply: *which app you may
  sign in to* → plan line → module toggle → account role → employee permission → data scope,
  over the RLS ceiling. With the diagnostic order for telling which one fired, all eight plans,
  all twelve modules, every gated route, all 24 settings sections, and the import and
  custom-field gates.
- **`feature-catalogue.md`** — new. 30 modules: the rules customers argue with, not the screens.
  Order pricing, the status lifecycle, part dispatch, derived stock, per-employee working weeks.

### Stage D — overview and guides

- **`application-overview.md`** — new. What OZZO is, the three pieces a customer touches, the
  vocabulary and its traps.
- **`setup-guides.md`** — new. The order to set an account up in, what breaks when it is done out
  of order, the decisions that are hard to undo, and the four modules that ship switched off.
- **`workflow-guides.md`** — new. Thirteen end-to-end workflows.
- **`database-and-api-map.md`** — new. 191 tables, 50 database functions, 86 API routes, and the
  naming traps (customers are `contacts`; attendance is `tracking_sessions`).
- **`CHANGELOG.md`** — this file.

### Rewritten

- **`ui-inventory.md`** — rebuilt from 30 screens to 91, **with a date on every claim** so
  anything predating the 26 October design-system change can be told apart.
- **`troubleshooting.md`** — 8 symptoms to 15, including the new defects and their workarounds.
  The Access Denied entry was rewritten now that F-005 is fixed.
- **`evidence-index.md`** — records the production-build run, and the two mistakes nearly made.

### Corrections to this knowledge base itself

Recorded because being wrong twice is worse than being wrong once:

- **A candidate defect was dropped.** `/contacts/new` appeared to render an empty form; it was
  cold-load slowness and fills in on its own. Re-read before calling a page broken.
- **`/inbox` was nearly recorded as crashing** on the strength of a console error that belonged
  to a different page.
- **The access-control matrix initially missed a gate entirely** — web and mobile sign-in rights.
  Added after the founder pointed it out.

---

## 2026-10-24 — the blocked pass

An attempt to walk the WhatsApp screens. **Produced nothing**: 21 routes were recorded BLOCKED
with the reason "the Browser pane could not be un-hidden".

Kept in the history because the conclusion was wrong in an instructive way. Navigation really
does hang while the pane is hidden — but showing the pane is one call, and the routes were never
unreachable. One of them was crashing the whole time.

---

## 2026-10-23 — the first pass

The knowledge base was created.

- `scripts/knowledge-inventory.mjs` written — reads the routes, nav, plan gates and settings
  sections from source and generates `navigation-map.md` and `_generated/`.
- 28 screens opened on the **dev server**, on test tenant 001288 and on the live account 001001.
- `ui-inventory.md`, `test-matrix.md`, `known-issues.md`, `troubleshooting.md` and
  `evidence-index.md` created; 12 findings and 6 open questions recorded, with four screenshots.
- The read-only verification rules were set: test tenants only, never account 001001, no form
  submitted, nothing created or changed.

**Three of its findings turned out to be dev-server artefacts**, which is why every pass since
has been run on a production build.

---

## How to add to this file

One entry per working session that changed the knowledge base. Say what changed, what it was
based on, and — where it applies — what was got wrong and corrected. The corrections are the part
that stops the same mistake being made twice.
