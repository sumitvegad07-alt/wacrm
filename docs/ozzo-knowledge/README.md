# OZZO knowledge base

Support-facing documentation for the OZZO product: what each screen is, who can reach it, what
has to be switched on first, and what to tell a customer who reports a problem.

This is **not** a second copy of the engineering docs. `wacrm-web/PROJECT.md` remains the
developer source of truth for schema, conventions and build rules. This folder answers a
different question: *given a customer on the phone, what do I say?*

## Where this stands — 27 October 2026

Checked today against the live code. The inventory was regenerated; the verification numbers
below are counted from `test-matrix.md`, not estimated.

| Stage | What it is | State |
| --- | --- | --- |
| **A — Inventory** | Every route, menu entry, plan gate and settings section, generated from source | **DONE.** Regenerated 2026-10-27: **171 routes** (was 167 on 10-23), 93 nav destinations in 10 groups, 85 plan-gated routes, 118 routes with no menu entry, 24 settings sections |
| **B — Browser verification** | Open each screen on test tenant 001288, read-only, and record what it really does | **DONE as far as this tenant allows, 2026-10-27, on a production build.** **86 PASS** · 76 BLOCKED (each with a reason) · **5 FAIL** · **4 NOT TESTED** of 171; 91 screens examined in all. Three of the eight defects were fixed on 2026-10-27 and re-verified. Every blocked row says why: 29 are founder-only `/admin`, the rest need a record this tenant does not have |
| **B — Written output** | `ui-inventory.md`, `known-issues.md`, `troubleshooting.md`, `evidence-index.md` | **ALL FOUR REWRITTEN 2026-10-27.** 12 findings → **21**, of which 9 are new; Q-004, Q-005 and Q-007 closed, 3 new questions opened; `ui-inventory.md` now carries all 91 screens with a date on every claim; `troubleshooting.md` covers **21** customer symptoms, up from 8 |
| **C — Behaviour and access** | `feature-catalogue.md`, `access-control-matrix.md` | **WRITTEN 2026-10-27.** `access-control-matrix.md` sets out the four independent gates (plan line → module toggle → account role → employee permission), plus data scope and the RLS ceiling, with the diagnostic order for telling which one fired. `feature-catalogue.md` covers 30 modules — the rules customers argue with, not the screens. Both VERIFIED IN CODE. A non-owner pass was ruled unnecessary: a user sees exactly what their rights allow, so the rules are the answer |
| **D — Overview and guides** | `application-overview.md`, `setup-guides.md`, `workflow-guides.md`, `database-and-api-map.md`, `CHANGELOG.md` | **WRITTEN 2026-10-27.** All five. The architecture and vocabulary, the setup order and what breaks out of order, 13 end-to-end workflows, and a map of 191 tables / 50 database functions / 86 API routes |
| **E — Support rehearsal** | Answer real questions from this knowledge base only, and fix whatever it could not answer | **DONE 2026-10-27.** 22 questions: 10 answered, 6 half-answered, 6 missed. **Every miss was about the account’s life, not a screen** — renewal, seats, leavers, deletion, data custody. All 12 gaps fixed; see [support-rehearsal.md](support-rehearsal.md) |
| **F — Videos** | Tested demo journeys (`demo-scenarios.md`), then recorded walkthroughs | **PLANNED 2026-10-27.** [video-dictionary.md](video-dictionary.md) catalogues **37 films in 3 tracks** (sell / start / use), each in English and Hindi, with the eight to make first. [demo-scenarios.md](demo-scenarios.md) holds the ten journeys they are recorded from — **written, none walked yet.** Nothing filmed |

### Start here for a support call

| Question | File |
| --- | --- |
| "Why can my admin see it and my rep can't?" | [access-control-matrix.md](access-control-matrix.md) |
| "Why is this number what it is?" | [feature-catalogue.md](feature-catalogue.md) |
| "What does this screen look like and what is on it?" | [ui-inventory.md](ui-inventory.md) |
| "They are reporting a problem — is it a bug?" | [troubleshooting.md](troubleshooting.md), then [known-issues.md](known-issues.md) |
| "How do I set a new account up?" | [setup-guides.md](setup-guides.md) |
| "How does this job get done, start to finish?" | [workflow-guides.md](workflow-guides.md) |
| "What is OZZO, in one read?" | [application-overview.md](application-overview.md) |
| "What happens if they don't renew / an employee leaves / they delete something?" | [feature-catalogue.md](feature-catalogue.md), *Account lifecycle* |
| "What videos should we make?" | [video-dictionary.md](video-dictionary.md) |
| "Where does this data live?" | [database-and-api-map.md](database-and-api-map.md) |

