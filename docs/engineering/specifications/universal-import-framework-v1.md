# Feature Specification: Universal Import Framework v1

**Status:** Confirmed (founder decisions locked 2026-08-22)
**Module:** Platform / Cross-cutting (CRM · Catalogue · Field Force all consume it)
**Date:** 2026-08-22
**Built by:** Antigravity (this is a full Mode-B spec + contract).
**Preceding discovery:** private Artifact "Universal Import Framework" (audit of the live DB `gxurqwpfvfktmreqmzqb` + `wacrm-web` repo), founder-reviewed and approved with four additions and a pilot change, all incorporated below.

---

## 1. Feature Overview

- **Problem:** WACRM has no import *feature* — it has **six separate import systems** already running in production, each built by hand with no shared code: Contacts (`components/contacts/import-modal.tsx`), Leads (`components/leads/lead-import-dialog.tsx`), Products (`components/products/import-products-modal.tsx`), Tasks (`components/tasks/import-tasks-modal.tsx`), Stock (`components/stock/stock-import-dialog.tsx`), and Territories (`lib/territories/api.ts` → `bulkImportTerritories`). They disagree on input method (file upload vs. paste-a-textarea), column mapping (fuzzy keyword vs. exact header vs. fixed position), preview (none / live table / results-only), persistence (direct insert / `stock_bulk_adjust` RPC / library fn), and error reporting (a count vs. per-row messages). There are 4+ hand-written CSV parsers, **zero** XLSX support, **zero** import history/audit anywhere, and only Contacts detects duplicates.
- **Business justification:** Importing master data is the **#1 onboarding task** for a new tenant — a distribution/FMCG customer arrives with customers, products, price lists and territories already in Excel. Today that experience is inconsistent and fragile, and there is no audit trail for a bulk operation that can create thousands of rows. A single enterprise-grade engine removes onboarding friction, and — because it replaces six bespoke importers — *reduces* net code and eliminates divergent behaviour.
- **Target use case / industries:** WACRM's core market (field sales / distribution SMBs). An admin onboarding a tenant uploads a customer sheet exported from Tally/Marg/Excel, maps columns once, saves the mapping as a template for next month, previews validity, imports, and — if the file was wrong — undoes it within a safety window. A monthly price-list refresh reuses the saved template and never re-maps.

**Governing design principle — "one engine, many descriptors":** there is exactly one import pipeline. A module becomes importable by registering a **descriptor** (a config object declaring its table, fields, synonyms, validators, lookups, dedupe key, and undo eligibility) — never by writing new UI or a new parser. This mirrors the existing **report engine registry** pattern in this codebase (`report_registry_*` tables + per-module descriptors); reuse that mental model.

> The pipeline: **File → Parse (one reader) → Detect headers → Auto-map → Manual-map (if needed) → Preview + Validate → Resolve unknown masters → Commit (batched, idempotent, server-side) → Audit (`import_jobs`) → Error report + Undo window.**

## 2. Scope

