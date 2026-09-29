# Feature Specification: OZZO FSM Phase 1 + 2 — Customer Assets, Complaints & Job Assignment

**Status:** **Confirmed** — architecture approved by founder 2026-09-29, with three changes folded in
(customer snapshots on assets, job category master, technician-created-job readiness) and five open
questions answered. Only pricing remains open, and it blocks nothing here.
**Module:** New product line — FSM (Field Service Management), 4th line, includes WFA
**Date:** 2026-09-29
**Supersedes for scope:** the 9-phase build map (https://claude.ai/artifact/VCKxTiGN99C8UNZh8y4Lkq)
is the long-range plan. This spec covers only its Phase 1 and Phase 2, web only.

---

## 1. Feature Overview

**Problem.** OZZO can track where a field person is and what they sold, but has no concept of
*a thing that gets serviced*. A water-purifier dealer with 400 installed units has nowhere to
record those units, nowhere to log "unit at Flat 302 is leaking", and no way to route that
complaint to the technician who covers that area. Today this lives in WhatsApp groups and
notebooks.

**Business justification.** FSM is a new sellable product line. Competitor Fieldy publishes
₹6,000–15,000 per user per year in India for this category; OZZO's most expensive plan today is
₹300 per user per month. The category is proven and price-tolerant. This spec is the smallest
slice that demos credibly: a complaint arrives, gets attached to a real machine, and lands on
the right technician.

**Target use case / industries.** Indian service SMBs with an installed base: water treatment
and RO, elevators, CCTV and security systems, power backup and UPS, HVAC, pest control, home
appliances. The common shape is 50–2,000 installed units, 3–30 technicians, territory-based
coverage.

**Why an asset, not just a customer.** After six months a customer may own five pumps, three
motors and two generators. Service history attached to the *customer* is meaningless; attached
to the *asset* it tells you which unit keeps failing. The chain is
`Customer → Asset → Service Job → Visits`, never `Customer → Service Job`.

---

## 2. Scope

### In scope

**Phase 1 — Customer Assets**
- `asset_types` master (per tenant, configurable)
- `customer_assets` table with serial number, installation date, warranty start/end, status
- Customer name and phone **snapshots** on the asset, for history and search only
- Asset list screen with filters and soft-delete / Show-Inactive parity
- Asset detail screen
- Asset list panel under each Customer, with inline "Add Asset"
- Asset import through the existing Universal Import Framework

**Phase 2 — Complaints and Service Jobs**
- Single `service_jobs` table. A complaint **is** a job with `source = 'complaint'`.
- `source` enum: complaint, preventive_maintenance, amc, installation, inspection, internal
- `intake_channel` enum: phone, whatsapp, walk_in, email, internal
- `job_categories` master and a nullable `job_category_id` on the job (work type, e.g. Electrical,
  Mechanical, Breakdown). Optional, may go unused at launch.
- Status lifecycle: open → assigned → in_progress → on_hold → completed / cancelled
- Priority, SLA due timestamp, SLA breach surfacing
- Notes (threaded list) and Attachments (file upload)
- **Manual assignment** and **Area-Based assignment**, the latter resolving through the
  existing `territories` tree and `employee_area_assignments`
- Job list, "Log Complaint" create screen, job detail screen
- Service settings screen: asset types, SLA hours per priority, job-number prefix
- Rights registry entries, plan gating for the new `fsm` line, RLS on every new table

### Out of scope — do not build

- **AMC / contracts** of any kind. `source = 'amc'` exists in the enum so the column never needs
  migrating; nothing reads or writes it in this phase.
- **Billing, invoices, quotations, payments.**
- **Service Visits.** The stated goal chain ends at Service Visit, but neither Phase 1 nor
  Phase 2 specifies it. Visits are Phase 3. See §13 for the hooks this spec deliberately leaves.
- **Mobile app.** Web only. See §6.
- **Reports and dashboards.** The job list's own filters are the only analytics in this phase.
- **Marketing pages, landing pages, WhatsApp templates, customer notifications.**
- **Checklists, parts consumption, signatures, job report PDF.**
- **Custom fields on assets or jobs. Hard reject for v1**, founder ruling 2026-09-29. Every SaaS
  dies on "add Motor HP", then "add Compressor PSI", then fifty more. Ship first. Do not add an EAV
  path for assets or jobs, and do not register them as custom-field entity types.
- **Complaint → Job conversion.** Explicitly rejected by the founder on 2026-09-29. One record.
- **`parent_job_id` workflow.** The column ships; no UI exposes it.

---

## 3. User Roles & Permissions

| Role | Can see | Can do | Tenant / RLS implication |
|---|---|---|---|
| Owner / Admin | All assets and jobs in the account | Everything, including service settings and asset types | Existing owner/admin bypass in `has_permission()` applies |
| Service Manager (new default role) | All assets and jobs | Create/edit assets and jobs, assign (both modes), change status, cancel, manage notes and attachments. Not service settings unless granted | Scoped by `account_id` only |
| Dispatcher (new default role) | All jobs, read-only assets | Create jobs, assign, change status. Cannot delete assets or jobs | Scoped by `account_id` only |
| Technician (new default role) | Assets belonging to customers in their assigned areas; jobs assigned to them | Change status on own jobs (in_progress, on_hold, completed), add notes and attachments. **`create_service_jobs` is grantable but OFF in the default Technician role** — founder ruling: technicians may log complaints only when the tenant switches it on. Cannot assign, cannot cancel | **Data-scope directional RLS**, same pattern as `site_visits` / `orders`. The INSERT policy must be permission-based, never admin-only — see §4.12 |
| Viewer | Read-only | Nothing. Never granted `create_service_jobs` | Scoped by `account_id` only |

New permission keys to add to `src/lib/auth/permissions-registry.ts`:

```ts
SERVICE_ASSETS: {
  VIEW: 'view_service_assets',
  CREATE: 'create_service_assets',
  EDIT: 'edit_service_assets',
  DELETE: 'delete_service_assets',
  IMPORT: 'import_service_assets',
  EXPORT: 'export_service_assets',
},
SERVICE_JOBS: {
  VIEW: 'view_service_jobs',
  CREATE: 'create_service_jobs',
  EDIT: 'edit_service_jobs',
  DELETE: 'delete_service_jobs',
  ASSIGN: 'assign_service_jobs',
  CHANGE_STATUS: 'change_service_job_status',
  CANCEL: 'cancel_service_jobs',
  MANAGE_NOTES: 'manage_service_job_notes',
  MANAGE_ATTACHMENTS: 'manage_service_job_attachments',
},
SERVICE_SETTINGS: {
  MANAGE: 'manage_service_settings',
},
```

**Plan gating.** In `src/lib/plans/catalog.ts`:
- `ProductLine` gains `"fsm"`.
- `PlanId` gains `"FSM"`, `"CRM_FSM"`, `"SFA_FSM"`.
- `PLAN_LINES`: `FSM: { crm:false, wfa:true, sfa:false, fsm:true }`,
  `CRM_FSM: { crm:true, wfa:true, sfa:false, fsm:true }`,
  `SFA_FSM: { crm:false, wfa:true, sfa:true, fsm:true }`.
  FSM includes WFA, exactly as SFA does.
- `ModuleKey` gains `"service"`; `MODULE_LINE.service = "fsm"`.
- `PLAN_PRICE` entries are required by the type. Use placeholders `FSM: 500, CRM_FSM: 600,
  SFA_FSM: 800` and flag in the PR that these are **unconfirmed** — see §10 Open Question 1.
- The DB backstop `account_has_line` must accept `'fsm'`.

---

## 4. Data Model

Conventions this follows, verified in the repo — do not deviate:
- Sequential timestamped migrations in `supabase/migrations/`, `IF NOT EXISTS` everywhere.
- Named Postgres enums (matching `territory_status` precedent), not text + CHECK.
- Soft delete via `deleted_at timestamptz NULL`; unique indexes are partial on `deleted_at IS NULL`.
- Every RLS policy wraps the auth call as `(select auth.uid())` — bare `auth.uid()` re-plans per
  row and was the subject of a 157-policy performance migration. Do not regress it.
- Every foreign key gets a covering index. A 124-index migration exists for exactly this reason.
- Every `SECURITY DEFINER` function sets `SET search_path = public` on the same line.

### 4.1 Enums

```sql
CREATE TYPE asset_status              AS ENUM ('active','under_repair','replaced','scrapped','inactive');
CREATE TYPE service_job_source        AS ENUM ('complaint','preventive_maintenance','amc','installation','inspection','internal');
CREATE TYPE service_job_channel       AS ENUM ('phone','whatsapp','walk_in','email','internal');
CREATE TYPE service_job_priority      AS ENUM ('low','medium','high','critical');
CREATE TYPE service_job_status        AS ENUM ('open','assigned','in_progress','on_hold','completed','cancelled');
CREATE TYPE service_assignment_type   AS ENUM ('manual','area_based');
```

**`source` vs `intake_channel` — these are two different axes and both contain "internal".**
`source` answers *why the job exists*. `intake_channel` answers *how it reached us*. The founder's
brief labelled the phone/WhatsApp/walk-in/email/internal list "Complaint Sources"; it is stored as
`intake_channel` because `source` is already the complaint/AMC/installation axis. Do not merge them.

### 4.2 `asset_types`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `default gen_random_uuid()` |
| account_id | uuid NOT NULL | FK `accounts(id)` ON DELETE CASCADE |
| name | text NOT NULL | `CHECK (btrim(name) <> '')` |
| code | text NULL | optional short code |
| status | territory_status NOT NULL DEFAULT 'active' | reuse the existing `territory_status` enum rather than adding a third active/inactive type |
| is_seed_data | boolean NOT NULL DEFAULT false | set true for the seeded defaults |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | |
| deleted_at | timestamptz NULL | soft delete |

Unique: `(account_id, lower(name)) WHERE deleted_at IS NULL`.

Seeded on FSM account provision (follow `20260910120000_seed_territories_on_account_create.sql`):
Water Purifier, Air Conditioner, Elevator, CCTV Camera, UPS / Inverter, Generator, Pump / Motor,
Other. Seeds are `is_seed_data = true` so a tenant can archive them without confusion.

### 4.3 `customer_assets`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `default gen_random_uuid()` |
| account_id | uuid NOT NULL | FK `accounts(id)` ON DELETE CASCADE |
| asset_code | text NOT NULL | human-readable, per-account series, e.g. `AST-000147` |
| contact_id | uuid NOT NULL | FK `contacts(id)` ON DELETE RESTRICT — the customer |
| asset_type_id | uuid NULL | FK `asset_types(id)` ON DELETE SET NULL |
| product_id | uuid NULL | FK `products(id)` ON DELETE SET NULL — the catalogue model this unit is an instance of |
| name | text NOT NULL | `CHECK (btrim(name) <> '')` |
| make | text NULL | manufacturer |
| model_no | text NULL | |
| serial_no | text NULL | |
| installation_date | date NULL | |
| warranty_start | date NULL | |
| warranty_end | date NULL | |
| status | asset_status NOT NULL DEFAULT 'active' | |
| customer_name_snapshot | text NULL | name of the customer **at the moment the asset was created**. History and search only |
| customer_phone_snapshot | text NULL | phone at creation, stored as captured. History and search only |
| site_label | text NULL | where the unit physically sits, e.g. "Terrace, Block B" |
| territory_id | uuid NULL | FK `territories(id)` ON DELETE SET NULL — defaults from the contact |
| notes | text NULL | |
| created_by | uuid NULL | FK `profiles(id)` ON DELETE SET NULL |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | |
| deleted_at | timestamptz NULL | soft delete |

Constraints:
- `CHECK (warranty_end IS NULL OR warranty_start IS NULL OR warranty_end >= warranty_start)`
- `CHECK (installation_date IS NULL OR installation_date <= current_date + 1)` — tolerate a
  timezone-edge day rather than rejecting today's install.
- Unique `(account_id, lower(serial_no)) WHERE serial_no IS NOT NULL AND deleted_at IS NULL`.
  **Deliberate call:** the same serial appearing twice in one tenant is almost always double
  entry, and the import framework already reports per-row failure reasons, so a rejected row is
  visible rather than silent. If a tenant legitimately has colliding serials across
  manufacturers, that becomes an Open Question, not a silent duplicate.
- Unique `(account_id, asset_code) WHERE deleted_at IS NULL`.

Indexes: `(account_id, contact_id) WHERE deleted_at IS NULL`, `(account_id, status)`,
`(account_id, warranty_end)` for the expiring-warranty filter, plus covering indexes on
`asset_type_id`, `product_id`, `territory_id`, `created_by`.

**`territory_id` default.** A BEFORE INSERT/UPDATE trigger copies `contacts.territory_id` when
the asset's own `territory_id` is NULL. It does **not** overwrite an explicitly set value — a
customer's head office may be in one area while the machine sits in another, and area-based
assignment must follow the machine. This mirrors the existing
`20260916120000_contacts_denormalize_geo_from_territory.sql` trigger pattern.

**Customer snapshots — write-once, and never displayed as the customer.** Founder change #1,
2026-09-29. Contacts get renamed, phone numbers change, and duplicate contacts get merged; without a
snapshot, an asset's service history silently rewrites itself and an old phone number becomes
unsearchable. So both columns are filled by the same BEFORE INSERT trigger that defaults
`territory_id`, copying `contacts.name` and `contacts.phone`.

Three rules the implementer must not bend:
- **Filled on INSERT only.** The trigger never refreshes them on UPDATE. A snapshot that tracks the
  live record is not a snapshot.
- **Never rendered as the customer.** Every screen resolves the customer through `contact_id`. The
  asset list's Customer column joins `contacts`; it does not read the snapshot. Showing a stale name
  in the UI is the exact failure this column is meant to prevent, not cause.
- **Search only.** They are covered by a search index and matched by the asset list's free-text
  filter alongside name, serial and code, so "customer called from their old number" still finds the
  machine. A trigram or `lower()` index on `(account_id, customer_phone_snapshot)` is enough.

Considered and declined: the same snapshot pair on `service_jobs`. A job always has `contact_id`, and
an assigned job always has an asset, so the chain already resolves. Adding it there would be two more
columns for no case we can name.

**`asset_code` generation.** Antigravity must first search the repo for the existing customer-code
generator (there is a `handle_new_user` / Customer ID mechanism; a duplicate-Customer-ID bug was
fixed previously) and **reuse it if one exists**. Only if none exists, add:

```sql
CREATE TABLE IF NOT EXISTS public.service_code_counters (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind       text NOT NULL,               -- 'asset' | 'job'
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, kind)
);
```

with `service_next_code(p_account_id uuid, p_kind text, p_prefix text) RETURNS text`, which does
`INSERT ... ON CONFLICT (account_id, kind) DO UPDATE SET last_value = service_code_counters.last_value + 1
RETURNING last_value` and formats `prefix || '-' || lpad(last_value::text, 6, '0')`. The row-level
lock from the upsert serialises concurrent inserts, so codes are gapless per tenant.

### 4.3b `job_categories`

Founder change #2, 2026-09-29. A flat, tenant-configurable master for **work type**.

Same six-column shape as `asset_types`: `id`, `account_id`, `name`, `code`, `status`
(`territory_status`), `is_seed_data`, timestamps, `deleted_at`. Unique
`(account_id, lower(name)) WHERE deleted_at IS NULL`.

Seeded on FSM provision: Breakdown, Preventive Maintenance, Installation, Electrical, Mechanical,
Inspection.

> **One warning the implementer must carry into the seed data and the settings screen copy.** The
> founder's example list mixed three different axes: a trade (Electrical, Mechanical), a work type
> (Installation, Breakdown), and a **charge basis** (Warranty, Chargeable). The first two belong
> here. **Charge basis does not.** It is derived from AMC and warranty coverage in a later phase, and
> if tenants encode "Warranty" and "Chargeable" as categories now, we will have two competing sources
> of truth for whether a job is billable — one a free-text master a salesperson can edit, the other a
> contract. That is a money bug waiting six months. So: seed trade and work-type values only, and the
> settings screen's helper text says "Work type, for example Electrical or Breakdown. Billing and
> warranty coverage are handled separately." Do not seed Warranty or Chargeable.

### 4.4 `service_jobs`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `default gen_random_uuid()` |
| account_id | uuid NOT NULL | FK `accounts(id)` ON DELETE CASCADE |
| job_no | text NOT NULL | per-account series, prefix from service settings, default `JOB` |
| contact_id | uuid NOT NULL | FK `contacts(id)` ON DELETE RESTRICT |
| asset_id | uuid NULL | FK `customer_assets(id)` ON DELETE RESTRICT — see note below |
| parent_job_id | uuid NULL | FK `service_jobs(id)` ON DELETE SET NULL — **ships unused** |
| source | service_job_source NOT NULL DEFAULT 'complaint' | |
| intake_channel | service_job_channel NULL | required when `source='complaint'` |
| job_category_id | uuid NULL | FK `job_categories(id)` ON DELETE SET NULL. Optional, never required |
| priority | service_job_priority NOT NULL DEFAULT 'medium' | |
| status | service_job_status NOT NULL DEFAULT 'open' | |
| title | text NOT NULL | `CHECK (btrim(title) <> '')` — short summary |
| description | text NULL | |
| assigned_to | uuid NULL | FK `profiles(id)` ON DELETE SET NULL — **`profiles.id`, not `auth.users.id`** |
| assignment_type | service_assignment_type NULL | how it was assigned; audit + future reporting |
| territory_id | uuid NULL | snapshot of the territory used for area resolution |
| sla_due_at | timestamptz NULL | computed on insert from priority + settings |
| opened_at | timestamptz NOT NULL DEFAULT now() | |
| assigned_at / started_at / completed_at / cancelled_at | timestamptz NULL | stamped by the status guard |
| on_hold_reason | text NULL | required to enter `on_hold` |
| resolution_notes | text NULL | required to enter `completed` |
| cancel_reason | text NULL | required to enter `cancelled` |
| created_by | uuid NULL | FK `profiles(id)` ON DELETE SET NULL |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | |
| deleted_at | timestamptz NULL | soft delete |

**`asset_id` is nullable in the database but required to leave `open`.** This is a deliberate
refinement of the founder's "every job should be linked to an Asset". A `NOT NULL` column blocks
phone intake — the call comes in, the agent does not yet know which of the customer's five pumps
it is, and forcing a guess produces wrong data, which is worse than a null for ten minutes. So:
the column is nullable, and the status guard refuses `open → assigned` while `asset_id IS NULL`.
No job can be worked, completed or reported on without an asset, which is the actual goal.

Indexes: `(account_id, status) WHERE deleted_at IS NULL`,
`(account_id, assigned_to, status) WHERE deleted_at IS NULL`,
`(account_id, sla_due_at) WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled')`,
`(account_id, contact_id)`, `(account_id, asset_id)`, `(account_id, source)`, plus covering
indexes on `territory_id`, `parent_job_id`, `job_category_id`, `created_by`.
Unique `(account_id, job_no) WHERE deleted_at IS NULL`.

### 4.5 `service_job_notes`

`id uuid PK` · `account_id uuid NOT NULL FK accounts` · `job_id uuid NOT NULL FK service_jobs(id) ON DELETE CASCADE`
· `body text NOT NULL CHECK (btrim(body) <> '')` · `created_by uuid NULL FK profiles(id)`
· `created_at timestamptz NOT NULL DEFAULT now()` · `deleted_at timestamptz NULL`.
Index `(account_id, job_id, created_at DESC)`.

### 4.6 `service_job_attachments`

`id uuid PK` · `account_id uuid NOT NULL FK accounts` · `job_id uuid NOT NULL FK service_jobs(id) ON DELETE CASCADE`
· `file_path text NOT NULL` (storage object path) · `file_name text NOT NULL` · `mime_type text NULL`
· `size_bytes bigint NULL CHECK (size_bytes IS NULL OR size_bytes <= 10485760)`
· `uploaded_by uuid NULL FK profiles(id)` · `created_at timestamptz NOT NULL DEFAULT now()`
· `deleted_at timestamptz NULL`. Index `(account_id, job_id)`.

**Storage.** New bucket `service-attachments`, private. Path convention
`{account_id}/{job_id}/{uuid}-{filename}`, matching `expense_proofs`.

> **This is the single highest-risk item in the migration.** A previous project restore silently
> dropped all `storage.objects` RLS policies, every upload began failing with a permission error,
> and it presented as total sync failure rather than as a storage problem. The migration must
> create the bucket **and** its four explicit policies (select / insert / update / delete), each
> keyed on `(storage.foldername(name))[1] = account_id::text` for a member of that account, and
> §11 requires a real upload-then-download test, not a code review.

### 4.7 Service settings

No new table. Settings live in `accounts.settings` JSONB under a `service_settings` key, matching
the existing `territory_settings` precedent:

```json
{
  "service_settings": {
    "job_no_prefix": "JOB",
    "asset_code_prefix": "AST",
    "sla_hours": { "low": 72, "medium": 48, "high": 24, "critical": 4 },
    "default_assignment_mode": "area_based",
    "require_asset_on_assign": true
  }
}
```

`sla_due_at` is computed by a BEFORE INSERT trigger as `opened_at + (sla_hours[priority] || ' hours')::interval`,
and recomputed on priority change while the job is still `open` or `assigned`.

**Deliberately an interval on a `timestamptz`, not a calendar date.** Every date bug this codebase
has had — the DSR "0 visits", the empty dashboard trend charts — came from mixing UTC storage with
account-local calendar days. An interval from `opened_at` has no timezone semantics to get wrong.
Display formats it in the account timezone; the stored value never needs conversion.

### 4.8 Area-based assignment resolver

Reuses `territories` (self-referencing tree, `level` 1 = Country … 4 = Area) and
`employee_area_assignments (account_id, employee_id, territory_id, assigned_by)`, both already in
production. Under the default `area_wise` mode one employee holds a given area, so resolution is
deterministic; under `direct` mode it may not be.

```sql
CREATE OR REPLACE FUNCTION public.service_job_resolve_area_assignee(
  p_account_id uuid, p_territory_id uuid
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tid uuid := p_territory_id; v_depth int := 0; v_count int; v_employee uuid;
BEGIN
  WHILE v_tid IS NOT NULL AND v_depth < 10 LOOP
    SELECT count(*), min(a.employee_id) INTO v_count, v_employee
      FROM employee_area_assignments a
     WHERE a.account_id = p_account_id AND a.territory_id = v_tid;
    IF v_count = 1 THEN RETURN v_employee; END IF;
    IF v_count > 1 THEN RETURN NULL; END IF;   -- ambiguous: never guess
    SELECT parent_id INTO v_tid FROM territories
      WHERE id = v_tid AND account_id = p_account_id;
    v_depth := v_depth + 1;
  END LOOP;
  RETURN NULL;
END; $$;
```

Rules, all of which must be honoured:
- Walk **upward** from the most specific territory. An Area-level assignment beats a City-level one.
- **More than one employee on a level returns NULL.** Never pick arbitrarily. The UI then tells the
  user to assign manually and says why.
- Depth is capped at 10 to survive a malformed tree.
- The territory used is `COALESCE(asset.territory_id, contact.territory_id)` — the machine's area
  wins over the customer's registered area.
- The resolved employee must still be an active, non-deleted profile with mobile or web access; the
  calling RPC re-checks this and returns `reason = 'employee_inactive'` if not.

### 4.9 Status transition guard

A BEFORE UPDATE trigger `service_jobs_guard_status()` enforces the machine and stamps timestamps.

| From | Allowed to | Precondition |
|---|---|---|
| open | assigned | `assigned_to IS NOT NULL` **and** `asset_id IS NOT NULL` (when `require_asset_on_assign`) |
| open | cancelled | `cancel_reason` present |
| assigned | in_progress, on_hold, open, cancelled | `open` clears `assigned_to`; `on_hold` needs `on_hold_reason`; `cancelled` needs `cancel_reason` |
| in_progress | on_hold, completed, cancelled | `completed` needs `resolution_notes` |
| on_hold | in_progress, cancelled | |
| completed | — | terminal in v1. Reopening is Open Question 5. |
| cancelled | — | terminal |

Any other transition raises `ERRCODE = '22023'` with a message naming both states. The trigger is
the only authority — the RPC and the UI both rely on it rather than duplicating the rules.

### 4.10 RLS

Every new table gets `ENABLE ROW LEVEL SECURITY` plus policies on the existing tenant pattern:

```sql
CREATE POLICY customer_assets_select ON public.customer_assets FOR SELECT
USING (account_id IN (
  SELECT account_id FROM public.profiles WHERE user_id = (select auth.uid())
));
```

- `(select auth.uid())` wrapping is mandatory, not stylistic.
- Write policies additionally require `is_account_member(account_id, 'admin')` **or** the matching
  permission via `has_permission()`, following whichever of the two the `orders` tables use — the
  implementer must read those policies and match them rather than inventing a third pattern.
- **Data scope for technicians** on `service_jobs` follows the directional scoping already applied
  to `orders` / `site_visits` / `deals` (migration set of 2026-08-30). A technician's SELECT is
  narrowed to `assigned_to = <their profiles.id>` or their hierarchy subtree. This is a no-op until
  Reporting Hierarchy is enabled for the tenant, exactly as the existing tables behave.
- Realtime subscriptions do **not** inherit RLS. Any channel this feature opens must filter on
  `account_id` explicitly.

### 4.11 Migration files

| File | Contents |
|---|---|
| `20260929150000_fsm_phase1_customer_assets.sql` | enums for assets, `asset_types`, `customer_assets` incl. customer snapshots, `service_code_counters`, code function, the combined territory-default + snapshot BEFORE INSERT trigger, indexes (incl. the snapshot search index), RLS, seed-on-provision hook |
| `20260929160000_fsm_phase2_service_jobs.sql` | job enums, `job_categories` + seeds, `service_jobs`, `service_job_notes`, SLA trigger, status guard, area resolver, the three RPCs, indexes, RLS |
| `20260929170000_fsm_service_attachments_storage.sql` | `service_job_attachments`, the `service-attachments` bucket, and its four `storage.objects` policies |
| `ROLLBACK-fsm-phase-1-2.md` | reverse order: drop policies, bucket, tables, functions, enums. Matches the existing ROLLBACK-\*.md convention |

Existing data: none of these tables exist, so there is nothing to migrate. No existing column is
altered except `accounts.settings` gaining a JSONB key, which is additive. `catalog.ts` and
`account_has_line` changes are additive — existing plans keep their behaviour.

### 4.12 Technician-created jobs — schema readiness check

Founder change #3, 2026-09-29. Technicians creating jobs from mobile is **Phase 4, not now**, but
nothing in this phase may block it. The following must all be true when Phase 2 ships, and each is an
acceptance-criteria item:

1. **The INSERT policy on `service_jobs` is permission-based, not role-based.** It must admit any
   caller in the account holding `create_service_jobs` via `has_permission()`, not only
   `is_account_member(account_id, 'admin')`. An admin-only INSERT policy would mean Phase 4 needs a
   migration to relax it — the whole point of this check.
2. **`created_by` is nullable and references `profiles.id`.** No trigger forces it to an admin.
3. **`assigned_to` may equal `created_by`.** No constraint forbids self-assignment, because a
   technician who logs a follow-up on site is its natural owner.
4. **`asset_id` may be set at insert time.** A technician standing in front of the second faulty pump
   knows exactly which asset it is, so the mobile create path can go straight to `open` with an asset
   attached and then to `assigned`.
5. **`parent_job_id` accepts a value at insert time** and is not blocked by any trigger or check,
   even though no v1 UI writes it. A field-raised follow-up is the first real use.
6. **`intake_channel` accepts `'internal'`,** which is what a technician-raised job will use.
7. **The default Technician role ships without `create_service_jobs`,** grantable per tenant. Founder
   ruling: the capability exists, the permission is opt-in.

Nothing above requires extra columns or tables. This section exists so the implementer verifies it
rather than discovering in Phase 4 that an INSERT policy has to be rewritten.

---

## 5. API Contract

Per the 20% Rule, ordinary reads and writes go through `@supabase/supabase-js` with RLS doing the
work. Only two operations need elevation, because both read `employee_area_assignments` and both
must be atomic across columns.

### 5.1 `service_job_assign`

```
RPC: service_job_assign(p_job_id uuid, p_mode text, p_employee_id uuid DEFAULT NULL) RETURNS jsonb
SECURITY DEFINER, SET search_path = public
```

Request: `p_mode` is `'manual'` or `'area_based'`. `p_employee_id` is required for `'manual'`, ignored
for `'area_based'`.

Success:
```json
{ "ok": true, "assigned_to": "<profiles.id>", "employee_name": "Ramesh K",
  "assignment_type": "area_based", "territory_id": "<uuid>", "territory_name": "Andheri East",
  "status": "assigned" }
```

Failure — always `{"ok": false, "reason": "<code>"}`, HTTP 200, never an exception except for
authorisation:

| reason | Meaning |
|---|---|
| `job_not_found` | wrong id, other tenant, or soft-deleted |
| `forbidden` | caller lacks `assign_service_jobs`. Raised as `42501` |
| `asset_required` | `require_asset_on_assign` is on and the job has no asset |
| `no_territory` | neither asset nor contact has a `territory_id` |
| `no_area_employee` | the walk reached the root with no assignment |
| `area_ambiguous` | a level had more than one employee. Includes `territory_name` |
| `employee_inactive` | resolved or supplied employee is deleted, inactive, or has no access |
| `employee_not_in_account` | supplied `p_employee_id` belongs to another tenant |
| `invalid_status` | job is already `completed` or `cancelled` |

Side effects: sets `assigned_to`, `assignment_type`, `assigned_at = now()`, `territory_id`,
`status = 'assigned'`, and writes a `module_activities` row. All in one statement so a failure
leaves nothing partially applied.

### 5.2 `service_job_set_status`

```
RPC: service_job_set_status(p_job_id uuid, p_status text, p_reason text DEFAULT NULL) RETURNS jsonb
SECURITY DEFINER, SET search_path = public
```

`p_reason` maps to `on_hold_reason`, `resolution_notes` or `cancel_reason` depending on the target
status. Success `{ "ok": true, "status": "in_progress", "changed_at": "<ts>" }`.

Failures: `job_not_found`, `forbidden` (needs `change_service_job_status`, and `cancel_service_jobs`
for cancellation), `invalid_transition` (includes `from` and `to`), `reason_required`,
`asset_required`, `not_assignee` — a technician may only move jobs assigned to them.

### 5.3 `service_job_preview_area_assignee`

```
RPC: service_job_preview_area_assignee(p_job_id uuid) RETURNS jsonb
SECURITY DEFINER, STABLE, SET search_path = public
```

Read-only. Returns the same shape as 5.1's success plus `{"would_assign": true|false}` and the same
reason codes, so the create and detail screens can show "Area assignment will route this to Ramesh K
(Andheri East)" *before* the user commits. No writes, no side effects.

### 5.4 Import

Register a `customer_assets` descriptor in `src/lib/import/descriptors/` and the matching branch in
the `import_commit` and `import_undo` RPCs, following `product-units.ts` and `masters.ts`.

```ts
export const customerAssetsDescriptor: ImportDescriptor = {
  module: "customer_assets",
  targetTable: "customer_assets",
  label: "Customer Assets",
  requiredPermission: "import_service_assets",
  undoable: true,
  dedupeKeys: ["serial_no"],
  maxRows: 5000,
  fields: [ /* customer lookup, asset_type lookup, product lookup, name, make,
               model_no, serial_no, installation_date, warranty_start,
               warranty_end, status, site_label, notes */ ],
};
```

Lookup rules — these matter, because a previous importer silently created 15 bogus Country-level
territories by resolving a lookup the wrong way:
- **Customer** resolves against existing `contacts` by customer code, then phone (E.164), then exact
  name. **Never creates a contact.** Unresolved → row fails with reason `customer_not_found`.
- **Asset Type** resolves by name, case-insensitive. May create a missing type only when the user
  ticks "create missing asset types" on the mapping screen; default off.
- **Product** resolves by code then name. **Never creates a product.**
- **Territory is never taken from the file and never created.** It is inherited from the resolved
  contact by the table's own trigger.
- Dates accept `dd-mm-yyyy`, `dd/mm/yyyy` and ISO. Ambiguous two-digit years fail the row rather
  than guessing a century.
- Per-row failures carry a human reason, matching the import failure-reason work already shipped.

---

## 6. Mobile Behavior

**N/A for this spec — web only.** The founder scoped Phase 1 and Phase 2 to web screens, and the
FSM mobile flow is Phase 4 of the build map. Antigravity must not add mobile screens, and must not
add anything to `wacrm-mobile`.

Two things this spec does deliberately so Phase 4 is not blocked:
1. `service_jobs.id` is a client-generatable `uuid` with `DEFAULT gen_random_uuid()`, so the mobile
   offline queue can create a job offline and keep its id. This is the opposite of the
   `location_pings` mistake, where `id` is a server-assigned `bigint identity ALWAYS` and mobile
   shipped code generating a UUID for it.
2. Status changes go through one RPC with a server-side guard, so the mobile client can replay a
   queued status change without re-implementing the state machine, and a stale queued transition
   fails cleanly with `invalid_transition` instead of corrupting the row.

When Phase 4 arrives, job writes must be wired into `SyncEngine.enqueueMutation` following the
`VisitService.ts` pattern, and the parent-before-child ordering lesson applies — a job must land
before its notes, attachments or visits, and an FK violation (`23503`) on a child is **transient**,
not permanent. Do not treat it as a dead letter.

---

## 7. UI States

New routes under `src/app/(dashboard)/`, all Server Components by default with `"use client"`
pushed as far down as possible. Reuse the shared table shell (pinned Action column, Show-Inactive
toggle, ConfirmDialog) and `FormPageShell` + `FormActions` + `PhotoUpload` — do not build new
table or form chrome.

### 7.1 `/service/assets` — Asset list

| State | Behaviour |
|---|---|
| Loading | Existing table skeleton |
| Empty, no assets at all | "No assets yet. Add your first asset, or import a list." Two buttons: Add Asset, Import Assets |
| Empty, filters exclude everything | "No assets match these filters." Clear-filters button. Distinct from the above — never show the onboarding empty state to someone who filtered |
| Populated | Columns: Asset Code, Name, Customer, Type, Serial No, Warranty End, Status, Action (pinned). Warranty End shows an amber pill within 30 days and a red pill when past |
| Filters | Customer, Asset Type, Status, Warranty (expiring in 30 / expired), Territory, free-text on name/serial/code |
| Show Inactive | Off by default, matching the eight pages already converted to soft delete |
| Permission denied | Route not rendered and nav item hidden without `view_service_assets` |
| Partial error | Table renders; a dismissible banner names what failed to load |
| Offline / network error | "Could not load assets." Retry button. No silent empty table |

### 7.2 `/service/assets/new` and `/service/assets/[id]/edit`

`FormPageShell`. Fields grouped: Identity (customer, name, type, product, make, model, serial),
Lifecycle (installation date, warranty start, warranty end, status), Placement (site label,
territory with the existing territory picker), Notes. Customer is locked when the form is opened
from a customer's asset panel, the same way order-from-visit locks its customer.

Validation states: duplicate serial shows "Serial 12345 already exists on asset AST-000091" with a
link to that asset, not a raw constraint error. Warranty end before start blocks submit inline.

### 7.3 `/service/assets/[id]` — Asset detail

Header: asset code, name, customer link, status pill, warranty pill. Tabs:
- **Details** — all fields read-only with Edit
- **Service Jobs** — jobs for this asset, newest first, with a Log Complaint button that pre-fills
  customer and asset. Empty state: "No service history for this asset yet."
- **Timeline** — `module_activities` feed, reusing the existing Timeline component

### 7.4 Customer detail — Assets panel

A panel on the existing `/contacts/[id]` page listing that customer's assets (code, name, type,
serial, warranty, status) with Add Asset and a link to the filtered asset list. Renders only with
`view_service_assets` **and** an FSM-enabled plan. Empty state: "No assets recorded for this
customer." This is the entry point that makes the workflow feel connected, so it is not optional.

