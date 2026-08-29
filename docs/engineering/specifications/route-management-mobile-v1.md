# Feature Specification: Route Management — Mobile Parity (Planning + Calendar) V1

**Status:** In Development — built by Claude Code 2026-08-25 (TypeScript clean; not yet device-tested)
**Module:** Field Force (Route / Beat Management)
**Date:** 2026-08-25

## 0. Implementation Notes (2026-08-25 build)

**Open questions resolved:** unified Calendar+Planner screen (one screen, capability-layered);
**tap-to-assign** (no drag library added); route-file convention followed (`app/route/new.tsx`,
`app/route/edit/[id].tsx`).

**⚠️ Correctness finding fixed during the build — identity mismatch.** Verified against prod:
`route_plan_assignments.assignee_id`, `routes.primary_assignee_id`, and the `get_route_for`
RPC all key on **`profiles.id`**, while `route_executions.user_id` keys on the **auth `user_id`**
— and `profiles.id ≠ user_id`. The shipped mobile "Today's Route" / "Upcoming" screens passed
`profile.user_id` into an assignment lookup, so they were **silently returning zero routes for
everyone**. Fixed by passing `profile.id` at every assignment-read call site
(`app/route/index.tsx`, `summary.tsx`, `upcoming.tsx`, `[id].tsx`, `app/(drawer)/contacts.tsx`).
All new planner code keys assignments by `profiles.id` and the execution overlay by `user_id`.

**Files added:** `app/route/calendar.tsx` (unified month Calendar + Planner),
`app/route/new.tsx`, `app/route/edit/[id].tsx`, `src/components/route/RouteFormScreen.tsx`,
`src/components/route/CustomerPicker.tsx`, `src/hooks/useRoutePlanning.ts`; pure month-projection
helpers added to `src/lib/route/planner-ops.ts` (`isoDowOf`, `buildMonthGrid`,
`assignmentAppliesOn`, `assignmentsForDate`) and runtime-verified.
**Files extended:** `src/services/RouteService.ts` (planning reads + offline-queued writes),
`src/lib/route/index.ts` (barrel export), `app/(drawer)/calendar.tsx` (redirect into the route
Calendar).

**Verified:** `tsc --noEmit` exit 0; month-projection date math verified by a standalone runtime
harness (Mon-first 42-cell grid, weekday recurrence, date-bounded windows, inactive rows); all
seven planning RPC signatures confirmed against prod.
**Not verified:** on-device UI / offline sync (no device run yet); no unit test committed (mobile
repo has no test harness — adding one is out of scope).

> **One-line summary:** The mobile app can already *execute* routes but cannot *plan* them.
> This spec adds the management side to mobile — create/edit a route, manage its customers,
> and assign the weekly schedule through a **month-calendar planner (one employee at a time)** —
> plus a **per-rep month Calendar** that shows "my route schedule by date" and replaces the
> current placeholder Calendar screen. Crucially, **no new backend is required**: every RPC
> this feature needs is already wrapped in `wacrm-mobile/src/lib/route/sdk.ts`. This is a
> **UI-only build over an existing, offline-aware data layer.**

---

## 1. Feature Overview

- **Problem:** On mobile today, a user can only run a route that was planned for them *on the
  web*. They cannot create a route, add/remove/reorder its customers, or assign which day it
  runs — all of that is web-only. A field manager standing in the field has to wait until
  they're back at a desk to adjust the plan. There is also no calendar on mobile: the
  standalone Calendar screen is a "Coming Soon" stub, and the only schedule view is a flat
  "Upcoming (Tomorrow–Friday)" list that can't show a whole month or past/future dates.
- **Business justification:** Route/Beat planning is the core of field-sales-force (SFA)
  operations. A manager who can re-plan a beat from their phone (a rep called in sick, a new
  shop opened, a customer must move to Thursday) keeps the field moving without a laptop.
  This is the largest remaining gap in the mobile web-parity program for the Route module.