**In scope (v1):**
- **One shared engine** under `src/lib/import/` (core, framework-agnostic) + a **descriptor registry** (`src/lib/import/registry.ts`) + per-module descriptors (`src/lib/import/descriptors/*.ts`).
- **One shared UI** — an `ImportWizard` in a right-side `<Sheet>` with steps Upload → Map → Preview → Result, opened from any module's Import button.
- **File formats:** CSV **and** XLSX, via the **already-installed `xlsx` (SheetJS ^0.18.5)** package as the single reader for both (`XLSX.read`). **No new parsing library** (no papaparse). First sheet by default; sheet picker when a workbook has several.
- **Auto column detection + smart mapping:** layered strategy — (1) exact normalized match, (2) descriptor synonym dictionary, (3) fuzzy/edit-distance above a confidence threshold, (4) content sniff as tie-breaker — each mapping carrying a confidence surfaced in the UI.
- **Manual mapping UI:** source column (+ sample values) ↔ destination-field dropdown, "map to custom field", and "ignore column". Unmapped required fields block Continue with a reason.
- **Preview + four-count verdict:** Total / Valid / Invalid / Duplicate, over a table with every problem cell flagged inline.
- **Dry-run / "Validate only":** an explicit action that runs full validation and offers the error report **without committing any row** (the preview is already a dry run by construction; this formalises the walk-away path, and is the only validation path for the large-file async tier).
- **Validation engine (per descriptor):** required, data type (text/number/date/email/phone/boolean/lat-lng), length limits, enum/allowed values, unique (within file + against existing), foreign-key/lookup resolution scoped to the tenant.
- **Duplicate handling:** **Skip existing (default)** · Update existing (upsert) · Import all as new.
- **Guided "resolve unknown masters" step:** when a row references a master value that doesn't exist (e.g. Area "Rajkot East"), group the distinct unknowns and let an **admin** — per value — *match to an existing master* (fuzzy-suggested), *create it*, or *reject those rows*. Per-master-type eligibility (see 4.6). **Not** a blind global auto-create toggle.
- **Error reporting:** downloadable CSV mirroring the original file + appended `row_number` and `error_message` columns.
- **Mapping templates:** save a header→field mapping per module, **tenant-shared, admin-managed** (`import_templates`); auto-applied on next matching upload.
- **Import history / audit:** every run recorded in `import_jobs` (who/when/file/mode/counts/mapping/status), surfaced in an Import History view with the error report retrievable.
- **Undo Import (new rows only):** every imported row mapped via `import_row_map`; undo deletes exactly the rows this job created, **within a bounded window**, and is **blocked if any imported row already has dependents**. Upsert (update) imports are **not** undoable in v1 (stated limitation).
- **Large-file tiers 100 → 50,000 rows** (see 4.7 + 5): browser parse/validate/commit for small–mid; Storage upload + `import_staging` + Edge Function async for the top tier.
- **Permissions:** a new `import_data` capability gating the Import button, combined with each module's existing manage/create permission; `import_manage` (admin) for auto-create / undo / template management. Surfaced in **Team → Employee Roles**.
- **Pilot module:** **Product Units** (`product_units`) — flat, no parent, no financial impact, no existing importer to disrupt. Proves the engine end-to-end before any live importer is touched.

**Out of scope (v1) — logged, deliberately deferred:**
- **Migrating the six existing importers.** v1 ships the engine + the Product Units pilot only. Migration of Territories, Customers, Products, Leads, Stock, Tasks happens in later waves (Section 10 rollout) — one at a time, behind their existing buttons, each removing a bespoke parser. Do **not** rip out the existing importers in this spec.
- **Orders / Quotations / Payments / Expenses import** — transactional + money + pricing/approval logic; a separate guided-migration project, never self-serve.
- **WhatsApp data, GPS/visit telemetry, custom-field *definitions*** — never importable (Meta-owned / device-generated evidence / schema metadata).
- **Mobile import** — v1 is **web/desktop-only** (admin workflow). No `SyncEngine` involvement (see Section 6).
- **Full undo of upsert imports** (before-image snapshots) — deferred.
- **Scheduled / API-triggered imports**, cross-file joins, and de-dupe merge (combining two rows) — deferred.

## 3. User Roles & Permissions

| Role | Can see | Can do | RLS / tenant |
|---|---|---|---|
| Owner / Admin | All import UI, history, templates | Import into any module (has `import_data` implied), resolve/create unknown masters, undo, create/edit/delete templates | Bypass via role; `import_manage` implied |
| Employee with `import_data` **and** the module's manage/create permission | Import button on that module; own + tenant history per RLS | Upload, map, validate, commit (Skip/Update/New). **Cannot** create unknown masters (unknowns become reject-or-match-to-existing only) or undo unless also `import_manage` | Scoped to `account_id` |
| Employee with `import_data` but **not** the module permission | — | Cannot import that module (button gated) | Scoped |
| Employee without `import_data` | — | No Import button anywhere | Scoped |
| Viewer (system role) | May view Import History (read) | No import | RLS SELECT only |

