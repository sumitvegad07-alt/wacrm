# Feature Specification: Route Management (OZZO Route / Beat Management V1)

**Status:** ✅ APPROVED FOR IMPLEMENTATION — Revision 3 (CTO final review applied 2026-08-02)
**Module:** Field Force (new sub-module, depends on Territory Master + Reporting Hierarchy)
**Date:** 2026-08-01 (rev. 2 + rev. 3: 2026-08-02)

> Scoping decisions were confirmed with the founder on 2026-08-01:
> 1. A Route is a **reusable named template** with a primary assignee; the weekly Planner maps
>    *salesman × weekday → route*.
> 2. The **weekly Planner is the schedule for V1**; the database is built to allow richer
>    patterns (every X days / monthly) later without a rebuild.
> 3. Approval is **simple and reuses the shipped Reporting Hierarchy** (none / manager / admin).
> 4. History is a **detailed audit log** (reusing `module_activities`), not structural version
>    snapshots.
> 5. Route execution stops **reuse the existing `site_visits` system** (GPS / photo / feedback /
>    offline), linked back to the route.
> 6. A mobile user who holds the create/edit permission gets **full authoring parity** on the
>    phone — create/edit, import, drag-and-drop sequencing, and the Planner — all offline-first.

> **Revision 2 (2026-08-02):** the Architecture Review
> (`route-management-architecture-review.md`) was approved. All seven `[APPLY TO V1 SPEC]` and all
> `[DOC ONLY]` recommendations are folded in below. Confirmed founder decisions: drag-and-drop =
> **@dnd-kit** (web) + **react-native-draggable-flatlist** (mobile); `manage_route_schedule` stays a
> **single** permission (scheduling is one business capability); **no team-scoped visibility in V1**
> (Owner/Admin see all, Managers see only routes they created/own — team scope deferred to a future
> version via Reporting Hierarchy); Route Management gets its **own new "Routes" sidebar group** (not
> under Location Tracking — different business domain).

> **Revision 3 (2026-08-02) — CTO final review, APPROVED for implementation.** Three polish changes
> applied: (1) `owner_id` → **`primary_assignee_id`** (avoids semantic drift once routes are
> shared/templated/reassigned); (2) an explicit **Archive semantics** architecture rule (§5.5);
> (3) a non-blocking **Route Health** validation engine with a health score (§5.11, §7). One
> engineering rule added to the Antigravity contract (§13): *never optimize for V2 by making V1
> harder to understand.* No feature scope was added.

---

## 1. Feature Overview

- **Problem:** Today a field salesman can visit any customer they can see, in any order, on any
  day. FMCG / distribution businesses run on *beats* — a fixed, ordered list of shops a salesman
  covers on a given weekday ("North Route on Monday"). Without this, there is no way to plan
  coverage, no way to see who was skipped, and no proof the planned round was actually run.
- **Business justification:** Beat planning is table-stakes for the FMCG/distribution segment
  wacrm sells into — it is one of the "planned modules" already named in the handbook
  (Route/Beat Management). It turns the existing raw GPS/visit data into a *plan vs. actual*
  story an owner can act on. It is also the natural consumer of the two foundations shipped on
  2026-07-31: Territory Master (which customer belongs to which area/salesman) and Reporting
  Hierarchy (who approves).
- **Target use case / industries:** FMCG, distribution, and any field-sales org where reps run
  repeating daily rounds of the same shops. Personas: **Admin/Owner** configures the module and
  approves; **Manager** builds and assigns routes for their team; **Salesman** runs today's route
  on the phone (and, where permitted, builds/edits their own).