- **Target use case / industries:** FMCG / distribution / pharma field sales, where an
  Area Sales Manager (ASM) supervises salesmen running daily beats. The ASM plans; the
  salesman executes. Both are mobile-first users in this segment.

---

## 2. Scope

### In scope (V1)

1. **Route create / edit screen** (mobile) — name, primary assignee, status, description,
   territories referenced; backed by the existing `route_upsert` RPC.
2. **Route customer management** — add customers (territory-scoped), remove, reorder
   sequence; backed by `route_add_customers`, `route_remove_customer`,
   `route_reorder_customers`, `route_import_customers`.
3. **Month-calendar Planner (one employee at a time)** — a Google-Calendar-style month grid
   (mirroring the web `MonthlyPlannerBoard`) filtered to a **single selected employee**
   (default: the logged-in user; a manager can switch to a downline employee). Tap a day →
   assign / move / copy / remove that employee's route for that weekday. Backed by
   `route_planner_set`, `route_planner_move`, `route_planner_clear`.
4. **Per-rep Route Calendar (read view)** — the same month grid in read-only mode for a user
   without planning rights: each day cell shows the route(s) scheduled for that date and their
   execution status (done / in-progress / pending / missed). Tapping a date opens that day's
   route with its stops. **This replaces the "Coming Soon" Calendar stub and supersedes the
   existing "Upcoming (Tomorrow–Friday)" list** on the My Routes screen.
5. **Route clone** on mobile (`route_clone`) — optional convenience, low cost since the RPC is
   already wrapped.
6. **Permission-gated capability layering** — the read Calendar and the Planner are the *same
   screen*; write affordances (assign/move/remove) appear only when the user holds the
   relevant permission (see §3). No planning permission → clean read-only calendar.

### Out of scope (V1) — do not build

- **The full all-employees × month matrix on mobile.** The web planner can show every salesman
  at once; mobile is **deliberately one employee at a time** (founder decision, this spec).
  Managers who need the whole team in one view continue to use web.
- **Bulk-assign across many employees / "Today's Workload" cross-team drill-down** — web-only.
- **Manager filter panel beyond the single-employee selector + status** — no territory/area/
  manager/route multi-filter bar on mobile V1.
- **Any change to the data model, RPCs, RLS, or permission keys.** If Antigravity finds itself
  writing a migration or a new RPC, that is a STOP AND ASK — it means this spec's core premise
  (UI-only) is wrong and must be re-confirmed.
- **The richer `route_schedules` multi-pattern UI** — that table stays dormant in V1, exactly
  as on web.
- **Route health / executions analytics dashboards** — web monitoring surface, not ported.

---

## 3. User Roles & Permissions

**No new permission keys.** Reuse the exact keys already enforced by the RPCs and the web UI
(from `ROUTE_PERMISSIONS`). Mobile gates each affordance with the same keys via
`PermissionWrapper` / `hasPermission`, and the RPCs enforce ownership server-side regardless.

| Capability (mobile) | Permission key(s) | Notes |
|---|---|---|
| See routes / open the Calendar (read) | `view_routes` | Everyone with route access. |
| Create a route | `add_routes` | |
| Edit a route's core fields | `edit_routes` | RPC also checks `created_by` / `primary_assignee_id` for non-admins. |
| Add / remove / reorder customers | `manage_route_customers` (or the granular `add_route_customers`, `remove_route_customers`, `reorder_route_customers`) | Match whatever the web UI checks — verify in `route-workspace.tsx` before wiring. |
| Assign in the planner (set/move/clear a day) | `assign_routes` | |
| Manage schedule | `manage_route_schedule` | Single umbrella permission (founder decision 2026-08-02). |
| Clone a route | `clone_routes` | |
| Execute a route | `execute_route` | Already built. |
| Approve / reject | `approve_routes` | Already built (approvals screen). |

**Tenant isolation:** every RPC is already RLS-scoped by `account_id`; mobile adds no direct
table queries for writes. Reads that hit tables directly (calendar projection) **must** carry
the account filter exactly as the existing mobile route reads do — Antigravity must copy the
existing read pattern in `src/lib/route/sdk.ts`, not hand-roll a new query.