- **Two-layer, as per the handbook:** `has_permission()` is the soft UI/action gate; **RLS is the hard backstop**. Because commit runs through a **SECURITY INVOKER** RPC (runs as the user), a tampered client payload still cannot insert cross-tenant or beyond the user's RLS — exactly the payment/stock lesson (a hidden button must not be bypassable via direct REST).
- `import_manage` implies `import_data`. Owner/Admin/superadmin bypass, consistent with `has_permission()`.
- **Auto-create of master data requires `import_manage`** (admin-level) — a deliberately higher bar than plain import, because it writes permanent master records.
- **Permission-key decision (confirmed default):** v1 uses a single baseline `import_data` key + the module's own permission, rather than N per-module `import_<module>` keys. This gives "Salesman ✗ Import" cleanly without inventing a key per table. (If per-module granularity is later needed, descriptors can name a specific required permission — see Open Questions.)

## 4. Data Model

New migration (next sequential timestamp, e.g. `supabase/migrations/20260822HHMMSS_universal_import_framework_v1.sql`) + matching `ROLLBACK-universal-import-framework.md`. All new tables: `account_id uuid not null`, RLS enabled, policies via `is_account_member(account_id, ...)`, `created_at`/`updated_at` with the shared `set_updated_at` trigger. Regenerate TS types after.

### 4.1 `import_jobs` — audit + run state
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK, `default gen_random_uuid()` | |
| `account_id` | uuid NOT NULL | RLS scope |
| `user_id` | uuid NOT NULL | who ran it (`auth.users`) |
| `module` | text NOT NULL | descriptor key, e.g. `product_units` |
| `target_table` | text NOT NULL | from descriptor (whitelist, see undo RPC) |
| `file_name` | text NOT NULL | |
| `file_size` | bigint | bytes |
| `source_format` | text | `csv` \| `xlsx` |
| `mode` | text NOT NULL | `skip` \| `update` \| `new` |
| `status` | text NOT NULL | `validating` \| `previewed` \| `importing` \| `completed` \| `failed` \| `undone` |
| `total_rows` `valid_rows` `invalid_rows` `duplicate_rows` | int | preview verdict |
| `imported_rows` `skipped_rows` `failed_rows` | int | commit result |
| `mapping` | jsonb | resolved `{sourceHeader: fieldKey}` used |
| `template_id` | uuid NULL FK → `import_templates` | if a template was applied |
| `source_file_path` | text NULL | Storage path (kept for async tier + re-download) |
| `error_report_path` | text NULL | Storage path to the generated error CSV |
| `undoable` | boolean NOT NULL default false | true only for insert-only (`skip`/`new`) runs on an undoable target |
| `undo_deadline` | timestamptz NULL | window close (default `completed_at + interval`, see 4.7) |
| `undone_at` `undone_by` | timestamptz / uuid NULL | |
| `created_at` `updated_at` | timestamptz | |

Index: `(account_id, module, created_at desc)` for history; `(account_id, status)`.

### 4.2 `import_row_map` — enables undo of new rows
| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity PK | high-volume append-only |
| `account_id` | uuid NOT NULL | RLS scope |
| `import_job_id` | uuid NOT NULL FK → `import_jobs` | ON DELETE CASCADE |
| `target_table` | text NOT NULL | |
| `record_id` | uuid NOT NULL | the row this job created |
| `created_at` | timestamptz | |

Index `(import_job_id)`. **Why a generic map table instead of an `import_job_id` column on every target table:** avoids a schema change to every importable table and keeps undo logic in one place. Populated by the commit RPC only for insert-only runs.

### 4.3 `import_templates` — saved mappings (tenant-shared)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL | RLS scope; visible to whole tenant |
| `module` | text NOT NULL | |
| `name` | text NOT NULL | e.g. "Tally customer export" |
| `mapping` | jsonb NOT NULL | `{sourceHeader: fieldKey}` |
| `default_mode` | text NULL | remembered duplicate mode |
| `created_by` | uuid NOT NULL | |
| `created_at` `updated_at` | timestamptz | |

Unique `(account_id, module, lower(name))`. RLS: SELECT for any account member; INSERT/UPDATE/DELETE require `import_manage`.