**Guiding principles (must never be violated — from the founder's plan):**
1. **Route is optional.** When the module is off, there is zero route enforcement and free-visit
   mode is completely unchanged. Existing route data (if any) is preserved.
2. **Territory owns customers.** Routes never *own* customers — they only *reference* `contacts`
   that are already the salesman's via Territory assignment. No customer ownership logic is
   duplicated here.
3. **Simplicity first.** Every screen must be usable by a non-technical FMCG admin.
4. **Configuration over hardcoding.** Every behavior switch lives in account settings, not code.

---

## 2. Scope

### In scope (V1)
- **Settings & module toggle:** account-wide enable (default OFF), behavior switches, approval
  mode, validation thresholds.
- **Granular permissions:** one permission key per action (no bundling), layered on the existing
  role security.
- **Route Master:** name, primary assignee, status, description, territories referenced, customers,
  sequence, schedule/planner, audit history.
- **Customer import:** "Import All" (default) or "Select Customers", drawing only from customers
  the route's primary assignee is actually entitled to (territory-scoped) and not already on another route.
- **Sequencing:** drag-and-drop ordering of customers within a route (web **and** mobile).
- **Schedule (V1 = weekly Planner):** person × weekday → route grid, with per-assignment
  start/end/active/pause fields. Database built to hold richer repeat patterns later.
- **Route Planner:** weekly grid with assign / copy / move / reassign.
- **Approval workflow:** configurable none / manager / admin, resolved through Reporting
  Hierarchy.
- **Execution (mobile, offline-first):** start today's route, visit / skip / complete each stop,
  track planned vs. actual order, skipped, completed, time, and location — each completed stop
  **creates a `site_visit`**.
- **Audit trail:** every structural and lifecycle action logged to `module_activities`.
- **Mobile authoring parity:** permitted mobile users can create/edit/import/reorder and use the
  Planner, offline-first.

### Out of scope (V1) — do not build
- Google Maps optimization, AI route optimization, traffic prediction, ETA, distance matrix,
  heat maps.
- Route sharing between accounts, geofence-based route creation.
- **Multi-route customer assignment** — a customer belongs to at most one route (DB-enforced).
- **Multiple-schedule UI** — the schedule table supports it, but V1 UI exposes only the weekly
  Planner.
- **Structural version snapshots** — audit log only in V1.
- Automatic route generation from territories (routes are built by hand in V1).

---

## 3. User Roles & Permissions

### Two-layer model (do not conflate — see handbook "Permission & Security System")
- **System role (`profiles.account_role`)** is the hard RLS security layer. It decides whether a
  write is *allowed at all* at the Postgres level.
- **Granular permission keys (`employee_roles.permissions` JSONB)** are the soft access layer.
  They decide *which actions a role is offered*. Owner/Admin/superadmin bypass all keys via the
  existing `has_permission()` (SQL) / `hasPermission()` (client) mirror.

**Reconciliation note (deliberate design decision, flag if you disagree):** The founder's plan
listed "who can create/edit" partly under *Settings* (Phase 1) and partly under *Permissions*
(Phase 2). To avoid two sources of truth, **who-can-do-what is owned entirely by the granular
permission keys below**, and `route_settings` holds only *behavior* configuration (skip rules,
sequence rules, thresholds, approval mode). This matches how Orders/Tasks already work
(`add_orders`, `edit_orders`, …). The Settings screen therefore shows *behavior* switches, and
*access* is assigned in the Roles editor.

### Permission keys (flat, in the Roles editor — mirror `add_orders` style)

| Group | Key | Grants |
|---|---|---|
| Route | `view_routes` | See routes list/detail |
| | `add_routes` | Create a route |
| | `edit_routes` | Edit route header/customers (see "own vs any" below) |
| | `delete_routes` | Delete/archive a route |
| | `clone_routes` | Clone a route |
| | `assign_routes` | Assign routes in the Planner |
| | `approve_routes` | Approve **and** reject routes |
| | `archive_routes` | Archive/restore a route |
| Customers | `add_route_customers` | Add/import customers to a route |
| | `remove_route_customers` | Remove customers from a route |
| | `reorder_route_customers` | Drag-and-drop sequence a route |
| Schedule | `manage_route_schedule` | Create/edit/pause/resume schedule + Planner assignment |
| Execution | `execute_route` | Start a route, complete a stop |
| | `skip_route_stop` | Skip a stop (subject to `skip_allowed` setting) |
| | `modify_route_sequence` | Visit out of planned order (subject to `out_of_sequence_allowed`) |

**"Own vs. any" scope:** `edit_routes` alone lets a user edit **their own** routes (created_by =
them, or primary assignee = them). Editing/approving **other people's** routes additionally requires the
Admin system role (owner/admin bypass). This is enforced **inside the RPCs** (checking
`created_by`/`primary_assignee_id` against the caller), because the role-level RLS layer cannot express
"own" — see the handbook's note that UI/row scoping must live in SQL, not just the query.

**`manage_route_schedule` is deliberately a single permission** (founder decision, 2026-08-02):
scheduling — create / edit / pause / resume + Planner assignment — is one business capability;
splitting it into action-level keys would only complicate role administration.

**Manager visibility (V1):** Owner/Admin see all routes; a Manager sees only routes they created or
own (`created_by` / `primary_assignee_id`). Team-scoped visibility (a manager seeing their downline's routes via
`get_all_reports`) is **deferred to a future version** — the primitives exist but are not wired in V1.

### Role summary

| Role | Can see | Can do |
|---|---|---|
| **Owner / Admin** | All routes, all executions in the account | Everything; bypasses all permission keys; approves; assigns; the only role that can edit/approve *others'* routes |
| **Manager** (agent + granted keys) | Routes they own/created + (if wired) their downline via `get_all_reports` | Build/assign routes for their team where keys granted; approve if `approve_routes` granted and route belongs to their downline |
| **Salesman** (agent + granted keys) | Own routes; today's assigned route to execute | Create/edit **own** route + reorder/import where keys granted; run today's route; skip/out-of-sequence per settings |
| **Viewer** | Read-only where `view_routes` granted | Nothing mutating |

**Tenant/RLS implications:** every new table carries `account_id` with RLS via
`is_account_member(account_id[, 'admin'])`. Execution tables (field-owned) additionally scope
rows to the acting field user. Realtime is not required for V1 (no live-map dependency).

---

## 4. Data Model

> **Two id spaces exist in this codebase — get this right (handbook-verified):**
> - `auth.uid()` (= `auth.users.id`) is what `site_visits.user_id`, `tracking_sessions.user_id`,
>   `contacts.user_id`, `module_activities.user_id` store.
> - `profiles.id` is a *different* id, used by `employee_area_assignments.employee_id`,
>   `profiles.manager_id`, `expenses.employee_id`.
> **Convention for this feature:** *field-owned execution* columns use `user_id = auth.uid()`
> (mirroring `site_visits`). *Admin-config* columns that name an employee (route primary assignee, planner
> assignee) use `profiles.id` (mirroring `employee_area_assignments`). Each column below states
> which. Do not mix them — the Territory RLS bug came from exactly this confusion.

Migrations are sequential SQL files. Web is at **107** (area/owner visibility); **verify the next
free number against `wacrm-web/supabase/migrations/` before writing** — likely `108`+. Use
`IF NOT EXISTS`, attach `set_updated_at`/`update_updated_at_column()` triggers, never drop columns
with live data.

### 4.1 `routes` (migration ~108)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()`, client-generatable (offline) |
| `account_id` | uuid NOT NULL | FK `accounts` |
| `name` | text NOT NULL | Duplicate names are a **warning, not blocked** — no unique constraint |
| `description` | text NULL | |
| `primary_assignee_id` | uuid NULL | **`profiles.id`** — the primary assigned salesman (renamed from `owner_id` per CTO final review 2026-08-02: "owner" misleads once routes are shared/templated/reassigned) |
| `status` | text NOT NULL | `default 'draft'`; CHECK in (`draft`,`pending_approval`,`active`,`rejected`,`archived`) |
| `created_by` | uuid NOT NULL | **`auth.uid()`** of the creator (for "own" checks) |
| `archived_at` | timestamptz NULL | Soft archive |
| `created_at` / `updated_at` | timestamptz | `set_updated_at` trigger |

RLS: `select` = `is_account_member(account_id)`; `insert/update/delete` =
`is_account_member(account_id,'agent')` (so salesmen can author) — granular access + own/any
enforced in the RPCs.

### 4.2 `route_customers` (migration ~108)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL | |
| `route_id` | uuid NOT NULL | FK `routes` ON DELETE CASCADE |
| `contact_id` | uuid NOT NULL | FK `contacts` ON DELETE CASCADE (customer) |
| `sequence` | integer NOT NULL | 1-based order within the route |
| `created_at` / `updated_at` | timestamptz | |

Constraints:
- `UNIQUE (route_id, contact_id)` — no duplicate customer within a route.
- **`UNIQUE (account_id, contact_id)`** — enforces "one customer, at most one route" (the
  no-multi-route rule) at the DB, not just UI. (Naturally consistent: area-wise territory
  assignment already gives one customer one salesman.)
- **No unique constraint on `sequence`** — reordering rewrites all sequences inside one
  transactional RPC; a unique index would deadlock/fail mid-swap.

RLS: tenancy (`is_account_member(account_id)` for select; `'agent'` for writes).

### 4.3 `route_plan_assignments` — the weekly Planner (V1 live schedule) (migration ~109)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL | |
| `route_id` | uuid NOT NULL | FK `routes` ON DELETE CASCADE |
| `assignee_id` | uuid NOT NULL | **`profiles.id`** — the salesman (mirrors `employee_area_assignments.employee_id`) |
| `day_of_week` | smallint NOT NULL | **ISO 1=Mon … 7=Sun** |
| `start_date` | date NULL | Phase-5 "Start Date" |
| `end_date` | date NULL | Phase-5 "End Date" |
| `is_active` | boolean NOT NULL default true | Phase-5 "Active" |
| `paused_at` | timestamptz NULL | Phase-5 "Pause" |
| `created_at` / `updated_at` | timestamptz | |

Constraint: **partial** unique index
`UNIQUE (account_id, assignee_id, day_of_week) WHERE end_date IS NULL AND is_active` — one
*permanent* (open-ended, active) route per salesman per weekday (an off day = no row). In V1 every
assignment is open-ended (`end_date IS NULL`), so this behaves identically to a plain unique
constraint. **The predicate is deliberate future-proofing** (Architecture Review item 4): it lets a
future *temporary reassignment* add a date-bounded row for the same `(assignee, day_of_week)` slot
without a risky live-constraint migration. Only `status='active'` routes may be assigned (enforced in
RPC).

RLS: select = `is_account_member(account_id)`; writes = `is_account_member(account_id,'agent')`
+ `manage_route_schedule`/`assign_routes` in RPC.

### 4.4 `route_schedules` — richer patterns, DORMANT in V1 UI (migration ~109)
Created to satisfy "future-proof the database for multiple schedules per route." **No V1 UI reads
or writes this.** Columns: `id`, `account_id`, `route_id` (FK CASCADE), `repeat_pattern`
(`weekly`|`every_x_days`|`monthly`|`custom`), `days_of_week` int[] NULL, `interval_days` int NULL,
`day_of_month` int NULL, `start_date` date NULL, `end_date` date NULL, `is_active` bool default
true, `paused_at` timestamptz NULL, timestamps. RLS = tenancy. Document it as dormant so a future
session doesn't think it's wired.

### 4.5 `route_executions` — a salesman running a route on a day (migration ~110)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Client-generatable (offline) |
| `account_id` | uuid NOT NULL | |
| `route_id` | uuid NOT NULL | FK `routes` |
| `user_id` | uuid NOT NULL | **`auth.uid()`** — who ran it (mirrors `site_visits`) |
| `execution_date` | date NOT NULL | |
| `status` | text NOT NULL | `default 'in_progress'`; CHECK in (`in_progress`,`completed`,`abandoned`) |
| `started_at` | timestamptz NULL | |
| `completed_at` | timestamptz NULL | |
| `tracking_session_id` | uuid NULL | FK `tracking_sessions` — ties the round to the punch session |
| `created_at` / `updated_at` | timestamptz | |

Constraint: `UNIQUE (route_id, user_id, execution_date)`.
RLS: `select`/`insert`/`update` = `is_account_member(account_id) AND (user_id = auth.uid() OR is_account_member(account_id,'admin'))`.

### 4.6 `route_execution_stops` — one per customer in an execution (migration ~110)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Client-generatable |
| `account_id` | uuid NOT NULL | |
| `execution_id` | uuid NOT NULL | FK `route_executions` ON DELETE CASCADE |
| `contact_id` | uuid NOT NULL | FK `contacts` |
| `planned_sequence` | integer **NULL** | Snapshotted from `route_customers` at start. **NULL = an unplanned stop** added mid-round via the "Add Customer during execution" action (Architecture Review item 5 / C1) |
| `actual_sequence` | integer NULL | Set when visited |
| `status` | text NOT NULL | `default 'pending'`; CHECK in (`pending`,`completed`,`skipped`) |
| `skip_reason` | text NULL | Required when `skipped` and setting says so |
| `site_visit_id` | uuid NULL | FK `site_visits` — the reused visit created on complete |
| `visited_at` | timestamptz NULL | |
| `created_at` / `updated_at` | timestamptz | |

**Unplanned stops:** a salesman with the right permission may add a customer not on the planned route
during execution; that stop is inserted with `planned_sequence = NULL` and an `actual_sequence`
reflecting when it was visited, so "plan vs. actual" correctly shows it as unplanned.

RLS: same field-owned scope as `route_executions` (via join or duplicated `user_id`; prefer a
policy that checks the parent execution's ownership).

### 4.7 `site_visits` — add route attribution (minimal ALTER, migration ~110)
Add `route_execution_id` uuid NULL (FK `route_executions`, ON DELETE SET NULL) so a visit is
attributable to a route in the existing **Customer Visits** screen. No other change to
`site_visits`. Execution stops create a normal customer visit (`target_type='Customer'`,
`contact_id` set — remember the dual-write handbook note) plus this back-link.

### 4.8 Audit — reuse `module_activities` (no new table)
Log with `module_name='route'`, `record_id=<route_id>`, snake_case actions: `route_created`,
`route_edited`, `customer_added`, `customer_removed`, `customers_reordered`, `schedule_changed`,
`route_assigned`, `route_submitted`, `route_approved`, `route_rejected`, `route_archived`,
`route_cloned`, plus execution actions (`route_started`, `stop_completed`, `stop_skipped`,
`route_completed`) keyed to the execution/route.
⚠️ **GOTCHA:** `module_activities.user_id` FKs `auth.users`, **not** `profiles`. Never embed
`profiles` via that FK (returns zero rows, silently blanks the timeline). Fetch activities
plainly, then enrich with a separate `profiles` query — copy the lead/order detail pages.

**Standardized `details` jsonb per action** (Architecture Review item 6 / C7 — audit-over-versioning
is only sufficient if the payload can reconstruct intent):
- `customer_added` → `{ contact_id, name, count }` (count for bulk/import)
- `customer_removed` → `{ contact_id, name }`
- `customers_reordered` → `{ order: [contact_id, …] }`
- `schedule_changed` / `route_assigned` → `{ assignee_id, day_of_week, start_date, end_date, is_active }`
- status changes (`route_submitted`/`approved`/`rejected`/`archived`) → `{ from, to, reason }`
- execution (`route_started`/`stop_completed`/`stop_skipped`/`route_completed`) → `{ execution_id, contact_id?, skip_reason?, actual_sequence? }`

### 4.9 Config storage (no new tables)
- **Module toggle:** add `route` to `accounts.module_settings`, **default `false`** (mirror
  `reporting_hierarchy`: normalizers in `use-auth.tsx` and `/api/account/module-settings` must
  special-case it to `false` when the key is absent; backfill existing accounts in the migration).
- **Behavior config:** `accounts.settings.route_settings` (jsonb), e.g.:
```json
{
  "execution": { "skip_allowed": true, "skip_reason_mandatory": true, "out_of_sequence_allowed": true },
  "capacity": { "max_customers": 50, "enforcement": "warn" },
  "validation": { "warn_duplicate_name": true, "warn_schedule_conflict": true },
  "approval_mode": "none"
}
```
`approval_mode` ∈ `none` | `manager` | `admin`.
`capacity.enforcement` ∈ `warn` (default — non-blocking banner) | `block` (hard cap: reject adds past
`max_customers`). Default `warn`/50 keeps V1 behavior identical while letting an enterprise with fixed
vehicle/route capacity opt into a hard cap (Architecture Review item 3 / C4). Per-role / per-route
capacity overrides are a future additive key — nothing is hardcoded.

### 4.10 Indexes (name these explicitly in the migrations)
- `route_customers (route_id)` plus the customer-uniqueness index (doubles as an `(account_id, contact_id)` lookup)
- `route_plan_assignments (account_id, assignee_id, day_of_week)` (the partial unique index above)
- `route_executions (account_id, user_id, execution_date)`
- `route_execution_stops (execution_id, status)`
- `site_visits (route_execution_id)` (new column — index the Customer Visits attribution join)

`route_execution_stops` is the highest-volume table (≈ reps × stops/day × days). At V1 volume these
indexes suffice; date-partitioning is a documented future option (§12 Architecture Notes), not V1 work.

---

## 5. API Contract

All mutating RPCs: **SECURITY INVOKER** (run as the caller, tenancy applies), **WHERE-qualified**
on every UPDATE/DELETE (the `pg_safeupdate` landmine — an unqualified write passes SQL tests but
400s over REST; use `WHERE true` where needed), **idempotent** via caller-supplied client ids
(existence check *before* insert, never `ON CONFLICT` on a sequence-bearing row), and they **log**
to `module_activities`. Multi-table operations are RPCs so mobile can call them through
`enqueueRpc` (the proven `create_order` offline path).

**Error codes (reuse existing conventions):** `42501` permission (`has_permission` fails),
`23514` check_violation (illegal status transition / bad enum), `23505` unique_violation
(customer already on a route — catch and return a friendly "already in route X"). Never leak raw
DB errors to the client (handbook rule).

### 5.1 `route_upsert`
- **Args:** `p_route_id uuid`, `p_name text`, `p_description text`, `p_primary_assignee_id uuid` (profiles.id,
  nullable), `p_customer_ids uuid[]` (nullable — `NULL` = leave customers unchanged; an array =
  set the exact customer set, sequence = array order).
- **Returns:** `jsonb` route row (incl. resolved status).
- **Behavior:** creates if `p_route_id` absent (status = `draft` unless `approval_mode='none'`
  then eligible to go `active` on submit), else edits. Edit of a route not created/owned by the
  caller requires Admin. Rejects a `p_customer_ids` entry already on another route (`23505` →
  friendly). Logs `route_created`/`route_edited` (+ `customer_added`/`customers_reordered`).
- **Errors:** `42501` (no `add_routes`/`edit_routes`), `23505` (cross-route customer), `23514`.

### 5.2 `route_import_customers`
- **Args:** `p_route_id uuid`, `p_mode text` (`all` default | `select`), `p_contact_ids uuid[]`
  (used when `select`).
- **Behavior:** `all` imports every contact the route **primary assignee** is entitled to
  (territory-scoped via `employee_area_territory_ids(primary assignee's auth user)`) that is **not already on
  a route**, appended after the current max sequence. `select` imports the given ids (same
  eligibility + not-already-routed checks). Logs `customer_added` (count in details).
- **Returns:** `jsonb` `{ added: int, skipped_already_routed: int }`.
- **Errors:** `42501` (`add_route_customers`).

### 5.3 `route_add_customers` / `route_remove_customer`
- Add: `p_route_id`, `p_contact_ids uuid[]` → append; reject cross-route dupes. Perm
  `add_route_customers`.
- Remove: `p_route_id`, `p_contact_id` → delete row, resequence remaining. Perm
  `remove_route_customers`.

### 5.4 `route_reorder_customers`
- **Args:** `p_route_id uuid`, `p_ordered_contact_ids uuid[]` (the full new order).
- **Behavior:** rewrites `sequence` for all rows in one transaction (WHERE-qualified). Perm
  `reorder_route_customers`. Logs `customers_reordered`.

### 5.5 `route_update_status` (mirror `update_order_status`)
- **Args:** `p_route_id uuid`, `p_new_status text`, `p_reason text` (nullable).
- **State machine:** `draft → pending_approval | active(*)` ; `pending_approval → active |
  rejected` ; `active → archived` ; `rejected → draft` ; `archived → active(restore)`.
  `(*)` `draft → active` directly is allowed only when `approval_mode='none'`.
- **Permissions:** submit (`draft→pending_approval`) needs `edit_routes` on own route;
  approve/reject need `approve_routes` (and, for others' routes, Admin or the route in the
  approver's downline). Validates transition (`23514`), logs
  `route_submitted`/`route_approved`/`route_rejected`/`route_archived`.
- **Approver resolution** (when `approval_mode='manager'`): `get_approver(<creator profile id>)`
  from Reporting Hierarchy (default_approver → first active manager → null). If null → falls back
  to Admin approval and surfaces that in the UI.

**Archive semantics (architecture rule — CTO final review 2026-08-02).** Archiving is a soft state
(`status='archived'`, `archived_at` set), never a delete. A route in `archived` status:
- is **hidden from the Routes list by default** (a "Show archived" filter reveals it);
- **cannot be assigned in the Planner** (`route_planner_set` rejects a non-`active` route);
- **cannot start execution** (`route_execution_start` rejects a non-`active` route);
- **cannot be edited** (`route_upsert` / customer add/remove/reorder RPCs reject an archived route);
- keeps its **historical executions fully visible** (`route_executions`/`route_execution_stops` and
  the linked `site_visits` are untouched);
- keeps its **full audit history** (`module_activities` retained);
- **can be restored** via `route_update_status(..., 'active')` (perm `archive_routes`), which logs
  the restore.
Hard delete (`delete_routes`) remains available **only for a route with no executions** (mirrors
`territory_delete`); anything with execution history is archived, not deleted.

### 5.6 `route_clone`
- **Args:** `p_route_id`, `p_new_name`. Copies header + customers (new ids, status `draft`,
  cleared primary assignee unless specified). Perm `clone_routes`. Logs `route_cloned`.

### 5.7 `route_planner_set`
- **Args:** `p_route_id`, `p_assignee_id` (profiles.id), `p_day_of_week smallint`,
  `p_is_active bool`, `p_start_date date` (nullable), `p_end_date date` (nullable).
- **Behavior:** upsert on `(account_id, assignee_id, day_of_week)`. Only `active` routes.
  Perm `assign_routes`/`manage_route_schedule`. Logs `route_assigned`/`schedule_changed`.
  A `NULL`/inactive call clears the slot (the "Off" day).
- **Copy/Move** (planner UX) are thin wrappers: copy = `route_planner_set` on the target
  slot; move = set target then clear source, in one call `route_planner_move(p_from…, p_to…)`.

### 5.8 Execution RPCs
- **`route_execution_start`** — `p_execution_id uuid`, `p_route_id uuid`, `p_execution_date date`,
  `p_tracking_session_id uuid` (nullable), **`p_stops jsonb[]`** (client-provided:
  `{ stop_id, contact_id, planned_sequence }` captured from the device's **cached** route at start).
  Idempotent on `p_execution_id` (and per `stop_id`). Creates the execution and upserts the
  client-provided stops verbatim; the server **does NOT re-derive** the stop list from current
  `route_customers`. **The on-device plan is authoritative for that day's execution** — consistent
  with quoted-price-wins — so a route edited after the salesman went offline cannot silently change
  the round they actually worked (Architecture Review item 5 / C2). Perm `execute_route`. Logs
  `route_started`.
- **`route_stop_complete`** — `p_stop_id uuid`, `p_site_visit_id uuid` (client-generated),
  `p_visit jsonb` (check-in coords, `visit_photo_url`, `feedback_type`, `feedback_text`, notes),
  `p_actual_sequence int`. Inserts a `site_visits` row (`target_type='Customer'`, `contact_id`,
  `route_execution_id`, dual-write `contact_id`) **and** updates the stop
  (`status='completed'`, `site_visit_id`, `visited_at`, `actual_sequence`) in one transaction.
  Idempotent on `p_site_visit_id`/`p_stop_id`. Perm `execute_route`. Logs `stop_completed`.
- **`route_stop_skip`** — `p_stop_id uuid`, `p_reason text`, `p_actual_sequence int`. Sets
  `status='skipped'`; rejects if `skip_allowed=false` (`42501`/`23514`) or if
  `skip_reason_mandatory=true` and reason blank. Perm `skip_route_stop`. Logs `stop_skipped`.
- **`route_execution_complete`** — `p_execution_id uuid`. Sets `completed_at`,
  `status='completed'`. Perm `execute_route`. Logs `route_completed`.
- **Out-of-sequence:** when `out_of_sequence_allowed=false`, the RPCs reject completing/skipping a
  stop whose `planned_sequence` is not the lowest still-`pending` one (needs `modify_route_sequence`
  to override). When `true`, any order is accepted and `actual_sequence` records what really
  happened.

### 5.9 Route resolution — `get_route_for(p_assignee_id uuid, p_date date)`
**Centralize "which route runs today" in this one function** (Architecture Review item 2). In V1 its
body is a trivial lookup: `route_plan_assignments` where `assignee_id = p_assignee_id AND day_of_week
= ISO-weekday(p_date) AND is_active` (and, if set, `p_date` within `start_date`/`end_date`), returning
the `route` + `route_customers`. It is intentionally the **single insertion point** for future
Business Calendar / Weekly Off / Public Holiday / Leave suppression and for temporary-reassignment
date precedence — none built in V1, but all plug in here without touching the planner or execution.
Web execution, mobile execution, and the planner's "today" preview must all resolve through this
function, not ad-hoc queries.

### 5.10 Other reads (direct Supabase, RLS-scoped — no RPC needed)
Routes list/detail, the planner grid, and execution history are plain `select`s. Follow the "no
`?account_id` in URL / always filter by account" rules.

### 5.11 Route Health — `route_health(p_route_id uuid)` (CTO final review 2026-08-02)
A **read-only, non-blocking validation engine** (not a feature gate). Returns
`{ score: int, checks: [{ code, severity: 'warning', ok: bool, detail? }] }`. `score` = percentage
of checks that pass (`round(100 * passed / total)`), so a clean route shows **100%**. **Nothing here
ever blocks a save, assignment, or execution** — it is admin-facing guidance only. The V1 check set:

| Code | Warns when |
|---|---|
| `no_customers` | the route has zero `route_customers` |
| `primary_assignee_missing` | `primary_assignee_id IS NULL` |
| `not_assigned` | the route has no `route_plan_assignments` row (never placed on the Planner) |
| `duplicate_name` | another non-archived route in the account shares the name (case-insensitive) |
| `capacity_exceeded` | customer count > `route_settings.capacity.max_customers` |
| `contains_archived_customer` | a referenced contact is inactive / soft-deleted / flagged `needs_territory_review` (implement against whatever inactive signal `contacts` actually exposes — confirm before coding) |
| `outside_territory` | a route customer whose `territory_id` is **not** within the primary assignee's assigned areas (`employee_area_territory_ids`) — i.e. the customer isn't really this salesman's per Territory |

Computed on demand (a SQL function or an assembled read); it is **not** stored state, so it never
needs syncing. Surfaced as a **Route Health panel** on the route detail (score + the list of active
warnings) and a compact health indicator column on the Routes list. The `capacity_exceeded`,
`duplicate_name`, and `outside_territory` checks reuse logic already described elsewhere in this
spec — do not duplicate it; share it.

---

## 6. Mobile Behavior

**Offline-first is mandatory** (handbook standing rule). Current verified state: `SyncEngine`
(`wacrm-mobile/src/core/SyncEngine/`) is functional and **generic across module names**;
`enqueueMutation` is **single-table**, and **`enqueueRpc`** handles multi-table/atomic operations
(built for Orders Phase 2, dead-letter + retry included). Do **not** assume WatermelonDB (mobile
has none) — local queue is AsyncStorage-backed.

- **Authoring (create/edit/import/reorder/planner) — multi-table → use `enqueueRpc`:**
  - Create/edit route → `enqueueRpc('route_upsert', {...}, routeId)` with a client-generated
    `routeId` (idempotent). Reorder → `enqueueRpc('route_reorder_customers', …)`. Import →
    `enqueueRpc('route_import_customers', …)`. Planner assignment (single-table) may use
    `enqueueMutation('route_plan_assignments','CREATE'|'UPDATE', id, payload)` **or** the RPC —
    prefer the RPC for the "move" case (two rows).
  - Offline: queues optimistically, shows "saved locally, will sync". Online: runs once so the
    caller gets the real result. Permanent rejection (e.g. cross-route customer) → surface via
    `showAppDialog`, do **not** silently drop.
- **Execution — offline-first via `enqueueRpc`:**
  - Start → `route_execution_start` (client-generated `executionId`). Complete a stop →
    `route_stop_complete` with a client-generated `site_visit_id` + the visit payload (photo
    uploaded via SyncEngine's `uploads` support, same as the punch-out photo path). Skip →
    `route_stop_skip`. Complete route → `route_execution_complete`.
  - **Reference the correct offline pattern:** `app/visit/select-contact.tsx` (client
    `Crypto.randomUUID()` → enqueue with a proper `result.type` check). Do **not** copy Contacts
    create/edit (placeholder-UUID + `result.isSuccess` bugs) or the orphaned `VisitService.ts`.
  - **UUIDs:** `expo-crypto` `Crypto.randomUUID()` only. Do **not** use `src/utils/uuid.ts`
    (Math.random polyfill, a known violation).
- **"Pending Sync" indication:** authored routes and completed stops show a pending-sync state
  until flushed; the existing `SyncFailureBanner` covers dead-lettered RPCs.
- **Conflict resolution:** last-write-wins on `updated_at` for header/reorder edits (two editors
  are unlikely given one-salesman-one-area, but LWW is the house rule).
- **Battery/permissions:** execution ties into the existing punch/tracking Foreground Service; no
  new background service. A route stop uses the live location fix (same as visit check-in), not a
  new polling loop.
- **Empty string → uuid:** optional uuid fields (`primary_assignee_id`, `tracking_session_id`,
  `site_visit_id`) must be `null`, never `''` (the classic mobile bug).

---

## 7. UI States

**Web** (Next.js, Shadcn only, dark-mode-first, full-width `w-full` forms):
- **Module OFF:** no "Routes" sidebar entry, no route enforcement anywhere. Only Settings shows
  the toggle. (Guiding principle #1.)
- **Settings → Route** (`route-settings.tsx`, tile in `settings-overview.tsx`, registered in
  `settings-sections.ts`; module toggle card in `module-settings.tsx`): behavior switches +
  approval mode + thresholds. States: loading skeleton, saved toast, permission-denied (non-admin
  sees read-only via `gated-button`).
- **Routes list** (`/routes`, `<DataTable>`): columns name / primary assignee / status pill / #customers / health /
  updated. States: loading, **empty** ("No routes yet — create your first beat"), populated,
  filter-no-match, permission-denied (list hidden if no `view_routes`).
- **Route detail/editor** (`/routes/[id]`): house pattern — header card (name, primary assignee,
  status pill, **Route Health score badge**, Submit/Approve/Reject/Archive/Clone buttons gated by
  keys) + left tabs **Customers / Schedule / Health / (Timeline on the right)**. Customers tab:
  drag-and-drop list, Add / Import (All | Select) / Remove / search / filter. Health tab/panel: the
  `route_health` score + the list of active warnings (all non-blocking). States: loading,
  empty-customers ("Import customers to start"), capacity-exceeded **warning banner** (non-blocking;
  hard block only if `capacity.enforcement='block'`), duplicate-name **warning** (non-blocking),
  archived route (read-only with a "Restore" action), reorder in-progress (optimistic), save error
  toast.
- **Route create** (`/routes/new`): header form → import step.
- **Planner** (`/routes/planner`): weekly grid, salesman rows × Mon–Sun columns, drag-and-drop
  assign, copy/move, "Off" empty cells. States: loading, empty (no active routes → prompt to
  create/activate), assign conflict warning, permission-denied.
- **Approval:** pending routes surface an Approve/Reject action for users with `approve_routes`;
  a "Suggested approver" line (like the expense page) when `approval_mode='manager'`. When
  `approval_mode='manager'` but `get_approver` returns null (no manager set), the UI shows an explicit
  **"No approver configured — needs an admin"** state and never silently dumps the route onto admins
  (Architecture Review C6).

**Mobile** (React Native `StyleSheet`, `SafeAreaView` + `KeyboardAvoidingView`, 48px targets):
- **Authoring** (permitted users): routes list, create/edit with **mobile-friendly drag-and-drop**
  sequencing, import (All | Select), and a **mobile-friendly Planner** (per-salesman day list, not
  a cramped desktop grid). Every mutation offline-first with pending-sync state.
- **Today's Route (execution):** resolves via `get_route_for(me, today)` (not an ad-hoc query).
  States: **no route today** ("No route planned for today" empty state — never an error), route
  loaded (Start Route CTA), in-progress stop list (Visit / Skip / Complete; out-of-sequence blocked
  or allowed per setting; **Add Customer** — an unplanned, permission-gated stop — appends a
  `planned_sequence = NULL` row), offline (all actions queue with "saved locally"), completed summary
  (planned vs actual, unplanned + skipped counts).
- **Permission-denied:** authoring entry points hidden via `PermissionWrapper` / `hasPermission`
  (owner/admin bypass). Menu visibility gap (handbook-known) noted — gate the *actions*, not just
  the menu.

---

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behavior | Severity |
|---|---|---|
| Module OFF | Zero route UI/enforcement; free-visit mode unchanged; existing route rows preserved | Blocker |
| Salesman has no route assigned today | "No route planned for today" empty state on mobile — not an error | Info |
| Add a customer already on another route | Reject with friendly "already in route <name>" (`23505`); import silently skips + reports count | Warning |
| Customer count > `capacity.max_customers`, `enforcement='warn'` | Non-blocking warning banner; save allowed | Info |
| Customer count > `capacity.max_customers`, `enforcement='block'` | Add rejected with a clear message; existing customers untouched | Warning |
| Salesman adds an unplanned customer mid-execution | Stop inserted with `planned_sequence=NULL`; shows as unplanned in plan-vs-actual | Info |
| Duplicate route name | Non-blocking warning; save allowed (no unique constraint) | Info |
| Contact deleted / territory reassigned away | `route_customers` CASCADE-removes; completed `site_visits` retained (history) | Warning |
| Offline create then edit before sync | Idempotent via client `routeId`; single server row after flush | Blocker |
| Two edits race (reorder vs header) | LWW on `updated_at` | Info |
| Skip when `skip_allowed=false` | RPC rejects (`42501`); UI hides Skip | Warning |
| Skip with blank reason when reason mandatory | RPC rejects; UI requires reason before enabling Skip | Warning |
| Complete out of order when `out_of_sequence_allowed=false` | RPC rejects unless caller has `modify_route_sequence`; UI enforces order | Warning |
| Approve without `approve_routes` | `42501`; button hidden | Blocker |
| `approval_mode='manager'` but `get_approver` returns null | Fall back to Admin approval; UI states "no manager set — needs admin" | Warning |
| Delete a route that has executions | Soft-archive instead of hard delete (preserve history); hard delete only if no executions (mirror `territory_delete`) | Warning |
| Customer has NULL `hierarchy_level` | Routes only **read** contacts → does not trip the hierarchy trigger; safe | Info |
| Non-`active` route assigned in planner | Rejected — only `active` routes are assignable/executable | Warning |
| Two salesmen, same customer | Prevented upstream by area-wise territory exclusivity + `UNIQUE(account_id, contact_id)` | Blocker |

---

## 9. Reuse Check

**Antigravity must search for and reuse these before writing new code:**
- **Config pattern:** `accounts.module_settings` + `accounts.settings` jsonb; how `territory` /
  `reporting_hierarchy` / `order_settings` are added (`module-settings.tsx`,
  `/api/account/module-settings` `CONFIGURABLE_MODULES`, `use-auth.tsx` normalizers — note the
  default-OFF special-case used by `reporting_hierarchy`).
- **Permission plumbing:** `has_permission()` (SQL) / `hasPermission()` (client),
  `team/roles/page.tsx` roles editor (flat keys like `add_orders`), `gated-button.tsx` (web),
  `PermissionWrapper.tsx` + `canCreate` (mobile).
- **State-machine + status RPC reference:** `update_order_status` (migration 086) — copy its
  permission check + transition validation + logging shape for `route_update_status`.
- **Offline multi-table reference:** `create_order`/`update_order` RPCs + `SyncEngine.enqueueRpc`
  (idempotent client-id pattern) — the template for all route authoring/execution RPCs.
- **Execution reuse:** `site_visits`, `tracking_sessions`, `geofences`; the correct offline visit
  pattern in `app/visit/select-contact.tsx`; the polymorphic + `contact_id` dual-write rules; the
  web Customer Visits page `location-tracking/visits/page.tsx`.
- **Territory scoping:** `employee_area_territory_ids(user_id)`, `territories`,
  `employee_area_assignments`, `contacts.territory_id` — for import eligibility.
- **Reporting:** `get_approver()` (+ `get_reporting_chain`/`get_all_reports` if wiring downline
  visibility), `lib/reporting/api.ts`.
- **Audit:** `module_activities` (+ the `auth.users`-not-`profiles` embed gotcha and the
  separate-profiles-enrichment fix).
- **Web UI:** `<DataTable>` family, `<Timeline>`, house detail layout (lead/order detail),
  `sidebar.tsx` RBAC `module` key, `formatCurrency`/`settings-sections.ts`.
- **Mobile UI:** `SyncEngine`, `EntityList`/`EntityRenderer`, `Select`/`ColorPill`/`ProductPicker`
  style pickers, `showAppDialog`/`showToast`, `Crypto.randomUUID()`.

**Do not:** build a parallel visit system; duplicate territory or approver logic; introduce a
DDD/repository layer for this (web live pages call Supabase directly — follow that); wire the
web DDD dead-code layers; generate order/route numbers client-side; write to `orders.status`-style
fields directly instead of via the status RPC.

---

## 10. Open Questions

**None — all resolved.** Founder decisions recorded 2026-08-02 (Architecture Review approval):

1. **Drag-and-drop library — DECIDED.** Web: **`@dnd-kit`**. Mobile:
   **`react-native-draggable-flatlist`**. Antigravity adds these as new dependencies (`npx expo
   install` on mobile to keep SDK 57 compatibility; standard install on web) — this is the one
   pre-approved new dependency; no further STOP AND ASK is needed for it.
2. **Manager team-scoped visibility — DECIDED: not in V1.** Owner/Admin see all routes; a Manager
   sees only routes they created or own. Team scope is deferred to a future version, to be built on
   the existing Reporting Hierarchy (`get_all_reports`).
3. **Sidebar placement — DECIDED: a new top-level "Routes" group** (not under Location Tracking —
   different business domain). It carries the routes list and the Planner; the sidebar item uses the
   RBAC `route` module key.
4. **`manage_route_schedule` — DECIDED: single permission**, not split. Scheduling is one business
   capability.

---

## 11. Acceptance Criteria

**Functional**
- [ ] Module toggle defaults OFF; with it OFF, no route UI appears and free-visit mode is
      byte-for-byte unchanged (verified: punch/visit/expense flows work with module off).
- [ ] A route can be created, have customers imported (All defaults to the primary assignee's territory-scoped,
      not-already-routed contacts), reordered by drag-and-drop, and saved — on **both** web and
      mobile for a permitted user.
- [ ] A customer cannot be added to two routes (verified: second add returns the friendly
      already-routed message; DB `UNIQUE(account_id, contact_id)` present).
- [ ] Planner assigns *salesman × weekday → route*; "today's route" on mobile resolves from it.
- [ ] Approval respects `approval_mode`: `none` → create goes active; `manager` → routed to
      `get_approver`; `admin` → any admin; illegal transitions rejected.
- [ ] Execution: start snapshots stops; complete creates a linked `site_visit`; skip records
      reason (when mandatory); planned-vs-actual + skipped/completed are queryable; an unplanned
      mid-round customer records a `planned_sequence=NULL` stop.
- [ ] Archive behavior matches the §5.5 rule (hidden by default, not assignable/executable/editable,
      history + audit retained, restorable) — verified for each of those points.
- [ ] `route_health` returns a score + non-blocking warnings for each defined check; a clean route
      scores 100%; no health warning ever blocks a save, assignment, or execution.

**Code Quality**
- [ ] TypeScript strict, zero new errors (`npm run typecheck` web; `npx tsc --noEmit` mobile —
      paste real output). No `any` without a justifying comment.
- [ ] Shadcn only on web; `SafeAreaView`+`KeyboardAvoidingView` on mobile input screens.

**Architecture**
- [ ] Execution reuses `site_visits` (no parallel visit table). Config reuses
      `module_settings`/`settings` jsonb. Audit reuses `module_activities`. No new DDD/repository
      layer.
- [ ] Territory scoping reuses `employee_area_territory_ids`; approver reuses `get_approver`.

**Testing**
- [ ] Every mutating RPC tested through the **real REST endpoint** (curl/anon key → 200, not 400)
      to catch the `pg_safeupdate` unqualified-write landmine.
- [ ] State-machine transitions tested (legal pass, illegal → `23514`, unpermitted → `42501`).
- [ ] Core loop regression: WhatsApp→CRM→Field Tracking→Expense unaffected.

**Security**
- [ ] RLS enabled + explicit on every new table; cross-tenant `select` returns `[]`; a
      non-admin cannot edit/approve another user's route (verified via direct REST call, not just UI).
- [ ] All RPC inputs validated; no raw DB errors leaked to client.

**Performance**
- [ ] No N+1 (route + customers + contacts fetched via joins/relational select). Reorder is one
      transactional RPC, not per-row updates from the client.
- [ ] Import "All" paginates past the 1000-row cap if needed.

**Documentation**
- [ ] `CLAUDE Web.md` and `CLAUDE mobile.md` updated with the real shipped schema/RPCs/gotchas;
      `route_schedules` documented as dormant. Note migration numbers actually used.

**Production Readiness**
- [ ] Offline verified in Airplane Mode: create route, reorder, complete a stop offline → all sync
      correctly on reconnect with no duplicates (idempotent client ids). Photo upload survives
      offline.
- [ ] Migrations use `IF NOT EXISTS`, are sequentially numbered, applied and verified against prod;
      module backfilled OFF on existing accounts.

---

## 12. Architecture Notes (Future Compatibility — documentation only)

These describe the deliberate growth path. **None are built in V1.** They exist so future work stays
additive rather than a redesign.

- **Route Templates (F1).** `routes` already functions as a shared template: it holds the customer
  list once, and `route_plan_assignments` already allows the same `route_id` on many
  `(assignee, day_of_week)` rows, so assigning one route to multiple salesmen with independent weekly
  slots works today. `route_executions` is keyed `(route_id, user_id, execution_date)`, so several
  salesmen can even run the same route the same day. The only future addition — a salesman customizing
  an inherited list — is an **additive** `route_instance_overrides(route_id, assignee_id, …)` table
  that touches neither `routes` nor `route_customers`. The customer-uniqueness index is therefore kept
  a **named partial index** (`WHERE archived_at IS NULL`) so a future template/instance split can
  rescope it cleanly. **Add no speculative columns now.** Under the multi-salesman model, `primary_assignee_id`
  reads as "steward/creator"; a null primary assignee means the import scope must be chosen explicitly.
- **Business Calendar / Weekly Off / Public Holidays / Leave (F2).** All integrate at the single
  `get_route_for(assignee, date)` resolver (§5.9). Future additive tables (`business_calendars`,
  account-scoped with scope = company/territory/employee; `leave_requests` from the planned HRMS
  module) let the resolver, in order, read the planner assignment then suppress/shift it for a
  holiday, weekly-off, or approved leave — at which point "off day" (no planner row) and "on leave /
  holiday" become distinguishable. No change to routes, planner, or execution schema.
- **Temporary Route Reassignment (F3).** Enabled by the planner's partial unique index (§4.3) plus
  the already-present `start_date`/`end_date`/`is_active` fields; date precedence lives in
  `get_route_for`. No further schema change needed.
- **Multi-stage approval (F4).** The `route.status` state machine extends by adding statuses + an
  additive `route_approval_steps` table; `approval_mode` can grow from an enum to a chain. Route rows
  untouched.
- **Non-weekly schedules (F5).** Already modeled by the dormant `route_schedules` table.
- **Capacity by role/route (F6).** Additive `route_settings.capacity.overrides` key.
- **Execution scale (F7).** `route_execution_stops` can be date-partitioned and old executions
  archived; nothing in the V1 shape prevents it.

## 13. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip
steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything
1. Read `CLAUDE Web.md` (in `wacrm-web/`) and `CLAUDE mobile.md` (in `wacrm-mobile/`) in full —
   they are the current, verified source of truth for stack, schema, and gotchas.
2. Read this entire specification, including Open Questions.
3. Search the existing codebase before writing new code — specifically for the items in Section 9
   (Reuse Check): `module_settings`/`route_settings` config pattern, `has_permission`/
   `hasPermission`, `update_order_status` (state-machine reference), `create_order` +
   `SyncEngine.enqueueRpc` (offline multi-table reference), `site_visits` +
   `app/visit/select-contact.tsx` (execution reuse + correct offline UUID pattern),
   `employee_area_territory_ids` + `territories` (import eligibility), `get_approver` (approval),
   `module_activities` (audit + the `auth.users` embed gotcha), the web `<DataTable>`/`<Timeline>`
   families, and mobile `SyncEngine`/`PermissionWrapper`.
4. Confirm the actual naming conventions by inspecting real files (kebab-case component files
   exporting PascalCase; hooks `use*`; RPCs `snake_case`; migrations sequential numbered) — do not
   assume. **Verify the next free migration number** against `wacrm-web/supabase/migrations/`
   (expected `108`+).
5. **Do not assume offline support is automatic.** `SyncEngine` is generic across module names;
   `enqueueMutation` is single-table and **`enqueueRpc`** is for multi-table/atomic ops. All route
   authoring/execution here is multi-table → use `enqueueRpc` with client-generated ids following
   the `create_order` pattern. WatermelonDB does **not** exist on mobile. Use `Crypto.randomUUID()`
   only. Confirm this is still accurate against the live repo before coding — it has changed
   between audits.

### Step 2 — STOP AND ASK triggers
Do not guess or silently choose a default in any of these situations. Stop and ask a specific,
answerable question instead:
- **The drag-and-drop libraries are pre-approved** — `@dnd-kit` (web) and
  `react-native-draggable-flatlist` (mobile). Install them and proceed; no confirmation needed for
  these specifically. Any *other* new dependency is still a STOP AND ASK.
- Any other Open Question (Section 10) becomes relevant to the code you're about to write.
- You find existing code that conflicts with this spec (a route/beat table, service, or screen
  already exists with different behavior).
- The spec doesn't specify behavior for a case you hit (an error state, a permission edge, a data
  ambiguity).
- You would introduce any *other* library/dependency/pattern not already used in the repo.
- You would change a shared table/component/service (`site_visits`, `module_activities`,
  `module_settings`, the roles editor, the sidebar) in a way that could affect other features.

Example of a good question: "The spec says import 'All' pulls the primary assignee's territory-scoped
contacts — should a route with no `primary_assignee_id` set import nothing, or fall back to the creator's
territories?"

### Step 3 — Implementation rules
- TypeScript strict: zero errors, no `any` without a justifying comment.
- Reuse Before Create / Extend Before Replace — if you wrote new code where Section 9 says to
  reuse, undo it and reuse.
- Match this spec's data model and API contract exactly. To deviate is a STOP AND ASK.
- Multi-tenant RLS on every new table/query — never rely on app-level filtering alone; enforce
  "own vs. any" inside the RPCs.
- Every mutating RPC: SECURITY INVOKER, WHERE-qualified writes (`pg_safeupdate`), idempotent via
  client id, logs to `module_activities`, and **tested through the real REST endpoint** (expect
  200, not 400).
- Offline-first on mobile: every authoring/execution action must work in Airplane Mode and sync
  correctly, with a visible pending-sync state and no duplicates on retry.
- Module defaults OFF; with it off, the app behaves exactly as it does today.
- **Never optimize for V2 by making V1 harder to understand. If two implementations are equally
  extensible, always choose the simpler one.** (CTO standing rule — configurable and enterprise-grade,
  but extremely easy to use and read.)

### Step 4 — Self-verification before declaring done
Check the feature against every item in Section 11 (Acceptance Criteria), and confirm explicitly,
category by category (Functional, Code Quality, Architecture, Testing, Security, Performance,
Documentation, Production Readiness). For anything you could not verify (e.g. offline sync you
couldn't exercise), say so plainly — do **not** mark it done, and do **not** fabricate a test
report (handbook absolute rule).

### Step 5 — Report back
When finished, report:
1. What was implemented, mapped to this spec's sections, with the real migration numbers used.
2. Any deviations from the spec and why.
3. Any new conventions discovered or introduced (so they can be added to the handbook + CLAUDE
   files).
4. Any Acceptance Criteria items you could not fully verify and why.
