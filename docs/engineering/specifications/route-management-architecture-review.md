# Route Management Architecture Review

**Reviewer stance:** Enterprise SaaS Architect — challenge the design, do not blindly implement.
**Subject:** `route-management.md` (Feature Specification, Confirmed 2026-08-01)
**Date:** 2026-08-01
**Status:** Awaiting founder approval. **No code, migrations, or spec edits have been made.**
This document is the mandatory pre-implementation gate.

**How to read the recommendations:** each is tagged so approval is unambiguous:
- `[APPLY TO V1 SPEC]` — a change I recommend folding into the spec **before** coding. Does **not**
  add V1 features or change V1 behavior; it prevents a future redesign or fixes a latent defect.
- `[DOC ONLY]` — an Architecture Notes addition; no schema/behavior change.
- `[FUTURE]` — explicitly deferred; recorded so the growth path stays additive.

---

## 1. Approved Decisions

These I reviewed and endorse as-is. They are architecturally sound and correctly reuse the
platform.

| Decision | Why it holds |
|---|---|
| **Module toggle defaults OFF** (`module_settings.route`) | Matches `reporting_hierarchy` precedent; makes "route is optional" the literal default, not a code branch. |
| **Reusable-template route + person×weekday Planner** | Correct separation of *what to visit* (route) from *who/when* (planner). See §5.5 below — this is already, in effect, the "template" model you're asking to future-proof. |
| **Weekly Planner is the V1 schedule; `route_schedules` dormant** | Ships the 90% case without a calendar UI; keeps the richer-pattern table ready. Correct YAGNI discipline. |
| **Approval reuses Reporting Hierarchy (`get_approver`)** | No duplicated org chart. The `draft → pending_approval → active/rejected` state machine mirrors the proven `update_order_status`. |
| **Audit via `module_activities`** (no new table) | Reuses the generic feed that already powers every timeline. |
| **Execution reuses `site_visits`** (+ `route_execution_id` back-link) | No parallel visit system; inherits GPS/photo/feedback and the existing offline visit path. Single source of visit truth. |
| **Offline authoring & execution via `enqueueRpc` + client-generated ids** | The proven `create_order` idempotency pattern; multi-table safe. |
| **One customer, at most one route** — `UNIQUE(account_id, contact_id)` on `route_customers` | Enforced in the DB, not just UI; naturally consistent with area-wise territory exclusivity. |
| **Config in `accounts.settings.route_settings`; access in granular permission keys** | Single source of truth per concern; matches Orders/Tasks. |

---

## 2. Challenged Decisions

I pushed on every load-bearing choice. Eight are worth raising; three of these are, on reflection,
defects or future-blockers in the spec **as I wrote it** and I recommend correcting them before code.

**C1 — `route_execution_stops.planned_sequence` is `NOT NULL`, which blocks the Plan's own
"Add Customer during execution" feature.** The spec (§2, §7 mobile) says a salesman may add a
customer mid-round if allowed, but my data model (§4.6) can't represent an *unplanned* stop
(it has no planned position). This is an internal contradiction in the spec. **Self-challenge
upheld — must fix.**

**C2 — Execution snapshot is described as server-derived, which is wrong for offline.**
`route_execution_start` (§5.8) "snapshots one stop per current `route_customers`." Offline, the
server isn't reachable, and by the time the queued RPC flushes, the route may have changed. A
server-side re-snapshot would silently produce a *different* stop list than what the salesman
actually worked. This violates the "quoted-price-wins / client is authoritative offline"
philosophy the codebase already follows. **Self-challenge upheld — must fix.**

**C3 — Planner uniqueness `UNIQUE(account_id, assignee_id, day_of_week)` blocks future
Temporary Reassignment (your item 4).** A hard one-row-per-(assignee, day) rule cannot hold a
permanent assignment *and* a date-bounded temporary one for the same slot. Fixing this later means
altering a unique constraint on a live table with data — the exact kind of migration you want to
avoid. Cheap to prevent now. **Upheld — recommend a pre-emptive constraint change (see R4).**

**C4 — Route capacity is warn-only with a single global threshold.** Fine for an SMB; an
enterprise with fixed van capacity or SLA-bound beats will want a *hard* cap, and different caps by
role/route. Current design can't express "block at 40" or "40 for vans, 80 for walkers." Still must
stay configurable and un-hardcoded (your item 3). **Upheld — recommend a small restructure (R3).**

**C5 — `manage_route_schedule` bundles four permissions the Plan listed separately** (Schedule
Create / Edit / Pause / Resume). This is a deliberate deviation from your "no bundled permissions"
rule, made for UI sanity. **Flagging for your explicit call** — I can split it into four keys if you
want strict adherence; my recommendation is to keep it bundled (schedule pause/resume without edit
is not a meaningful separate grant), but this is your rule to relax, not mine.

