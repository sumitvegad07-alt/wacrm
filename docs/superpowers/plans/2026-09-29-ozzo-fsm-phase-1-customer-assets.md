# OZZO FSM Phase 1 — Customer Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working per-tenant Customer Asset registry — asset types, assets with serial/warranty/status, list, detail, customer panel, and import — gated behind a new `fsm` product line.

**Architecture:** Additive only. Two new masters (`asset_types`, `customer_assets`) plus a per-account code counter, all RLS-scoped by `account_id`. Assets inherit territory and snapshot the customer's name and phone via one BEFORE INSERT trigger. Pure business rules (settings normalisation, warranty state, code formatting) live in `src/lib/service/` as tested TypeScript; the database owns constraints and defaults. Screens reuse the existing table shell, `FormPageShell` and the territory picker — no new chrome.

**Tech Stack:** Next.js 16 App Router (Server Components by default), React 19, TypeScript strict, Tailwind + Shadcn, Supabase Postgres with RLS, vitest 4.

**Spec:** `docs/engineering/specifications/ozzo-fsm-phase-1-2-assets-and-jobs.md` — read §2, §3, §4.1–4.3b, §4.10–4.12, §5.4, §7.1–7.4, §9, §10 before starting. The spec is authoritative; this plan sequences it.

## Global Constraints

- TypeScript strict. `npm run typecheck` must exit 0 after every task. No `any` without an inline comment justifying it.
- Every RLS policy wraps the auth call as `(select auth.uid())`. A bare `auth.uid()` re-plans per row and regresses a 157-policy performance migration.
- Every `SECURITY DEFINER` function declares `SET search_path = public` on its definition line.
- Every foreign key gets a covering index in the same migration that creates it.
- Migrations are idempotent: `IF NOT EXISTS` or `CREATE OR REPLACE` on every statement. Applying twice is a no-op. Never drop a column holding live data.
- Soft delete via `deleted_at timestamptz NULL`. Unique indexes are partial on `deleted_at IS NULL`.
- `created_by` and any employee reference means **`profiles.id`**, never `auth.users.id`. Check the FK before writing a join.
- Record-form saves use `Promise.all`, never sequential awaits — each round trip to Mumbai costs ~200 ms.
- No changes to `wacrm-mobile` in this plan. Web only.
- No custom-field / EAV path for assets. Founder hard reject, spec §10 ruling 3.
- Tests live beside their module as `*.test.ts` and run under `npm test`.
- Do not add a new dependency. Adding one is a STOP AND ASK.
- Commit after every task. Push to `main` (this project never uses feature branches — Vercel deploys `main`).

---

### Task 1: Add the `fsm` product line and plan gating

**Files:**
- Modify: `src/lib/plans/catalog.ts`
- Test: `src/lib/plans/catalog.test.ts`
- Create: `supabase/migrations/20260929150000_fsm_phase1_customer_assets.sql` (plan backstop only in this task; later tasks append)

**Interfaces:**
- Consumes: nothing.
- Produces: `ProductLine` now includes `"fsm"`; `PlanId` includes `"FSM" | "CRM_FSM" | "SFA_FSM"`; `ModuleKey` includes `"service"`; `MODULE_LINE.service === "fsm"`. Later tasks gate routes on `hasLine(plan, "fsm")` / the existing module-settings guard.

- [ ] **Step 1: Read the file before changing it**

Read `src/lib/plans/catalog.ts` end to end and `src/lib/plans/catalog.test.ts`. Note the exact names of the exported maps and any exhaustiveness helpers — the types are `Record<PlanId, …>` and `Record<ModuleKey, ProductLine>`, so adding a member breaks compilation everywhere a map is missing a key. That is intentional; let the compiler find them all.

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/plans/catalog.test.ts`:

```ts
describe('FSM product line', () => {
  it('includes WFA on every FSM plan, exactly as SFA does', () => {
    expect(PLAN_LINES.FSM.wfa).toBe(true);
    expect(PLAN_LINES.CRM_FSM.wfa).toBe(true);
    expect(PLAN_LINES.SFA_FSM.wfa).toBe(true);
  });

  it('turns the fsm line on for the three FSM plans and off for the rest', () => {
    const withFsm = PLAN_IDS.filter((p) => PLAN_LINES[p].fsm);
    expect(withFsm.sort()).toEqual(['CRM_FSM', 'FSM', 'SFA_FSM']);
  });

  it('keeps CRM out of FSM-only and SFA-only plans', () => {
    expect(PLAN_LINES.FSM.crm).toBe(false);
    expect(PLAN_LINES.SFA_FSM.crm).toBe(false);
    expect(PLAN_LINES.CRM_FSM.crm).toBe(true);
  });

  it('maps the service module to the fsm line', () => {
    expect(MODULE_LINE.service).toBe('fsm');
  });

  it('unlocks the service module only on FSM plans', () => {
    expect(modulesForPlan('FSM').has('service')).toBe(true);
    expect(modulesForPlan('CRM_FSM').has('service')).toBe(true);
    expect(modulesForPlan('SFA_FSM').has('service')).toBe(true);
    expect(modulesForPlan('SFA').has('service')).toBe(false);
    expect(modulesForPlan('CRM').has('service')).toBe(false);
  });

  it('does not change what pre-existing plans unlock', () => {
    expect(modulesForPlan('SFA').has('route')).toBe(true);
    expect(modulesForPlan('CRM').has('whatsapp')).toBe(true);
  });

  it('prices every plan', () => {
    for (const id of PLAN_IDS) expect(PLAN_PRICE[id]).toBeGreaterThan(0);
  });
});
```

The helper that resolves a plan's module set may be named something other than `modulesForPlan` — read the file and use its real exported name. If it is not exported, export it rather than duplicating the logic in the test.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/plans/catalog.test.ts`
Expected: FAIL. TypeScript errors on `PLAN_LINES.FSM` and `MODULE_LINE.service` not existing.

- [ ] **Step 4: Add the line, plans and module key**

In `src/lib/plans/catalog.ts`:

```ts
export type ProductLine = "crm" | "wfa" | "sfa" | "fsm";

export type PlanId = "CRM" | "WFA" | "CRM_WFA" | "SFA" | "CRM_SFA" | "FSM" | "CRM_FSM" | "SFA_FSM";

export const PLAN_IDS: readonly PlanId[] = [
  "CRM", "WFA", "CRM_WFA", "SFA", "CRM_SFA", "FSM", "CRM_FSM", "SFA_FSM",
] as const;
```

Add to `PLAN_LABEL`: `FSM: "FSM"`, `CRM_FSM: "CRM + FSM"`, `SFA_FSM: "SFA + FSM"`.

Add to `PLAN_PRICE` — **placeholders, unapproved, see spec §10 ruling 1. Say so in the commit message:**

```ts
  FSM: 500,
  CRM_FSM: 600,
  SFA_FSM: 800,
```

Every existing entry in `PLAN_LINES` needs the new key, and the three new plans need full rows. FSM includes WFA:

```ts
export const PLAN_LINES: Record<PlanId, Record<ProductLine, boolean>> = {
  CRM:     { crm: true,  wfa: false, sfa: false, fsm: false },
  WFA:     { crm: false, wfa: true,  sfa: false, fsm: false },
  CRM_WFA: { crm: true,  wfa: true,  sfa: false, fsm: false },
  SFA:     { crm: false, wfa: true,  sfa: true,  fsm: false },
  CRM_SFA: { crm: true,  wfa: true,  sfa: true,  fsm: false },
  FSM:     { crm: false, wfa: true,  sfa: false, fsm: true  },
  CRM_FSM: { crm: true,  wfa: true,  sfa: false, fsm: true  },
  SFA_FSM: { crm: false, wfa: true,  sfa: true,  fsm: true  },
};
```