**Visibility rule (unchanged):** a non-manager sees only their own routes (created_by = them,
or primary_assignee = them). The single-employee planner selector must only offer employees the
current user is entitled to plan for (their downline) — reuse the same employee-scoping the web
planner uses (`useAccountEmployees` equivalent on mobile); do not expose the whole company.

---

## 4. Data Model

**No changes.** This feature reads and writes only existing tables through existing RPCs:

- `routes` — the route template (name, `primary_assignee_id` → `profiles.id`, status).
- `route_customers` — customers on a route + `sequence`.
- `route_plan_assignments` — the weekly schedule: `(account_id, assignee_id, day_of_week)`
  where `day_of_week` is ISO 1=Mon … 7=Sun, with `start_date` / `end_date` for date-bounded
  temporary reassignments. **This is the source of truth the month calendar projects from.**
- `route_schedules` — dormant, do not read/write in V1.
- `route_executions` — one row per (salesman, route, `execution_date`); the **actuals** the
  read Calendar overlays on plan.
- `route_execution_stops` — per-customer execution state.
- Audit → `module_activities` (existing event types: `route_edited`, `customer_added`,
  `schedule_changed`, etc.) — written by the RPCs, not by mobile.

**Month-projection rule (read Calendar & Planner display):** for the visible month, each
`route_plan_assignments` row with `day_of_week = D` renders on **every date in that month whose
weekday = D**, subject to its `start_date`/`end_date` window and `is_active`. Execution status
for a concrete date comes from `route_executions.execution_date`. This mirrors the web
`MonthlyPlannerBoard` exactly — Antigravity must read that component's projection logic and
match it, not invent a different date math.

**Migration notes:** N/A — zero schema change.
**RLS implications:** N/A — no new tables/policies; reuse existing scoping.

---

## 5. API Contract

**No new endpoints.** Every RPC below is **already wrapped** in
`wacrm-mobile/src/lib/route/sdk.ts` (verified 2026-08-25). Antigravity calls the existing SDK
functions; it must **not** call `supabase.rpc(...)` directly from screens.

| Purpose | RPC (already wrapped on mobile) |
|---|---|
| Create / edit route | `route_upsert` |
| Add customers | `route_add_customers` |
| Import customers (territory bulk) | `route_import_customers` |
| Remove a customer | `route_remove_customer` |
| Reorder customers | `route_reorder_customers` |
| Clone a route | `route_clone` |
| Assign a day in planner | `route_planner_set` |
| Move an assignment between days | `route_planner_move` |
| Clear a day's assignment | `route_planner_clear` |
| Bulk status change | `route_bulk_update_status` |
| Read plan assignments | `route_plan_assignments` |
| Read executions (actuals) | `route_executions` |

Request/response shapes: use the existing TypeScript types in `wacrm-mobile/src/lib/route/
types.ts` and `.../sdk.ts`. If a screen needs a shape the SDK doesn't already return, extend
the SDK function's return type — do not shape data ad-hoc inside a component.

**Error cases:** the SDK already maps RPC errors to typed `RouteError` values
(`src/lib/route/errors.ts`) — surface those to the UI (permission-denied, schedule conflict,
territory-not-entitled, optimistic-move-collision). Do not swallow them into a generic toast.

---

## 6. Mobile Behavior

- **Offline:** the route SDK already accepts an `executor` backed by `SyncEngine.enqueueRpc`
  (`RouteSdkOptions`, `sdk.ts:63`), and the execution flow already queues offline. All
  **planning writes** (`route_upsert`, customer add/remove/reorder, `route_planner_*`) must go
  through that **same offline executor** so a manager can re-plan with no signal and have it
  sync on reconnect. **Reads** (calendar projection) are direct + retried, as the SDK already
  does — reads do not queue.
  - **Reuse, do not rebuild:** the existing `OfflineQueueBanner`
    (`src/components/route/OfflineQueueBanner.tsx`) must appear on the new planning screens too.
  - **Conflict resolution:** the planner move RPC is atomic and already collision-safe
    (`applyOptimisticMove` in `planner-ops.ts`). Two managers editing the same slot → last
    write wins at the RPC, and the client re-reads to reconcile. Do not add a bespoke conflict
    UI in V1.
