# Feature Specification: Leave Management v1

**Status:** Confirmed
**Module:** Field Force / Team Management (new module; HRMS Evolution arriving early)
**Date:** 2026-08-17

---

## 1. Feature Overview

**Problem.** There is no way to record that an employee is off work. Today, [`attendance-status.ts`](../../../src/lib/location/attendance-status.ts) classifies any day with no punch session as **Absent**, in red. An admin looking at the attendance page cannot tell an approved holiday from a no-show. Approved sick days stay red forever. Half days look like misconduct: an employee who legitimately works only the afternoon is flagged **Short Present** and **Late Start**.

Confirmed by code search on 2026-08-17: **no leave table, page, RPC, or mobile screen exists in either repository.** This is a greenfield module.

**Business justification.** Every competitor in the Indian field-force/SFA space ships leave management, because attendance data without leave data is not usable for payroll or for performance conversations. Two existing pieces of the product are already waiting for it:

- The Monthly attendance tab renders **Leave** and **Holidays** columns that are hardcoded to `0` for every employee ([`attendance/page.tsx:232`](<../../../src/app/(dashboard)/location-tracking/attendance/page.tsx>)). Two dead columns already sit on screen.
- The reporting hierarchy (manager + approver, migration `106`) shipped on 2026-07-31 and is currently used for nothing except an expense suggestion. Leave approval is the first real consumer.

**Target use case.** SMB field teams of 5–100 reps. A rep applies from the phone — usually from the punch-in screen, because that is the screen they open at 9am when they realise they can't come in. Their manager or an admin approves from the web. The admin then reads the attendance page and sees the truth.

---

## 2. Scope

### In scope

**Configuration (Settings)**
- Leave Types: admin-defined, unlimited, per account. Name, colour, Active/Inactive. Saves as Active by default.
- Holiday Calendar: company-wide list of dated holidays.
- Working Days: replaces the hardcoded Monday–Friday week in the attendance code.

**Leave requests**
- Date range (`from_date` → `to_date`) in one request, with a per-day weightage: **Full / First Half / Second Half / Quarter**.
- Mandatory reason on every surface. Optional attachment on every leave type.
- Auto-numbered `LV-YYYY-NNNNNN`, searchable.
- Employees: today and future dates only. Admins: any date, including the past, on any employee's behalf.
- Overlapping requests blocked in the database.

**Approval**
- Statuses: Pending → Approved / Rejected / Cancelled; Approved → Cancelled.
- Approvers: the employee's reporting manager (any level up the chain) **and** any admin/owner **and** anyone holding `approve_leaves`.
- Rejection and admin cancellation require a reason.
- Employees may edit or withdraw their own request **only while Pending**.
- Every action written to an immutable activity log shown on the leave record.

**Attendance integration**
- Approved full-day leave → day reads **On Leave**, not Absent.
- Approved part-day leave → expected hours reduced; the corresponding punch is no longer flagged.
- Punching in on an approved leave day → allowed, with a warning, and the day carries a **Worked on Leave** flag.
- Holidays and non-working days get their own day statuses and are never counted as leave or absence.
- Monthly tab's `leave` and `holidays` columns become real.

**Surfaces**
- Web: Settings → Leave Settings; Location Tracking → **Leaves**; changes to the Attendance page.
- Mobile: Leaves list screen, Apply screen, leave detail, plus an entry point and conflict warning on the punch screen.

### Out of scope — do not build

- **Leave balances, quotas, accrual, carry-forward, encashment.** No allotment per type, no "8 of 12 remaining", no blocking when a notional balance runs out. The schema must not make this hard to add later, but nothing in v1 counts entitlement.
- **Paid vs unpaid classification** and anything payroll-facing.
- **Notifications** — no WhatsApp, no push, no email. Status is visible in-app only. (WhatsApp is blocked anyway: zero Meta-approved templates exist, and 10 of 13 profiles have no phone number.)
- **Multi-level / sequential approval chains.** One approval decides the request.
- **Two different leave types on the same day** (e.g. half casual + half unpaid). Deliberately blocked by the overlap constraint — see §8.
- **Compensatory off, work-from-home, short-leave/permission slips.**
- **Offline leave application.** See §6.
- **Leave in the generic report engine.** A future module-registry entry, not v1.

---

## 3. User Roles & Permissions

New flat permission keys, matching the format the current roles editor writes (`view_x` / `manage_x`, not the older nested shape):

| Key | Grants |
|---|---|
| `view_leaves` | See other employees' leave records. Everyone can always see their own without this key. |
| `manage_leaves` | Apply on another employee's behalf, backdate, edit or cancel someone else's request. |
| `approve_leaves` | Approve or reject. |

`owner` and `admin` short-circuit to true inside `has_permission`, as they do everywhere else.

| Role | Can see | Can do |
|---|---|---|
| **Owner / Admin** | All leave in the account | Create leave types, holidays, working days. Apply for anyone, including past dates. Approve, reject, edit, cancel anything — reason required for reject/cancel. May approve their own leave (a single-admin account would otherwise deadlock); the log records it as a self-approval. |
| **Reporting manager** (non-admin, appears in `get_reporting_chain` of the employee, at any depth) | Own leave + leave of everyone in their downline | Apply for themselves. Approve/reject anyone in their downline. **Cannot approve their own leave.** Cannot edit someone else's request. |
| **Agent / employee** | Own leave only | Apply for themselves, today or later. Edit or cancel their own request **while Pending only**. |
| **Viewer** | Own leave only | Apply for themselves. No approval rights. |