### 7.5 `/service/jobs` — Job list

| State | Behaviour |
|---|---|
| Populated | Columns: Job No, Customer, Asset, Title, Source, Channel, Priority, Status, SLA, Assigned To, Action (pinned) |
| SLA column | Time remaining for open work. Amber under 25% remaining, red and "Overdue by 3h" when `sla_due_at < now()` and status is not completed/cancelled. Completed and cancelled jobs show a neutral dash |
| Filters | Status (multi), Priority, Source, Intake Channel, Assigned To, Territory, Unassigned only, SLA breached only, date range on `opened_at` |
| Default view | Status in (open, assigned, in_progress, on_hold), sorted by SLA due ascending — the work that needs attention first |
| Bulk action | Select rows → Assign. Runs `service_job_assign` per row and reports a per-row result summary: "7 assigned, 2 could not be assigned automatically (no area employee)". Never a silent partial success |
| Empty / permission / error | Same four-state discipline as 7.1 |

### 7.6 `/service/jobs/new` — Log Complaint

Built for someone on the phone with a customer, so field order follows the conversation and the
form is submittable in under 20 seconds:

1. Customer (searchable, by name or phone)
2. Asset (filtered to that customer's assets; shows "This customer has no assets — add one" with an
   inline link; leaving it blank is allowed and the job stays `open`)