### 4.4 `import_staging` — large-file async tier only
| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity PK | |
| `account_id` | uuid NOT NULL | |
| `import_job_id` | uuid NOT NULL FK | ON DELETE CASCADE |
| `row_number` | int NOT NULL | 1-based source row |
| `raw` | jsonb NOT NULL | mapped row values |
| `status` | text | `pending` \| `valid` \| `invalid` \| `imported` |
| `error` | text NULL | validation message |

Used only when a file crosses the async threshold (4.7). Purged after job completion + undo window.

### 4.5 Permissions
Extend the existing permission model (as `manage_stock` / `manage_leaves` were added): register keys **`import_data`** and **`import_manage`** wherever the permission catalogue/`has_permission()` and the Employee Roles UI enumerate keys. Confirm the real location by inspecting how `manage_stock` was wired in migration 20260821* + the Employee Roles screen — **reuse that exact mechanism**, do not invent a parallel one.

### 4.6 Descriptor contract (TypeScript, not DB) — `src/lib/import/types.ts`
```ts
interface ImportDescriptor {
  module: string;                 // 'product_units'
  targetTable: string;            // 'product_units'
  label: string;                  // 'Product Units'
  requiredPermission?: string;    // extra module perm beyond import_data (e.g. 'manage_products')
  undoable: boolean;              // insert-only undo allowed for this target
  dedupeKeys: string[];           // field keys forming the uniqueness identity
  fields: FieldDescriptor[];
  lookups?: LookupDescriptor[];   // named refs resolved to ids
  childWrites?: ChildWriteDescriptor[]; // tags, custom values, etc.
}
interface FieldDescriptor {
  key: string; label: string;
  required?: boolean;
  type: 'text'|'number'|'integer'|'date'|'email'|'phone'|'boolean'|'latlng';
  maxLength?: number;
  allowed?: string[];             // enum
  unique?: boolean;               // participates in dedupe/uniqueness
  synonyms: string[];             // ['unit name','uom','measure'] → key
}
interface LookupDescriptor {
  field: string;                  // target FK field
  table: string;                  // lookup table
  matchColumns: string[];         // ['name'] or ['sku','name']
  createable: 'never'|'admin';    // guided-resolve eligibility
  createFields?: Record<string,unknown>; // defaults when creating (e.g. color)
}
```
**Pilot descriptor (`descriptors/productUnits.ts`):** `targetTable: 'product_units'`, `undoable: true`, `dedupeKeys: ['name']`, fields `name` (text, required, unique, synonyms `unit`,`uom`,`measure name`) and `short_code`/`symbol` if present on the table (**inspect the real `product_units` columns first**), no lookups, no child writes. Confirm actual columns before finalising.

### 4.7 Large-file thresholds & undo window (constants, one place)
- Async threshold: files **> 10,000 rows** (or **> ~5 MB**) upload to Storage and run via the Edge Function into `import_staging`; at/under that, everything runs browser-parse → chunked commit RPC (500 rows/call).
- Commit chunk size: **500**.
- **Undo window:** `undo_deadline = completed_at + interval '30 minutes'`, **and** implicitly closed when a **newer** completed import on the same `(account_id, module)` exists. (Founder's "10 minutes / until another import" — set 30 min as the constant; make it a single named constant so it's trivially tunable.)

### 4.8 RLS summary
Every table: enable RLS; SELECT/INSERT/UPDATE via `is_account_member(account_id)`; write-privileged actions additionally checked inside RPCs via `has_permission()`. `import_row_map` + `import_staging` are engine-internal (no direct client writes; written by RPC/Edge Function).

## 5. API Contract