- **Local schema/queue changes:** none beyond enqueuing the above RPCs into the existing route
  queue. **WatermelonDB is not used on mobile — do not introduce it.**
- **Background service:** N/A — planning is foreground-only.
- **Battery/permissions:** N/A — no new device permissions (no GPS/camera added by planning).

---

## 7. UI States

For **every** new screen (Route form, Customer manager, Planner/Calendar), handle:

- **Loading:** skeleton, matching existing mobile route screens.
- **Empty:**
  - Route form: fresh create.
  - Calendar (read): "No routes scheduled" month → clean empty month, not an error.
  - Planner: selected employee has no assignments → empty month with "+ assign" affordances (if
    permitted).
- **Populated:** month grid with day cells showing route chips + counts; read view adds an
  execution-status dot per date.
- **Partial-error:** one RPC in a batch fails (e.g. reorder saved, status didn't) → show which
  action failed via the typed `RouteError`, keep the rest.
- **Full-error:** read failed → retry affordance (SDK already retries; show a manual retry after
  retries exhaust).
- **Permission-denied:** no `view_routes` → the module/tab is hidden (mirror existing
  `RouteGuard`). Has `view_routes` but not planning keys → Calendar renders **read-only**, no
  assign/move/remove controls appear at all (not disabled-greyed — absent).
- **Offline:** `OfflineQueueBanner` visible; write affordances still work and queue; a queued-but-
  unsynced assignment is visually marked as pending until it flushes.

**Screens affected / added:**
- `app/route/index.tsx` — replace the "Upcoming (Tomorrow–Friday)" block with an entry into the
  month Calendar.
- **New:** route create/edit form screen (e.g. `app/route/new.tsx` + `app/route/edit/[id].tsx`,
  matching the mobile Contacts/Order edit route-file convention — verify the actual convention
  in the repo before naming).
- **New:** route customer manager (reuse `EntityList` + a customer picker patterned on
  `ProductPicker`, scoped by `TerritoryPicker`).
- **New:** month Planner/Calendar screen (single component, capability-layered).
- `app/(drawer)/calendar.tsx` (currently `ComingSoon`) — **redirect into the route Calendar**
  and delete the stub content.

---

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected Behavior | Severity |
|---|---|---|
| Rep with only `view_routes` opens Calendar | Read-only month; no write controls rendered | Blocker if writable |
| Manager assigns a route to a day the employee already has one | RPC's `warn_schedule_conflict` surfaces; confirm-overwrite (matches web) | Warning |
| Move assignment onto an occupied slot | Atomic overwrite via `route_planner_move`; client re-reads | Info |
| Offline: manager reorders customers, then app closed | Mutation persisted in route queue, flushes on reconnect, no data loss | Blocker |
| Add customer outside the assignee's entitled territory | RPC rejects (territory-not-entitled `RouteError`); UI explains, doesn't crash | Warning |
| Calendar month spans a `start_date`/`end_date` boundary | Assignment shows only on in-window dates | Warning |
| Employee selector shows someone outside caller's downline | Must be impossible — selector is scoped; if empty, show "No employees you can plan for" | Blocker |
| Execution already run for a date, then plan edited | Read calendar shows the *actual* execution for past dates, the *plan* for future dates | Info |
| Two managers edit same slot concurrently | Last-write-wins at RPC; both re-read; no bespoke merge UI | Info |
| Route has 0 customers, manager tries to assign it to a day | Allow (empty route is valid to schedule) but surface a soft hint | Info |

---

## 9. Reuse Check

**Antigravity must search for and reuse these before writing any new code:**

- `wacrm-mobile/src/lib/route/sdk.ts` — **the entire planning API is already here.** Do not
  re-wrap RPCs. If a needed function is missing, extend this file.
- `wacrm-mobile/src/lib/route/planner-ops.ts` — `applyOptimisticMove`, `plannerCellKey` (pure
  planner logic, already unit-testable).
- `wacrm-mobile/src/lib/route/permissions.ts` — `canApproveRoute` and route permission helpers.
- `wacrm-mobile/src/hooks/useRoute.ts` — `useRouteToday`, `useRouteUpcoming`, `useRouteApproval`
  (extend with a `useRouteCalendar` / `usePlanner` hook rather than fetching in components).
- `wacrm-mobile/src/components/route/OfflineQueueBanner.tsx` — reuse on new screens.
- `wacrm-mobile/src/navigation/RouteGuard.tsx` + `PermissionWrapper` — gate the new screens.
- `wacrm-mobile/src/components/crm/EntityList.tsx` — customer list on the route.
- `wacrm-mobile/src/components/ui/TerritoryPicker.tsx` + `src/hooks/useTerritory.ts` —
  territory-scoped customer selection.
- `wacrm-mobile/src/components/orders/ProductPicker.tsx` — **pattern** to copy for a
  `CustomerPicker` (search + multi-select + add), if one doesn't already exist.
- **Web reference (behavior source of truth, do not port React directly):**
  `wacrm-web/src/components/routes/monthly-planner.tsx` (month projection + drag/copy/repeat
  semantics), `route-wizard.tsx` / `route-workspace.tsx` (create/edit + customer flows),
  `route-edit-sheet.tsx`. Match their **behavior and permission checks**, re-implemented in
  React Native.

**Explicit reuse statement for Antigravity:** "The backend for this feature is complete. Search
`src/lib/route/` first — assume the RPC you need is already wrapped, and prove it isn't before
writing any data-access code."

---

## 10. Open Questions

1. **Unified Calendar+Planner vs. two screens (RECOMMENDED: unified).** This spec treats the
   read Calendar and the manager Planner as **one screen** whose write affordances appear only
   with permission. Alternative: two separate screens. Chosen: unified (less code, one mental
   model, matches how web layers permissions on one board). *Confirm if you'd rather split.*
2. **Drag-and-drop vs. tap-to-assign on the phone.** Web uses drag (`@dnd-kit`); the original
   route spec named `react-native-draggable-flatlist` for mobile. On a small month grid, **tap
   a day → pick a route from a sheet** is often more reliable than dragging across a 6×7 grid.
   Recommendation: **tap/long-press-to-assign as primary**, drag as a fast-follow if it tests
   well. *Confirm the interaction you want for V1.*
3. **Route-file naming convention** for the new create/edit screens — Antigravity must inspect
   the actual mobile convention (`app/contact/edit/[id].tsx` vs `app/order/edit/[id].tsx`) and
   match it; flagged so it isn't guessed.

*(All product-scope decisions — one employee at a time, month calendar, permission-driven,
calendar replaces the stub — were confirmed with the founder on 2026-08-25.)*

---

## 11. Acceptance Criteria

**Functional**
- [ ] A user with `add_routes` can create a route on mobile (name, primary assignee, status)
      and it appears on web with identical fields.
- [ ] A user with `manage_route_customers` can add (territory-scoped), remove, and reorder
      customers; sequence persists and matches web.
- [ ] A user with `assign_routes` can assign, move, copy, and clear an employee's route on a day
      via the month Planner; changes reflect on web's `MonthlyPlannerBoard`.
- [ ] The Planner is filtered to exactly one employee, defaulting to self, switchable only
      within the caller's downline.
- [ ] A user with only `view_routes` sees a read-only month Calendar with per-date execution
      status and **no** write controls.
- [ ] Tapping a date opens that date's route + stops.
- [ ] The old "Coming Soon" Calendar screen redirects into the route Calendar; the
      "Upcoming (Tomorrow–Friday)" list is replaced by the month view.

**Code Quality** — TypeScript strict, zero errors, no unjustified `any`; screens call the route
SDK, never `supabase.rpc` directly.

**Architecture** — no new RPCs, tables, migrations, or permission keys; all writes flow through
the existing route SDK offline executor; pure planner logic stays in `planner-ops.ts`.

**Testing** — unit tests for any new month-projection/date helper (assignment on every matching
weekday, respecting `start_date`/`end_date`); a test proving an offline assignment queues and
flushes with no data loss; a permission test proving read-only render without planning keys.

**Security** — every screen gated by the correct permission key; employee selector cannot escape
the caller's downline; no direct table write bypasses an RPC; account scoping copied from
existing route reads.

**Performance** — month view memoized (no re-projection per cell render); calendar handles a
heavy month (many assignments) without jank on a mid-range Android device.

**Documentation** — update `wacrm-web/PROJECT.md` (mobile parity status) and this spec's Status
to Done; note any new mobile convention discovered so it can be added to the handbook.

**Production Readiness** — verified on device R9ZY805SJ0D (see mobile build/device-ops notes);
offline path tested with airplane mode mid-edit; committed and pushed to mobile master (push
directly to main — no branches/PRs).

---

## 12. Antigravity Implementation Contract

### Step 1 — Read before writing anything
1. Read the full Engineering Handbook for the current stack, architecture, and standards.
2. Read this entire specification, including Open Questions.
3. **Search the existing codebase first.** Specifically search for and read:
   `wacrm-mobile/src/lib/route/` (`sdk.ts`, `planner-ops.ts`, `permissions.ts`, `types.ts`,
   `errors.ts`), `src/hooks/useRoute.ts`, `src/components/route/OfflineQueueBanner.tsx`,
   `src/navigation/RouteGuard.tsx`, `src/components/crm/EntityList.tsx`,
   `src/components/ui/TerritoryPicker.tsx`, `src/components/orders/ProductPicker.tsx`, and the
   existing `app/route/*` screens. On web, read `src/components/routes/monthly-planner.tsx`,
   `route-wizard.tsx`, `route-workspace.tsx` as the behavior source of truth.
4. Identify the real mobile route-file naming convention by inspecting `app/contact/edit/` and
   `app/order/edit/` — do not assume.
5. **The backend is already built.** Confirm against the live repo that every RPC in §5 is still
   wrapped in `src/lib/route/sdk.ts` before writing code. If any is missing, extend the SDK —
   do not call `supabase.rpc` from a screen, and do not write a migration.

### Step 2 — STOP AND ASK triggers
- You find yourself needing a new table, column, RPC, migration, or permission key → STOP. This
  spec's premise is UI-only; if that's wrong, re-confirm before proceeding.
- Anything in §10 Open Questions touches the code you're about to write (unified vs split
  screen; drag vs tap; file naming).