3. Intake Channel — defaults to Phone
4. Priority — defaults to Medium, with the resulting SLA shown live: "Due by 2 Oct, 4:30 PM"
5. Title, Description
6. Attachments — optional, multi-file
7. Assignment — "Assign later" (default), "Assign to area" with the live
   `service_job_preview_area_assignee` result shown inline, or "Assign to person"

`source` is fixed to `complaint` on this screen and not user-editable. Other sources are created by
future phases, not by hand.

### 7.7 `/service/jobs/[id]` — Job detail

Header: job no, title, status pill, priority pill, SLA countdown, customer and asset links.
Sections: Assignment card (current assignee, assignment type, Reassign with both modes and the
preview), Details, Notes (newest first, add inline), Attachments (upload, download, soft delete),
Timeline, and a status action bar showing **only legal next transitions** for this status and this
user's rights — never a disabled button for a transition the guard would reject.

On-hold, complete and cancel each open a ConfirmDialog that captures the mandatory reason. The
reason field cannot be skipped, because the trigger will reject the write anyway.

### 7.8 `/settings/service` — Service settings

Asset Types master (list, add, edit, archive — archive blocked with a count when assets reference
it), SLA hours per priority with validation that critical ≤ high ≤ medium ≤ low, job number and
asset code prefixes, default assignment mode, require-asset-on-assign toggle. Gated on
`manage_service_settings`.