**C6 — `approval_mode='manager'` with an unset manager silently falls back to Admin.** At one
account it's harmless; across an enterprise with many employees whose `manager_id` was never set,
*every* route lands on Admins with no signal. **Upheld — needs a visible "unresolved approver"
surface, not a silent fallback (R7).**

**C7 — The audit log records the action but not enough to reconstruct intent.**
`module_activities` gives actor + action + timestamp, but "customer_removed" without *which*
customer, or "customers_reordered" without old→new, is a weak audit for a module whose whole point
is accountability. You chose audit-over-versioning deliberately; that choice is only as good as the
`details` payload. **Upheld — standardize the `details` jsonb (R6).**

**C8 — `routes.owner_id` (single salesman) is semantically strained under the multi-salesman
template future.** When one template is run by five reps, "owner" is really "steward/creator," and
`import All = owner's territory` becomes ambiguous (whose territory?). Not a V1 problem (V1 routes
are single-owner), but worth naming so the meaning doesn't silently drift. **Upheld — documentation
+ a resolver decision (see §5, F1 and R2).**

---

## 3. Recommended Improvements

Mapped to your six items and the challenges above.

### Item 1 — Future-proof Route Template architecture → **No schema change needed; document the growth path.**
Finding: **V1's `routes` table already IS a template.** It holds the customer list *once*, and
`route_plan_assignments` already permits the same `route_id` on many `(assignee, day)` rows —
i.e., **assign one route to multiple salesmen with independent weekly slots is already supported
today** (there is no constraint tying a route to a single assignee). `route_executions` is keyed
`(route_id, user_id, execution_date)`, so multiple salesmen can even run the same route the same day.

The *only* thing a future "Template → Instance" split would add is **per-salesman customization of
an inherited list** (rep B drops two shops from the shared template). That is a purely **additive**
change — a future `route_instance_overrides` table keyed by `(route_id, assignee_id)` — and touches
neither `routes` nor `route_customers`. Therefore **no dormant columns now** (adding speculative
`parent_template_id` would be YAGNI clutter).
- `[DOC ONLY]` Add an Architecture Note stating the above explicitly, and that the customer-uniqueness
  index must stay a **named partial index** (`WHERE archived_at IS NULL`) so a future template/instance
  model can rescope it without a blind constraint rebuild.
- **Decision:** V1 unchanged. Growth path is additive. Documented.

### Item 2 — Business Calendar placeholder → **Centralize "today's route" resolution now; document the integration layer.**
- `[APPLY TO V1 SPEC]` Put the "resolve the route for (salesman, date)" logic in **one** place — a
  single helper/RPC `get_route_for(assignee, date)` — even though V1's body is a trivial lookup on
  `route_plan_assignments`. This costs nothing now and gives the future calendar/leave check
  **exactly one insertion point** instead of logic scattered across web, mobile execution, and the
  planner. This is the single most valuable forward-compatibility move in the review.
- `[DOC ONLY]` Architecture Note — future layering: `get_route_for` will, in order, (1) read the
  planner assignment for the ISO weekday, then (2) suppress/þshift it if the date is a **Public
  Holiday** or **Weekly Off** (a future `business_calendars` table, account-scoped, scope =
  company/territory/employee) or falls inside an approved **Leave** (`leave_requests`, part of the
  planned HRMS module). "Off day" (no planner row) and "on leave / holiday" become *distinguishable*
  states at that point. No V1 behavior change.

### Item 3 — Route Capacity configuration → **Restructure the setting; keep it configurable, add an enforcement mode.**
- `[APPLY TO V1 SPEC]` Replace the flat `validation.customer_count_threshold` with a `capacity`
  object:
  ```json
  "capacity": { "max_customers": 50, "enforcement": "warn" }   // enforcement: "warn" | "block"
  ```
  Default stays `warn`/50 (V1 behavior identical). An enterprise that needs a hard cap flips
  `enforcement` to `block` — still fully configurable, still zero hardcoded limits anywhere.
