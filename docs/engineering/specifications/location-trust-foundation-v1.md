# Feature Specification: Location Trust Foundation (v1)

**Status:** Implemented (2026-08-07) — DB + web verified; mobile pending on-device test
**Module:** Field Force (Location Tracking)
**Date:** 2026-08-07

> **Implementation status (2026-08-07), built directly (not Antigravity):**
> - **Database — DONE & verified live.** Migration `20260807170000_location_trust_foundation`
>   applied to prod: `location_pings.is_mocked` + `client_ping_id` (+ unique idempotency index),
>   `site_visits.check_in_is_mocked`/`check_out_is_mocked`, new `tracking_events` table (RLS on,
>   2 policies), and `compute_daily_distance` rewritten with accuracy + impossible-jump filtering.
> - **Web — DONE & verified in-browser.** Shared util `src/lib/location/distance.ts` (9 vitest
>   tests incl. a TS↔SQL parity assertion pinned to 111.19 km). Track Report: real `accuracy_m`,
>   filtered distance, populated Mock/GPS-Off/Switch-Off/Critical columns. Overview: filtered
>   distance + last-seen/stale/mock markers. Verified against seeded test data: distance 11.53 km
>   consistent across SQL/Overview/Track-Report, avg accuracy 111 m, mock marker rendered red.
> - **Mobile — CODE DONE, tsc-clean, NOT device-tested.** `lib/location.ts` ping fix (no client
>   `id`; sends `client_ping_id` + `is_mocked`) + `getCurrentLocation` returns `mocked` + tracking
>   health/`tracking_events` emission wired into the `_layout.tsx` AppState foreground handler.
>   `SyncEngine` idempotency guard (23505 on `client_ping_id`/`client_event_id` → success).
>   Site-visit check-in/out mock capture. **Requires an EAS build + on-device verification** (see
>   §11 Testing) — background GPS / mock-location cannot be exercised in this environment.

> **One-line purpose:** Make the location data itself trustworthy — pings that actually
> save, a distance number that can't be inflated by bad GPS, visible fake-GPS detection, and
> honest "agent went dark" reporting — *before* building higher-value features (beat/route
> adherence, auto-visit, manager alerts) on top of it. Those are deliberately deferred.

---

## 1. Feature Overview