---

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behaviour | Severity |
|---|---|---|
| Complaint logged for a customer with no assets | Job is created and stays `open`. Cannot be assigned until an asset is attached. Detail screen shows "Attach an asset to assign this job" | Blocker if not handled |
| Area-based assignment finds nobody | `no_area_employee`. UI: "No employee covers Andheri East. Assign manually or set an area owner." Job stays `open` | Blocker |
| Area-based assignment finds two employees | `area_ambiguous`. Never picks one. Same fallback message naming the territory | Blocker |
| Neither asset nor contact has a territory | `no_territory`. Message points at the customer's territory field | Warning |
| Assigned employee is deactivated later | Job keeps the assignment and shows the assignee as inactive with a Reassign prompt. `assigned_to` is never silently nulled | Warning |
| Two users assign the same job simultaneously | Last write wins at row level; the loser's response reflects the current state because the RPC re-reads inside the statement. No duplicate activity rows | Warning |
| Duplicate serial on manual entry | Inline error naming the existing asset code, with a link | Warning |
| Duplicate serial in an import | Row fails with `duplicate_serial` and the existing asset code in the reason. Other rows still commit | Warning |
| Import references a customer that does not exist | Row fails `customer_not_found`. **No contact is created** | Blocker |
| Import file has a Territory column | Column is ignored. Territory comes from the contact | Blocker |
| Priority changed after opening | `sla_due_at` recomputed while status is `open` or `assigned`; frozen once work has started, so a late priority bump cannot retroactively mark historic work compliant | Warning |
| Job completed with no resolution notes | Trigger rejects; dialog requires the note | Warning |
| Technician tries to change status on someone else's job | `not_assignee` | Blocker |
| Technician tries to cancel a job | `forbidden` — cancellation needs `cancel_service_jobs` | Blocker |
| Asset deleted while jobs reference it | `ON DELETE RESTRICT`. UI offers archive (soft delete) instead and explains that N jobs reference it | Warning |
| Customer deleted while assets reference them | `ON DELETE RESTRICT`, same treatment | Warning |
| Attachment upload fails on storage permissions | Explicit "Upload failed — storage permission" message, and the attachment row is **not** inserted. Never an orphan row pointing at a missing object | Blocker |
| Attachment over 10 MB | Rejected client-side before upload, with the limit named | Info |
| Tenant on a non-FSM plan reaches `/service/*` | Plan gate redirects with the standard upgrade message; `account_has_line` refuses the write even if the UI is bypassed | Blocker |
| Malformed territory tree (cycle) | Resolver stops at depth 10 and returns NULL rather than looping | Warning |
| 5,000 assets for one customer | Asset panel paginates at 25 with "View all" | Info |