- `[FUTURE]` Per-role / per-route capacity overrides are an additive key
  (`capacity.overrides: [...]`) — no redesign. Daily capacity (sum across a salesman's day) is
  trivial in V1 (one route/day) and becomes meaningful only if multi-route days arrive.
- **Recommendation:** apply the object restructure now (cheap, avoids a settings-shape migration
  later); keep default = warn.

### Item 4 — Temporary Route Reassignment → **One cheap schema change now avoids a future live-constraint migration.**
- `[APPLY TO V1 SPEC]` Change the planner uniqueness from
  `UNIQUE(account_id, assignee_id, day_of_week)` to a **partial** index:
  `UNIQUE(account_id, assignee_id, day_of_week) WHERE end_date IS NULL AND is_active`.
  In V1 every assignment is open-ended (`end_date IS NULL`), so this behaves **identically** to
  today — but it permits date-bounded temporary rows to coexist with the permanent one later. The
  fields temporary reassignment needs (`assignee_id`, `start_date`, `end_date`, `is_active`,
  `paused_at`) **already exist** on `route_plan_assignments`.
- **Why now:** altering a UNIQUE constraint on a populated table in production is a risky, downtime-y
  migration. Defining it correctly on day one is free.
- `[DOC ONLY]` When the feature lands, the centralized `get_route_for` (Item 2) picks a date-bounded
  row covering the target date over the open-ended default. No other change.
- **Conclusion:** current schema *almost* supports it; this **one index-predicate change** is the
  only thing I recommend adjusting now.

### Item 5 — Execution lifecycle correctness (from C1/C2)
- `[APPLY TO V1 SPEC]` Make `route_execution_stops.planned_sequence` **NULLABLE** (NULL = an
  unplanned stop added mid-round via the Plan's "Add Customer" action). This makes the spec
  internally consistent.
- `[APPLY TO V1 SPEC]` `route_execution_start` accepts a **client-provided `p_stops`** array
  (client-generated stop ids + planned sequences captured from the *cached* route at start). The
  server **upserts idempotently** and does **not** re-derive the stop list from current
  `route_customers`. The salesman's on-device plan is authoritative for that day's execution —
  consistent with quoted-price-wins.

### Cross-cutting improvements
- `[APPLY TO V1 SPEC]` **Index set** (name them in §4): `route_customers(route_id)`,
  `route_plan_assignments(account_id, assignee_id, day_of_week)`,
  `route_executions(account_id, user_id, execution_date)`,
  `route_execution_stops(execution_id, status)`, `site_visits(route_execution_id)`.
- `[APPLY TO V1 SPEC]` **Audit `details` standard** (from C7): every logged action carries a typed
  `details` jsonb — `customer_removed → {contact_id, name}`; `customers_reordered → {order:[ids]}`;
  `route_assigned → {assignee_id, day_of_week}`; status changes → `{from, to, reason}`. This is what
  makes audit-over-versioning actually sufficient.
- `[DOC ONLY]` (from C6) `approval_mode='manager'` with a null `get_approver` result must render a
  visible "no approver configured — needs admin" state (mirroring the expense page's suggested-
  approver line), never a silent dump onto admins.

### Item 6 — Reuse verification (Reuse > Extend > Create)
Re-audited every proposed artifact against what exists. No duplication introduced:

| Need | Resolution |
|---|---|
| Audit trail | **Reuse** `module_activities` |
| Visit records | **Reuse** `site_visits` (+ one nullable FK column = **Extend**) |
| Approver resolution | **Reuse** `get_approver` |
| Customer→salesman scoping for import | **Reuse** `employee_area_territory_ids` / `territories` |
| Config storage | **Reuse** `accounts.settings` / `module_settings` jsonb |
| Permission gate | **Reuse** `has_permission` / `hasPermission` |
| Status transition engine | **Reuse** the `update_order_status` pattern (state machine + log) |
| Offline multi-table writes | **Reuse** `SyncEngine.enqueueRpc` (the `create_order` pattern) |
| Web list/detail/timeline UI | **Reuse** `<DataTable>`, `<Timeline>`, house detail layout |

Genuinely new (no existing solution): `routes`, `route_customers`, `route_plan_assignments`,
`route_executions`, `route_execution_stops`, and the route RPCs. **Create is justified.** The only
open "reuse" question is the **drag-and-drop library** — see Risks R-DND.

---

## 4. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-DND | **No drag-and-drop library exists in either repo.** This is a new dependency on both platforms and is the one hard blocker for sequencing. | Blocker | Founder decision required before coding (`@dnd-kit` web / `react-native-draggable-flatlist` mobile recommended). Already Open Question #1. |
| R-TERR | **Import-All depends on complete territory assignment.** If a route owner has no/partial `employee_area_assignments`, `employee_area_territory_ids` returns little, so "Import All" silently imports few or zero customers. | High | Import-All must report counts ("imported 0 — this salesman has no assigned areas"); document the territory-assignment prerequisite. |
| R-SNAP | Offline execution snapshot drift (C2) if server re-derives stops. | High | Fixed by R5 client-authoritative `p_stops`. |
| R-APPR | Approval "manager" fallback dumps on admins at scale (C6). | Medium | Visible unresolved-approver state; consider a per-account default approver. |
| R-VOL | `route_execution_stops` is high-volume (≈ reps × stops × days). At enterprise scale, millions/yr. | Medium | Index now (see index set); **`[FUTURE]`** date-partition `route_execution_stops` and archive old executions. Not needed at V1 volume. |
| R-PERM | 16 granular keys risk roles-editor sprawl and non-sensical combinations (`skip` without `execute`). | Low | Group visually; document key dependencies; owner/admin bypass all. |
| R-AUDIT-FK | `module_activities.user_id` FKs `auth.users`, not `profiles` — embedding it blanks the timeline. | Low (known) | Enforce the separate-profiles-enrichment pattern in the spec (already noted). |
| R-UNIQ | `UNIQUE(account_id, contact_id)` could surprise ops when moving a customer between routes (add fails until removed). | Low | RPC returns a friendly "already in route X"; consider an explicit "move" action `[FUTURE]`. |

---

## 5. Future Compatibility Notes

- **F1 — Route Templates:** `routes` already behaves as a shared template; multi-salesman
  assignment is live via `route_plan_assignments`. Per-instance customization arrives as an
  additive `route_instance_overrides(route_id, assignee_id, …)` table — no redesign. `owner_id`
  reinterprets as "steward"; a null owner means "import scope must be chosen explicitly."
- **F2 — Business Calendar / Leave / Weekly Off / Holidays:** all plug into the single
  `get_route_for(assignee, date)` resolver (R2). Additive tables (`business_calendars`,
  `leave_requests`); no change to routes/planner/execution schema.
- **F3 — Temporary Reassignment:** enabled by the partial planner index (R4) + existing date fields;
  resolution precedence lives in `get_route_for`.
- **F4 — Multi-stage approval:** the `route.status` state machine extends by adding statuses + an
  additive `route_approval_steps` table; `approval_mode` can grow from an enum to a chain. Route
  rows are untouched.
- **F5 — Non-weekly schedules:** `route_schedules` (dormant) already models weekly / every-X-days /
  monthly / custom.
- **F6 — Capacity by role/route:** additive `capacity.overrides` key.
- **F7 — Execution scale:** partition `route_execution_stops` by date; nothing in the V1 shape
  prevents it.

---

## 6. Final Architecture Recommendation

**The specification is architecturally sound and is approved to proceed — conditional on folding in
a small, bounded set of forward-compatibility and correctness adjustments before the first line of
code.** None of these add V1 features or change V1 behavior; they either fix a latent defect or make
the growth path additive instead of a redesign.

**`[APPLY TO V1 SPEC]` deltas to fold in upon your approval of this review:**
1. Planner uniqueness → **partial** index `WHERE end_date IS NULL AND is_active` (enables temporary
   reassignment later without a live-constraint migration). *(Item 4 / C3)*
2. `route_execution_stops.planned_sequence` → **NULLABLE** (supports the Plan's own "Add Customer
   during execution"). *(Item 5 / C1)*
3. `route_execution_start` → accept **client-authoritative `p_stops`**; server upserts idempotently,
   does not re-derive. *(Item 5 / C2)*
4. `route_settings.capacity` **object** with `max_customers` + `enforcement: warn|block` (default
   warn/50). *(Item 3 / C4)*
5. Centralize resolution in **`get_route_for(assignee, date)`** (single future hook for calendar/
   leave). *(Item 2)*
6. Standardize the **audit `details` jsonb** payload per action. *(C7)*
7. Name the **index set** in §4. Add the **Architecture Notes** for Items 1 & 2 and the
   unresolved-approver surface. *(Items 1, 2 / C6)*

**`[DOC ONLY]`:** Route Template growth path (F1), Business Calendar integration layer (F2),
customer-uniqueness partial-index rationale.

**Deferred `[FUTURE]`, recorded, non-blocking:** Route Templates, Business Calendar/Leave, temporary
reassignment feature, multi-stage approval, per-role capacity, execution partitioning.

**Still requires your decision before coding (unchanged from the spec's Open Questions):**
- **Drag-and-drop library** (R-DND) — the one hard blocker.
- Manager team-scoped visibility now vs. later.
- Sidebar placement.

**Also flag for your ruling:** whether to keep `manage_route_schedule` bundled or split it into four
keys per your "no bundled permissions" rule (C5). My recommendation: keep bundled.

On your approval of this review, I will fold the seven `[APPLY TO V1 SPEC]` deltas + the `[DOC ONLY]`
notes into `route-management.md`, resolve the three open decisions with you, and only then begin
implementation per the Antigravity contract. **No code has been written and none will be until you
approve.**
