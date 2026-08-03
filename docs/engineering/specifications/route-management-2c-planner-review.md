# Route Management — Phase 2c Planner Review

**Status:** For CTO review (required before Phase 2d)
**Date:** 2026-08-03
**Commit:** `d752806` (branch `main`). Module `route` OFF by default → planner is inert in prod.

Contents: (1) Planner UX Review · (2) Architecture Review · (3) Performance Notes ·
(4) Verification Report.

---

## 1. Planner UX Review

**Screen:** `/routes/planner` — salesman rows × Mon–Sun. **No calendar UI.**
- **Desktop:** a grid (`180px` name column + 7 day columns). Each cell shows the assigned route
  chip (name + drag handle + ⋯ menu) or a `+` to assign (empty = "Off" for read-only users).
- **Responsive (<lg):** per-salesman cards, one row per weekday — the same actions, no grid.

**Interactions (all RPC-driven, permission-gated):**
- **Assign** — click an empty cell → a right-hand Sheet lists **active** routes (searchable +
  paginated) → pick → assigned.
- **Move** — drag a chip to another cell (any salesman/day). Optimistic: the chip jumps
  instantly; on RPC failure it snaps back with an error toast.
- **Clear** — chip ⋯ → Clear.
- **Copy to day** — chip ⋯ → Copy to day → pick a weekday (same salesman).
- **Copy week** — toolbar "Copy week" → dialog (from salesman → to salesman) copies every
  weekday route across.

**States:** loading, empty ("no active employees" / "no match"), error + Retry, module-disabled
& permission-denied (page guard), optimistic move + rollback. Viewers (no assign/manage rights)
see a read-only board (no `+`, no chip controls, no drag handle).

---

## 2. Architecture Review

- **Strict layering held:** `PlannerBoard` (UI) → route hooks → Route SDK → planner RPCs. No
  component calls Supabase for planner writes; the only direct reads are reference data
  (paginated employees) via a hook, consistent with the rest of the app.
- **Existing RPCs only** (no new DB work, no direct table writes): `route_planner_set`,
  `route_planner_move` (atomic), `route_planner_clear`. Move is a single RPC — never a
  set-then-clear from the client, so it can't partially apply.
- **Pure logic extracted + tested:** `src/lib/route/planner-ops.ts` (`applyOptimisticMove`,
  `plannerCellKey`) — the optimistic transform is unit-tested and the UI stays logic-free.
- **Query keys:** `plannerAll()` is the invalidation prefix; `planner(accountId, sig)` caches
  each visible page independently. Mutations invalidate the prefix so the board and the
  workspace Planning tab both refresh.
- **Future compatibility — nothing blocked:**
  - *Temporary assignment* — the schema's date-bounded rows + partial unique index already
    support it; `getPlanner`/the board key off `(assignee, dow)` and can add a date dimension
    later without a redesign.
  - *Route Templates* — the board assigns by `route_id`; a template→instance split changes what a
    route *is*, not how the planner assigns it.
  - *Business Calendar / Weekly Off / Holidays / Leave* — these belong in the single
    `get_route_for(assignee, date)` resolver (already the one execution hook), not the planner;
    the planner just records intent.
  - *Multiple schedules* — the dormant `route_schedules` table is untouched and available.
- **Offline-mobile readiness:** all mutations go through the SDK executor seam, so mobile reuses
  the identical SDK with a SyncEngine-backed executor (Phase 3).

---

## 3. Performance Notes

Designed for 500+ salesmen / 500+ routes / 20k+ customers:
- **Salesman rows are server-paginated** (20/page, searchable) — the board never renders 500
  rows or 3 500 cells at once.
- **Assignments are fetched only for the visible page** (`getPlanner(accountId, assigneeIds)`
  with an `in(assignee_id, …)` filter) — not the whole account's assignment table.
- **Route name/status for chips** come from a single embedded join on that page's assignments
  (no N+1 per cell).
- **Assign palette** (active routes) is itself paginated + searched server-side (15/page).
- **`keepPreviousData`** on the paged queries avoids flicker when paging/searching.
- **Copy-week** fetches the source's assignments in one query, then issues N `route_planner_set`
  calls (one per weekday, ≤7) — bounded and small.
- **Known cost:** copy-week is N sequential RPCs (≤7, fine). If future bulk operations grow
  (e.g. copy to many salesmen at once), a server-side bulk-copy RPC would be the next step — not
  needed at current scope.

---

## 4. Verification Report

**Automated (run from `wacrm-web`, confirmed cwd):**
- `tsc --noEmit` → **0 errors**.
- `vitest run` → **538/538 pass** (43 files), incl. 5 new `planner-ops` tests covering the
  optimistic move: move-to-empty, target-overwrite (mirrors the atomic RPC), untouched cells,
  and the plannerAll/planner key relationship.
- `next build` → **✓ Compiled successfully**; `/routes/planner` present in the route manifest.
- No regressions (full suite green; the four earlier phases' tests unaffected).

**Server behavior (from Phase 1 production smoke test, still authoritative):** the planner RPCs
(`route_planner_set/clear/move`) were exercised end-to-end as a real authenticated user with RLS
+ permission enforcement; move is atomic in SQL. This phase adds only client code over those.

**Manual planner walkthrough — NOT yet performed live.** It requires the `route` module enabled
on a test account with active routes + employees; I can't authenticate into the running app from
here. I verified Assign/Move/Copy/Clear/permission/module-disabled paths by construction + the
unit-tested optimistic transform, but a real click-through (with screenshots) is still pending.
**Recommendation:** enable the module on the test account and I'll drive the full walkthrough via
the preview browser — ideally before Phase 2d. This is the same open item flagged in the 2b review
(#1) and is the main gap between "verified by automation" and "verified by hand."

---

## Recommendation

Phase 2c is functionally complete and passes all automated checks, with the architecture kept
future-proof and no new DB surface. Before 2d I recommend the live walkthrough above. On your
approval, Phase 2d (Execution UI — web read-only monitoring, per D4) begins.