---

## 9. Reuse Check

Antigravity **must** read these before writing any new code, and extend rather than duplicate:

| Need | Existing thing to read and reuse |
|---|---|
| Territory tree and area ownership | `supabase/migrations/101_territory_master.sql`, `102_territory_rpcs.sql`, `105_territory_default_area_wise.sql`; `employee_area_assignments`; `src/lib/territories/` (`api.ts`, `settings.ts`, `types.ts`) |
| Territory default / geo inheritance trigger pattern | `20260916120000_contacts_denormalize_geo_from_territory.sql`, incl. `territory_flat_geo()` |
| Territory picker component | the picker added in the 2026-09-15 form UX batch |
| Permissions | `src/lib/auth/permissions-registry.ts`, `permission-groups.ts`, `rbac.ts`, `has_permission()` |
| Plan gating | `src/lib/plans/catalog.ts`, the `account_has_line` DB backstop, plan-aware default roles |
| Import | `src/lib/import/` — `registry.ts`, `types.ts`, `descriptors/product-units.ts`, `descriptors/masters.ts`, and the `import_commit` / `import_undo` RPCs |
| Tables, soft delete, Show Inactive, pinned Action column, ConfirmDialog | the eight pages converted in the 2026-09-14 table overhaul |
| Forms | `FormPageShell`, `FormActions`, `PhotoUpload` |
| Activity timeline | `module_activities` and the `<Timeline>` component |
| Attachments and storage policies | the `expense_proofs` bucket and its `storage.objects` policies; `custom-field-attachments` |
| Soft-delete + RLS + `(select auth.uid())` + FK-index conventions | the 2026-09-13 performance migrations and the 2026-08-30 data-scope RLS migrations |
| Locking a parent record on a child form | the order-from-visit customer lock |
| Parallelised saves | the 2026-09-15 `Promise.all` pattern on record forms — round-trips to Mumbai are ~200 ms each, so never save sequentially |