- **Problem (three verified defects in the live product, 2026-08-07):**
  1. **GPS pings have not saved since 2026-07-17.** `location_pings.id` is a server-assigned
     `bigint` (`identity ALWAYS`), but `wacrm-mobile/lib/location.ts` now generates a text
     UUID and sends it as `id` in the insert payload — a guaranteed rejection by Postgres.
     Confirmed via live DB: saved pings have contiguous server-assigned ids 6→131, latest
     `recorded_at` is 2026-07-17, and this lines up with the offline-sync (SyncEngine) rework.
     **Net effect: any agent who punches in today loses their location history silently.**
  2. **The distance figure is inflatable.** Both `location-tracking/track-report/page.tsx`
     and `location-tracking/overview/page.tsx` compute distance client-side by summing
     Haversine across *every* ping regardless of GPS quality (the SQL `compute_daily_distance`
     function isn't called by either). Live data proves this is real, not theoretical: across
     126 production pings, average `accuracy_m` = **133 m**, worst = **1231 m**, and **41/126
     (a third) have NULL accuracy**. A single 1.2 km-accuracy point adds ~1 km of phantom
     travel. This distance feeds **fuel-expense approval** — a money-trust problem.
  3. **Fake-GPS is undetectable.** There is no place to record it (`location_pings` has no
     `is_mocked` column) and the app never reads Android's mock-location flag. The Track
     Report already renders a "Mock" column, but it is hardcoded to `0` and can never populate.
     Two adjacent columns ("GPS Off", "Switch Off") are likewise hardcoded `0`.
  - Bonus defect found in passing: Track Report selects a column named `accuracy`, but the
    real column is `accuracy_m`, so its "Accuracy" column always shows ~100 % (meaningless).

- **Business justification:** Field-force software is bought on *trust* — "can I believe the
  attendance, the visits, and the travel claims?" Every higher-value feature we want next
  (beat/route adherence, geofence auto-visit, manager alerts, distance-based fuel approval)
  is built on this same ping data. If the data is not saving, is inflatable, and is spoofable,
  those features inherit the distrust the first time a manager catches a wrong number. This
  pass hardens the foundation so the rest can be trusted.

- **Target use case / industries:** SMBs with field sales/service teams (the core wacrm
  Field Force persona) whose managers approve mileage expenses and rely on GPS to verify a
  rep was actually where they claimed. Directly benefits any customer paying for the Field
  Force add-on.

## 2. Scope

**In scope:**
- **P1 — Ping pipeline fix (urgent):** location pings insert successfully again; offline
  replay stays idempotent via a new dedup key, not the server-assigned `id`.
- **P2 — Trustworthy distance:** one shared distance calculation (accuracy filtering +
  impossible-jump rejection) used by both web surfaces AND `compute_daily_distance`; fix the
  `accuracy_m` column-name bug so the Accuracy column is real.
- **P3 — Fake-GPS detection:** capture Android's mock-location flag on every background ping
  and on punch-in/out and site-visit check-in snapshots; store it; surface it (count in Track
  Report's "Mock" column, "suspect" badge on the live map). **Flag only — never block** the
  agent (founder decision, 2026-08-07).
- **P4 — "Agent went dark" visibility:** a lightweight `tracking_events` table + mobile
  capture of GPS-services-disabled/enabled and permission-revoked events during an active
  session; "last seen X min ago" + stale highlight on the live map; populate the existing
  "GPS Off" / "Switch Off" / "Critical" columns in Track Report.

**Out of scope (deliberately deferred — do NOT build):**
- Beat/Route planning & adherence (planned-vs-actual). Separate approved spec:
  `route-management.md`.
- Geofence automatic visit check-in.
- Manager push/email alerts and scheduled productivity digests (this pass makes the data
  *visible*, not *pushed*).
- Historical route playback / animation.
- Blocking punch-in/check-in on mock detection (explicitly rejected for v1).
- iOS mock detection (wacrm is Android-only today; Android's `mocked` flag has no iOS
  equivalent — note it, don't build for it).
- Table partitioning / ping archival (handbook tech-debt item 1.3 — not this pass).

## 3. User Roles & Permissions

| Role | Can see | Can do | RLS / tenant implications |
|---|---|---|---|
| Owner / Admin | All location-tracking screens (Overview, Track Report, All Locations, Attendance, Customer Visits), including new mock/gap indicators | View only (these are read dashboards); no new write action | All new reads filtered by `account_id` via existing RLS + explicit `account_id` filter in every query and Realtime channel |
| Manager (business "Team"/"All" scope) | Same screens, scoped to their team's reps per existing Business Scope logic | View only | Business-scope filtering is UI-layer today; do not regress it. No change to scope rules in this pass |
| Field Agent | No location-tracking dashboards (these are admin-facing). The **mobile app writes** pings + tracking events automatically on their behalf | Cannot see or edit their own trust flags | Mobile writes go through existing `location_pings_insert` RLS (`user_id = auth.uid() AND is_account_member(account_id)`); new `tracking_events` table gets an equivalent insert policy |
| Viewer | Read dashboards (SELECT only) | Nothing | Standard viewer RLS |

No new *permission keys* are introduced. This is intentional: the pass adds visibility to
existing admin screens and automatic mobile writes, not new user-triggered actions.

## 4. Data Model

All changes are **additive** and safe for the 126 existing rows. Migrations follow the repo
convention: sequential numbered SQL in `wacrm-web/supabase/migrations/`, `IF NOT EXISTS`,
never drop a live column.

### 4.1 `location_pings` — new columns

| Column | Type | Notes |
|---|---|---|
| `is_mocked` | `boolean NOT NULL DEFAULT false` | Android mock-location flag captured at ping time. Backfills `false` for existing rows (correct — unknown = assume genuine). |
| `client_ping_id` | `uuid NULL` | App-generated idempotency token for offline replay. **Not** the primary key. `NULL` for the 126 legacy rows. |

- **Keep `id` exactly as-is** (`bigint identity ALWAYS`, server-assigned). Do NOT change it to
  uuid — the fix is to stop sending it, not to change the column.
- Idempotency index (prevents a re-flushed offline ping from double-inserting):
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS location_pings_client_ping_id_uidx
    ON location_pings (account_id, client_ping_id)
    WHERE client_ping_id IS NOT NULL;
  ```

### 4.2 `tracking_sessions` — no new column required

Mock/gap state for a session is **derived on read** (a session is "suspect" if any of its
pings is `is_mocked`, and "went dark" if it has a qualifying gap or a `tracking_event`). Do
not denormalize a `has_mock` flag onto the session in v1 — avoid a maintenance trigger for
data we can compute. (If read performance ever demands it, revisit — noted, not built.)

### 4.3 `site_visits` — new columns

| Column | Type | Notes |
|---|---|---|
| `check_in_is_mocked` | `boolean NOT NULL DEFAULT false` | Mock flag on the check-in GPS snapshot. |
| `check_out_is_mocked` | `boolean NOT NULL DEFAULT false` | Mock flag on the check-out snapshot. |

### 4.4 New table: `tracking_events`

Small, append-only signal log for honest "went dark" reporting. Lets the app self-report the
cases it *can* observe (GPS toggled off, permission revoked); the cases it cannot self-report
(phone switched off) are inferred at read time from battery + session `end_reason`.

```sql
CREATE TABLE IF NOT EXISTS tracking_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts(id),
  session_id   uuid REFERENCES tracking_sessions(id),
  user_id      uuid NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN
                 ('gps_disabled','gps_enabled','permission_revoked','permission_restored')),
  battery_pct  smallint,
  recorded_at  timestamptz NOT NULL,          -- device capture time, not sync time
  received_at  timestamptz NOT NULL DEFAULT now(),
  client_event_id uuid,                        -- offline idempotency, same pattern as pings
  created_at   timestamptz NOT NULL DEFAULT now()
);
```
- Follows the ping pattern deliberately (`id` server-assigned bigint; `client_event_id` for
  dedup) so the same offline path and the same lesson apply.
- Idempotency index mirrors 4.1.

### 4.5 RLS

- `location_pings`, `site_visits`: **no policy change** — new columns inherit existing
  policies. Verify the existing `location_pings_insert` policy still permits the insert once
  `id` is omitted (it should — the policy checks `user_id`/`account_id`, not `id`).
- `tracking_events`: enable RLS; add policies mirroring `location_pings`:
  ```sql
  ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tracking_events_insert ON tracking_events FOR INSERT
    WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));
  CREATE POLICY tracking_events_select ON tracking_events FOR SELECT
    USING (is_account_member(account_id));
  ```

### 4.6 `compute_daily_distance` — update, not replace

Apply the same filtering the shared TS util uses (see §5.2). Keep the signature
`(p_user_id uuid, p_date date DEFAULT CURRENT_DATE) RETURNS double precision`. Exclude pings
where `accuracy_m IS NULL OR accuracy_m > MAX_ACCURACY_M`, order by `recorded_at`, and skip
any segment whose implied speed exceeds `MAX_PLAUSIBLE_SPEED_MPS`. Comment the thresholds and
their rationale in the function body.

## 5. API Contract

No new HTTP endpoints or Next.js route handlers. All reads are direct `supabase-js` queries
from client components (the existing 80 %-direct pattern); all mobile writes go through
`SyncEngine.enqueueMutation`. The "contract" here is the shared functions and the mobile
write shape.

### 5.1 Ping write shape (mobile) — the P1 fix

`wacrm-mobile/lib/location.ts`, background task:
- Generate `const clientPingId = generateUUID();`
- Build the payload **without `id`**:
  ```ts
  const payload = {
    client_ping_id: clientPingId,
    account_id, session_id: sessionId, user_id: userId,
    lat, lng, accuracy_m, speed_mps, battery_pct,
    is_mocked: loc.mocked ?? false,      // Android LocationObject.mocked; false if undefined
    recorded_at,
  };
  await syncEngine.enqueueMutation('location_pings', 'CREATE', clientPingId, payload);
  ```
- The SyncEngine queue/dedup key becomes `clientPingId` (a value we own), but the DB `id` is
  left for Postgres to assign. **Antigravity must read `SyncEngine`'s `defaultProcessFn` and
  confirm it inserts `op.payload` as-is** — if it injects `id` from the entityId anywhere,
  that path must be corrected so `location_pings` inserts omit `id`. If the SyncEngine
  hard-couples entityId→`id`, that is a **STOP AND ASK**.
- **Regression check:** the duplicate-session / double-tap prevention added during the
  offline-punch work may have assumed client-generated ids for pings. Re-verify it still
  works after this change (backlog item references this).

### 5.2 Shared distance utility (web) — the P2 fix

Create `wacrm-web/src/lib/location/distance.ts` (business logic belongs in `lib/`, never in a
component — per Code Standards):
```ts
export const MAX_ACCURACY_M = 100;          // pings worse than this are excluded (tunable)
export const MAX_PLAUSIBLE_SPEED_MPS = 55;  // ~200 km/h; segments faster than this are GPS jumps