Add `"service"` to `ModuleKey` and to `MODULE_KEYS`, and `service: "fsm"` to `MODULE_LINE`.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run src/lib/plans/catalog.test.ts && npm run typecheck`
Expected: tests PASS. `typecheck` will surface every other file with a now-incomplete `Record<PlanId, …>` or `Record<ProductLine, …>` — fix each by adding the new keys. Do not widen a type to silence it, and do not add `as any`.

- [ ] **Step 6: Add the database backstop**

Create `supabase/migrations/20260929150000_fsm_phase1_customer_assets.sql` starting with a header comment and the plan backstop. Read the current `account_has_line` body first and extend it in the same style — this replaces it, so copy its existing logic exactly and only add the `fsm` branch:

```sql
-- ============================================================
-- 20260929150000_fsm_phase1_customer_assets.sql
-- OZZO FSM Phase 1: plan backstop, asset masters, customer assets.
-- Spec: docs/engineering/specifications/ozzo-fsm-phase-1-2-assets-and-jobs.md
-- Additive only. Idempotent. No existing column is altered.
-- ============================================================

-- account_has_line must recognise 'fsm'. Read the existing function body and
-- preserve it verbatim; the only change is that 'fsm' becomes a valid line.
-- (Replace the body below with the real one plus the fsm case.)
```

STOP AND ASK if `account_has_line`'s current body does not make the extension obvious — guessing at a security backstop is not acceptable.

- [ ] **Step 7: Commit**

```bash
git add src/lib/plans/catalog.ts src/lib/plans/catalog.test.ts supabase/migrations/20260929150000_fsm_phase1_customer_assets.sql
git commit -m "feat(fsm): add fsm product line, FSM/CRM_FSM/SFA_FSM plans, service module key

PLAN_PRICE values for the three FSM plans are PLACEHOLDERS (500/600/800) and
are not founder-approved. See spec section 10 ruling 1 before publishing pricing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Service settings module (pure TypeScript)

**Files:**
- Create: `src/lib/service/settings.ts`
- Create: `src/lib/service/settings.test.ts`
- Create: `src/lib/service/types.ts`

**Interfaces:**
- Consumes: Task 1's `ModuleKey`.
- Produces:
  - `type ServiceSettings = { asset_code_prefix: string; job_no_prefix: string; sla_hours: Record<JobPriority, number>; default_assignment_mode: 'manual' | 'area_based'; require_asset_on_assign: boolean }`
  - `DEFAULT_SERVICE_SETTINGS: ServiceSettings`
  - `normalizeServiceSettings(raw: unknown): ServiceSettings`
  - `type CustomerAsset` and `type AssetType` row shapes
  - `warrantyState(asset: Pick<CustomerAsset,'warranty_end'>, today: Date): 'none' | 'active' | 'expiring' | 'expired'`

This task deliberately defines the whole `ServiceSettings` shape including the Phase 2 SLA keys, so Phase 2 does not have to migrate a settings blob that tenants already wrote.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/service/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SERVICE_SETTINGS,
  normalizeServiceSettings,
  warrantyState,
} from './settings';

describe('normalizeServiceSettings', () => {
  it('returns defaults for null, undefined and non-objects', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(normalizeServiceSettings(bad)).toEqual(DEFAULT_SERVICE_SETTINGS);
    }
  });

  it('keeps supplied values and fills the gaps', () => {
    const out = normalizeServiceSettings({ asset_code_prefix: 'EQP' });
    expect(out.asset_code_prefix).toBe('EQP');
    expect(out.job_no_prefix).toBe(DEFAULT_SERVICE_SETTINGS.job_no_prefix);
  });

  it('uppercases and trims a prefix and strips anything but A-Z0-9', () => {
    expect(normalizeServiceSettings({ asset_code_prefix: '  eq-p 1 ' }).asset_code_prefix).toBe('EQP1');
  });

  it('falls back to the default when a prefix normalises to empty', () => {
    expect(normalizeServiceSettings({ asset_code_prefix: '---' }).asset_code_prefix)
      .toBe(DEFAULT_SERVICE_SETTINGS.asset_code_prefix);
  });

  it('caps a prefix at 6 characters', () => {
    expect(normalizeServiceSettings({ asset_code_prefix: 'ABCDEFGHI' }).asset_code_prefix).toBe('ABCDEF');
  });

  it('rejects non-positive and non-numeric sla hours per priority', () => {
    const out = normalizeServiceSettings({ sla_hours: { critical: 0, high: -1, medium: 'x', low: 96 } });
    expect(out.sla_hours.critical).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.critical);
    expect(out.sla_hours.high).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.high);
    expect(out.sla_hours.medium).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.medium);
    expect(out.sla_hours.low).toBe(96);
  });

  it('rejects an unknown assignment mode', () => {
    expect(normalizeServiceSettings({ default_assignment_mode: 'magic' }).default_assignment_mode)
      .toBe(DEFAULT_SERVICE_SETTINGS.default_assignment_mode);
  });

  it('coerces require_asset_on_assign to a real boolean', () => {
    expect(normalizeServiceSettings({ require_asset_on_assign: false }).require_asset_on_assign).toBe(false);
    expect(normalizeServiceSettings({ require_asset_on_assign: 'no' }).require_asset_on_assign).toBe(true);
  });

  it('never mutates its input', () => {
    const input = { asset_code_prefix: 'x' };
    const copy = structuredClone(input);
    normalizeServiceSettings(input);
    expect(input).toEqual(copy);
  });
});