- Existing route code conflicts with this spec (e.g. a route form already exists).
- The spec doesn't specify an error/permission edge case you hit.
- You're about to add a new library (e.g. a calendar or drag lib) not already in mobile — ask
  first; prefer building the month grid from existing primitives.
- You're about to change a shared route SDK function or component used by the already-shipped
  execution flow.

### Step 3 — Implementation rules
- TypeScript strict: zero errors, no `any` without a justifying comment.
- Reuse Before Create / Extend Before Replace — the route SDK, hooks, guards, and pickers exist;
  extend them.
- Match §4/§5 exactly. Any deviation is a STOP AND ASK.
- Respect multi-tenant isolation on every read; every write goes through an RPC.
- Preserve offline-first: planning writes queue via the existing route offline executor and
  degrade gracefully with no connectivity.

### Step 4 — Self-verification before declaring done
Check every item in §11 category by category (Functional, Code Quality, Architecture, Testing,
Security, Performance, Documentation, Production Readiness). If a category can't be verified in
your environment (e.g. on-device offline test), say so explicitly rather than marking it done.

### Step 5 — Report back
1. What was implemented, mapped to this spec's sections.
2. Any deviations and why.
3. Any new mobile conventions discovered/introduced (for the handbook).
4. Any Acceptance Criteria not fully verified and why.