### What the 27 October sweep found

Nine new findings, all verified in a browser on a production build, tenant 001288:

| # | What | Severity |
| --- | --- | --- |
| **F-012** | Open **Add Task** by its own URL and all fourteen dropdown lists stay empty for the life of the page; Assigned To shows a raw database id. Correct when reached from the Tasks list | high |
| **F-013** | The **account owner** is bounced out of **Add Product** when opening `/products/new` directly. A surviving F-005 instance that commit `9b0a358` did not cover | high |
| **F-016** | **Broadcasts crashed for every tenant** — React refused to render it. **FIXED `372802b`** | high |
| **F-011** | **Document Templates** settings cannot be opened from its own URL — it lands on the module toggles instead | medium |
| **F-014** | The customer detail page listed thirteen predefined fields a second time, all empty. **FIXED `6d28edc`** | medium |
| **F-008** | `/reports/tasks` tiles count 2 tasks while the table under them says no records — the tiles ignore the period filter | medium |
| **F-009** | Two tiles on the Ageing report print no number at all | low |
| **F-010** | The Visits list shows neither a heading nor an empty state | low |
| **F-015** | An employee’s email is title-cased on the detail page | low |

And three questions closed: `/custom-fields`, `/team` and `/location-tracking/track-report` all
redirect correctly on a production build — the blank pages recorded on 23 October were the dev
server, not the product. The FAIL against `/custom-fields` is withdrawn.

**F-012 and F-013 are the same mistake as F-005**, found in two more places after that fix
shipped: a value that has not loaded yet is being read as a value of "no". Q-009 asks for a sweep
of the rest.

### What changed in the product since the last pass (10-23/24)

- **F-005 is fixed** — commit `9b0a358` (2026-10-27) stopped permission gates refusing during the
  profile-load window. This was the highest-severity finding here. Two lesser symptoms of the same
  window remain; see `known-issues.md`.
- **Four new routes** — `/`, `/print/expense/[id]`, `/print/leave/[id]`, `/print/list`. Added to
  `test-matrix.md`; `/` has since been opened, the three print routes need a record or a Print
  button to reach them.
- **The UI moved under it.** Since 10-24 the design system landed (`b82796d` → `d820882`) and the
  header-less data screens got a heading row that hosts their controls (`130a9d3`).
  `ui-inventory.md` now **dates every claim**, so anything marked 2026-10-23 predates both changes
  — its behaviour holds, its layout wording may not. The four screenshots predate them too.
- **F-007 is fixed** — reproduced in the browser, then fixed (`8341d46`) with one label map tied to
  the resolvers and a test that fails if a metric has no label.
- **The WhatsApp suite is no longer a blank.** Five screens had been recorded as code-only because
  the browser pane could not be opened on 24 October. All five were opened on 27 October, and one
  of them — Broadcasts — turned out to be crashing (F-016). A route that answers HTTP 200 has not
  been verified.

### Not committed

This whole folder and `scripts/knowledge-inventory.mjs` are **untracked** — they exist only on this
machine. Nothing here is in git history or deployed.

## Who this is for

The business owner, answering questions like:

- How do I switch a feature on?
- Why can the admin see a module but the sales representative cannot?
- Which settings and permissions does this feature need?
- Where is this function in the UI?
- Is this expected behaviour, a configuration problem, or a bug?

## The files