Explicit instruction to Antigravity: **search for `employee_area_assignments`,
`territory_flat_geo`, `permissions-registry`, `import_commit`, `FormPageShell`, `module_activities`,
`expense_proofs` and `account_has_line` before writing anything.** If you find yourself writing a
new territory walker, a new table shell, a new form shell, or a new storage policy pattern, stop —
one already exists.

---

## 10. Resolved Decisions

All five design questions were answered by the founder on 2026-09-29. These are rulings, not
defaults — implement them as written and do not reopen them mid-build.

| # | Question | Ruling | Consequence for the build |
|---|---|---|---|
| 1 | FSM pricing | **Open, and deliberately not blocking.** Use placeholders ₹500 / ₹600 / ₹800 so the types compile, flagged unapproved in the PR | Only the public price list waits. No code path depends on the value |
| 2 | Serial numbers unique per tenant | **Yes. Keep the unique index.** 99% of service companies expect serials to be unique; if a manufacturer ever collides, handle it then rather than weakening data quality now | Partial unique index stays as specified in §4.3. Import reports `duplicate_serial` per row |
| 3 | Asset custom fields in v1 | **No. Hard reject.** "Add Motor HP", then "Compressor PSI", then fifty more — that is where SaaS products die. Ship first | Do not register `customer_asset` or `service_job` as custom-field entity types. No EAV path. Asset Types carry the variation instead |
| 4 | Who can log a complaint | **Admin, Dispatcher, Service Manager always. Technician only when the right is granted. Viewer never** | `create_service_jobs` exists in the default Technician role definition but is OFF. §4.12 keeps the INSERT policy permission-based so turning it on later needs no migration |
| 5 | Reopening a completed job | **No. Completed stays completed.** Create a new job and link it with `parent_job_id` if needed. Reopening turns reports into garbage | `completed` and `cancelled` are terminal in the status guard. No `reopen_service_job` right exists. No UI offers it |
| 6 | Pause the SLA clock on hold | **No.** Track hold duration only. Pausing means accumulating intervals across repeated hold/resume cycles — complexity with no payoff | `sla_due_at` never moves once set, except the priority recompute while `open`/`assigned`. The job detail screen shows total time spent on hold as a read-only figure derived from the activity timeline |