All server writes go through RPCs (the repo's "80% rule"); one Edge Function only for the async tier. **SECURITY INVOKER** everywhere except where a DEFINER is explicitly justified.

### 5.1 `import_commit` (RPC, SECURITY INVOKER, idempotent)
- **Name:** `import_commit(p_job_id uuid, p_module text, p_rows jsonb, p_mode text, p_resolutions jsonb)`
- **Request:** `p_rows` = array of mapped row objects (already validated client-side); `p_mode` ∈ `skip|update|new`; `p_resolutions` = `{lookupField: {rawValue: resolvedId|null|"__create__"}}` from the guided-resolve step.
- **Behaviour:** re-verifies `has_permission(auth.uid(), account, 'import_data')` (+ module perm) → 42501 on fail; re-verifies every resolved id belongs to `account_id`; resolves lookups **set-based** (one query per lookup table, not per row); inserts (or upserts for `update`) in batches; for insert-only modes writes `import_row_map`; updates `import_jobs` counts + status. **Idempotent:** guarded so a retried chunk (offline/queue replay) never double-imports — existence check on dedupe key before insert, mirroring `create_order`'s pattern.
- **Response:** `{ imported int, skipped int, failed int, errors: [{row int, message text}] }`.
- **Errors:** `42501` permission; `22xxx` type; unique-violation counted as skipped (not failed) in `skip` mode.

### 5.2 `import_create_masters` (RPC, SECURITY INVOKER, admin-gated)
- **Name:** `import_create_masters(p_module text, p_lookup_field text, p_values jsonb)`
- Requires `has_permission(..., 'import_manage')` → 42501. Only for lookups whose descriptor `createable = 'admin'`. Creates the named masters (with descriptor `createFields` defaults), returns `{ value: newId }` map. Rejects values for `createable:'never'` lookups (e.g. tax slabs).

### 5.3 `import_undo` (RPC, SECURITY INVOKER)
- **Name:** `import_undo(p_job_id uuid)`
- Requires `import_manage`. Loads job; **rejects** if `undoable=false`, if `now() > undo_deadline`, if job `undone`, or if a newer completed import on the same module exists. For each `import_row_map` row: **block if the record has dependents** (checked per target table via a small dependency map in the RPC — e.g. a contact with any `orders`/`site_visits`/`tasks` referencing it). If clean, delete the mapped rows (respecting RLS via INVOKER), mark job `undone` (`undone_at`, `undone_by`), delete `import_row_map` rows.
- **Response:** `{ removed int, blocked int, blocked_reason text[] }`. If any row is blocked, undo is **all-or-nothing refused** with the reason list (no partial undo) — safer and clearer.
- **`target_table` whitelist:** the RPC only operates on tables named by a registered descriptor with `undoable=true`; any other value errors. This closes the dynamic-SQL injection surface.

### 5.4 Edge Function `import-large` (async tier only)
- **Trigger:** client uploads the file to Storage, creates an `import_jobs` row (`status='validating'`), invokes the function with `{ job_id }`.
- **Behaviour:** reads file from Storage, parses with `xlsx`, applies the stored `mapping`, writes rows to `import_staging`, validates, updates verdict counts (`status='previewed'`); on user confirm (or auto for validate-only) commits from staging in batches via the same commit logic, updating counts and `status='completed'`. Uses the **service role** (documented, necessary background path) but still stamps `account_id`/`user_id` from the job and enforces tenant checks in code.
- **Client polls** `import_jobs.status` (or subscribes via Realtime filtered by `account_id`).

### 5.5 Client data layer (`src/lib/import/*`, pure functions)
`parseFile(file) → {headers, rows}` · `detectMapping(headers, descriptor) → MappingResult[]` · `validateRows(rows, mapping, descriptor, existingKeys) → {valid, invalid, duplicate}` · `resolveLookups(...)` · `buildErrorCsv(originalRows, errors) → Blob`. All unit-tested (extend the `parse-contact-csv.test.ts` discipline).

## 6. Mobile Behavior

**N/A — v1 is web/desktop-only by deliberate decision.** Bulk import is an admin onboarding workflow; there is no mobile UI and no `SyncEngine` involvement. This spec touches **no** mobile code. Per the handbook, mobile `SyncEngine` currently covers only `site_visits`/`activities`; this feature does not extend or depend on it. If mobile import is ever wanted, it would enqueue a server-side job rather than commit on-device — a future spec, not this one.

## 7. UI States

Wizard lives in a right-side `<Sheet>` (repo convention for complex forms). States per step:
- **Upload:** empty (dropzone) · file selected (name + row count) · parse error (bad/empty file, unreadable sheet) · template-match prompt ("A saved mapping matches — apply it?").
- **Map:** auto-mapped (high-confidence quiet, low-confidence flagged, unmatched highlighted) · required-field-unmapped (Continue disabled + reason) · all-columns-ignored guard.
- **Preview:** validating (skeleton) · verdict (Total/Valid/Invalid/Duplicate) + flagged table · **all-invalid** (Import disabled, only "Download report") · **has unknown masters** → resolve-unknowns panel (match/create/reject per value; create disabled for non-admins and `createable:'never'` lookups) · duplicate-mode selector (default Skip).
- **Result:** success (counts + "View imported …") · partial (counts + prominent **Download error report**) · failed (reason) · **Undo available** (button + countdown to `undo_deadline`) · undo done · undo blocked (dependents list).
- **Cross-cutting:** loading skeletons for all async; **permission-denied** (no Import button rendered; direct route guarded); offline (web) → disable commit with a clear message. Dark mode verified, no white flash. Import History view: list of `import_jobs` with status pills, counts, and per-row Undo (enabled only within window).

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behavior | Severity |
|---|---|---|
| Excel stores phone as scientific notation / drops leading zeros | Read all cells as **text** (`xlsx` `raw:false`/`cellText`); never coerce numerics for text fields | Blocker |
| CSV with embedded newlines/quotes/BOM, UTF-16, or non-Latin (Hindi/Gujarati) names | `xlsx` reader handles; parse as UTF-8; verify with a fixture test | Blocker |
| Cell begins with `=`,`+`,`-`,`@` (CSV injection) | Treated as data on import; **neutralised** (prefix `'`) when writing the error-report CSV | Warning |
| Unknown master value (Area "Rajkot East") with several casings/typos in one file | Grouped as distinct values in resolve step; admin matches typos to one existing master → no duplicate masters created | Blocker (data quality) |
| Non-admin hits unknown masters | Create disabled; only match-to-existing or reject-rows offered | Info |
| Duplicate within file **and** vs. existing | Counted once as duplicate; Skip mode leaves existing untouched | Info |
| Commit fails midway (row 30k of 50k) | Idempotent chunks → completed chunks persist; job reflects true counts; re-run safely resumes/ skips already-imported | Blocker |
| Same file uploaded twice (anxious re-run) | Skip-default + idempotency → second run imports 0, skips all | Info |
| Undo after a customer already got an order | Undo **refused all-or-nothing** with dependent reason list | Warning |
| Undo after window / after a newer import | Undo button hidden/disabled with explanation | Info |
| File > async threshold | Routed to Storage + Edge Function; "running in background, we'll notify you" | Info |
| Required destination field unmapped | Continue blocked with the specific field named | Warning |
| Tenant A's category id smuggled in payload | Server re-verifies id ∈ account → rejected | Blocker (security) |
| `xlsx` prototype-pollution advisories | Pin/patch to a safe `xlsx` build; validate before trusting parsed objects (see Security) | Warning |

## 9. Reuse Check

**Antigravity must search for and reuse these before writing anything new:**
- **Existing importers (do not duplicate their logic — but do NOT delete them in v1):** `components/contacts/import-modal.tsx`, `lib/contacts/{parse-contact-csv,dedupe,resolve-import-tags}.ts` (the most mature pattern — dedupe by `phone_normalized`, tag resolution, chunked insert with per-row retry: **lift these ideas into the core engine**), `components/leads/lead-import-dialog.tsx`, `components/products/import-products-modal.tsx`, `components/tasks/import-tasks-modal.tsx`, `components/stock/stock-import-dialog.tsx` (+ `stock_bulk_adjust` RPC), `lib/territories/api.ts` `bulkImportTerritories`.
- **UI primitives:** `<Sheet>`, `<Dialog>`, `<DataTable>` (`components/ui/data-table/`), `<Select>`, `<Button>`, `components/ui/gated-button.tsx` — never a raw `<button>`/`<input>`.
- **Auth/permission:** `hooks/use-auth.tsx` (`accountId`, `canEditSettings`), the `has_permission()` RPC, and however `manage_stock` was registered in the permission catalogue + Employee Roles UI.
- **Patterns:** the **report engine registry** (`report_registry_*` + descriptors) as the model for the descriptor registry; `create_order`/`calculate_order_pricing` as the model for an **idempotent SECURITY INVOKER** commit RPC; `set_updated_at`, `is_account_member()`.
- **Storage:** existing Supabase Storage bucket conventions for the source file + error report (reuse an existing bucket pattern; do not create ad-hoc client-side downloads for the report — generate server-side/Storage where the async tier needs it, browser Blob for the small tier).
- **Library:** the **already-installed `xlsx`** package — do **not** add papaparse or any new parser.

## 10. Open Questions

Nearly all resolved during scoping on 2026-08-22. Remaining:
1. **Per-module permission granularity** — v1 ships one `import_data` + module permission. If the founder later wants a visible per-module import toggle in the roles UI, descriptors already carry `requiredPermission`; confirm whether to expose distinct `import_<module>` keys at that point. *(Default: no, keep it simple.)*
2. **Undo window length** — set to **30 minutes** + "until next import". Confirm 30 min is right for onboarding (founder said "10 min / until another import"). Single constant, trivially changed.
3. **Rollout order after the Product Units pilot** — Section-10 waves below are the recommendation; confirm before Wave 1.

**Rollout order (recommendation):**
- **Wave 0 (this spec):** engine + **Product Units** pilot.
- **Wave 1:** other flat lookups (Product Categories, Tax slabs — `createable:'never'`) + **Territories** (migrate off the N+1 importer; exercises self-referential parent-path resolution).
- **Wave 2:** **Customers, Products, Leads** (retire three bespoke importers; add XLSX + mapping UI + error reports; fix the Leads-writes-raw-text-to-lookups bug).
- **Wave 3:** **Opening Stock** (retire the paste box), Tasks, Route customers, Geofences, and Employees (with an invite/provisioning wrapper).
- **Later / separate project:** Orders / Quotations / Payments guided migration.

## 11. Acceptance Criteria

**Functional**
- [ ] From **Products → Product Units** (or its settings screen), an admin can open the Import wizard, upload a CSV **and** an XLSX, map columns, preview, and import — verified with a real file.
- [ ] Auto-mapping resolves `unit`/`uom`/`measure name` → `name` via synonyms; a mis-headed column can be mapped manually; an unmapped required field blocks Continue.
- [ ] Preview shows correct Total/Valid/Invalid/Duplicate on a fixture containing all four; every invalid cell shows a reason.
- [ ] "Validate only" produces the error report and imports **zero** rows.
- [ ] Duplicate mode defaults to **Skip**; re-importing the same file imports 0 / skips all (idempotent) — verified.
- [ ] Downloadable error CSV mirrors the input + `row_number` + `error_message`.
- [ ] Save a mapping template; a subsequent matching upload auto-applies it.
- [ ] `import_jobs` records the run with correct counts; Import History lists it.
- [ ] Undo removes exactly the imported rows within the window; is refused (all-or-nothing, with reasons) when a row has dependents or the window closed.
- [ ] Guided resolve step: unknown masters grouped; admin can match/create/reject; non-admin cannot create; `createable:'never'` lookups never offer create.

**Code Quality** — TS strict, no `any`; core is framework-agnostic pure functions; Product Units importable via **descriptor only**, zero module-specific engine code; Zod validates all RPC/Server-Action inputs.
**Architecture** — one engine + registry; existing importers untouched (not deleted); reuses `<Sheet>`/`<DataTable>`; commit is SECURITY INVOKER + idempotent; no N+1 (lookups set-based).
**Testing** — unit tests for `parseFile` (CSV+XLSX, BOM, quotes, non-Latin), `detectMapping`, `validateRows`, `buildErrorCsv`; an idempotency test (double commit); an undo-blocked-by-dependents test; a cross-tenant-id-rejected test.
**Security** — `import_data`/`import_manage` enforced in RPCs (42501), not just UI; every resolved id re-checked ∈ `account_id`; undo `target_table` whitelisted; CSV-injection neutralised on export; `xlsx` on a patched/safe version; file size/row caps enforced server-side.
**Performance** — 10k-row file commits in chunks with visible progress and no N+1; >10k routes to the async tier without freezing the tab; dedupe uses an indexed key, not an in-memory scan of the whole table.
**Documentation** — `docs/engineering/engineering-handbook.md` module inventory updated with the three new tables + the descriptor pattern; ROLLBACK doc written; an ADR if the descriptor-registry is deemed a major architectural addition.
**Production Readiness** — RLS on all new tables verified (cross-tenant SELECT returns `[]`); migration is `IF NOT EXISTS`; TS types regenerated; pilot verified on the live Product Units screen; core operating loop (WhatsApp → CRM → Field → Expense) unaffected.

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything
1. Read the full Engineering Handbook (`docs/engineering/engineering-handbook.md` or the copy provided) for stack, architecture principles, and code standards.
2. Read this entire specification, including Open Questions and the Rollout order.
3. Search the existing codebase for anything related before writing new code. Specifically search for: the six existing importers and their libs listed in **Section 9 (Reuse Check)**; the **report engine registry** (`report_registry_*` tables + descriptors) as the pattern to mirror; the `create_order`/`calculate_order_pricing` RPCs as the idempotent-SECURITY-INVOKER model; how **`manage_stock`** was registered in the permission catalogue, `has_permission()`, and the **Employee Roles** UI; the real columns of **`product_units`**; existing Supabase **Storage** bucket usage; and the installed **`xlsx`** package usage.
4. Identify the actual naming conventions from real files (components PascalCase `.tsx`, hooks `use*.ts`, services/libs, Server Actions suffixed `Action`) — do not assume.
5. **Do not assume offline support is needed** — this feature is **web-only**; it must not touch `wacrm-mobile` or `SyncEngine`. Confirm that scope against the spec before writing.

### Step 2 — STOP AND ASK triggers
Do not guess or silently choose a default when:
- Anything in **Open Questions** is relevant to the code you're about to write (per-module permission keys; undo-window length; rollout beyond the pilot).
- You find existing code that conflicts with this spec (e.g. an existing importer whose behaviour the engine must preserve; a permission-registration mechanism different from what's described).
- The spec doesn't specify behaviour for a case you hit (an error/permission/type edge).
- You are about to introduce a **new library or pattern** not already in the codebase — note the spec explicitly forbids adding a CSV parser (use `xlsx`); any *other* new dependency is a STOP AND ASK.
- You are about to change a **shared** component/service/table/RPC in a way that could affect other features (e.g. the permission catalogue, a target table's schema).

Ask specific, answerable questions — e.g. "The `product_units` table has no `short_code` column; should the pilot descriptor import only `name`, or add `short_code` as a new column first?"

### Step 3 — Implementation rules
- TypeScript strict, zero errors, no `any` without a justifying comment.
- **Reuse Before Create / Extend Before Replace** — lift the mature contacts-import logic (dedupe, tag resolution, chunked insert with per-row retry) into the shared core rather than re-inventing it. If you wrote new code where existing code could have been extended, undo it and extend.
- Match the Data Model (Section 4) and API Contract (Section 5) exactly. Deviation = STOP AND ASK.
- **Do not delete or rewire the six existing importers in this spec** — v1 is engine + Product Units pilot only. Migrations of the existing importers are later waves.
- Respect multi-tenant isolation (RLS) on every new table/query/RPC — application-level filtering is never sufficient; every resolved id must be re-verified server-side to belong to `account_id`.
- Commit RPC must be **SECURITY INVOKER + idempotent**; undo RPC must whitelist `target_table`.

### Step 4 — Self-verification before declaring done
Check against every item in **Section 11 (Acceptance Criteria)**, category by category (Functional, Code Quality, Architecture, Testing, Security, Performance, Documentation, Production Readiness). Do not mark an item done you could not verify (e.g. async tier if a 50k file wasn't testable) — say so explicitly.

### Step 5 — Report back
1. What was implemented, mapped to the spec's sections.
2. Any deviations and why.
3. New conventions discovered/introduced (so the handbook can be updated) — especially the descriptor registry shape.
4. Any Acceptance Criteria that could not be fully verified and why.