| File | What it holds | State |
| --- | --- | --- |
| `README.md` | This page | — |
| `navigation-map.md` | Every route, every menu entry, every gate | **GENERATED** — do not hand-edit |
| `test-matrix.md` | Verification status per route | Hand-maintained |
| `known-issues.md` | Findings, defects, limitations, open questions | **Current** — 21 findings, 9 open questions |
| `ui-inventory.md` | Screen-by-screen catalogue | **Current** — 91 screens, rewritten 2026-10-27 |
| `feature-catalogue.md` | What each feature does and how it really behaves | **Written 2026-10-27** — 30 modules |
| `access-control-matrix.md` | Settings × plans × roles × permissions × RLS | **Written 2026-10-27** — the four gates |
| `application-overview.md` | Architecture, plans, terminology | **Written 2026-10-27** |
| `setup-guides.md` | Initial setup and master-data dependencies | **Written 2026-10-27** |
| `workflow-guides.md` | Step-by-step operational workflows | **Written 2026-10-27** — 13 workflows |
| `troubleshooting.md` | Symptom → cause → what to tell the customer | **Current** — 21 symptoms, reviewed 2026-10-27 |
| `database-and-api-map.md` | Tables, RPCs, APIs, code references | **Written 2026-10-27** |
| `support-rehearsal.md` | The Stage E rehearsal: what the knowledge base could not answer | **Written 2026-10-27** |
| `demo-scenarios.md` | The journeys to record | **Written 2026-10-27** — 10 journeys, none walked yet |
| `video-dictionary.md` | Every video OZZO should have, and the order to make them | **Written 2026-10-27** — 37 films |
| `evidence-index.md` | Screenshots, verification runs and dates | **Written** |
| `CHANGELOG.md` | Changes to this knowledge base | **Written 2026-10-27** |
| `_generated/` | Machine-readable inventory (`routes.json`, `nav.json`) | **GENERATED** |

Only `demo-scenarios.md` (Stage F) is still missing. It is listed so the shape of the finished
knowledge base stays visible, and so nothing is quietly dropped.

## Verification labels

Every claim in this knowledge base carries one of these. They are not interchangeable, and
reading code is never browser verification:

| Label | Means |
| --- | --- |
| **VERIFIED IN BROWSER** | The screen was opened and the behaviour observed, on a date recorded in `evidence-index.md` |
| **VERIFIED IN CODE** | Read from the implementation; not opened in a browser |
| **TESTED IN AUTOMATED TEST** | A test asserts it, and the test was run |
| **INFERRED — REQUIRES VERIFICATION** | A reasonable reading of the code that nobody has confirmed |
| **UNKNOWN** | Open question |
| **KNOWN DEFECT** | Confirmed wrong, with evidence, in `known-issues.md` |

## How verification is done safely

**The local dev server talks to the production database.** `wacrm-web/.env.local` points at the
live Mumbai Supabase project, and so does the mobile app. There is no staging database.

So verification runs under these rules:

1. Read-only. Open screens, read lists, open detail views. **No form is submitted. No record is
   created, edited or deleted. No setting is changed.**
2. Only on test tenant **001288** (the Play Console closed-test tenant) or the four seeded demo
   tenants. **Account 001001 is the live customer and is never touched.**
3. Screenshots are checked before they land here: no tokens, no real customer data, no superadmin
   tools, no developer console.

## Verifying screens in a browser — do it on a production build

**Do not walk screens on `npm run dev`.** Measured on this machine, 2026-10-23/24:

| What happened | Time |
| --- | --- |
| First compile of `/location-tracking/attendance` | **4.8 minutes** |
| First compile of `/territories` | **2.2 minutes** |
| One "Finished writing to filesystem cache" pass while compiling `/inbox` | **11.2 minutes** |

While the dev server is writing that cache it answers nothing, so it looks dead — several
"the server crashed" conclusions in this project were wrong, and were really the server busy.
Routes answer in 3–7 seconds once compiled, so the cost is per route, first visit only.

The practical method:

1. `npm run build`, then `npx next start`. A built server serves every route with no compilation.
2. If the working tree has uncommitted edits you do not want to disturb, build a detached
   worktree of the last commit instead and junction `node_modules` into it — that leaves the
   main `.next` cache alone.
3. On the dev server, warm routes with plain HTTP requests (`curl`) before driving the browser.
   A browser call that waits for a draw will time out at 30s and hide what is really happening.

**A page that never finishes loading is not necessarily broken.** `/inbox` holds an open
realtime connection, so `document.readyState` never reaches `complete` and any tool that waits
for load will hang. Read such a page with a DOM query instead.

## Regenerating the inventory

```bash
node scripts/knowledge-inventory.mjs
```

Reads `src/app`, `src/lib/plans/surface-gates.ts`, `src/components/layout/sidebar.tsx` and
`src/components/settings/settings-sections.ts`; rewrites `navigation-map.md` and `_generated/`.
It will not overwrite `test-matrix.md` — verification results survive a regeneration.

Run it after any change to routes, navigation, plan gates or settings sections, and compare the
output with what the knowledge base says.
