# Route Management — Phase 2d Execution Monitor Review

**Status:** For CTO review (before Phase 2e — Approval UI)
**Date:** 2026-08-03
**Commit:** `a465100` (branch `main`). Module `route` OFF by default → inert in prod.

Web is a **management console**, not the execution app — routes are run on mobile (Phase 3).
Phase 2d is **read-only monitoring** answering: who started, who's running, who completed, who
skipped.

---

## 1. UX
- **`/routes/executions`** — head-count **tiles** (Started / Currently running / Completed for the
  selected date) + a **date picker** (default today) + **status filter** (All / Running /
  Completed / Abandoned).
- **Table:** Salesman · Route · Status · Progress (`completed/total` + a "N skipped" badge) ·
  Started · Completed. Paginated.
- **Row → stops Sheet:** per-stop status (completed/skipped/pending), **skip reasons**, visit
  times, and a link to open the route. This is where "who skipped what, and why" is answered.
- **States:** loading skeletons, empty ("no route runs on this date"), error + retry,
  module-disabled + permission-denied (page guard). No write actions anywhere — purely monitoring.
- New **"Execution Monitor"** entry in the Routes sidebar group (gated on `view_routes` + module).

## 2. Architecture
- `UI → hooks → SDK` reads only; **zero writes** on this screen (correct for a console).
- New SDK reads: `listExecutions` (route + salesman names + per-page stop tallies),
  `getExecutionSummary` (three head counts), `getExecutionStops` (contact-enriched). Actor names
  resolved via `profiles.user_id` (the auth.users-embed gotcha avoided).
- Pure `tallyStops` extracted to `execution-ops.ts` and unit-tested; UI stays logic-free.
- **RLS:** admins/owners see all executions; non-admins see only their own (field-owned rows).
  So the console is full-visibility for managers/owners and self-only for a plain agent — matches
  the security model (team-scope is deferred, as documented).

## 3. Performance (enterprise scale)
- Executions are **server-paginated** (25/page), filtered by date + status server-side.
- Stop tallies + salesman names are resolved **only for the visible page** (bounded `in(...)`
  queries) — never the whole account's stops.
- Tiles use **head-count** queries (count only, no rows).
- `keepPreviousData` avoids flicker across date/status/page changes.

## 4. Verification
- `tsc --noEmit` → **0 errors**; `vitest run` → **541/541** (3 new `execution-ops` tests:
  completed/skipped/pending tally, unknown-status defensive, empty); `next build` → **✓ compiled**,
  `/routes/executions` present.
- **Live walkthrough still pending** module-enable on a test account (same standing item from 2b/2c)
  — offer stands to drive it in the preview browser and capture screenshots.

## Recommendation
Phase 2d is complete and passes all automated checks. On approval, Phase 2e (Approval UI) begins —
noting that approve/reject affordances already exist on the Route Workspace header; 2e would add a
dedicated pending-approval queue + any approver-experience polish.