**Tenant isolation.** `leaves`, `leave_days`, `leave_types` and `holidays` all carry `account_id` with RLS enabled, following the `expenses` policy shape in `058_expense_management.sql`.

**Enforcement is server-side, not UI-only.** Approve, reject, cancel, edit and create all go through RPCs that call `has_permission`. This is deliberate and non-negotiable for this module: the backlog records that permissions across the app are currently enforced in the UI only, and mobile writes to tables directly. The Payment module's `require_*` settings were decorative for weeks for exactly this reason. Approving your own leave is precisely the action that must not be defensible only by a hidden button.

---

## 4. Data Model

Migration file: `supabase/migrations/20260817170000_leave_management.sql`. Additive only. Companion rollback note at `supabase/migrations/ROLLBACK-leave-management.md`, following the existing `ROLLBACK-*.md` convention.

### ⚠️ Two traps to get right before writing any SQL

1. **`profiles.id` is not `auth.uid()`.** `auth.uid()` matches `profiles.user_id`. Every ownership check must be written `employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())`, exactly as `expenses_select` does. Getting this wrong produces policies that silently return nothing.
2. **The `updated_at` trigger function in this repo is `update_updated_at_column()`**, not `set_updated_at()` as the handbook states. Verify against `058_expense_management.sql` and use the real one.

### 4.1 `leave_types`

Direct analogue of `expense_types`.

```sql
CREATE TABLE IF NOT EXISTS leave_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  status      TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_types_account_name
  ON leave_types (account_id, lower(name));
```

- Default `'Active'` satisfies "when admin clicks save it will be saved as active".
- Case-insensitive unique name per account — stops "Casual Leave" and "casual leave" coexisting. (This is the fix for the class of mess that produced `kg`/`Kg`/`KG` in `products.unit`.)
- RLS: SELECT for `is_account_member(account_id)`; INSERT/UPDATE/DELETE for `is_account_member(account_id, 'admin')`.
- No seed data. An account starts with an empty list and an empty state that says so.

### 4.2 `leaves` — the request header

```sql
CREATE TABLE IF NOT EXISTS leaves (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_number        TEXT NOT NULL,
  leave_type_id       UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  from_date           DATE NOT NULL,
  to_date             DATE NOT NULL,
  total_days          NUMERIC(5,2) NOT NULL,
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  applied_by          UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  is_backdated        BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_url      TEXT,
  attachment_name     TEXT,
  approved_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  rejected_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  cancelled_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leaves_date_order CHECK (to_date >= from_date),
  CONSTRAINT leaves_reason_present CHECK (length(btrim(reason)) > 0),
  CONSTRAINT leaves_number_unique UNIQUE (account_id, leave_number)
);
```

- `total_days` = sum of `leave_days.day_value` **after** holidays and non-working days are excluded. Stored, not derived on read, because the list view sorts and filters on it.
- `applied_by` distinguishes self-service from admin-on-behalf. Do not infer this from `employee_id` alone.
- `reason` is `NOT NULL` with a non-blank check — the mandatory-reason rule lives in the database, not only in three separate forms. Same lesson as the payment required-fields work.
- One optional attachment, not a child table. Payments needed many; a leave needs at most a certificate.
- Indexes: `(account_id, status)`, `(employee_id, from_date)`, `(account_id, from_date, to_date)`.

### 4.3 `leave_days` — one row per calendar day

This is the table attendance actually reads.

```sql
CREATE TABLE IF NOT EXISTS leave_days (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_id     UUID NOT NULL REFERENCES leaves(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_date   DATE NOT NULL,
  weightage    TEXT NOT NULL CHECK (weightage IN ('full','first_half','second_half','quarter')),
  day_value    NUMERIC(3,2) NOT NULL CHECK (day_value IN (1.00, 0.50, 0.25)),
  status       TEXT NOT NULL
                 CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_days_lookup
  ON leave_days (account_id, leave_date, status);
CREATE INDEX IF NOT EXISTS idx_leave_days_employee
  ON leave_days (employee_id, leave_date);

-- The overlap guard. A date can be covered by at most one live request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_days_no_overlap
  ON leave_days (employee_id, leave_date)
  WHERE status IN ('Pending','Approved');
```

**Why a row per day rather than a range.** The attendance page asks "who is on leave on this date?" for every employee for every day of a month. Against a range that is a non-indexable comparison per row; against `leave_days` it is one index hit. It also makes the overlap rule a database constraint instead of application logic, and makes future balance counting a `SUM(day_value)`.

**`status` is denormalised from the parent** so the attendance query never joins. Kept in sync by an `AFTER UPDATE ON leaves` trigger that cascades any status change to its `leave_days`. Rejected and Cancelled rows are retained (never deleted) so the history and the audit log stay intact, and they stop blocking the date because the unique index is partial.

`day_value` mapping — fixed, not configurable in v1: `full` → 1.00, `first_half` → 0.50, `second_half` → 0.50, `quarter` → 0.25.

- RLS mirrors `leaves` exactly, resolved through the parent row.

### 4.4 `holidays`

