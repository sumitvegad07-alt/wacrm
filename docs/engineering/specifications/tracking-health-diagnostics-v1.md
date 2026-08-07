# Feature Specification: Tracking Health & Diagnostics (v1)

**Status:** Implemented (2026-08-07) — DB + web built & browser-verified; mobile pending on-device test
**Module:** Field Force (Location Tracking)
**Date:** 2026-08-07

> **Implementation status (2026-08-07), built directly (not Antigravity):**
> - **DB — DONE & live.** `device_health_snapshots` table (migration `20260807190000`, RLS, 2 policies).
> - **Web — DONE & browser-verified.** Engine `src/lib/location/tracking-health.ts` (8 unit tests)
>   + issue catalog `tracking-issues.ts`. Two pages under Location Tracking: triage list
>   (`/health`) and per-agent diagnostic (`/health/[userId]`), matching the existing
>   MetricCard/DataTable/Badge structure; sidebar entry added. Verified with seeded data: coverage
>   22%, classified "Background location not allowed" + "Fake/mock GPS", device snapshot + gap
>   timeline + copyable fixes all rendered correctly. Web `tsc` clean; 559 tests pass.
> - **Mobile — CODE DONE, tsc-clean, NOT device-tested.** `lib/device-health.ts` heartbeat
>   (expo-device/expo-battery/expo-location) wired into punch-in/out, foreground, and hourly ping;
>   SyncEngine idempotency extended to `client_snapshot_id`. **Also fixed two more instances of the
>   ping `id` bug found in `punch.tsx`** (punch-in + punch-out pings were sending a client id too).
> - **Battery-optimization detection deferred to v2 (honest correction to Open Q#1):**
>   `react-native-device-info` does NOT expose the exemption flag and no safe expo API does, so it
>   is NOT collected in v1 (`battery_optimization_on` stays NULL). The symptom is still caught via
>   `os_killed_app` (session end_reason), whose fix message already says "set battery to
>   Unrestricted". Direct detection needs a small native module — a v2 item.

> **Purpose:** Give an admin a self-serve answer to "why isn't this agent tracking?" so they
> stop opening support tickets. Turns raw signals into a plain-English **diagnosis + the exact
> fix to tell the agent**. Builds directly on the Location Trust Foundation (pings now save,
> `tracking_events`, `is_mocked`, battery per ping).

---

## 1. Feature Overview

- **Problem:** Today the admin sees dots on a map. When the dots stop, they have no idea why —
  permission missing? battery optimization killed the service? phone died? agent never punched
  in? — so they raise a ticket or wrongly accuse the agent. Location tracking on Android fails
  silently in a dozen well-known ways, none of which the current product surfaces.
- **Business justification:** "The app isn't tracking my rep" is the single biggest support
  burden for field-force software. Every serious competitor (FieldAssist, Bizom, etc.) ships a
  device/location-health screen for exactly this. It reduces support load, settles
  agent-vs-manager disputes (e.g. "my phone died" is now provable), and improves data quality.
- **Target use case:** An admin/manager opens "Tracking Health", sees a ranked list of only the
  agents with a problem today, each with a cause and a fix, and resolves it by messaging the
  agent — without engineering or support involvement.

## 2. Scope

**In scope (Full v1):**
- **Device health heartbeat** (mobile): a periodic self-report of device state (permissions,
  battery, power mode, location services, app version, manufacturer/OS, battery-optimization).
- **Coverage engine** (server): "expected vs received pings" per agent per day, with gaps
  detected and each gap classified to a cause.
- **Issue classification**: map raw signals → a stable issue code → plain-English cause + fix.
- **Two-tier admin UI** under Location Tracking:
  1. **Tracking Health** — account-wide "Needs Attention today" triage list.
  2. **Per-agent daily diagnostic** — coverage %, gap timeline, device snapshot, issue+fix list.

**Out of scope (v1):**
- Push/email/WhatsApp alerts to admins or agents (this makes the data *visible*, not *pushed* —
  alerts are a fast-follow once codes are stable).
- In-app auto-remediation beyond deep-linking the agent to the relevant Android settings screen.
- iOS-specific diagnostics (Android-only app today).
- Historical trend analytics / reliability scoring over weeks (v1 is per-day).
- Precise-vs-approximate location detection (not cleanly exposed by expo-location; revisit).

## 3. User Roles & Permissions

| Role | Sees | Does | Notes |
|---|---|---|---|
| Owner / Admin | Both new screens, all agents in the account | View + copy the suggested fix message | Read dashboards; no new mutations |
| Manager (Team scope) | Both screens, scoped to their team | View | Reuse existing business-scope filtering; don't regress it |
| Field Agent | Nothing new in web (admin-facing). The **mobile app writes** their own heartbeats automatically | — | Heartbeat insert uses the same self-own RLS as pings |
| Viewer | Read-only | — | Standard |

No new permission keys. Mobile heartbeat writes are automatic and self-scoped.

## 4. Data Model

Additive. Migration convention: timestamped SQL in `wacrm-web/supabase/migrations/`, `IF NOT EXISTS`.

### 4.1 New table: `device_health_snapshots`

A point-in-time self-report from the device. Append-only, same idempotency pattern as pings
(server-assigned `bigint id`, `client_snapshot_id` for offline replay).

```sql
CREATE TABLE IF NOT EXISTS device_health_snapshots (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id               uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id               uuid REFERENCES tracking_sessions(id) ON DELETE SET NULL,
  user_id                  uuid NOT NULL,
  recorded_at              timestamptz NOT NULL,        -- device capture time
  received_at              timestamptz NOT NULL DEFAULT now(),
  client_snapshot_id       uuid,                        -- offline idempotency
  -- capture reason: 'punch_in' | 'foreground' | 'ping' | 'punch_out'
  reason                   text,
  -- app / device identity
  app_version              text,
  os_version               text,
  android_api_level        integer,
  manufacturer             text,
  model                    text,
  -- power
  battery_pct              smallint,
  is_charging              boolean,
  low_power_mode           boolean,                     -- battery saver on
  battery_optimization_on  boolean,                     -- NULL if the device lib can't report it
  -- location / permissions (text: 'granted' | 'denied' | 'undetermined')
  location_services_on     boolean,
  fg_location_permission   text,
  bg_location_permission   text,
  notification_permission  text,                        -- NULL if not collected
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS device_health_client_id_uidx
  ON device_health_snapshots (account_id, client_snapshot_id) WHERE client_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS device_health_user_recorded_idx
  ON device_health_snapshots (account_id, user_id, recorded_at DESC);

ALTER TABLE device_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_health_insert ON device_health_snapshots FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));
CREATE POLICY device_health_select ON device_health_snapshots FOR SELECT
  USING (user_id = auth.uid() OR is_account_member(account_id, 'agent'::account_role_enum));
```

### 4.2 Reused (no change)
- `tracking_events` (gps_disabled/enabled, permission_revoked/restored) — already built.
- `location_pings` (battery_pct, accuracy_m, is_mocked) — already built.
- `tracking_sessions` (started_at, ended_at, end_reason).
- `employee_devices` (device_name, model, os, version) — cross-reference for app-version staleness.

## 5. API Contract

### 5.1 `get_agent_tracking_health(p_user_id uuid, p_date date)` — new RPC
Server-side so the coverage + gap logic lives in one place. Returns JSON:
```jsonc
{
  "date": "2026-08-07",
  "punched_in": true,
  "active_seconds": 28800,
  "expected_pings": 48,          // floor(active_seconds / 600)
  "received_pings": 30,
  "coverage_pct": 62,
  "gaps": [                       // ordered; each gap = a run of missing expected pings in a session
    { "from": "...", "to": "...", "minutes": 70, "issue_code": "battery_optimization" }
  ],
  "latest_snapshot": { /* newest device_health_snapshots row */ },
  "issue_codes": ["battery_optimization", "bg_permission_missing"]  // deduped, most-severe first
}
```
- `active_seconds` = sum of session durations that day (ended_at or now() if still open).
- A **gap** = an interval between two consecutive in-session pings longer than
  `2 × PING_INTERVAL` (i.e. > 20 min), OR from session start to first ping, OR last ping to
  session end. Each gap is classified (see §5.3).
- `SECURITY INVOKER` (runs as the caller; tenancy via RLS on the underlying tables).

### 5.2 `get_account_tracking_health(p_date date)` — new RPC
Returns one row per punched-in agent for the triage list:
```jsonc
[ { "user_id": "...", "full_name": "...", "coverage_pct": 62,
    "worst_severity": "critical", "headline_issue_code": "battery_optimization",
    "last_seen_at": "...", "punched_in": true } ]
```
Also includes agents who **did not punch in** (so "no data" is explained, not mysterious).

### 5.3 Gap → issue classification (inside the RPCs)
For each gap, pick the most likely cause from evidence near the gap window:
| Evidence during/around the gap | issue_code | severity |
|---|---|---|
| `tracking_events.gps_disabled` present | `gps_off` | high |
| `permission_revoked` present | `permission_revoked` | high |
| Latest snapshot `bg_location_permission != granted` | `bg_permission_missing` | high |
| Latest snapshot `battery_optimization_on = true` | `battery_optimization` | high |
| Latest snapshot `low_power_mode = true` | `power_save_mode` | medium |
| Last ping before gap had `battery_pct <= 10` and no later data | `phone_died` | info |
| Session `end_reason = 'app_killed'` | `os_killed_app` | medium |
| `employee_devices.version` older than current | `app_outdated` | medium |
| None of the above | `unknown_gap` | medium |
Account-level extras: no session today → `not_punched_in` (info); device pending → `device_pending` (high); any `is_mocked` ping → `mock_location` (high, security).

### 5.4 Issue copy catalog — TS on web (`src/lib/location/tracking-issues.ts`)
Maps each `issue_code` → `{ severity, title, cause, fix }` (UI copy). Keeps human wording out
of the database so it can be reworded without a migration. Example:
```ts
battery_optimization: {
  severity: "high",
  title: "Battery optimization is on",
  cause: "Android is putting the app to sleep in the background, so it stops sending location.",
  fix: "Ask the agent to open Settings → Apps → WACRM → Battery → set to 'Unrestricted'.",
}
```

## 6. Mobile Behavior

- **New dependency required:** `react-native-device-info` for `battery_optimization_on`
  (Android `isBatteryOptimizationEnabled`) and richer device identity. Optional adds:
  `expo-notifications` (notification permission on Android 13+) and `expo-intent-launcher`
  (deep-link the agent straight to the battery/location settings screen from a future in-app
  prompt). **See Open Questions** — battery-optimization detection is the one field that cannot
  be read from the currently-installed libs (`expo-device`/`expo-battery`).
- **Heartbeat capture** (`lib/device-health.ts`, new): a `captureHealthSnapshot(reason)` that
  reads — all local, no network, cheap:
  - `expo-device`: manufacturer, modelName, osVersion, platformApiLevel
  - `expo-battery`: battery level, `getBatteryStateAsync` (charging), `isLowPowerModeEnabledAsync`
  - `expo-location`: `hasServicesEnabledAsync`, fg + bg permission getters
  - `expo-constants`/`expo-application`: app version
  - `react-native-device-info`: `isBatteryOptimizationEnabled` (Android) → `battery_optimization_on`
  then enqueues one `device_health_snapshots` CREATE via `SyncEngine.enqueueMutation` with a
  `client_snapshot_id` (offline-safe, idempotent — same pattern as pings; **never send `id`**).
- **When it fires:**
  - `reason:'punch_in'` — in `punch.tsx` right after a session starts (the most valuable one).
  - `reason:'foreground'` — in the `_layout.tsx` AppState 'active' handler (already the home of
    the tracking-health check) — throttled to at most once per ~15 min.
  - `reason:'ping'` — piggybacked in the background task after a ping is enqueued, throttled to
    ~1/hour so we don't write a snapshot every 10 min.
  - `reason:'punch_out'` — in `punch.tsx` on punch-out.
- **Offline:** heartbeats queue through `SyncEngine` and sync on reconnect, `recorded_at` = capture time.
- **Requires a new EAS build** to ship (native dep + new capture code). Old installs simply
  won't send heartbeats — the report degrades gracefully (fewer signals, not a crash).

## 7. UI States

**Tracking Health (triage list)** — new page under the Location Tracking sidebar group:
- Loading: skeleton rows.
- Empty (everyone healthy / nobody on shift): friendly "All clear — no tracking issues today."
- Populated: rows sorted worst-severity first; each row = agent, coverage %, a colored severity
  chip, the headline cause in plain English, "last seen", and a "View details" link.
- Filter by date (default today) and by severity.

**Per-agent diagnostic** — detail page (or a slide-over Sheet):
- **Coverage card:** big "62% coverage — 30 of 48 expected pings", colored.
- **Gap timeline:** the shift as a bar; green where pings landed, red/amber gaps labeled with
  their cause.
- **Device snapshot card:** model, Android version, app version, battery %/charging, each
  permission (✓/✗), battery-optimization state, power-save, last heartbeat time. Unknown fields
  render "—" (e.g. battery-optimization on an old app build without the dep).
- **Issues & fixes list:** each detected issue as title + plain cause + a copyable "message to
  send the agent" fix. A "Copy fix" button.
- Empty/partial: if the agent never punched in → "No shift today"; if no heartbeat yet →
  "This agent's app hasn't reported device health yet (needs the updated app)."

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behavior | Severity |
|---|---|---|
| Agent punched in, zero pings all day | Coverage 0%, one big gap, classified by latest snapshot/events | Blocker to surface |
| Agent never punched in | Row shows `not_punched_in` (info), not a false alarm | Info |
| Old app build (no heartbeat, no is_mocked) | Report still works from pings/sessions; device card shows "—"; suggest app update | Warning |
| `battery_optimization_on` NULL (dep missing / lib returns unknown) | Don't assert it as a cause; fall back to gap-pattern + other signals | Info |
| Phone died (battery 4% then silence) | `phone_died` (info) not a scary red — protects the agent | Info |
| Clock skew (device time wrong) | `recorded_at` may look off; v1 trusts device time (note as a known limitation) | Info |
| Re-flushed offline heartbeat (same client_snapshot_id) | Unique index dedups; SyncEngine idempotency guard treats it as success | Blocker |
| Multiple sessions in one day | `active_seconds` sums them; gaps computed per session, merged in output | Warning |
| Coverage > 100% (more pings than expected) | Clamp to 100%; can happen with sub-throttle bursts | Info |

## 9. Reuse Check

Antigravity/implementer must search for and reuse:
- `wacrm-mobile/lib/location.ts` — the `logTrackingHealth`/`checkTrackingHealthOnForeground`
  pattern and the background task (piggyback the ping-reason heartbeat here); `client_ping_id`
  idempotency pattern to copy for `client_snapshot_id`.
- `wacrm-mobile/src/core/SyncEngine/` — `enqueueMutation` + the `isIdempotentDuplicate` guard
  (extend its key list to include `client_snapshot_id`).
- `wacrm-mobile/app/punch.tsx` — punch-in/out hooks for the heartbeat.
- `wacrm-mobile/app/_layout.tsx` — the AppState 'active' handler (already calls the health check).
- `wacrm-web/src/lib/location/distance.ts` — sibling for the new `tracking-issues.ts` and any
  shared location helpers; keep new web logic under `src/lib/location/`.
- `wacrm-web/src/components/ui/data-table/` — for the triage list.
- Existing Location Tracking pages/sidebar (`src/app/(dashboard)/location-tracking/*`) — add the
  new page alongside, matching their layout.
- `is_account_member`, existing ping RLS — mirror for the new table.

**Do not create:** a second sync path, a new map, a new device-info abstraction, or duplicate
distance/coverage math.

## 10. Open Questions

1. **Battery-optimization detection needs `react-native-device-info`** (the only way to read the
   Android exemption flag; `expo-device`/`expo-battery` can't). Confirm we add it. *CTO
   recommendation: yes — it's the highest-value single signal (it's the founder's headline
   example), the library is standard and well-maintained, and it also enriches the device card.*
   If declined, `battery_optimization_on` stays NULL and that cause is inferred from gaps only.
2. **Notification-permission signal (`expo-notifications`) and settings deep-link
   (`expo-intent-launcher`)** — include in v1 or defer? *Recommendation: defer both to v2;
   they're nice-to-have and add two more deps. v1 ships the big signals with just
   `react-native-device-info`.*
3. **Heartbeat retention** — snapshots are small but per-agent-per-hour adds up. *Recommendation:
   v1 keep all; add a 90-day cleanup cron later (pairs with the ping-bloat roadmap item).*
4. **Where the two pages live in the sidebar** — a new "Tracking Health" item vs a tab inside an
   existing screen. *Recommendation: new sidebar item under Location Tracking, since it's the
   admin's daily triage surface.*

## 11. Acceptance Criteria

**Functional**
- [ ] A punched-in agent on the updated app produces `device_health_snapshots` rows at punch-in,
      on foreground (throttled), and hourly with pings.
- [ ] `get_agent_tracking_health` returns correct expected/received/coverage and gaps for a known
      fixture day (verified in a rolled-back transaction).
- [ ] Each gap is classified to the right `issue_code` per §5.3 for constructed fixtures
      (battery-optimization, gps_off, bg_permission_missing, phone_died, not_punched_in).
- [ ] Triage list shows only agents needing attention (plus not-punched-in), worst-first.
- [ ] Per-agent view shows coverage %, gap timeline, device snapshot, and copyable fixes.
- [ ] Old-app agent (no heartbeat) still renders without error; device fields show "—".

**Code Quality**
- [ ] `npx tsc --noEmit` clean (web) and no new errors in touched mobile files (actually run).
- [ ] Issue copy lives in `tracking-issues.ts`, not in the database or scattered in JSX.

**Architecture**
- [ ] Coverage/gap logic in the RPCs (one source of truth); heartbeat writes via `SyncEngine`;
      `id` server-assigned, idempotency via `client_snapshot_id`.
- [ ] New dep (`react-native-device-info`) declared once; guarded so a missing/unknown value
      yields NULL, never a crash.

**Security**
- [ ] `device_health_snapshots` RLS enabled; cross-tenant SELECT returns `[]`.
- [ ] RPCs are SECURITY INVOKER; every query filters by `account_id`.

**Performance**
- [ ] Heartbeat is all-local reads; no new network poll; ping-reason snapshot throttled ~1/hour.
- [ ] Triage + detail queries are single round-trips / one RPC each (no N+1 across agents).

**Documentation**
- [ ] Handbook + PROJECT.md updated: new table, RPCs, issue-code catalog, the new dependency.

**Production Readiness**
- [ ] Migration additive, verified against existing data.
- [ ] New EAS build produced; release notes note device-health is forward-only.
- [ ] After deploy, a real punch-in on the new build produces a heartbeat and the per-agent view
      shows a real device snapshot.

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip
steps, and do not proceed past a "STOP AND ASK" trigger without an answer.

### Step 1 — Read before writing
1. Read the Engineering Handbook (stack, standards, offline architecture).
2. Read this whole spec, including Open Questions — especially #1 (the new dependency).
3. Search and reuse the files in §9 before writing anything new. Confirm the SyncEngine offline
   facts against the live repo (they've changed between audits).
4. Match existing naming/conventions by inspecting real files.

### Step 2 — STOP AND ASK triggers
- Open Question #1 (add `react-native-device-info`) is unresolved when you reach the heartbeat.
- The SyncEngine insert path couples the queue entityId to the DB `id` (must not, for the new
  table — same rule as `location_pings`).
- An `expo-device`/`expo-battery`/`expo-location` API you expected isn't available in the
  installed versions.
- You'd need a new library/pattern beyond the one named dependency.
- Changing a shared component/service/table in a way that affects other features.

### Step 3 — Implementation rules
- TypeScript strict, zero errors, no unjustified `any`.
- Reuse Before Create / Extend Before Replace.
- Match the data model + RPC contracts exactly; deviations are STOP AND ASK.
- RLS on the new table; every query/Realtime channel filters by `account_id`.
- Heartbeats must queue offline via `SyncEngine` and sync on reconnect with device timestamps.
- Any unavailable device signal → NULL, never a crash.

### Step 4 — Self-verification before "done"
Check every Section 11 item, category by category (Functional, Code Quality, Architecture,
Security, Performance, Documentation, Production Readiness). For anything you can't verify in
your environment (on-device heartbeat, real battery-optimization toggle), say so explicitly.
Actually run `npx tsc --noEmit` on web.

### Step 5 — Report back
1. What was built, mapped to this spec's sections.
2. Any deviations and why.
3. New conventions/dependencies introduced (for the handbook).
4. Acceptance Criteria not fully verified and why (especially on-device).