describe('warrantyState', () => {
  const today = new Date('2026-09-29T00:00:00Z');

  it('is none when no warranty end is recorded', () => {
    expect(warrantyState({ warranty_end: null }, today)).toBe('none');
  });

  it('is expired the day after warranty end', () => {
    expect(warrantyState({ warranty_end: '2026-09-28' }, today)).toBe('expired');
  });

  it('is expiring on the last day of warranty', () => {
    expect(warrantyState({ warranty_end: '2026-09-29' }, today)).toBe('expiring');
  });

  it('is expiring within 30 days inclusive', () => {
    expect(warrantyState({ warranty_end: '2026-10-29' }, today)).toBe('expiring');
  });

  it('is active beyond 30 days', () => {
    expect(warrantyState({ warranty_end: '2026-10-30' }, today)).toBe('active');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/service/settings.test.ts`
Expected: FAIL — cannot resolve `./settings`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/service/types.ts` with the row shapes (`AssetType`, `CustomerAsset`, `JobPriority = 'low'|'medium'|'high'|'critical'`, `AssetStatus = 'active'|'under_repair'|'replaced'|'scrapped'|'inactive'`), mirroring the columns in spec §4.2 and §4.3 exactly.

Create `src/lib/service/settings.ts`:

```ts
import type { JobPriority } from './types';

export type AssignmentMode = 'manual' | 'area_based';

export type ServiceSettings = {
  asset_code_prefix: string;
  job_no_prefix: string;
  sla_hours: Record<JobPriority, number>;
  default_assignment_mode: AssignmentMode;
  require_asset_on_assign: boolean;
};

export const DEFAULT_SERVICE_SETTINGS: ServiceSettings = {
  asset_code_prefix: 'AST',
  job_no_prefix: 'JOB',
  sla_hours: { low: 72, medium: 48, high: 24, critical: 4 },
  default_assignment_mode: 'area_based',
  require_asset_on_assign: true,
};

const PRIORITIES: JobPriority[] = ['low', 'medium', 'high', 'critical'];

function normalizePrefix(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return cleaned.length > 0 ? cleaned : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normalizeServiceSettings(raw: unknown): ServiceSettings {
  if (!isRecord(raw)) return { ...DEFAULT_SERVICE_SETTINGS, sla_hours: { ...DEFAULT_SERVICE_SETTINGS.sla_hours } };

  const slaRaw = isRecord(raw.sla_hours) ? raw.sla_hours : {};
  const sla_hours = { ...DEFAULT_SERVICE_SETTINGS.sla_hours };
  for (const p of PRIORITIES) {
    const v = slaRaw[p];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) sla_hours[p] = v;
  }

  return {
    asset_code_prefix: normalizePrefix(raw.asset_code_prefix, DEFAULT_SERVICE_SETTINGS.asset_code_prefix),
    job_no_prefix: normalizePrefix(raw.job_no_prefix, DEFAULT_SERVICE_SETTINGS.job_no_prefix),
    sla_hours,
    default_assignment_mode:
      raw.default_assignment_mode === 'manual' || raw.default_assignment_mode === 'area_based'
        ? raw.default_assignment_mode
        : DEFAULT_SERVICE_SETTINGS.default_assignment_mode,
    require_asset_on_assign:
      typeof raw.require_asset_on_assign === 'boolean'
        ? raw.require_asset_on_assign
        : DEFAULT_SERVICE_SETTINGS.require_asset_on_assign,
  };
}

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_DAYS = 30;

export function warrantyState(
  asset: { warranty_end: string | null },
  today: Date = new Date(),
): 'none' | 'active' | 'expiring' | 'expired' {
  if (!asset.warranty_end) return 'none';
  // Compare calendar days in UTC. warranty_end is a DATE column, so it carries
  // no time or zone; anchoring both sides to UTC midnight keeps the boundary
  // days stable regardless of where the viewer sits.
  const end = Date.parse(`${asset.warranty_end}T00:00:00Z`);
  if (Number.isNaN(end)) return 'none';
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.floor((end - now) / DAY_MS);
  if (days < 0) return 'expired';
  return days <= EXPIRING_WINDOW_DAYS ? 'expiring' : 'active';
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run src/lib/service/settings.test.ts && npm run typecheck`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/service/
git commit -m "feat(fsm): service settings normaliser and warranty state helper

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration — asset enums, masters and the code counter

**Files:**
- Modify: `supabase/migrations/20260929150000_fsm_phase1_customer_assets.sql`
- Create: `supabase/migrations/ROLLBACK-fsm-phase-1.md`
- Create: `docs/engineering/specifications/verify/fsm-phase-1-verify.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks (SQL is independent of the TS).
- Produces: `asset_status` enum; tables `asset_types`, `service_code_counters`; function `service_next_code(p_account_id uuid, p_kind text, p_prefix text) RETURNS text`. Task 4 depends on all three.

- [ ] **Step 1: Search for an existing code generator before writing one**

Run: `grep -rn "customer_code\|lpad(\|next_code\|_counters" supabase/migrations/*.sql | head -40`

A Customer ID mechanism exists (a duplicate-Customer-ID bug was fixed in `handle_new_user`). If it exposes a reusable per-account sequence function, **use it and skip creating `service_code_counters`**, recording that in the commit message. Only if there is no reusable function, continue to Step 2. Do not create a second mechanism alongside an existing one — that is a STOP AND ASK.

- [ ] **Step 2: Append the enum, masters and counter to the migration**

```sql
-- ── Enums ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM ('active','under_repair','replaced','scrapped','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Asset Types master ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (btrim(name) <> ''),
  code         text NULL,
  status       territory_status NOT NULL DEFAULT 'active',
  is_seed_data boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_types_uniq_name_per_account
  ON public.asset_types (account_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS asset_types_account_status_idx
  ON public.asset_types (account_id, status) WHERE deleted_at IS NULL;

-- ── Per-account code counters ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_code_counters (
  account_id uuid   NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind       text   NOT NULL CHECK (kind IN ('asset','job')),
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, kind)
);

-- Gapless per tenant: the upsert takes a row lock, so concurrent inserts
-- serialise here rather than racing to the same number.
CREATE OR REPLACE FUNCTION public.service_next_code(
  p_account_id uuid, p_kind text, p_prefix text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next bigint;
BEGIN
  INSERT INTO service_code_counters (account_id, kind, last_value)
  VALUES (p_account_id, p_kind, 1)
  ON CONFLICT (account_id, kind)
    DO UPDATE SET last_value = service_code_counters.last_value + 1
  RETURNING last_value INTO v_next;
  RETURN coalesce(nullif(btrim(p_prefix), ''), 'AST') || '-' || lpad(v_next::text, 6, '0');
END; $$;

REVOKE EXECUTE ON FUNCTION public.service_next_code(uuid, text, text) FROM anon;

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.asset_types            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_code_counters  ENABLE ROW LEVEL SECURITY;
```

For the policies on `asset_types`, open the migration that added RLS to an existing master of the same shape (`product_units` is the closest) and **copy its policy structure exactly**, substituting the table name and the `manage_service_settings` permission. Do not invent a third pattern. `service_code_counters` gets RLS enabled with **no policies at all** — only the `SECURITY DEFINER` function touches it, so no client should ever read or write it directly.

- [ ] **Step 3: Seed default asset types for new FSM accounts**

Read `supabase/migrations/20260910120000_seed_territories_on_account_create.sql` and follow its hook pattern exactly. Seed, with `is_seed_data = true`: Water Purifier, Air Conditioner, Elevator, CCTV Camera, UPS / Inverter, Generator, Pump / Motor, Other.

Also backfill existing accounts, matching `20260909160000_backfill_territories_all_tenants.sql`, so a tenant switched onto an FSM plan tomorrow is not looking at an empty master.

- [ ] **Step 4: Write the verification script**

Create `docs/engineering/specifications/verify/fsm-phase-1-verify.sql`. This repo has no DB test harness, so a checked-in script with expected output is the verification artefact:

```sql
-- FSM Phase 1 verification. Run against a Supabase branch, never production.
-- Replace :acct with a real test account_id.

-- 1. Codes are sequential, zero-padded and prefixed. Expect AST-000001, AST-000002.
SELECT public.service_next_code(:'acct', 'asset', 'AST');
SELECT public.service_next_code(:'acct', 'asset', 'AST');

-- 2. Counter state. Expect last_value = 2.
SELECT kind, last_value FROM public.service_code_counters WHERE account_id = :'acct';

-- 3. Empty prefix falls back. Expect AST-000003.
SELECT public.service_next_code(:'acct', 'asset', '   ');

-- 4. Seeded types. Expect 8 rows, all is_seed_data = true.
SELECT count(*), bool_and(is_seed_data) FROM public.asset_types WHERE account_id = :'acct';

-- 5. Duplicate type name is rejected. Expect: unique violation 23505.
INSERT INTO public.asset_types (account_id, name) VALUES (:'acct', 'water purifier');

-- 6. Name reusable after archive. Expect: 1 row inserted, no error.
UPDATE public.asset_types SET deleted_at = now()
 WHERE account_id = :'acct' AND lower(name) = 'other';
INSERT INTO public.asset_types (account_id, name) VALUES (:'acct', 'Other');

-- 7. No policy exposes the counters table. Expect 0 rows.
SELECT policyname FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'service_code_counters';

-- 8. No bare auth.uid() in this migration's policies. Expect 0 rows.
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('asset_types','customer_assets')
   AND (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%select auth.uid()%');
```

- [ ] **Step 5: Apply the migration to a branch and run the verification**

Apply to a Supabase **branch**, not production. Then run `fsm-phase-1-verify.sql` checks 1 through 8 and confirm each expected result. Paste the actual output into the PR description.

Apply the migration a **second** time to the same branch and confirm it succeeds with no error — that proves idempotency.

- [ ] **Step 6: Write the rollback document**

Create `supabase/migrations/ROLLBACK-fsm-phase-1.md` following the format of `ROLLBACK-territory-master.md`. Reverse order: drop policies, then `customer_assets`, `asset_types`, `service_code_counters`, then `service_next_code`, then the trigger functions, then the `asset_status` enum. Note explicitly that the `account_has_line` change must be reverted by restoring the previous function body, and paste that previous body into the document so the rollback is self-contained.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/ docs/engineering/specifications/verify/
git commit -m "feat(fsm): asset_types master, per-account code counter, seeds

Verified on a Supabase branch: sequential codes, prefix fallback, duplicate-name
rejection, name reuse after archive, counters table has no client policy,
migration is idempotent on re-apply.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Migration — `customer_assets`, the inheritance trigger, indexes and RLS

**Files:**
- Modify: `supabase/migrations/20260929150000_fsm_phase1_customer_assets.sql`
- Modify: `docs/engineering/specifications/verify/fsm-phase-1-verify.sql`

**Interfaces:**
- Consumes: `asset_status`, `asset_types`, `service_next_code` from Task 3.
- Produces: table `customer_assets` with every column in spec §4.3, and trigger `customer_assets_defaults()`. Tasks 5 onward query it.

- [ ] **Step 1: Read the trigger this one is modelled on**

Read `supabase/migrations/20260916120000_contacts_denormalize_geo_from_territory.sql` in full, including `territory_flat_geo()`. The new trigger follows its shape: BEFORE INSERT OR UPDATE, only doing work when it must.

- [ ] **Step 2: Append the table**

Write `CREATE TABLE IF NOT EXISTS public.customer_assets` with exactly the columns, types and nullability in spec §4.3, including `customer_name_snapshot` and `customer_phone_snapshot`. Include all three CHECK constraints from the spec (warranty ordering, installation date not in the future beyond one day, and `btrim(name) <> ''`), and both partial unique indexes (`serial_no`, `asset_code`).

Add every index the spec names, including the covering indexes on `asset_type_id`, `product_id`, `territory_id`, `created_by`, and the snapshot search index:

```sql
CREATE INDEX IF NOT EXISTS customer_assets_phone_snapshot_idx
  ON public.customer_assets (account_id, lower(customer_phone_snapshot))
  WHERE customer_phone_snapshot IS NOT NULL AND deleted_at IS NULL;
```

- [ ] **Step 3: Write the defaults trigger**

```sql
CREATE OR REPLACE FUNCTION public.customer_assets_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text; v_name text; v_phone text; v_territory uuid;
BEGIN
  -- Asset code: assigned once, on insert, never rewritten.
  IF TG_OP = 'INSERT' AND (NEW.asset_code IS NULL OR btrim(NEW.asset_code) = '') THEN
    SELECT coalesce(settings->'service_settings'->>'asset_code_prefix', 'AST')
      INTO v_prefix FROM accounts WHERE id = NEW.account_id;
    NEW.asset_code := service_next_code(NEW.account_id, 'asset', v_prefix);
  END IF;

  -- Territory: inherit from the contact ONLY when the asset has none of its own.
  -- An explicitly set territory is never overwritten — the machine may sit
  -- somewhere other than the customer's registered address, and area-based
  -- assignment must follow the machine.
  IF NEW.territory_id IS NULL THEN
    SELECT c.territory_id INTO v_territory
      FROM contacts c WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id;
    NEW.territory_id := v_territory;
  END IF;

  -- Customer snapshots: INSERT ONLY. Never refreshed on UPDATE. A snapshot that
  -- tracks the live record is not a snapshot. Spec section 4.3, founder change 1.
  IF TG_OP = 'INSERT' THEN
    SELECT c.name, c.phone INTO v_name, v_phone
      FROM contacts c WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id;
    NEW.customer_name_snapshot  := coalesce(NEW.customer_name_snapshot,  v_name);
    NEW.customer_phone_snapshot := coalesce(NEW.customer_phone_snapshot, v_phone);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS customer_assets_defaults_trg ON public.customer_assets;
CREATE TRIGGER customer_assets_defaults_trg
  BEFORE INSERT OR UPDATE ON public.customer_assets
  FOR EACH ROW EXECUTE FUNCTION public.customer_assets_defaults();
```

Note the `coalesce` on the snapshots: it lets the importer supply the historical name and phone from a file when they differ from today's contact record, while still defaulting to the contact.

- [ ] **Step 4: Write the RLS policies**

Read the policies on `orders` (or the nearest tenant-scoped transactional table) and match them. SELECT admits any member of the account; INSERT, UPDATE and DELETE additionally require the matching permission from Task 5 via `has_permission()`. Every policy uses `(select auth.uid())`.

**INSERT must be permission-based, not admin-only** — spec §4.12 point 1. An admin-only INSERT policy would force a migration in Phase 4.

- [ ] **Step 5: Extend the verification script**

Append to `fsm-phase-1-verify.sql`:

```sql
-- 9. Asset code auto-assigns. Expect a non-null AST-nnnnnn.
INSERT INTO public.customer_assets (account_id, contact_id, name)
VALUES (:'acct', :'contact', 'Test RO Unit') RETURNING asset_code, territory_id;

-- 10. Territory inherited from the contact. Expect equal.
SELECT a.territory_id = c.territory_id AS inherited
  FROM customer_assets a JOIN contacts c ON c.id = a.contact_id
 WHERE a.name = 'Test RO Unit';

-- 11. Explicit territory is NOT overwritten by an unrelated edit. Expect true.
UPDATE public.customer_assets SET territory_id = :'other_territory' WHERE name = 'Test RO Unit';
UPDATE public.customer_assets SET notes = 'unrelated edit'     WHERE name = 'Test RO Unit';
SELECT territory_id = :'other_territory' AS kept FROM customer_assets WHERE name = 'Test RO Unit';

-- 12. Snapshots frozen. Rename the contact, change its phone, then expect
--     snapshot_unchanged = true AND live_name_changed = true.
UPDATE public.contacts SET name = 'RENAMED LTD', phone = '+919999999999' WHERE id = :'contact';
SELECT a.customer_name_snapshot <> c.name AS snapshot_unchanged,
       c.name = 'RENAMED LTD'             AS live_name_changed
  FROM customer_assets a JOIN contacts c ON c.id = a.contact_id
 WHERE a.name = 'Test RO Unit';

-- 13. Duplicate serial rejected. Expect 23505 on the second insert.
INSERT INTO public.customer_assets (account_id, contact_id, name, serial_no)
VALUES (:'acct', :'contact', 'A', 'SN-1');
INSERT INTO public.customer_assets (account_id, contact_id, name, serial_no)
VALUES (:'acct', :'contact', 'B', 'sn-1');

-- 14. Warranty ordering rejected. Expect 23514.
INSERT INTO public.customer_assets (account_id, contact_id, name, warranty_start, warranty_end)
VALUES (:'acct', :'contact', 'C', '2026-01-01', '2025-01-01');

-- 15. Contact with assets cannot be hard-deleted. Expect 23503.
DELETE FROM public.contacts WHERE id = :'contact';

-- 16. Every FK has a covering index. Expect 0 rows.
SELECT c.conname FROM pg_constraint c
 WHERE c.contype = 'f' AND c.conrelid = 'public.customer_assets'::regclass
   AND NOT EXISTS (
     SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND (i.indkey::smallint[])[0:array_length(c.conkey,1)-1] @> c.conkey);

-- 17. Cross-tenant isolation. Run as a member of another account.
--     Expect 0 rows, then a permission error on the insert.
SELECT count(*) FROM public.customer_assets WHERE account_id = :'acct';
INSERT INTO public.customer_assets (account_id, contact_id, name)
VALUES (:'acct', :'contact', 'Intruder');
```

- [ ] **Step 6: Apply and verify**

Apply to the branch, then run checks 9 through 17 and confirm each. Check 12 has two assertions and **both** must be true — a passing `snapshot_unchanged` with a failing `live_name_changed` means the test itself did nothing.

Then run `ANALYZE public.customer_assets; ANALYZE public.asset_types;`. Skipping `ANALYZE` after a migration leaves the planner blind, which has bitten this project before.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/ docs/engineering/specifications/verify/
git commit -m "feat(fsm): customer_assets table, territory inheritance and customer snapshots

Snapshots are INSERT-only and are never rendered as the customer; every screen
resolves the customer through contact_id. Verified on a branch: checks 9-17.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Permissions and default service roles

**Files:**
- Modify: `src/lib/auth/permissions-registry.ts`
- Modify: `src/lib/auth/permission-groups.ts`
- Test: `src/lib/auth/service-permissions.test.ts` (create)
- Modify: wherever plan-aware default roles are built — find it with the grep in Step 1

**Interfaces:**
- Consumes: Task 1's `PlanId`.
- Produces: `PERMISSIONS.SERVICE_ASSETS.*` and `PERMISSIONS.SERVICE_SETTINGS.*` constants used by Tasks 6–10; default roles Technician, Dispatcher, Service Manager.

- [ ] **Step 1: Locate the default-role builder**

Run: `grep -rn "default.*role\|DEFAULT_ROLES\|plan-aware" src/lib src/app --include=*.ts --include=*.tsx | grep -i role | head -20`

Read what you find before editing. Plan-aware default roles already exist for CRM/WFA/SFA; the FSM roles are additions to that same structure, not a new mechanism.

- [ ] **Step 2: Write the failing test**

Create `src/lib/auth/service-permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from './permissions-registry';

describe('service permission keys', () => {
  it('exposes the asset rights the FSM screens gate on', () => {
    expect(PERMISSIONS.SERVICE_ASSETS.VIEW).toBe('view_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.CREATE).toBe('create_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.EDIT).toBe('edit_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.DELETE).toBe('delete_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.IMPORT).toBe('import_service_assets');
    expect(PERMISSIONS.SERVICE_ASSETS.EXPORT).toBe('export_service_assets');
  });

  it('exposes the settings right', () => {
    expect(PERMISSIONS.SERVICE_SETTINGS.MANAGE).toBe('manage_service_settings');
  });

  it('uses no key that collides with an existing permission string', () => {
    const all: string[] = [];
    const walk = (o: Record<string, unknown>) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'string') all.push(v);
        else if (v && typeof v === 'object') walk(v as Record<string, unknown>);
      }
    };
    walk(PERMISSIONS as unknown as Record<string, unknown>);
    const seen = new Set<string>();
    const dupes = all.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    // Pre-existing intentional aliases are allowed; new service_ keys are not.
    expect(dupes.filter((k) => k.includes('service_'))).toEqual([]);
  });
});
```

The collision test matters: this registry already contains deliberate aliases such as `view_deals` appearing in two groups, so the assertion is scoped to the new `service_` keys rather than demanding global uniqueness.

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/lib/auth/service-permissions.test.ts`
Expected: FAIL — `PERMISSIONS.SERVICE_ASSETS` is undefined.

- [ ] **Step 4: Add the groups**

Append `SERVICE_ASSETS` and `SERVICE_SETTINGS` to `PERMISSIONS` exactly as listed in spec §3. Do **not** add the `SERVICE_JOBS` group — that is Phase 2, and adding unused permission keys now means a half-populated role editor.

Register both groups in `permission-groups.ts` following the existing shape so the role editor renders them with labels.

- [ ] **Step 5: Add the three default roles**

In the default-role builder found in Step 1, add for FSM-enabled plans:

- **Service Manager** — all six `SERVICE_ASSETS` rights, plus `manage_service_settings`.
- **Dispatcher** — `view_service_assets` only (assets read-only; job rights arrive in Phase 2).
- **Technician** — `view_service_assets` only. **Nothing else.** Founder ruling §10 item 4: a technician's create right is opt-in, and in Phase 1 there is nothing for them to create.

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/
git commit -m "feat(fsm): service asset permissions and Technician/Dispatcher/Service Manager roles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Asset data layer

**Files:**
- Create: `src/lib/service/assets/api.ts`
- Create: `src/lib/service/assets/filters.ts`
- Create: `src/lib/service/assets/filters.test.ts`

**Interfaces:**
- Consumes: `CustomerAsset`, `AssetType` (Task 2); `PERMISSIONS.SERVICE_ASSETS` (Task 5); the `customer_assets` table (Task 4).
- Produces:
  - `type AssetFilters = { q?: string; contactId?: string; assetTypeId?: string; status?: AssetStatus[]; warranty?: 'expiring' | 'expired'; territoryId?: string; showInactive?: boolean }`
  - `parseAssetFilters(params: URLSearchParams): AssetFilters`
  - `serializeAssetFilters(f: AssetFilters): URLSearchParams`
  - `assetFilterSummary(f: AssetFilters): string` — used by the list's "no match" empty state
  - `listAssets`, `getAsset`, `createAsset`, `updateAsset`, `archiveAsset` in `api.ts`

Filters are split into their own file because they are pure and therefore the only part of this layer that can be unit-tested; `api.ts` is thin Supabase calls that the screens exercise.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/service/assets/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAssetFilters, serializeAssetFilters, assetFilterSummary } from './filters';

describe('parseAssetFilters', () => {
  it('returns an empty filter set for no params', () => {
    expect(parseAssetFilters(new URLSearchParams())).toEqual({});
  });

  it('trims the search term and drops it when blank', () => {
    expect(parseAssetFilters(new URLSearchParams('q=  ')).q).toBeUndefined();
    expect(parseAssetFilters(new URLSearchParams('q=  ro+unit ')).q).toBe('ro unit');
  });

  it('parses a repeated status param into an array', () => {
    expect(parseAssetFilters(new URLSearchParams('status=active&status=scrapped')).status)
      .toEqual(['active', 'scrapped']);
  });

  it('ignores an unknown status value', () => {
    expect(parseAssetFilters(new URLSearchParams('status=active&status=banana')).status)
      .toEqual(['active']);
  });

  it('accepts only the two warranty values', () => {
    expect(parseAssetFilters(new URLSearchParams('warranty=expiring')).warranty).toBe('expiring');
    expect(parseAssetFilters(new URLSearchParams('warranty=soon')).warranty).toBeUndefined();
  });

  it('reads showInactive only from the literal string true', () => {
    expect(parseAssetFilters(new URLSearchParams('showInactive=true')).showInactive).toBe(true);
    expect(parseAssetFilters(new URLSearchParams('showInactive=1')).showInactive).toBeUndefined();
  });
});

describe('serializeAssetFilters', () => {
  it('round-trips every supported filter', () => {
    const f = {
      q: 'kent', contactId: 'c1', assetTypeId: 't1',
      status: ['active' as const], warranty: 'expiring' as const,
      territoryId: 'z1', showInactive: true,
    };
    expect(parseAssetFilters(serializeAssetFilters(f))).toEqual(f);
  });

  it('omits empty values rather than writing blanks', () => {
    expect(serializeAssetFilters({ q: '', status: [] }).toString()).toBe('');
  });
});

describe('assetFilterSummary', () => {
  it('is empty when nothing is filtered', () => {
    expect(assetFilterSummary({})).toBe('');
  });

  it('names the active filters for the no-match empty state', () => {
    expect(assetFilterSummary({ q: 'kent', warranty: 'expired' }))
      .toBe('search "kent", warranty expired');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/lib/service/assets/filters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `filters.ts`**

Write the three pure functions to satisfy the tests. `parseAssetFilters` validates against the literal status and warranty unions from `types.ts` rather than casting. `serializeAssetFilters` omits keys whose value is empty, `undefined`, or an empty array.

- [ ] **Step 4: Implement `api.ts`**

Thin functions over `supabase-js`, each taking an authenticated client. Rules:
- `listAssets` selects the asset columns plus a joined `contacts(name, phone)` and `asset_types(name)`. **The Customer column reads the joined contact, never the snapshot** — spec §4.3.
- Free-text `q` matches `name`, `serial_no`, `asset_code` **and** `customer_phone_snapshot`, so an old phone number still finds the machine.
- `showInactive` false adds `.is('deleted_at', null)` and excludes `scrapped`; true returns everything.
- `archiveAsset` sets `deleted_at`. There is no hard delete.
- `createAsset` and `updateAsset` never send `asset_code`, `territory_id` when blank, or either snapshot — the trigger owns all three.
- Any multi-statement save uses `Promise.all`.

- [ ] **Step 5: Run everything**

Run: `npx vitest run src/lib/service/ && npm run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/service/assets/
git commit -m "feat(fsm): asset data layer and URL filter parsing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Asset list screen

**Files:**
- Create: `src/app/(dashboard)/service/layout.tsx`
- Create: `src/app/(dashboard)/service/assets/page.tsx`
- Create: `src/components/service/asset-list.tsx`
- Create: `src/components/service/warranty-pill.tsx`
- Modify: `src/app/(dashboard)/dashboard-shell.tsx` (nav)

**Interfaces:**
- Consumes: `listAssets`, `parseAssetFilters` (Task 6); `warrantyState` (Task 2); `PERMISSIONS.SERVICE_ASSETS.VIEW` (Task 5).
- Produces: the route `/service/assets`, and `<WarrantyPill state={...} endDate={...} />` reused by Tasks 9 and 10.

- [ ] **Step 1: Read the pattern you are copying**

Open the products or price-lists list page and read it fully: the pinned Action column, the Show-Inactive toggle, the ConfirmDialog wiring, the skeleton, and how filters reach the server. Copy that structure. If you find yourself writing a table shell, stop — one exists.

- [ ] **Step 2: Gate the route**

`src/app/(dashboard)/service/layout.tsx` is a Server Component that redirects unless the account's plan has the `fsm` line **and** the user holds `view_service_assets`. Find how an existing plan-gated route does this (the route module is gated on the `sfa` line) and reuse it.

- [ ] **Step 3: Build the list**

Columns in order: Asset Code, Name, Customer, Type, Serial No, Warranty End, Status, Action (pinned). Warranty End renders `<WarrantyPill>`: neutral for `none` and `active`, amber for `expiring`, red for `expired`.

Implement all four states from spec §7.1 as distinct branches:
- **No assets at all** — "No assets yet." with Add Asset and Import Assets.
- **Filters match nothing** — "No assets match these filters." with the text from `assetFilterSummary` and a Clear filters button.
- **Load failed** — "Could not load assets." with Retry. Never an empty table on error.
- **Loading** — the existing skeleton.

Getting the first two confused is the specific bug to avoid: never show onboarding copy to someone who has 400 assets and a filter applied.

- [ ] **Step 4: Add the nav entry**

Add a Service section with Assets to the nav in `dashboard-shell.tsx`, hidden unless the plan has `fsm` and the user holds `view_service_assets`, matching how existing plan-gated items hide.

- [ ] **Step 5: Verify in the browser**

Start the dev server with the preview tool, not Bash. Then confirm, on a test tenant switched to the FSM plan:
1. `/service/assets` renders with the nav item visible.
2. With zero assets, the onboarding empty state shows.
3. Insert three assets by SQL, including one with `warranty_end` yesterday and one 10 days out; confirm red and amber pills.
4. Apply a filter that matches nothing and confirm the **no-match** state, not the onboarding one.
5. Switch the tenant to the `CRM` plan and confirm the nav item disappears and `/service/assets` redirects.
6. Check the browser console for errors and the network tab for a failed request.

Capture a screenshot of the populated list for the PR.

- [ ] **Step 6: Run checks and commit**

```bash
npm run typecheck && npm run lint
git add src/app/\(dashboard\)/service/ src/components/service/ src/app/\(dashboard\)/dashboard-shell.tsx
git commit -m "feat(fsm): asset list screen with warranty pills and plan gating

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Asset create and edit form

**Files:**
- Create: `src/app/(dashboard)/service/assets/new/page.tsx`
- Create: `src/app/(dashboard)/service/assets/[id]/edit/page.tsx`
- Create: `src/components/service/asset-form.tsx`

**Interfaces:**
- Consumes: `createAsset`, `updateAsset`, `getAsset` (Task 6); `FormPageShell`, `FormActions`, the territory picker.
- Produces: `<AssetForm asset?={CustomerAsset} lockedContactId?={string} />`, reused by Task 10's panel.

- [ ] **Step 1: Read the shells before writing the form**

Read `FormPageShell`, `FormActions`, and one recent form that uses both. Also read the order-from-visit screen to see how a parent record is locked, because `lockedContactId` follows that pattern.

- [ ] **Step 2: Build the form**

Four field groups, in this order: Identity (customer, name, asset type, product, make, model no, serial no) · Lifecycle (installation date, warranty start, warranty end, status) · Placement (site label, territory) · Notes.

Behaviour that is not optional:
- When `lockedContactId` is set, the customer field renders read-only with the customer's name, exactly as order-from-visit locks its customer.
- Territory is left **blank** by default with helper text "Inherited from the customer if left blank." Do not pre-fill it from the contact in the UI — the trigger owns that, and pre-filling would convert every asset into an explicitly-set territory and break the "machine can sit elsewhere" behaviour.
- Warranty end before warranty start blocks submit with an inline message, before any request.
- A `23505` on the serial index is caught and rendered as "Serial {value} already exists on asset {code}" with a link to that asset. Fetch the conflicting asset's code to build the message. A raw constraint string must never reach the user.
- The save uses `Promise.all` if it writes more than once.

- [ ] **Step 3: Verify in the browser**

1. Create an asset with only customer and name; confirm an `AST-nnnnnn` code appears on the detail screen and territory was inherited.
2. Create an asset with an explicit territory different from the customer's; edit its notes; confirm the territory is unchanged.
3. Enter a serial that already exists; confirm the friendly message and the working link.
4. Enter warranty end before start; confirm submit is blocked inline with no network request.
5. Open the form from a customer's panel (after Task 10) and confirm the customer is locked.

- [ ] **Step 4: Run checks and commit**

```bash
npm run typecheck && npm run lint
git add src/app/\(dashboard\)/service/assets/ src/components/service/asset-form.tsx
git commit -m "feat(fsm): asset create and edit form with serial conflict handling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Asset detail screen

**Files:**
- Create: `src/app/(dashboard)/service/assets/[id]/page.tsx`
- Create: `src/components/service/asset-detail-header.tsx`

**Interfaces:**
- Consumes: `getAsset` (Task 6); `<WarrantyPill>` (Task 7); the existing `<Timeline>` component and `module_activities`.
- Produces: the route `/service/assets/[id]`.

- [ ] **Step 1: Build the header and Details tab**

Header: asset code, name, a link to the customer, status pill, warranty pill, Edit and Archive actions (Archive behind `delete_service_assets`, via ConfirmDialog).

Details tab: every field read-only, grouped as the form groups them. Show the customer as the **live joined contact name**, with the snapshot displayed only if it differs, labelled "recorded at creation". That makes the snapshot visible as history without letting it masquerade as the current customer.

- [ ] **Step 2: Add the Timeline tab**

Reuse the existing `<Timeline>` over `module_activities` filtered to this asset. Confirm how other modules write their activity rows and write asset create/edit rows the same way. If assets are not yet written to `module_activities`, add that to `api.ts` as a non-blocking call, following the pattern from the 2026-09-15 performance work — an activity log must never delay or fail the save.

- [ ] **Step 3: Add a placeholder-free Service Jobs tab**

Phase 2 owns the content. In Phase 1 render the tab with a real, honest empty state: "Service history appears here once job management is enabled." Do **not** write a TODO, a stub table, or a fake row.

- [ ] **Step 4: Verify in the browser**

1. Open an asset and confirm all fields, both pills and the customer link.
2. Rename the contact by SQL, reload, and confirm the header shows the **new** name while the Details tab shows the snapshot labelled as recorded at creation.
3. Archive an asset and confirm it leaves the default list and appears under Show Inactive.
4. Confirm the timeline shows the create and edit entries.

- [ ] **Step 5: Run checks and commit**

```bash
npm run typecheck && npm run lint
git add src/app/\(dashboard\)/service/assets/ src/components/service/
git commit -m "feat(fsm): asset detail screen with timeline and snapshot provenance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Assets panel on the customer detail page

**Files:**
- Modify: `src/app/(dashboard)/contacts/[id]/page.tsx`
- Create: `src/components/service/customer-assets-panel.tsx`

**Interfaces:**
- Consumes: `listAssets` (Task 6); `<WarrantyPill>` (Task 7); `<AssetForm lockedContactId>` (Task 8).
- Produces: nothing downstream.

- [ ] **Step 1: Read the contact detail page**

Read it fully and find how existing panels are composed and gated. Add the assets panel the same way. Do not restructure the page.

- [ ] **Step 2: Build the panel**

Lists that customer's assets — code, name, type, serial, warranty pill, status — with Add Asset (opens the form with the customer locked) and "View all" linking to `/service/assets?contactId=…`. Paginate at 25.

Renders only when the plan has the `fsm` line **and** the user holds `view_service_assets`. Empty state: "No assets recorded for this customer."

This panel is what makes the workflow feel connected rather than like a separate app, so it is not optional.

- [ ] **Step 3: Verify in the browser**

1. On an FSM tenant, open a customer with assets and confirm the panel lists them.
2. Add an asset from the panel and confirm the customer field is locked and the new asset appears without a full reload.
3. Confirm "View all" lands on the asset list already filtered to that customer.
4. Switch to a CRM-only tenant and confirm the panel is absent and the rest of the page is unchanged.

- [ ] **Step 4: Run checks and commit**

```bash
npm run typecheck && npm run lint
git add src/app/\(dashboard\)/contacts/ src/components/service/customer-assets-panel.tsx
git commit -m "feat(fsm): customer assets panel on contact detail

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Asset import

**Files:**
- Create: `src/lib/import/descriptors/customer-assets.ts`
- Create: `src/lib/import/descriptors/customer-assets.test.ts`
- Modify: `src/lib/import/registry.ts`
- Modify: the `import_commit` and `import_undo` RPCs — new migration `supabase/migrations/20260929155000_fsm_import_customer_assets.sql`

**Interfaces:**
- Consumes: `ImportDescriptor` from `src/lib/import/types.ts`; the `customer_assets` table (Task 4).
- Produces: `customerAssetsDescriptor`, registered under the module key `customer_assets`.

- [ ] **Step 1: Read the existing descriptors and the commit RPC**

Read `descriptors/product-units.ts`, `descriptors/masters.ts`, `types.ts`, `registry.ts`, and the `import_commit` / `import_undo` function bodies. Note precisely how a lookup field declares its resolution and how a per-row failure reason is returned, because the reasons are user-visible.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/import/descriptors/customer-assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { customerAssetsDescriptor as d } from './customer-assets';
import { getImportDescriptor } from '../registry';

const field = (key: string) => d.fields.find((f) => f.key === key);

describe('customer assets import descriptor', () => {
  it('is registered under its module key', () => {
    expect(getImportDescriptor('customer_assets')).toBe(d);
  });

  it('targets the right table and requires the import right', () => {
    expect(d.targetTable).toBe('customer_assets');
    expect(d.requiredPermission).toBe('import_service_assets');
    expect(d.undoable).toBe(true);
  });

  it('dedupes on serial number', () => {
    expect(d.dedupeKeys).toEqual(['serial_no']);
  });

  it('requires a customer and a name, and nothing else', () => {
    expect(d.fields.filter((f) => f.required).map((f) => f.key).sort())
      .toEqual(['customer', 'name']);
  });

  it('never accepts a territory column from the file', () => {
    expect(field('territory')).toBeUndefined();
    expect(field('territory_id')).toBeUndefined();
  });

  it('never accepts an asset code from the file', () => {
    expect(field('asset_code')).toBeUndefined();
  });

  it('gives the customer field phone and code synonyms so real files map cleanly', () => {
    const syn = field('customer')!.synonyms ?? [];
    expect(syn).toContain('customername');
    expect(syn).toContain('mobile');
    expect(syn).toContain('customercode');
  });

  it('offers every asset status as an enum option', () => {
    expect(field('status')!.options?.sort())
      .toEqual(['active', 'inactive', 'replaced', 'scrapped', 'under_repair']);
  });

  it('caps rows to protect the commit RPC', () => {
    expect(d.maxRows).toBeLessThanOrEqual(5000);
  });
});
```

Field option and synonym property names must match `ImportDescriptor` in `types.ts` — read it and adjust these assertions to the real property names before implementing.

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run src/lib/import/descriptors/customer-assets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the descriptor and register it**

Fields: `customer` (lookup, required), `asset_type` (lookup), `product` (lookup), `name` (required), `make`, `model_no`, `serial_no`, `installation_date`, `warranty_start`, `warranty_end`, `status`, `site_label`, `notes`.

Lookup rules, which exist because a previous importer silently created 15 bogus Country-level territories:
- **customer** → existing `contacts` by customer code, then phone in E.164, then exact name. **Never creates a contact.** Unresolved fails the row with `customer_not_found`.
- **asset_type** → by name, case-insensitive. May create a missing type only when the user ticks "create missing asset types"; default off.
- **product** → by code then name. **Never creates a product.**
- **No territory field exists.** Territory comes from the contact via the trigger.
- Dates accept `dd-mm-yyyy`, `dd/mm/yyyy` and ISO. A two-digit year fails the row rather than guessing a century.

Register in `registry.ts` alongside the existing descriptors.

- [ ] **Step 5: Add the `import_commit` and `import_undo` branches**

New migration `20260929155000_fsm_import_customer_assets.sql`. The commit branch inserts into `customer_assets` and lets the trigger assign code, territory and snapshots. Map `23505` on the serial index to the reason `duplicate_serial`, including the existing asset's code in the message. The undo branch deletes exactly the rows this job created, matching how the existing branches scope an undo.

- [ ] **Step 6: Verify end to end**

Build a 20-row CSV containing: 15 good rows, one unknown customer, one duplicate serial against an existing asset, one `warranty_end` before `warranty_start`, one row with a Territory column populated, and one `installation_date` of `01-02-26`.

Confirm: 15 commit; the unknown customer fails `customer_not_found`; the duplicate fails `duplicate_serial` naming the existing code; the bad warranty fails on the CHECK; the Territory column is ignored and that asset inherits from its contact; the two-digit year fails rather than guessing. Then undo and confirm exactly 15 rows are removed and no contact, product or asset type was created.

- [ ] **Step 7: Run checks and commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/import/ supabase/migrations/
git commit -m "feat(fsm): customer asset import with strict lookups

Territory is never read from the file and never created; it is inherited from the
resolved contact. Customers and products are never auto-created.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Service settings screen

**Files:**
- Create: `src/app/(dashboard)/settings/service/page.tsx`
- Create: `src/components/service/asset-types-master.tsx`
- Create: `src/components/service/service-settings-form.tsx`

**Interfaces:**
- Consumes: `normalizeServiceSettings`, `DEFAULT_SERVICE_SETTINGS` (Task 2); `PERMISSIONS.SERVICE_SETTINGS.MANAGE` (Task 5).
- Produces: nothing downstream. Phase 2 extends this page with SLA hours and job categories.

- [ ] **Step 1: Build the Asset Types master**

List, add, edit, archive. Archive is **blocked** when assets reference the type, with the message naming the count: "12 assets use this type. Reassign them first." Seeded types are archivable — they are marked `is_seed_data`, not protected.

- [ ] **Step 2: Build the settings form**

Asset code prefix only, in Phase 1. Run the input through `normalizeServiceSettings` before saving, and show the user the normalised result so "eq-p 1" visibly becoming "EQP1" is not a surprise. Persist under `accounts.settings.service_settings`, merging rather than replacing the settings object — clobbering a sibling key such as `territory_settings` would break an unrelated module.

Gate the whole page on `manage_service_settings`.

- [ ] **Step 3: Verify in the browser**

1. Add a type, use it on an asset, try to archive it, confirm the blocking message and count.
2. Archive an unused type and confirm it leaves the picker but existing assets keep their label.
3. Set the prefix to `eq-p 1`, save, confirm it stores as `EQP1` and the next new asset gets `EQP1-nnnnnn`.
4. Read `accounts.settings` by SQL and confirm `territory_settings` is untouched.
5. Sign in as a user without `manage_service_settings` and confirm the page is inaccessible.

- [ ] **Step 4: Run checks and commit**

```bash
npm run typecheck && npm run lint
git add src/app/\(dashboard\)/settings/service/ src/components/service/
git commit -m "feat(fsm): service settings page with asset types master and code prefix

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Phase 1 acceptance pass

**Files:**
- Modify: `wacrm-web/PROJECT.md`
- Modify: `docs/engineering/specifications/ozzo-fsm-phase-1-2-assets-and-jobs.md` (tick the Phase 1 criteria)

**Interfaces:** consumes everything; produces the record that Phase 1 is done.

- [ ] **Step 1: Walk spec §11 category by category**

Go through Functional, Code Quality, Architecture, Testing, Security, Performance, Documentation and Production Readiness. Tick only Phase-1 items. For each, record *how* it was verified — a command, a SQL result, or a screenshot. "Looks good" is not a verification.

The two that must not be assumed:
- **Cross-tenant isolation** — verification checks 17, executed as a real second-tenant session, not by reading the policy text.
- **Snapshot freeze plus live-name change** — verification check 12, both assertions true.

- [ ] **Step 2: Prove no regression for existing tenants**

On a real existing CRM-only account: no Service nav item, no `/settings/service`, no assets panel on customer detail, and contacts, orders and products all behave unchanged. This is the check that matters most, because every live tenant is on a non-FSM plan.

- [ ] **Step 3: Confirm index coverage and planner health**

Run verification check 16 (every FK covered) and `EXPLAIN (ANALYZE, BUFFERS)` on the asset list's default query with 10,000 seeded assets. Confirm an index scan, not a sequential scan. Attach the output.

Confirm `ANALYZE` has been run on both new tables.

- [ ] **Step 4: Full suite**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```
All four must pass. `build` is included because a Server Component mistake often only surfaces there.

- [ ] **Step 5: Update the docs**

Add the FSM module to `PROJECT.md`: the new tables, the routes, the permission keys, the three default roles, and a pointer to the spec. Tick the Phase 1 acceptance criteria in the spec with their verification notes.

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "docs(fsm): Phase 1 acceptance pass — customer assets complete

Verified: cross-tenant isolation as a second tenant, snapshot freeze with live
name change, FK index coverage, index scan on the list query with 10k rows, and
no behaviour change for an existing CRM-only account.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 7: Report the commit hash**

Nothing is done until it is committed, pushed and deployed. Report the hash, and confirm the Vercel deployment succeeded.

---

## Self-Review

**Spec coverage.** Phase 1 requirements map as follows: `customer_assets` → Task 4 · Asset Types → Tasks 3, 12 · serial number, installation date, warranty start/end, asset status → Task 4 columns and Task 8 form · Asset Detail Screen → Task 9 · Asset List under Customer → Task 10 · Asset Import → Task 11. Spec §3 permissions → Task 5. §4.12 readiness → the INSERT policy in Task 4 Step 4, with full verification deferred to Phase 2 where `service_jobs` exists. §10 ruling 3 (no custom fields) → nothing in this plan adds an EAV path. §13.1 (Order → Asset) → correctly absent; it is a future note, not work.

**Deliberately not in this plan.** `job_categories`, `service_jobs`, the SLA trigger, the status guard, the area resolver, the three RPCs, and the job screens are all Phase 2. The `ServiceSettings` type in Task 2 already carries the Phase 2 SLA keys so tenants never write a settings blob that later needs migrating.

**Type consistency.** `ServiceSettings`, `AssetFilters`, `warrantyState`, `parseAssetFilters`, `serializeAssetFilters`, `assetFilterSummary`, `service_next_code(uuid, text, text)` and `customer_assets_defaults()` are each defined once and referenced by the same name throughout. `<WarrantyPill>` is produced in Task 7 and consumed in Tasks 9 and 10. `<AssetForm lockedContactId>` is produced in Task 8 and consumed in Task 10.

**Known soft spots, called out rather than hidden.** Three places direct the implementer to read an existing file and match it instead of giving literal code: the `account_has_line` body (Task 1 Step 6), the RLS policy shape (Tasks 3 and 4), and the default-role builder (Task 5 Step 1). Each is a deliberate instruction to match an existing pattern rather than a guess, and each has a STOP AND ASK attached. Inventing SQL for a security backstop I have not read would be worse than sending the implementer to read it.