```sql
CREATE TABLE IF NOT EXISTS holidays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holidays_unique_date UNIQUE (account_id, holiday_date)
);
```

Company-wide only — no location-specific or role-specific holiday lists in v1. Each holiday is an explicit date; there is no recurring flag, because most Indian holidays (Diwali, Holi, Eid) move each year and a recurring flag would quietly produce wrong dates. Admins add next year's list next year. RLS: read for all members, write for admins.

### 4.5 Working days

Stored at `accounts.settings.tracking_settings.working_days` — an array of integers, `0` = Sunday through `6` = Saturday. It joins `start_time`, `end_time`, `interval_minutes` and `grace_minutes` in the same object, and `normalizeTrackingSettings()` in [`tracking-window.ts`](../../../src/lib/location/tracking-window.ts) must be extended to coerce and default it.

**Default: `[1,2,3,4,5,6]` — Monday to Saturday.**

> ⚠️ **This changes numbers already on screen, on the day it deploys.** `getWorkingDays()` in the attendance page currently hardcodes Monday–Friday ([`attendance/page.tsx:181`](<../../../src/app/(dashboard)/location-tracking/attendance/page.tsx>) skips `getDay() === 0 || === 6`). Switching the default to a six-day week raises every employee's Total Days by roughly four per month and lowers their presence percentage accordingly. The current figures are wrong for a six-day company, but the founder must be told the number moved rather than discovering it. **Antigravity: call this out explicitly in your completion report, and make the Working Days control visible in Settings so it can be corrected in one click if this company runs a five-day week.**

The hardcoded `getWorkingDays()` must be deleted and replaced by a shared helper that reads the setting and subtracts holidays. Put it in `src/lib/location/working-days.ts` — domain logic does not live in a React component.

### 4.6 Numbering

```sql
ALTER TABLE account_sequences ADD COLUMN IF NOT EXISTS leave_seq BIGINT DEFAULT 0;
```

`get_next_leave_number(p_account_id UUID)` returning `'LV-' || year || '-' || LPAD(seq, 6, '0')`, plus a `BEFORE INSERT` trigger, copied exactly from `get_next_payment_number` / `trg_set_payment_number` in `20260813170000_payment_collection_module.sql`. Do not invent a different mechanism.

### 4.7 Audit log — reuse, do not build

Every action writes to the existing **`module_activities`** table with `module_name = 'leave'` and `record_id` = the leave id. Do not create a `leave_audit_log` table.

Actions: `leave_applied`, `leave_edited`, `leave_approved`, `leave_rejected`, `leave_cancelled`. The `details` jsonb carries the before/after values for edits and the reason for rejections and cancellations.

> **Verify first:** `update_order_status` passes `record_id` as a `uuid` while `update_payment_status` passes `p_payment_id::text`. Check the real column type before writing the inserts, and match it.

---

## 5. API Contract

Three RPCs. All `SECURITY INVOKER`, so tenancy still holds through RLS and `auth.uid()` is the caller — the same choice made for `update_order_status` and `create_order`.

**Why RPCs at all, when the rest of the app inserts directly?** Four rules cannot be enforced client-side: the past-date restriction, the expansion of a date range into day rows, the overlap message, and the audit log entry. Mobile writes to tables directly throughout this codebase; a rule that lives only in a form is a rule that does not exist. That is exactly how the payment `require_*` toggles ended up decorative.

### 5.1 `create_leave_request`

```sql
create_leave_request(
  p_employee_id     UUID,        -- profiles.id; the caller's own profile for self-service
  p_leave_type_id   UUID,
  p_from_date       DATE,
  p_to_date         DATE,
  p_days            JSONB,       -- [{"date":"2026-08-20","weightage":"full"}, ...]
  p_reason          TEXT,
  p_attachment_url  TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL
) RETURNS JSONB
```

Validation, in order — each failure raises with a distinct, human-readable message:

| Check | Error |
|---|---|
| Caller is a member of the leave type's account | `Access denied` |
| `p_employee_id` ≠ caller's profile → requires `manage_leaves` | `You do not have permission to apply on someone else's behalf` |
| `p_from_date < CURRENT_DATE` → requires `manage_leaves` | `Leave cannot be applied for a past date` |
| Leave type exists, same account, `status = 'Active'` | `That leave type is not available` |
| `btrim(p_reason)` non-empty | `A reason is required` |
| `p_days` covers exactly the working, non-holiday dates in `[from, to]` — no gaps, no extras, no duplicates | `The selected days do not match the leave dates` |
| At least one day remains after holidays/weekly offs are removed | `This date range contains no working days` |
| No overlap (unique-index violation `23505` caught and rethrown) | `This employee already has leave on <date>` |

On success: inserts `leaves` (status `Pending`, `is_backdated` set when the range starts before today), inserts one `leave_days` row per entry in `p_days`, sets `total_days` to the sum, writes `leave_applied` to `module_activities`, returns the full leave row as jsonb.

**Antigravity must compute the eligible dates server-side too, not trust `p_days`.** The client sends what it thinks the days are; the RPC recomputes from the working-days setting and the holiday table and rejects a mismatch. A stale client with an old holiday list must not be able to book a holiday as leave.

### 5.2 `update_leave_status`

```sql
update_leave_status(
  p_leave_id   UUID,
  p_new_status TEXT,          -- 'Approved' | 'Rejected' | 'Cancelled'
  p_reason     TEXT DEFAULT NULL
) RETURNS JSONB
```

Allowed transitions — a `leave_status_transition_allowed(from, to)` `IMMUTABLE` function, mirroring `payment_status_transition_allowed`:

```
('Pending','Approved'), ('Pending','Rejected'), ('Pending','Cancelled'), ('Approved','Cancelled')
```

Authorisation:

- **Approve / Reject** requires: `has_permission(auth.uid(), account_id, 'approve_leaves')` **OR** `is_in_downline(<caller profile id>, leaves.employee_id)` (migration `106`, already live — reuse it, do not write new recursion).
- **Self-approval:** rejected for a non-admin manager acting on their own request. Permitted for owner/admin, because a single-admin account must not deadlock; the log entry records `"self_approved": true`.
- **Cancel** requires: the leave is the caller's own and still `Pending`; **or** `manage_leaves` / admin.
- `p_reason` is mandatory for `Rejected`, and for `Cancelled` when the canceller is not the employee themself.

On success: updates the corresponding `*_by` / `*_at` / reason fields, lets the cascade trigger update `leave_days.status`, writes the matching `module_activities` action, returns the updated row.

### 5.3 `update_leave_request`

```sql
update_leave_request(
  p_leave_id        UUID,
  p_leave_type_id   UUID,
  p_from_date       DATE,
  p_to_date         DATE,
  p_days            JSONB,
  p_reason          TEXT,
  p_change_reason   TEXT DEFAULT NULL
) RETURNS JSONB
```

- Employee editing their own **Pending** request: allowed, `p_change_reason` not required.
- Anyone else, or any request not `Pending`: requires `manage_leaves`, and `p_change_reason` is **mandatory**.
- Editing a `Rejected` or `Cancelled` request is rejected outright — apply again instead.
- Re-runs every validation from §5.1, deletes and re-inserts the `leave_days` rows inside the same transaction (so the overlap index re-checks naturally), and writes `leave_edited` with a before/after diff in `details`.
- Editing an **Approved** leave keeps it Approved. It does not silently return to Pending — the admin who edited it is the approver, and the log says so.

### 5.4 Reads

Plain PostgREST queries against `leaves`, `leave_days`, `leave_types` and `holidays`, protected by RLS. No read RPC. The list view embeds:

```
leaves: '*, leave_type:leave_types(id,name,color), employee:profiles!leaves_employee_id_fkey(id,full_name), days:leave_days(leave_date,weightage,day_value)'
```

> **Verify the FK name before using an embed.** `leaves_employee_id_fkey` is the expected constraint name but must be confirmed against the created schema — a wrong embed name is a PostgREST error, and this codebase has already lost a day to exactly that (`site_visits` → `leads`, and `leads.company`).

---

## 6. Mobile Behavior

### Online only — a deliberate decision, and it must be enforced, not assumed

Leave application **does not** go through `SyncEngine`. Do not call `enqueueMutation` anywhere in this feature.

The reason is not laziness about offline support: overlap validation and the past-date rule can only run on the server. A queued request that syncs two days later and is then rejected for clashing leaves the rep believing they have applied. They don't show up. Nobody knows why. A leave application is planned work, not an urgent capture like a punch-out — requiring signal is the honest trade.

Implementation:

- Before submitting, check connectivity through the existing `NetworkMonitor` / `@react-native-community/netinfo` wiring in `src/core/SyncEngine/`.
- Offline → block the submit and show, via the existing `showAppDialog` (**not** `Alert.alert` — 55 native popups were replaced app-wide; do not reintroduce one): *"You need an internet connection to apply for leave. Your details have been kept — try again when you're back online."* Keep the form populated.
- The leave **list** may read from cache and show a stale-data banner; only the write is gated.

### Leave types offline

Load them with the existing `useReferenceList('leave_types', …)` hook, which paints instantly from an AsyncStorage cache and refreshes in the background. Same treatment Leads gives `lead_statuses`. The picker must not be blank on a cold, slow start.

### Screens

| Path | Purpose |
|---|---|
| `app/leaves/index.tsx` | List of the user's leaves (admins see everyone). Status pill per row. Search icon → filter by leave number and type. Filter button → From date, To date, weightage, leave type, status, with an active-filter count badge. `+` → apply. |
| `app/leaves/new.tsx` | Apply form. |
| `app/leaves/[id].tsx` | Detail: dates, per-day weightage, type, reason, attachment, status, and the full activity log. Cancel button while Pending. |
| `app/(tabs)/menu.tsx` | New "Leaves" entry. Do **not** add a sixth tab — the tab bar is full. |
| `app/punch.tsx` | See below. |

Model the list screen on [`app/(tabs)/leads.tsx`](../../../../wacrm-mobile/app/(tabs)/leads.tsx) — it already has the search field, the filter modal, the `activeFiltersCount` badge and the pull-to-refresh this screen needs. Do not write a new list pattern.

### Punch screen changes

Both changes go in [`app/punch.tsx`](../../../../wacrm-mobile/app/punch.tsx), which already renders a main title and a primary "Start Punch In" button around line 753.

1. **Entry point.** A secondary text action beneath the primary button — *"Can't come in? Apply for leave"* — routing to `app/leaves/new.tsx`. Only shown when there is no active session (a punched-in rep is not applying for today's leave). It must not compete visually with Punch In: the handbook requires the critical action to stay the high-contrast one.
2. **Conflict warning.** On tapping Punch In, check for an Approved `leave_days` row for this user and today. If one exists, show a confirm dialog first: *"You're on approved <type> leave today. Punch in anyway?"* — Cancel / Punch In Anyway. Proceeding is allowed and the punch behaves exactly as normal; the flag is derived later on the web side from the overlap of a session and an approved leave day (see §7). **Nothing new is written to `tracking_sessions`.** A network failure on this lookup must not block punching in — fail open, log it, and let the rep punch in. Blocking attendance because a leave check timed out would be a far worse bug than a missing warning.

### Not touched

No changes to background location, the foreground service, battery behaviour, or ping intervals. No new native permissions. No new dependency.

---

## 7. UI States

### 7.1 Settings → Leave Settings (new section)

Add `leave_types` to `SETTINGS_SECTIONS` and `SECTION_META` in [`settings-sections.ts`](../../../src/components/settings/settings-sections.ts), group `workspace`, label "Leave Settings", icon `CalendarOff`. New panel `src/components/settings/leave-types-settings.tsx`, built from `expense-types-settings.tsx` — same two-column layout, same dialog-based add/edit, same Active/Inactive pill.

- **Left column:** leave type list. Empty → an icon, "No leave types configured", and an Add button. Populated → name, colour dot, Active/Inactive pill, edit and delete.
- **Right column:** Holiday Calendar card — year selector, dated list, add/remove. Empty → "No holidays added for 2026."
- **Delete of a used type:** the `ON DELETE RESTRICT` error is caught and shown as *"This leave type is used by existing leave records and can't be deleted. Set it to Inactive instead."* Same treatment `expense_types` gives today.
- **Deactivating a type** hides it from every new-request picker and leaves existing records untouched and still readable.
- **Non-admin** reaching the section: the rail entry is hidden, and direct navigation renders the standard read-only state.

**Working Days** goes in **Organisation Settings** ([`module-settings.tsx`](../../../src/components/settings/module-settings.tsx)), directly alongside the existing shift start, shift end and grace period — it belongs to the same `tracking_settings` object and the same mental model. A seven-checkbox row, Sun–Sat. Saving zero working days is rejected in the form.

### 7.2 Location Tracking → Leaves (new page)

Route `src/app/(dashboard)/location-tracking/leaves/page.tsx`. Sidebar entry immediately after "User Attendance" in [`sidebar.tsx:348`](../../../src/components/layout/sidebar.tsx), `module: "location_tracking"`, icon `CalendarOff`.

Built with the existing `<DataTable>` from `src/components/ui/data-table/` — sorting, per-column filters, manage-columns and CSV export come with it. Columns: Leave No · Employee · Type (colour pill) · From · To · Days · Weightage summary · Reason · Status · Applied On · Actions.

| State | Behaviour |
|---|---|
| Loading | Table skeleton, matching the other Location Tracking pages. No white flash in dark mode. |
| Empty (no leave at all) | "No leave records yet" with an Apply Leave button. |
| Empty (filters exclude everything) | "No leave matches these filters" + Clear filters. Never the same message as above — they need different actions. |
| Populated | Status as a colour pill: Pending amber, Approved green, Rejected red, Cancelled grey. |
| Row click | Detail sheet: full request, per-day weightage breakdown, attachment link, and the activity log newest-first — "Approved by Sumit on 17 Aug 2026, 4:12 PM". |
| Pending row, user may approve | Approve and Reject buttons. Reject opens a reason dialog; empty reason cannot submit. |
| Approved row, admin | Cancel (reason required) and Edit. |
| Own Pending row, any user | Edit and Withdraw. |
| No rights | Buttons rendered through `<GatedButton>` so they are disabled with a "Read Only" tooltip rather than missing. |
| Save error | Sanitised message via `toast.error`. Never a raw Postgres error. |
| Permission denied from the RPC | *"You don't have permission to approve leave."* The row does not change state optimistically — wait for the server. |

**Apply Leave dialog** (same component serves web self-service and admin-on-behalf): Employee (locked to self unless `manage_leaves`) · Leave Type (Active only) · From · To · a per-day weightage list generated from the range, with holidays and weekly offs shown greyed and labelled *"Holiday — Diwali"* / *"Weekly off"* and excluded from the total · Reason (required, submit disabled while blank) · optional attachment · a live "Total: 2.5 days" summary.

**Scope:** a user without `view_leaves` sees only their own rows — enforced by RLS, not by a client-side filter.

### 7.3 Attendance page changes

Daily tab: a new **On Leave** badge replaces Absent for a full-day approved leave, showing the type name. Part-day leave shows the day's real badges plus a **Half Day (Approved)** marker. A session on an approved leave day adds a **Worked on Leave** warning badge. Holidays and weekly offs get their own neutral badges instead of red Absent.

Monthly tab: `leave` becomes the summed `day_value` of approved leave days in the month; `holidays` becomes the real count; `totalWorkingDays` becomes configured working days minus holidays; `absent` becomes `totalWorkingDays − present − leaveDays`, floored at zero.

Filters: `ATTENDANCE_STATUS_OPTIONS` gains "On Leave", "Holiday", "Weekly Off" and "Worked on Leave" so an admin can pull up exactly those days.

---

## 8. Edge Cases & Failure Scenarios

| # | Scenario | Expected behaviour | Severity |
|---|---|---|---|
| 1 | Employee applies over a date already covered by a Pending request | Blocked by the partial unique index; message names the clashing date | Blocker |
| 2 | Same, but the existing request is Rejected or Cancelled | Allowed — the partial index ignores dead rows | Blocker if wrong |
| 3 | Two admins approve the same request simultaneously | Transition check runs inside the RPC; the second sees "already Approved" and the UI refreshes. No double log entry | Blocker |
| 4 | Employee applies for a past date | Rejected with `Leave cannot be applied for a past date` | Blocker |
| 5 | Admin applies for a past date on the employee's behalf | Allowed; `is_backdated = true`; the attendance page for that past day flips from Absent to On Leave on next read | Blocker if wrong |
| 6 | Range covers only Sundays and a holiday | Rejected: `This date range contains no working days` | Warning |
| 7 | Range spans a holiday in the middle (Fri–Tue with Monday a holiday) | Monday excluded, not counted in `total_days`, and shown greyed in the picker | Blocker |
| 8 | Admin adds a holiday **after** leave was approved across that date | The existing `leave_days` row stays — an approved leave is not silently rewritten. The attendance page shows Holiday for the day, and the leave keeps its original `total_days`. Recomputation is a v2 concern | Info |
| 9 | Employee punches in on an approved full-day leave | Warning, allowed; day shows Present + Worked on Leave | Warning |
| 10 | Employee on first-half leave punches in at 13:30 | Effective shift start moves to the shift midpoint → **not** Late Start | Blocker |
| 11 | Employee on second-half leave punches out at 13:30 | Effective shift end moves to the midpoint → **not** Early Leaving | Blocker |
| 12 | Quarter-day leave | Expected minutes × 0.75; `early_leaving` suppressed; no which-quarter concept exists | Warning |
| 13 | Non-admin manager approves their own leave | Rejected: `You cannot approve your own leave` | Blocker |
| 14 | Sole admin approves their own leave | Allowed; log records `self_approved: true` | Blocker if wrong |
| 15 | Manager is deactivated with requests pending | `is_in_downline` still resolves; any admin can approve. Nothing gets stuck | Warning |
| 16 | Employee profile deleted with leave records | `ON DELETE CASCADE` removes their leave, matching `expenses` | Info |
| 17 | Leave type deactivated while a request referencing it is Pending | Request unaffected and still approvable; the type is only hidden from new pickers | Blocker |
| 18 | Leave type deleted while referenced | `ON DELETE RESTRICT` blocks it; the UI says to deactivate instead | Warning |
| 19 | Mobile submit with no connectivity | Blocked with a clear message; form retained; nothing queued | Blocker |
| 20 | Leave lookup fails on punch-in (network) | Fail open — punch in proceeds without the warning; error logged | Blocker |
| 21 | Reason submitted as spaces only | Rejected by the `btrim` check at both form and database | Blocker |
| 22 | Attachment upload succeeds, leave insert fails | No orphan reference; the leave is not created and the user is told to retry. Upload happens **before** the RPC and the URL is passed in | Warning |
| 23 | Range of 200 days | Accepted; 200 rows inserted in one transaction. Consider a sanity cap of 366 days | Info |
| 24 | Two half-day leaves of different types on one day | **Not supported in v1** — blocked by the overlap index. Message must say so plainly, not just "already has leave" | Info |
| 25 | Employee edits their Pending leave to a range that now clashes | Re-validated on edit; the old day rows are removed and re-inserted in the same transaction so the index check is accurate | Blocker |
| 26 | Admin sets working days to a week that excludes an already-approved leave day | Approved leave is not rewritten (as #8). Attendance shows Weekly Off for that day | Info |
| 27 | Timezone: leave applied late evening from a phone | All leave fields are `date`, never `timestamptz`. Build date strings from local calendar parts, **never `toISOString()`** — the attendance code already carries this warning at `localDayKey` for exactly this reason | Blocker |

---

## 9. Reuse Check

**Antigravity must read these files before writing any new code.** Every one is a working implementation of something this spec needs.

**Web**
- `src/components/settings/expense-types-settings.tsx` — the Leave Types panel is this file with different fields.
- `src/components/settings/settings-sections.ts` — how a settings section registers.
- `src/components/settings/module-settings.tsx` — where Working Days goes and how `accounts.settings` is written.
- `src/components/ui/data-table/` — the Leaves table. Do not hand-roll one.
- `src/components/ui/gated-button.tsx` — permission-gated buttons.
- `src/lib/location/attendance-status.ts` + `attendance-status.test.ts` — the engine being extended, and its existing tests.
- `src/lib/location/tracking-window.ts` — `TrackingSettings` and `normalizeTrackingSettings`.
- `src/app/(dashboard)/location-tracking/attendance/page.tsx` — the page being modified; note `getWorkingDays` at line ~171 and `leave: 0` at line ~232.
- `src/lib/reporting/api.ts` — `getApprover`, `getReportingChain` already wrapped for the client.
- `src/components/layout/sidebar.tsx:342-349` — the Location Tracking nav group.

**Database**
- `058_expense_management.sql` — table + RLS + `update_updated_at_column` shape to copy.
- `086_order_status_lifecycle.sql` — `has_permission` and the `update_order_status` RPC shape.
- `20260813170000_payment_collection_module.sql` — numbering trigger and `update_payment_status`.
- `106_reporting_hierarchy.sql` — `is_in_downline`, `get_approver`, `get_reporting_chain`. **Reuse these. Do not write new recursive traversal.**

**Mobile**
- `app/(tabs)/leads.tsx` — list + search + filter modal + filter count badge.
- `src/hooks/useReferenceList.ts` — offline-cached lookup lists.
- `src/components/ui/Select.tsx`, `GlassDateTimePicker.tsx`, `Badge.tsx`, `Search.tsx`, `FilterChips.tsx`.
- `src/components/ui/AppDialog.tsx` / `AppToast.tsx` — `showAppDialog`, `showToast`, `showAppPrompt`. **No `Alert.alert` and no `Alert.prompt`** — the latter is iOS-only and this is an Android-only app.
- `app/punch.tsx` — the screen being extended.
- `app/(tabs)/menu.tsx` — where the Leaves entry goes.

**Explicitly do not create:** a new audit-log table (use `module_activities`), a new permission function (use `has_permission`), a new hierarchy walker (use `is_in_downline`), a new numbering scheme (copy the payment one), a new mobile list pattern, a new date picker, or a `leave_balances` table.

---

## 10. Open Questions

None blocking. All decisions were confirmed with the founder on 2026-08-17. Three items were deliberately deferred and are logged in the backlog rather than left ambiguous here:

1. **Paid vs unpaid leave types.** A one-boolean addition, needed the moment payroll or balances arrive. Left out of v1 to avoid a field nothing reads.
2. **Recomputation when a holiday is added over already-approved leave** (edge cases 8 and 26). v1 leaves approved records untouched — the correct conservative choice, but a v2 should offer the admin a recompute action.
3. **Leave in the generic report engine.** The module-alias pattern used for `sales` would make a leave report cheap later.

---

## 11. Acceptance Criteria

### Functional
- [ ] Admin creates a leave type; it saves as **Active** with no extra step. Deactivating removes it from new-request pickers only.
- [ ] Deleting a used leave type fails with the friendly message, not a raw error.
- [ ] Employee applies for a 3-day range with half-day on the first day; `total_days` = 2.5; three `leave_days` rows exist with correct weightages.
- [ ] Reason cannot be blank on web, mobile, or the punch-screen entry — verified by attempting a spaces-only submit against the database directly, not just the form.
- [ ] Employee cannot apply for yesterday. Admin can, and `is_backdated` is set.
- [ ] Overlapping request is refused, and the message names the clashing date.
- [ ] Manager approves a direct report's leave; a second-level manager can too; a non-admin cannot approve their own.
- [ ] Rejection without a reason is impossible.
- [ ] Employee edits and withdraws their own Pending request; cannot touch it once Approved.
- [ ] Admin cancels an Approved future leave with a reason; the date becomes available again.
- [ ] The leave record shows every action with actor and timestamp.
- [ ] Attendance Daily tab shows **On Leave** for an approved full-day leave that previously read Absent.
- [ ] First-half leave + 13:30 punch-in produces no Late Start flag; second-half leave + 13:30 punch-out produces no Early Leaving flag.
- [ ] Punching in on an approved leave day warns, allows, and flags the day.
- [ ] Monthly tab shows real Leave and Holidays figures; Total Days reflects configured working days minus holidays.
- [ ] Mobile: list, search by leave number and by type, all five filters, apply, view, cancel.
- [ ] Mobile offline: submit is blocked with the message, the form keeps its contents, and nothing enters the sync queue.
- [ ] Punch-in still works when the leave lookup fails.

### Code Quality
- [ ] `npx tsc --noEmit` in **both** repos, run in a real terminal, output pasted into the report. Zero new errors against the current baseline (web: 0; mobile: 1 pre-existing in `Search.tsx`). "Manually structure-checked" is not acceptable — this has been claimed before and was not equivalent.
- [ ] No `any` without a comment explaining why a real type is impossible.
- [ ] No business logic inside React components — day expansion, weightage maths and working-day calculation live in `src/lib/`.
- [ ] No raw `<button>`/`<input>` on web; no `Alert.alert`/`Alert.prompt` on mobile.

### Architecture
- [ ] Reuses `module_activities`, `has_permission`, `is_in_downline`, `account_sequences`, `<DataTable>`, `useReferenceList`. Any new equivalent is a spec violation and must be undone.
- [ ] `getWorkingDays` deleted from the page component and replaced by the shared helper.
- [ ] The attendance engine keeps taking pure inputs — no data fetching inside `attendance-status.ts`.

### Testing
- [ ] New vitest cases in `attendance-status.test.ts` covering: full-day leave → On Leave; first-half and second-half suppression; quarter-day; worked-on-leave; holiday; weekly off; and **regression cases proving days with no leave classify exactly as they do today**.
- [ ] Unit tests for the day-expansion helper: range across a weekend, range across a holiday, single day, range with no working days.
- [ ] Every §8 edge case exercised against the live schema in a **rolled-back transaction**, per the established practice, with the results listed one by one.
- [ ] The full web test suite still passes; report the before and after counts (currently ~1013).

### Security
- [ ] RLS enabled on all four new tables, policies written with `employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())` — never `employee_id = auth.uid()`.
- [ ] Cross-tenant check: a member of account A querying account B's leave returns `[]`.
- [ ] Direct-call check: a plain PostgREST `UPDATE` setting `status = 'Approved'` from an agent's token is refused. Approval is only possible through the RPC.
- [ ] An agent calling `update_leave_status` on a colleague outside their downline is refused.
- [ ] Trigger functions revoked from `anon`, following `20260816201000_revoke_trigger_functions_from_anon.sql`.

### Performance
- [ ] The attendance month view issues **one** query for the month's leave days, not one per employee or per day. N+1 is a rejection.
- [ ] `idx_leave_days_lookup` is used by the attendance query — confirm with `EXPLAIN`.

### Documentation
- [ ] `wacrm-web/PROJECT.md` updated with the module, its tables, and its permission keys.
- [ ] `ROLLBACK-leave-management.md` written before the migration is applied.
- [ ] The working-days default change flagged prominently in the completion report.
- [ ] Handbook corrections reported: the real trigger function is `update_updated_at_column()`, and the Monthly attendance tab's hardcoded Mon–Fri week.

### Production Readiness
- [ ] Migration is additive, uses `IF NOT EXISTS`, drops nothing, and is applied to production only after the rolled-back dry run passes.
- [ ] Existing attendance figures verified before and after on real data, with the working-days difference explained rather than absorbed silently.
- [ ] Core loop regression: punch in → track → visit → expense still works end to end.
- [ ] **Device test required before this is called done.** The punch-screen changes are on the single most important screen in the product; mobile payment collection has still never run on a phone, and that lesson applies here.

---

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything

1. Read the full Engineering Handbook for the current tech stack, architecture principles, and code standards.
2. Read this entire specification, including §8 Edge Cases and §10 Open Questions.
3. Search the existing codebase before writing new code. Specifically read every file listed in §9 Reuse Check — in particular `expense-types-settings.tsx`, `attendance-status.ts`, `058_expense_management.sql`, `086_order_status_lifecycle.sql`, `106_reporting_hierarchy.sql`, `20260813170000_payment_collection_module.sql`, `app/(tabs)/leads.tsx`, and `app/punch.tsx`.
4. Identify the naming conventions actually used by inspecting real files — do not assume. Note specifically that this repo's updated-at trigger is `update_updated_at_column()`, not the `set_updated_at()` the handbook claims.
5. **Do not assume offline support.** This feature is deliberately **online-only** on mobile (§6). Do not wire it into `SyncEngine.enqueueMutation`. If you believe offline support is needed, that is a STOP AND ASK, not a decision to make while implementing.
6. Verify before relying on: the `record_id` column type in `module_activities`; the generated FK constraint name before any PostgREST embed; and that `is_in_downline` / `get_approver` still exist as described in migration `106`.

### Step 2 — STOP AND ASK triggers

Do not guess or silently choose a default in any of these situations. Stop and ask a specific question instead:

- Anything in §10 Open Questions becomes relevant to the code you are writing.
- You find existing code that conflicts with this spec — for example an existing leave-shaped table, or an attendance rule this spec contradicts.
- The spec does not specify behaviour for a case you hit while implementing, especially an error state or a permission edge.
- You are about to add a library, dependency, or pattern not already used in the repo.
- You are about to change shared code in a way that could affect other features. **`attendance-status.ts` is shared by the daily view, the monthly view and the health pages — any change to its existing behaviour for days without leave is a STOP AND ASK.**
- Your validation of the existing attendance numbers disagrees with what §4.5 predicts.

Ask a specific, answerable question — not "should I proceed?" but e.g. "The spec says a quarter-day suppresses `early_leaving` but not `late_start`. For a rep whose only session is 09:00–11:00 on a quarter-day leave, should Short Present still apply against the reduced 6.75-hour expectation?"

### Step 3 — Implementation rules

- TypeScript strict: zero new errors, no `any` unless justified in a comment.
- Reuse Before Create / Extend Before Replace. If you wrote new code where existing code could have been extended, undo it and extend instead.
- Match the data model and API contract exactly. A deviation is a STOP AND ASK, not a judgment call.
- Respect multi-tenant isolation on every new table and query. Application-level filtering is never sufficient.
- Every rule that matters must be enforced in the database, not only in a form. Three separate forms will write to these tables and mobile writes directly; a validation that exists only in React does not exist.
- Suggested build order: migration + RPCs → dry-run verification of §8 → attendance engine + tests → web Settings → web Leaves page → attendance page → mobile.

### Step 4 — Self-verification before declaring done

Check every item in §11 against every Definition of Done category — Functional, Code Quality, Architecture, Testing, Security, Performance, Documentation, Production Readiness — and confirm category by category, not "looks good". Any item you could not verify (device testing, for example) must be stated as unverified rather than marked done. Paste the real `tsc` output and the real test counts.

### Step 5 — Report back

1. What was implemented, mapped to the sections of this spec.
2. Any deviations and why.
3. Any new conventions discovered or introduced, for the handbook.
4. Any Acceptance Criteria that could not be fully verified, and why.
5. **The working-days impact, stated explicitly:** the before and after Total Days and presence percentage for the existing employees, so the founder sees the change rather than discovering it.