**Only Question 1 remains open, and it gates nothing in this specification.**

---

## 11. Acceptance Criteria

### Functional
- [ ] An admin can create an asset type, then an asset against a customer, with serial number,
      installation date, warranty start and end, and status, and see it in the asset list.
- [ ] The asset appears in the Assets panel on that customer's detail page.
- [ ] An asset with no explicit territory inherits the customer's `territory_id`; an asset with an
      explicit territory keeps it after an unrelated edit. Verified by two SQL reads.
- [ ] `customer_name_snapshot` and `customer_phone_snapshot` are populated on insert. **Renaming the
      contact and changing its phone afterwards leaves both snapshots unchanged**, while the asset
      list's Customer column shows the *new* name. Both halves verified — a snapshot that drifts, or a
      UI that renders the snapshot, each fail this item.
- [ ] Searching the asset list by a customer's **old** phone number finds the asset.
- [ ] A job can be created with no `job_category_id`, and with one. The seeded categories contain no
      billing or warranty values.
- [ ] Importing a 500-row asset CSV creates 500 assets; a row naming an unknown customer fails with
      `customer_not_found` while the rest commit; a Territory column in the file is ignored; undo
      removes exactly the imported rows.
- [ ] A complaint can be logged in one screen with customer, asset, channel, priority, title and an
      attachment, and lands at status `open` with a `job_no` and a populated `sla_due_at`.
- [ ] `open → assigned` is refused while `asset_id IS NULL` and `require_asset_on_assign` is on,
      with reason `asset_required`.
- [ ] Manual assignment sets `assigned_to`, `assignment_type='manual'`, `assigned_at` and
      `status='assigned'` in one call.
- [ ] Area-based assignment on a job whose asset sits in an Area owned by exactly one employee
      assigns that employee and records `assignment_type='area_based'`.
- [ ] Area-based assignment returns `no_area_employee` when no ancestor territory has an owner, and
      `area_ambiguous` when a level has two, and in both cases the job remains `open` and
      `assigned_to` remains NULL.
- [ ] An Area-level owner wins over a City-level owner for the same job. Verified with a seeded
      two-level fixture.
- [ ] Every transition in the §4.9 table succeeds; every transition absent from it is rejected with
      `invalid_transition`. Verified case by case, not by sampling.
- [ ] `on_hold` without a reason, `completed` without resolution notes and `cancelled` without a
      cancel reason are all rejected by the database, not only by the form.
- [ ] A technician cannot change status on a job assigned to someone else (`not_assignee`) and
      cannot cancel any job (`forbidden`).
- [ ] `completed` and `cancelled` are terminal. No RPC argument, no UI control and no direct update
      moves a job out of either. Verified by attempting each illegal transition.
- [ ] **§4.12 readiness, all seven points, verified individually.** In particular: a non-admin profile
      holding only `create_service_jobs` can INSERT a job with an `asset_id` and a `parent_job_id`
      set, and `assigned_to = created_by`. This is tested now even though no UI does it, because it is
      the whole point of the check.
- [ ] The default Technician role ships **without** `create_service_jobs`, and granting it in the role
      editor makes the insert above succeed with no migration.
- [ ] The job list's default view shows only live work sorted by SLA due ascending, and an overdue
      job renders the red overdue pill with the correct hour count.
- [ ] Bulk assign over 10 rows where 3 cannot resolve reports "7 assigned, 3 failed" with per-row
      reasons, and the 7 are actually assigned.

### Code Quality
- [ ] `npx tsc --noEmit` passes with zero errors. No new `any` without a comment justifying it.
- [ ] No new table shell, form shell, territory walker or storage-policy pattern was written. Each
      reuse in §9 is either used or its non-use explained in the PR description.
- [ ] Lint passes. No `"use client"` added to a page or layout that did not need it.

### Architecture
- [ ] Ordinary reads and writes go through `supabase-js` with RLS. Only the three documented RPCs
      exist, and each is `SECURITY DEFINER` with `SET search_path = public`.
- [ ] The status machine exists in exactly one place — the trigger. The RPC and the UI read it, and
      neither re-implements it.
- [ ] `assigned_to` and `created_by` reference `profiles.id`. Confirmed by reading the FK, because
      the same column name means `auth.users.id` elsewhere in this codebase.
- [ ] `service_jobs.id` is `uuid DEFAULT gen_random_uuid()` and client-generatable.
- [ ] Record-form saves use `Promise.all`, not sequential awaits.

### Testing
- [ ] Unit tests for the area resolver covering: single owner at Area, single owner at City with
      none at Area, two owners at one level, no owner anywhere, and a tree deeper than 10.
- [ ] Unit tests for `sla_due_at` per priority, and for recompute-on-priority-change being active
      while `open`/`assigned` and inert afterwards.
- [ ] Transition tests covering the full matrix, including every illegal transition.
- [ ] Import tests: happy path, unknown customer, duplicate serial, ignored Territory column,
      ambiguous date, undo.
- [ ] Tests live beside their module in the existing test layout and run in the existing suite.

### Security
- [ ] RLS is enabled on `customer_assets`, `asset_types`, `service_jobs`, `service_job_notes`,
      `service_job_attachments`, and `service_code_counters`.
- [ ] Cross-tenant read attempt returns zero rows; cross-tenant write is refused. Verified by
      simulating a second tenant's JWT, not by inspecting the policy text.
- [ ] Every policy uses `(select auth.uid())`. Verified by grepping the migration for bare
      `auth.uid()`.
- [ ] Every `SECURITY DEFINER` function sets `search_path`. Verified by grep.
- [ ] `service_job_assign` refuses a caller without `assign_service_jobs` even when they can read
      the job.
- [ ] A tenant without the `fsm` line is refused by `account_has_line` at the database, not only by
      the UI. Verified by a direct insert attempt.
- [ ] **Storage: an attachment uploads, downloads and soft-deletes as a member of the owning
      account, and a member of another account cannot fetch the object.** Verified by actually
      moving a file, because a restore silently dropped these policies once before and it looked
      like a sync failure rather than a permissions failure.
- [ ] No `account_id` appears in any URL or query string.

### Performance
- [ ] Every foreign key added in these migrations has a covering index. Verified by query against
      `pg_indexes`.
- [ ] The job list's default view returns in under 300 ms with 10,000 jobs seeded, using an index
      scan. `EXPLAIN` output attached to the PR.
- [ ] The asset list with all filters applied does not sequential-scan `customer_assets`.
- [ ] `ANALYZE` is run after the migrations. The Mumbai migration made clear that skipping this
      leaves the planner blind.