export interface DistancePing { lat: number|null; lng: number|null;
  accuracy_m: number|null; recorded_at: string; }

/** Sum of travel in km across accuracy-filtered pings, skipping impossible jumps.
 *  Must stay behaviourally identical to compute_daily_distance() SQL (see §4.6). */
export function computeFilteredDistanceKm(pings: DistancePing[]): number { /* ... */ }
```
- Both `track-report/page.tsx` and `overview/page.tsx` must delete their inline Haversine and
  call this. No third copy may remain.
- A small parity check (a handful of fixture cases run through both this util and the SQL
  function returning the same result) is required — reuse the lightweight approach, not the
  full 15-case pricing harness.

### 5.3 Tracking-event write shape (mobile) — the P4 signal

On the mobile side, during an **active** session, when `Location.hasServicesEnabledAsync()`
flips false→true/true→false (checked on app foreground via the existing AppState listener and
in the background task), or foreground/background location permission is lost/restored,
enqueue a `tracking_events` CREATE via `SyncEngine.enqueueMutation('tracking_events', ...)`
with a `client_event_id`, `recorded_at` = capture time, and current `battery_pct`.

## 6. Mobile Behavior

- **Offline (per handbook Offline Architecture — verify still current before coding):** GPS
  pings already route through `SyncEngine.enqueueMutation` (that is precisely what regressed
  the `id`). The fix **keeps** them on SyncEngine; it must not revert to direct
  `supabase.from().insert()`. `tracking_events` must also go through `SyncEngine` so a GPS-off
  event captured in a dead zone still syncs later. `recorded_at` for both pings and events is
  the **device capture timestamp**, never sync time.
- **Mock capture:** `loc.mocked` on Android `LocationObject` (background task batch) and on
  `getCurrentPositionAsync()` results (punch-in/out + check-in snapshots). On any platform
  where it is `undefined`, store `false`. No native module needed — it is part of
  `expo-location`.
- **GPS-services / permission signals:** use `Location.hasServicesEnabledAsync()` and the
  existing permission getters; only emit events while a session is active (avoid noise). The
  phone-fully-off case is intentionally NOT self-reported (impossible) — it is inferred at
  read time.
- **New mobile build required:** mock capture + event emission ship in the app binary, so
  this needs an EAS build to reach devices; legacy pings/events won't carry the new flags.
  Call this out at release.
- **Battery/permission implications:** no change to polling cadence (still 30 s OS poll /
  10-min throttle). `hasServicesEnabledAsync` checks are cheap and event-driven, not a new
  poll loop.

## 7. UI States

**Overview (`location-tracking/overview/page.tsx`):**
- Loading: existing skeleton cards (unchanged).
- Empty (no active agents): existing empty state (unchanged).
- Populated: distance metric now uses the filtered util. Each map marker shows **"last seen
  X min ago"**; a marker whose active session has no ping for > `STALE_AFTER_MIN` (default
  25 min) renders in a **stale** style (e.g. muted/amber) with a "went dark" hint. A marker
  whose latest ping is `is_mocked` shows a **"suspect location"** badge.
- Partial data (some pings NULL-accuracy): distance silently excludes them; no error — this
  is the whole point.

**Track Report (`location-tracking/track-report/page.tsx`):**
- Fix the query to select `accuracy_m` (not `accuracy`); the "Accuracy" column shows the real
  average accuracy (and should read *lower m = better*; if kept as a %, define the mapping
  explicitly rather than the current always-100 % bug).
- "Distance (in km)" uses the filtered util.
- "Mock" column = count of `is_mocked` pings for that user in range (no longer hardcoded 0).
- "GPS Off" / "Switch Off" / "Critical" columns populated from `tracking_events` + gap
  heuristics (see §8). No longer hardcoded 0.
- Empty / loading / filter states: unchanged from current `DataTable` behavior.

**Customer Visits & Attendance (secondary, lighter touch):** where a check-in/out is
`*_is_mocked`, show the same "suspect" badge. Do not redesign these tables in this pass (the
viewport-overflow issue is tracked separately).

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behavior | Severity |
|---|---|---|
| Re-flushed offline ping (same `client_ping_id`) | Unique index rejects the duplicate; SyncEngine treats the conflict as success and drops the op (no zombie in queue) | Blocker |
| SyncEngine `defaultProcessFn` injects `id` from entityId | Must be corrected so `location_pings` inserts omit `id`; if it's hard-coupled → STOP AND ASK | Blocker |
| Ping with `accuracy_m = NULL` | Excluded from distance; still stored and still counts as a "total" ping | Info |
| Two good pings implying >200 km/h between them (GPS teleport) | That segment's distance is skipped (not summed); both pings retained | Warning |
| `loc.mocked` undefined (non-Android / older OS) | Store `false`; never crash | Info |
| Mock detected | Ping stored with `is_mocked=true`, surfaced as suspect; agent is **not** blocked | Warning |
| Active session, phone switched off (no pings, no event) | Read-time gap detection flags it; classified "Switch Off" if last battery was low or session `end_reason='app_killed'`, else "Critical" | Warning |
| GPS toggled off mid-shift | `gps_disabled` event emitted (if app alive); Track Report "GPS Off" reflects it; map marker goes stale | Warning |
| Legacy pings (pre-migration, `is_mocked` default, `client_ping_id` NULL) | Treated as genuine, non-duplicate; distance recomputed under new filter (may drop slightly — expected and correct) | Info |
| `compute_daily_distance` and TS util disagree | Parity check must fail the build/QA until thresholds match | Blocker |

## 9. Reuse Check

**Antigravity must search for and reuse these before writing anything new:**
- `wacrm-mobile/lib/location.ts` — the background task + ping payload (the P1 change lives
  here; do not create a parallel tracker).
- `wacrm-mobile/src/core/SyncEngine/` — `enqueueMutation`, `defaultProcessFn`; the ping and
  event writes route through this, following the `VisitService.ts` offline pattern.
- `wacrm-mobile/src/utils/uuid.ts` (`generateUUID`) — reuse for `client_ping_id` /
  `client_event_id`. **Confirm its randomness source** (handbook flags this as unverified for
  production keys) before relying on it for the uniqueness index.
- `wacrm-web/src/components/location-tracking/map-view.tsx` — extend for the stale / suspect
  marker states; do not build a new map.
- `wacrm-web/src/components/ui/data-table/` — Track Report already uses it; only change data,
  not the table.
- Existing SQL `compute_daily_distance` — **update**, don't add a second distance function.
- Existing `location_pings_insert` RLS policy and `is_account_member()` — reuse for
  `tracking_events`.

**Do not create:** a new location tracker, a second distance function, a bespoke map, or a
new offline queue.

## 10. Open Questions

Defaults below were set by the CTO as sensible starting values and are **tunable constants**,
not hard decisions — confirm or adjust, but implementation should not block on them:
- `MAX_ACCURACY_M = 100` (exclude pings worse than 100 m from distance). Live data avg is
  133 m, so this will exclude a meaningful share — that is the intent. Acceptable?
- `MAX_PLAUSIBLE_SPEED_MPS = 55` (~200 km/h jump rejection). Fine for road sales; raise if any
  customer is genuinely on highways/flights.
- `STALE_AFTER_MIN = 25` (map marker "went dark" threshold; 2.5× the 10-min ping interval).
- "Accuracy" column presentation: show average accuracy in **meters** (clear, lower=better)
  rather than salvaging the current misleading percentage — confirm this is acceptable UX.

All product-level decisions (flag-not-block for mock; include went-dark visibility) were
confirmed with the founder on 2026-08-07.

## 11. Acceptance Criteria

**Functional**
- [ ] A ping created on a device (online and offline-then-reconnected) appears in
      `location_pings` with a server-assigned `id` and the correct `client_ping_id`.
- [ ] Re-flushing the same offline ping does not create a duplicate row.
- [ ] Distance on Overview and Track Report is identical for the same user/day, and excludes
      NULL/low-accuracy pings and impossible jumps.
- [ ] `compute_daily_distance` returns the same value as the TS util for the parity fixtures.
- [ ] A mocked location is stored `is_mocked=true` and counted in Track Report's "Mock"
      column; the agent is not blocked.
- [ ] GPS-off during an active shift produces a `tracking_events` row and shows in "GPS Off".
- [ ] Map marker shows "last seen X min ago" and goes stale after `STALE_AFTER_MIN`.
- [ ] Track Report "Accuracy" column shows real values (not a constant).

**Code Quality**
- [ ] `npx tsc --noEmit` clean (web) — actually run, not "structure-checked"; mobile baseline
      unchanged (no new errors in touched files). No `any` without a justifying comment.
- [ ] Exactly one distance implementation in TS; both pages call it; no inline Haversine left.

**Architecture**
- [ ] Distance logic lives in `src/lib/location/`, not in a component.
- [ ] Ping + event writes go through `SyncEngine`, not direct `supabase.from().insert()`.
- [ ] `id` columns remain server-assigned; idempotency uses `client_*_id`.

**Testing**
- [ ] Offline ping + offline tracking-event verified in Airplane Mode → reconnect (device).
- [ ] Duplicate-flush test passes (unique index).
- [ ] Regression: duplicate-session/double-tap punch prevention still works after the id fix.

**Security**
- [ ] `tracking_events` has RLS enabled with `is_account_member` policies; cross-tenant SELECT
      returns `[]`.
- [ ] Every new Realtime subscription / query filters by `account_id`.

**Performance**
- [ ] No new polling loop on mobile; event checks are state-change-driven.
- [ ] Track Report/Overview queries remain single round-trips (no N+1).

**Documentation**
- [ ] `PROJECT.md` location sections + handbook updated: id is server-assigned & must not be
      client-sent; new columns/table; the shared distance util is the single source of truth.
- [ ] Thresholds documented with rationale in code.

**Production Readiness**
- [ ] Migration is additive, verified against the 126 existing rows (no data loss).
- [ ] New mobile EAS build produced; release notes call out that trust flags are forward-only.
- [ ] After deploy, a real punch-in produces a saved ping (verify the July-17 gap is closed).

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip
steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything
1. Read the full Engineering Handbook for the current tech stack, architecture principles, and
   code standards.
2. Read this entire specification, including Open Questions.
3. Search the existing codebase before writing new code — specifically: `wacrm-mobile/lib/location.ts`,
   `wacrm-mobile/src/core/SyncEngine/` (esp. `defaultProcessFn` / `enqueueMutation`),
   `wacrm-mobile/src/utils/uuid.ts`, `wacrm-web/src/app/(dashboard)/location-tracking/track-report/page.tsx`,
   `wacrm-web/src/app/(dashboard)/location-tracking/overview/page.tsx`,
   `wacrm-web/src/components/location-tracking/map-view.tsx`, the SQL `compute_daily_distance`
   function, and the `location_pings` RLS policies.
4. Identify the actual naming conventions used in these files by inspecting them — do not
   assume.
5. **Do not assume offline support is automatic.** GPS pings route through `SyncEngine`
   already; keep them there. Wire `tracking_events` through `SyncEngine.enqueueMutation` too,
   following the `VisitService.ts` pattern. Confirm the SyncEngine facts against the live repo
   before coding — they have changed between audits before.

### Step 2 — STOP AND ASK triggers
- The SyncEngine's insert path hard-couples the queue entityId to the DB `id` column (which
  would block omitting `id` for pings).
- You find existing code that conflicts with this spec (e.g. a second distance function or a
  different ping-write path).
- The spec doesn't specify behavior for a case you hit (an error state, a permission edge, a
  data-type ambiguity).
- You are about to introduce a new library/dependency/pattern not already used here.
- You are about to change a shared component/service/table in a way that could affect other
  features (e.g. `SyncEngine`, `map-view.tsx`, `compute_daily_distance`).

Ask a specific, answerable question — e.g. "SyncEngine's `defaultProcessFn` sets
`payload.id = op.entityId` for all modules; should I special-case `location_pings` to strip
`id`, or add a per-module option?"

### Step 3 — Implementation rules
- TypeScript strict: zero errors, no `any` without a justifying comment.
- Reuse Before Create / Extend Before Replace — one distance function, one tracker, one map.
- Match the data model and API shapes in this spec exactly; deviations are STOP AND ASK.
- Respect multi-tenant RLS on `tracking_events` and every query/Realtime channel.
- Preserve offline-first: pings and tracking events must survive a dead zone and sync on
  reconnect, with device capture timestamps.

### Step 4 — Self-verification before declaring done
Check every item in Section 11 (Acceptance Criteria), category by category (Functional, Code
Quality, Architecture, Testing, Security, Performance, Documentation, Production Readiness).
For anything you cannot verify in your environment (e.g. on-device offline sync, a real
mock-GPS app), say so explicitly rather than marking it done. **Actually run `npx tsc
--noEmit`** on web — "structure-checked" does not satisfy the DoD.

### Step 5 — Report back
1. What was implemented, mapped to this spec's sections.
2. Any deviations and why.
3. Any new conventions discovered/introduced (for the handbook).
4. Any Acceptance Criteria items not fully verified and why — especially the on-device and
   real-mock-GPS tests.