### Documentation
- [ ] `wacrm-web/PROJECT.md` gains the FSM module, its tables and its routes.
- [ ] `ROLLBACK-fsm-phase-1-2.md` exists and has been read end to end for correctness of order.
- [ ] New conventions (the code-counter function, the reason-code response shape) are reported back
      for addition to the engineering handbook.

### Production Readiness
- [ ] The three migrations apply cleanly to a fresh database **and** to a copy of production.
- [ ] Applying them twice is a no-op — every statement is `IF NOT EXISTS` or `CREATE OR REPLACE`.
- [ ] Rollback has been executed once against a scratch database and leaves no orphan enum, bucket
      or policy.
- [ ] Nothing regresses for a non-FSM tenant: an existing CRM-only account sees no new nav, no new
      settings and no behaviour change. Verified on a real existing account.
- [ ] Committed and pushed to `main` with the hash reported. Nothing is called done before that.

---

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip steps,
and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything

1. Read the Engineering Handbook for the current stack, architecture principles and code standards.
2. Read this entire specification, including §10 Resolved Decisions and §4.12.
3. Search the existing codebase before writing new code. Specifically search for:
   `employee_area_assignments`, `territory_flat_geo`, `territory_assign_employee_areas`,
   `src/lib/territories/`, `permissions-registry.ts`, `permission-groups.ts`, `has_permission`,
   `account_has_line`, `src/lib/plans/catalog.ts`, `src/lib/import/registry.ts`,
   `descriptors/product-units.ts`, `import_commit`, `import_undo`, `FormPageShell`, `FormActions`,
   `PhotoUpload`, `module_activities`, the `<Timeline>` component, the `expense_proofs` storage
   policies, and the pages already converted to soft delete with a pinned Action column.
4. Identify the real naming conventions by inspecting actual files — component, file, hook and
   service naming. Do not assume.
5. **Do not add anything to `wacrm-mobile`.** This phase is web only. Offline support is Phase 4;
   §6 explains what this spec deliberately leaves in place for it.

### Step 2 — STOP AND ASK triggers

Do not guess or silently choose a default in any of these situations:

- You are tempted to reopen any ruling in §10. Those six are decided. If you believe one is wrong,
  stop and say so with your reasoning — do not quietly implement a different answer.
- A tenant fixture legitimately needs two assets with the same serial number (ruling 2 says the
  constraint stays; a real counter-example is worth surfacing).
- You find existing code that conflicts with this spec — for example an existing asset, job,
  complaint or ticket table, or an existing customer-code generator that differs from §4.3.
- The spec does not specify behaviour for a case you hit — an error state, a permission edge, a
  data-type ambiguity.
- You are about to add a library, dependency or pattern not already used in this codebase.
- You are about to change a shared component, service or table in a way that could affect another
  feature — `contacts`, `products`, `profiles`, `territories`, `accounts.settings`, the import
  engine, or the permission registry.
- The area resolver's behaviour under `assignment_mode = 'direct'` is unclear for a tenant you are
  testing with.

Ask a specific, answerable question. Not "should I proceed?" but for example: "Open Question 6 —
a job sat in `on_hold` for two days waiting for a spare. Should `sla_due_at` have been pushed out,
or does the breach stand?"

### Step 3 — Implementation rules

- TypeScript strict mode, zero errors, no `any` without a comment explaining why a real type is not
  possible.
- Reuse Before Create, Extend Before Replace. If you wrote new code where existing code could have
  been extended, undo it and extend instead.
- Match §4 and §5 exactly. A deviation is a STOP AND ASK, never a silent judgment call.
- Multi-tenant isolation on every new table and query. Application-level filtering is never
  sufficient. Every policy wraps the auth call as `(select auth.uid())`. Every `SECURITY DEFINER`
  function sets `search_path`.
- Every foreign key gets a covering index in the same migration that creates it.
- The status machine lives only in the trigger.
- `assigned_to` and `created_by` are `profiles.id`. Check the FK before writing any query that
  joins them — the same column name means `auth.users.id` on other tables here, and that mismatch
  has caused a shipped bug before.
- Never save a record form with sequential awaits. Parallelise with `Promise.all`.
- Migrations are idempotent and additive. Never drop a column with live data.

### Step 4 — Self-verification before declaring done

Check this feature against every item in §11, and confirm explicitly category by category —
Functional, Code Quality, Architecture, Testing, Security, Performance, Documentation, Production
Readiness. Not "looks good." If an item could not be verified, say which and why rather than
marking it done. The storage upload/download test and the cross-tenant isolation test are the two
that must not be skipped or assumed.

### Step 5 — Report back

1. What was implemented, mapped to this spec's sections.
2. Any deviations and why.
3. Any new conventions discovered or introduced, so they can be added to the handbook.
4. Any Acceptance Criteria that could not be fully verified, and why.
5. The commit hash on `main`. Work is not done until it is committed, pushed and deployed.

---

## 13. Phase 3 hooks — not built here

Recorded so the next spec does not require a migration to undo this one:

- A `service_visits` table will reference `service_jobs(id)` as its parent, many visits per job.
  Nothing in this spec forecloses that.
- `service_jobs` gains no visit-related columns now. Counts and first/last visit timestamps belong
  on the visit table or a view, not denormalised onto the job.
- The existing geo-fenced check-in, odometer capture and selfie machinery is reused as-is in
  Phase 3. Do not fork it here.
- `status = 'in_progress'` is intended to be set by a visit check-in in Phase 3. The transition is
  already legal from `assigned`, so no schema change is needed then.

### 13.1 Future integration: Closed Order → Customer Asset

**Recorded 2026-09-29 at the founder's instruction so it is not forgotten.** Not built in this phase.

OZZO already has SFA orders, order line items, a product catalogue and customers. A dealer who sells a
Kent RO Elite with serial `KR10012` is creating, in the same moment, a machine that will need service
for the next eight years. Today those are two unrelated acts of data entry. They should be one.

The intended flow, for a later phase:

```
Order reaches its closed / fully-dispatched state
        ↓
For each order line whose product is flagged serviceable
        ↓
Prompt "Create 1 asset for this line?"  (never silent, never automatic)
        ↓
customer_assets row, pre-filled: contact, product, make, model,
installation_date = dispatch completion date, warranty_start = same,
warranty_end = warranty_start + product warranty months
        ↓
Operator types the serial number and confirms
```

What this phase already provides, so that phase needs no redesign:
- `customer_assets.product_id` exists and points at the catalogue, which is the join this flow needs.
- `customer_assets.contact_id`, `make`, `model_no`, `installation_date`, `warranty_start` and
  `warranty_end` all exist and are exactly the fields an order line can fill.
- The customer snapshots capture the buyer's name and phone as at the sale, which is what a warranty
  claim three years later actually needs.

What it will need to add, all additive and none of it a redesign:
- `customer_assets.source_order_item_id uuid NULL` for provenance, so an asset can be traced to the
  sale that created it, and so re-closing an order cannot create duplicate assets.
- A `products.is_serviceable` flag plus an optional `warranty_months`, so a dealer's consumables do
  not prompt for asset creation while the machines do.

**These columns are deliberately not added now.** An unused column is debt, and until the flow is
specified we would be guessing at its shape. The note exists so the guess is never needed.

Two design rules to carry into that phase:
- **Never create an asset silently on order close.** Serial numbers come from a sticker on a box, and
  an auto-created asset with a blank or generated serial is worse than no asset. Prompt, pre-fill,
  require the serial.
- **Idempotency is the whole game.** Keyed on `source_order_item_id`, so an order that is reopened,
  edited and re-closed does not produce a second asset for the same physical machine.
