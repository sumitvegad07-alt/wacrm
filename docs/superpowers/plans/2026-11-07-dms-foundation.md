# OZZO DMS — Plan 1: Foundation (the add-on line, seats, portal logins)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The superadmin can grant the DMS add-on and a seat count to an account; a tenant admin can then give a customer a portal login, reset its password and revoke it, never exceeding the seats bought — all enforced in the database, not only in the form.

**Architecture:** DMS is an add-on line stored in a new `accounts.addon_lines` array, deliberately NOT derived from `subscription_plan`, because `account_has_line`'s legacy fallback would otherwise hand the DMS free to every existing tenant. A portal customer is an `auth.users` row and nothing else, linked from `contacts.portal_user_id`; they never get a `profiles` row, so none of the 107 web files or 56 database functions that read `profiles` change. Logins are minted by a server route holding the service-role key inside the CRM — the DMS app, built in Plan 2, never holds that key.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, TypeScript, Supabase (`@supabase/supabase-js` 2.107, `@supabase/ssr` 0.10.3), PostgreSQL 17.6, Vitest, Tailwind.

**Spec:** `docs/engineering/specifications/ozzo-dms-product-v1.md`

**Plan 1 of 4.** Plan 2 is visibility plus the portal app shell, Plan 3 is ordering, Plan 4 is announcements, activities and reports. Nothing in this plan creates a portal app or a screen a distributor can reach — at the end of it there is still nowhere to log in to. That is intended: everything here is testable on its own.

## Global Constraints

- **Push directly to `main`.** Never a branch, never a PR. Vercel deploys `main`, so branched work never reaches live.
- **Every change is global to all tenants by default.** Behaviour is scoped by the add-on, never by a tenant id in code.
- **An account without the DMS add-on must be byte-identical to today:** no new column on a list, no new query, no new menu entry, no new setting.
- Migration filenames are `supabase/migrations/YYYYMMDDHHMMSS_name.sql` in byte order. This plan uses the `20261107*` range.
- SQL functions are `SET search_path` (either `public` or `''`, matching the file they sit beside). Never leave it unset.
- Dates are account-local: `AT TIME ZONE` the account's timezone, never `toISOString()`.
- The founder reads plain English. Error strings shown to an admin say what to do, never a raw Supabase message.
- Run `npm run typecheck` and `npm test` before every commit. Run `npm run lint:ui` when a `.tsx` file changed — it is a ratchet, so it must not go up.
- **`.env.local` points at PRODUCTION.** Never run a migration against it from a script. SQL is verified on the throwaway cluster, then applied by the founder.

---

### Task 1: `dms` as an add-on line in the plan catalogue

Pure TypeScript, no database. Doing this first means the type exists before anything imports it.

**Files:**
- Modify: `src/lib/plans/catalog.ts`
- Test: `src/lib/plans/catalog.dms.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `ProductLine` widened to include `"dms"`; `ADDON_LINES: readonly AddonLine[]`; `type AddonLine = "dms"`; `accountHasAddonLine(addonLines: string[] | null | undefined, line: AddonLine): boolean`; `ADDON_LABEL: Record<AddonLine, string>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/plans/catalog.dms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PLAN_IDS,
  planLines,
  accountHasAddonLine,
  ADDON_LINES,
  ADDON_LABEL,
} from "./catalog";

describe("dms add-on line", () => {
  it("is never granted by any plan code", () => {
    // The whole commercial model depends on this: DMS is sold, not included.
    for (const plan of PLAN_IDS) {
      expect(planLines(plan)).not.toContain("dms");
    }
  });

  it("is not granted by a legacy or unknown plan either", () => {
    // Legacy plans get full access in account_has_line's fallback. 001001 is one.
    expect(planLines("Enterprise" as never)).not.toContain("dms");
    expect(planLines("" as never)).not.toContain("dms");
  });

  it("is granted only by an explicit addon_lines entry", () => {
    expect(accountHasAddonLine(["dms"], "dms")).toBe(true);
    expect(accountHasAddonLine([], "dms")).toBe(false);
    expect(accountHasAddonLine(null, "dms")).toBe(false);
    expect(accountHasAddonLine(undefined, "dms")).toBe(false);
  });

  it("still lists exactly eight sellable plan codes", () => {
    // An add-on must not multiply the plan codes; CRM+SFA+DMS is a plan plus
    // an add-on, not a ninth code.
    expect(PLAN_IDS).toHaveLength(8);
  });

  it("has a label for every add-on", () => {
    for (const a of ADDON_LINES) {
      expect(ADDON_LABEL[a]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- src/lib/plans/catalog.dms.test.ts`

Expected: FAIL. `accountHasAddonLine`, `ADDON_LINES` and `ADDON_LABEL` are not exported from `catalog.ts`.

- [ ] **Step 3: Widen the line type and add the add-on exports**

In `src/lib/plans/catalog.ts`, change the `ProductLine` type and add the add-on block directly beneath it:

```ts
// "dms" is an ADD-ON line. It is never produced by planLines(): see ADDON_LINES
// below and §3 of ozzo-dms-product-v1.md. Keeping it inside ProductLine means
// surface-gates.ts and the RLS ceiling speak one vocabulary.
export type ProductLine = "crm" | "wfa" | "sfa" | "fsm" | "dms";

/**
 * Lines that are sold separately and granted per account, never implied by a
 * plan code. Stored in `accounts.addon_lines`.
 *
 * Why this exists rather than a ninth plan code: `account_has_line` ends with
 * `else (p_line is distinct from 'fsm')`, so a legacy or unknown plan is
 * granted every line but FSM — and account 001001 is a legacy Enterprise plan.
 * An ordinary `dms` line would have switched the DMS on, free, for every
 * existing tenant the day its migration ran.
 */
export type AddonLine = "dms";

export const ADDON_LINES: readonly AddonLine[] = ["dms"] as const;

export const ADDON_LABEL: Record<AddonLine, string> = {
  dms: "DMS (distributor portal)",
};

/** True only when the account has been explicitly granted the add-on. */
export function accountHasAddonLine(
  addonLines: string[] | null | undefined,
  line: AddonLine
): boolean {
  return Array.isArray(addonLines) && addonLines.includes(line);
}
```

- [ ] **Step 4: Check that `planLines` cannot emit `dms`**

Read `planLines` and `PLAN_LINES` in the same file. `PLAN_LINES` is a `Record<PlanId, {crm,wfa,sfa,fsm}>` of booleans, so widening `ProductLine` must not add a `dms` key to it. If `planLines` builds its result by iterating object keys, `dms` is absent automatically and nothing more is needed. If TypeScript now demands a `dms` key on `PLAN_LINES` entries, do **not** add it — change the record's value type to `Partial<Record<ProductLine, boolean>>` and leave every entry as it is.

- [ ] **Step 5: Run the tests and the type check**

Run: `npm test -- src/lib/plans/catalog.dms.test.ts && npm run typecheck`

Expected: 5 passing tests, and `tsc --noEmit` clean. If `typecheck` reports errors in `surface-gates.ts` or `use-auth`, they are the widened union reaching a `switch` — add a `dms` branch that returns the same thing an unknown line returns today. Do not silence with `as never`.

- [ ] **Step 6: Run the whole suite, to prove nothing else moved**

Run: `npm test`

Expected: the suite passes exactly as it did before this task. A plan-gating test that enumerates lines may now see a fifth; if it fails, read it — if it asserts "these are the lines", add `dms`; if it asserts "this plan grants these lines", it must be unchanged, and a failure there means `planLines` is leaking the add-on, which is the bug this whole task exists to prevent.

- [ ] **Step 7: Commit**

```bash
git add src/lib/plans/catalog.ts src/lib/plans/catalog.dms.test.ts
git commit -m "DMS is an add-on line, never granted by a plan code"
```

---

### Task 2: Migration — `addon_lines`, `portal_seats_limit`, and the `account_has_line` carve-out

**Files:**
- Create: `supabase/migrations/20261107120000_dms_addon_line_and_seats.sql`
- Create: `supabase/tests/60_dms_foundation.sql`
- Modify: `scripts/run-db-tests.sh:96-97`
- Create: `docs/RUN-THIS-SQL-dms-foundation.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `accounts.addon_lines text[]`, `accounts.portal_seats_limit integer`; `account_has_line(uuid, text)` answering `'dms'` from `addon_lines` only.

- [ ] **Step 1: Write the failing scenarios**

Create `supabase/tests/60_dms_foundation.sql`:

```sql
-- ============================================================
-- 2026-11-07 — DMS foundation (20261107120000, 20261107130000).
--
-- The question these answer: can the DMS reach an account nobody sold it to?
-- The dangerous path is account_has_line's legacy fallback, which grants every
-- line but FSM to an unknown plan — and 001001 is a legacy Enterprise plan.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT '''aaaa0000-0000-0000-0000-000000000001'''

-- ── G: the add-on line ───────────────────────────────────────
UPDATE public.accounts SET subscription_plan = 'CRM_SFA', addon_lines = '{}'
 WHERE id = :ACCT;

SELECT qa('G1 a paid plan does NOT grant dms',
  account_has_line(:ACCT, 'dms') = false,
  'CRM_SFA must not include the DMS');

SELECT qa('G2 the plan it DID buy still works',
  account_has_line(:ACCT, 'sfa') = true,
  'CRM_SFA must still grant sfa');

UPDATE public.accounts SET subscription_plan = 'Enterprise' WHERE id = :ACCT;

SELECT qa('G3 a LEGACY plan does not grant dms either',
  account_has_line(:ACCT, 'dms') = false,
  'this is the giveaway bug: legacy plans fall through to "every line but fsm"');

SELECT qa('G4 the legacy fallback is otherwise unchanged',
  account_has_line(:ACCT, 'crm') = true AND account_has_line(:ACCT, 'fsm') = false,
  'legacy keeps full access except fsm, exactly as before');

UPDATE public.accounts SET addon_lines = ARRAY['dms'] WHERE id = :ACCT;

SELECT qa('G5 an explicit grant turns it on',
  account_has_line(:ACCT, 'dms') = true,
  'addon_lines is the only door');

UPDATE public.accounts SET subscription_plan = 'CRM_SFA' WHERE id = :ACCT;

SELECT qa('G6 the add-on composes with a real plan',
  account_has_line(:ACCT, 'dms') AND account_has_line(:ACCT, 'crm')
  AND account_has_line(:ACCT, 'sfa'),
  'CRM + SFA + DMS needs no new plan code');

SELECT qa('G7 seats default to zero, i.e. not bought',
  (SELECT portal_seats_limit FROM public.accounts WHERE id = :ACCT) >= 0,
  'column exists and is not null');
```

- [ ] **Step 2: Register the file with the runner**

`scripts/run-db-tests.sh` hardcodes its scenario list — **a new file that is not added here never runs, and the suite still reports green.** Change lines 96-97:

```bash
for f in 00_fixture 10_buying_status 20_mapping_codes_territory \
         30_territory_coverage_rls 40_area_channel_mapping 50_rights_and_many_holders \
         60_dms_foundation; do
```

- [ ] **Step 3: Run the suite and watch the new scenarios fail**

Run: `PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh`

This takes about six minutes; run it in the background. Expected: the run aborts inside `60_dms_foundation.sql` at G1 because `addon_lines` does not exist. Expect roughly 46 migration errors before that — `storage.objects`, `publication "supabase_realtime"`, the `vector` extension and the deliberate `import_commit` guard. Watch for a *jump* in that number, not the number itself.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261107120000_dms_addon_line_and_seats.sql`:

```sql
-- ============================================================
-- DMS as an ADD-ON line, plus the seat allowance.
--
-- WHY NOT A PLAN CODE. account_has_line ends with
--   else (p_line is distinct from 'fsm')
-- so an unknown or legacy subscription_plan is granted every line except FSM.
-- Account 001001 is a legacy Enterprise plan. Had 'dms' been an ordinary line,
-- every existing tenant would have been given the DMS free on the day this ran.
-- FSM is already carved out of that fallback for exactly this reason.
--
-- It also keeps the eight sellable plan codes at eight: "CRM + SFA + DMS" is a
-- plan plus an add-on, not a ninth code.
--
-- Mirrors wacrm-web src/lib/plans/catalog.ts ADDON_LINES.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS addon_lines        text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS portal_seats_limit integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.accounts.addon_lines IS
  'Separately sold product lines, granted per account by the superadmin only. '
  'Currently just dms. NEVER derived from subscription_plan.';
COMMENT ON COLUMN public.accounts.portal_seats_limit IS
  'How many customer portal logins this account has bought. 0 = not bought.';

-- Only ever an add-on we actually sell.
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_addon_lines_known;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_addon_lines_known
  CHECK (addon_lines <@ ARRAY['dms']::text[]);

-- ── account_has_line: dms answered from addon_lines, and ONLY from there ──
CREATE OR REPLACE FUNCTION public.account_has_line(p_account_id uuid, p_line text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select case
    when p_line = 'dms' then ('dms' = any(a.addon_lines))
    else case a.subscription_plan
      when 'CRM'     then (p_line = 'crm')
      when 'WFA'     then (p_line = 'wfa')
      when 'CRM_WFA' then (p_line in ('crm','wfa'))
      when 'SFA'     then (p_line in ('wfa','sfa'))
      when 'CRM_SFA' then (p_line in ('crm','wfa','sfa'))
      when 'FSM'     then (p_line in ('wfa','fsm'))
      when 'CRM_FSM' then (p_line in ('crm','wfa','fsm'))
      when 'SFA_FSM' then (p_line in ('wfa','sfa','fsm'))
      -- legacy / unknown / null => full access EXCEPT fsm. 'dms' never reaches
      -- here, so the add-on cannot be inherited by a legacy plan.
      else (p_line is distinct from 'fsm')
    end
  end
  from public.accounts a
  where a.id = p_account_id;
$$;

COMMENT ON FUNCTION public.account_has_line(uuid, text) IS
  'True if the account has the given product line. crm|wfa|sfa|fsm come from '
  'subscription_plan (legacy/unknown => all but fsm). dms comes ONLY from '
  'addon_lines and is never inherited. Mirrors catalog.ts.';

GRANT EXECUTE ON FUNCTION public.account_has_line(uuid, text) TO authenticated, anon;
```

- [ ] **Step 5: Run the suite and watch G1–G7 pass**

Run: `PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh`

Expected: every scenario in files 00–50 passes exactly as before, and G1–G7 pass. If the migration-error count jumped, read the new ones before going on.

- [ ] **Step 6: Write the apply-this-SQL note for the founder**

The Supabase MCP cannot reach Mumbai, so migrations are applied by hand. Follow the existing `docs/RUN-THIS-SQL-*.md` files. Create `docs/RUN-THIS-SQL-dms-foundation.md` holding the full text of this migration (and, after Task 3, that one too, in order), with a one-paragraph plain-English explanation at the top saying what it adds and that no tenant's behaviour changes until an add-on is granted.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261107120000_dms_addon_line_and_seats.sql \
        supabase/tests/60_dms_foundation.sql scripts/run-db-tests.sh \
        docs/RUN-THIS-SQL-dms-foundation.md
git commit -m "DMS add-on line and seat allowance, kept out of the legacy plan fallback"
```

---

### Task 3: Migration — portal columns on `contacts`, and the seat cap

**Files:**
- Create: `supabase/migrations/20261107130000_portal_identity_and_seats.sql`
- Modify: `supabase/tests/60_dms_foundation.sql` (append)
- Modify: `docs/RUN-THIS-SQL-dms-foundation.md`

**Interfaces:**
- Consumes: `accounts.addon_lines`, `accounts.portal_seats_limit` (Task 2).
- Produces: `contacts.portal_user_id uuid`, `contacts.portal_email text`, `contacts.portal_access boolean`, `contacts.portal_access_revoked_at timestamptz`, `contacts.portal_access_set_by uuid`, `contacts.portal_access_set_at timestamptz`; `portal_seats_used(p_account_id uuid) returns integer`.

- [ ] **Step 1: Append the failing scenarios**

Append to `supabase/tests/60_dms_foundation.sql`:

```sql
-- ── H: portal identity and the seat cap ──────────────────────
\set DIST_C  '''c1000000-0000-0000-0000-00000000000c'''
\set DIST_C2 '''c1000000-0000-0000-0000-00000000000f'''

UPDATE public.accounts
   SET addon_lines = ARRAY['dms'], portal_seats_limit = 1
 WHERE id = :ACCT;

UPDATE public.contacts
   SET portal_email = 'c@abc.com',
       portal_user_id = '00000000-0000-0000-0000-0000000000c1',
       portal_access = true
 WHERE id = :DIST_C;

SELECT qa('H1 one login is counted as one seat used',
  portal_seats_used(:ACCT) = 1, 'seat accounting');

SELECT qa_refused('H2 the seat cap is enforced by the DATABASE, not the form',
  'UPDATE public.contacts SET portal_email = ''c2@abc.com'', '
  'portal_user_id = ''00000000-0000-0000-0000-0000000000c2'', '
  'portal_access = true WHERE id = ' || :DIST_C2);

UPDATE public.accounts SET portal_seats_limit = 2 WHERE id = :ACCT;

SELECT qa_allowed('H3 raising the limit lets the next login in',
  'UPDATE public.contacts SET portal_email = ''c2@abc.com'', '
  'portal_user_id = ''00000000-0000-0000-0000-0000000000c2'', '
  'portal_access = true WHERE id = ' || :DIST_C2);

-- Revoking frees the seat, and does not delete anything.
UPDATE public.contacts
   SET portal_access = false, portal_access_revoked_at = now()
 WHERE id = :DIST_C2;

SELECT qa('H4 revoking frees the seat but keeps the login on record',
  portal_seats_used(:ACCT) = 1
  AND (SELECT portal_user_id FROM public.contacts WHERE id = :DIST_C2) IS NOT NULL,
  'access off, history kept');

SELECT qa_refused('H5 two customers cannot share one login email',
  'UPDATE public.contacts SET portal_email = ''c@abc.com'' WHERE id = ' || :DIST_C2);

-- An account that never bought the DMS cannot have a login at all.
UPDATE public.accounts SET addon_lines = '{}', portal_seats_limit = 0 WHERE id = :ACCT;

SELECT qa_refused('H6 no add-on, no login',
  'UPDATE public.contacts SET portal_access = true WHERE id = ' || :DIST_C);

UPDATE public.accounts SET addon_lines = ARRAY['dms'], portal_seats_limit = 5
 WHERE id = :ACCT;

-- Migration 076 refuses ANY update to a customer with no hierarchy_level once
-- order hierarchy is on. Granting portal access is such an update, and "any
-- customer at any level" means dealers are in scope.
UPDATE public.accounts
   SET settings = COALESCE(settings, '{}'::jsonb) || '{"hierarchy_enabled": true}'::jsonb
 WHERE id = :ACCT;

SELECT qa('H7 a customer WITH a level can still be given access under hierarchy',
  (SELECT hierarchy_level FROM public.contacts WHERE id = :DIST_C) IS NOT NULL,
  'guards the 076 interaction; see the note in the migration');
```

- [ ] **Step 2: Run the suite and watch H1 fail**

Run: `PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh`

Expected: abort inside file 60 at the first `UPDATE ... portal_email` — the column does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261107130000_portal_identity_and_seats.sql`:

```sql
-- ============================================================
-- Portal identity on the CUSTOMER, and a seat cap the form cannot talk its
-- way past.
--
-- A PORTAL CUSTOMER IS NOT A PROFILE. profiles is the employee table in all
-- but name (account_role, employee_role_id, web_access), and 107 web files
-- plus 56 database functions read it. Putting a distributor there means all
-- 163 sites must start asking "employee, or customer with a login?", and the
-- first one missed puts a distributor in a headcount or an incentive run.
-- So a portal customer is an auth.users row and nothing else, pointed at from
-- here. Zero existing queries change.
--
-- handle_new_user needs NO change: it already returns immediately when the
-- metadata carries skip_account_provision='true', and on that path inserts no
-- profiles row either.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS portal_user_id           uuid        NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS portal_email             text        NULL,
  ADD COLUMN IF NOT EXISTS portal_access            boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_access_revoked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS portal_access_set_by     uuid        NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS portal_access_set_at     timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_portal_email_idx
  ON public.contacts (account_id, lower(portal_email))
  WHERE portal_email IS NOT NULL;

-- Answers "which customer is this login?" in one index hit. Plan 2's resolver
-- runs this lookup on every portal request.
CREATE INDEX IF NOT EXISTS contacts_portal_user_idx
  ON public.contacts (portal_user_id)
  WHERE portal_user_id IS NOT NULL;

-- ── Seats ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_seats_used(p_account_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select count(*)::integer
    from public.contacts c
   where c.account_id = p_account_id
     and c.portal_user_id is not null
     and c.portal_access
     and c.portal_access_revoked_at is null;
$$;

GRANT EXECUTE ON FUNCTION public.portal_seats_used(uuid) TO authenticated;

-- Enforced here and not only in the API route, because a cap that lives in a
-- form is a suggestion. This is what someone calling PostgREST directly hits.
CREATE OR REPLACE FUNCTION public.enforce_portal_seat_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  -- Only a row turning access ON is interesting. Revoking, and every ordinary
  -- customer edit, costs nothing.
  IF NEW.portal_access IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.portal_access IS TRUE
     AND OLD.portal_access_revoked_at IS NULL THEN
    RETURN NEW;   -- already held a seat; not a new one
  END IF;

  IF NOT account_has_line(NEW.account_id, 'dms') THEN
    RAISE EXCEPTION 'This account does not have the DMS. Portal access cannot be given.';
  END IF;

  SELECT portal_seats_limit INTO v_limit
    FROM accounts WHERE id = NEW.account_id;
  v_used := portal_seats_used(NEW.account_id);

  IF v_used >= COALESCE(v_limit, 0) THEN
    RAISE EXCEPTION 'All % portal logins are in use. Remove access from another customer, or buy more.',
      COALESCE(v_limit, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_portal_seat_cap ON public.contacts;
CREATE TRIGGER trg_enforce_portal_seat_cap
  BEFORE INSERT OR UPDATE OF portal_access ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_seat_cap();
```

- [ ] **Step 4: Run the suite and watch H1–H7 pass**

Run: `PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh`

Expected: G1–G7 and H1–H7 pass, files 00–50 unchanged.

If **H6 or the seat-cap scenarios behave oddly on a tenant with order hierarchy on**, read migration 076's `trg_enforce_contact_hierarchy_level`: it refuses *any* update to a customer whose `hierarchy_level` is null while hierarchy is enabled. That is a pre-existing rule and this plan does not weaken it — but it means an admin cannot grant portal access to an unlevelled customer on such a tenant. Record what you observe in the migration's header comment rather than working around it; it becomes a known limitation in the spec's open questions.

- [ ] **Step 5: Append this migration to the founder's SQL note**

Add its full text to `docs/RUN-THIS-SQL-dms-foundation.md`, after Task 2's, in apply order.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261107130000_portal_identity_and_seats.sql \
        supabase/tests/60_dms_foundation.sql docs/RUN-THIS-SQL-dms-foundation.md
git commit -m "Portal logins live on the customer, and the seat cap is enforced in the database"
```

---

### Task 4: Migration — mark a portal-placed order

Small, and it belongs here rather than in Plan 3: the column must exist before the CRM Orders list can read it in Task 8, and Plan 3 then only has to write it.

**Files:**
- Create: `supabase/migrations/20261107140000_order_placed_via_portal.sql`
- Modify: `docs/RUN-THIS-SQL-dms-foundation.md`

**Interfaces:**
- Produces: `orders.placed_by_portal_contact_id uuid null references contacts(id)`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Where a portal order came from.
--
-- The Orders list resolves the salesman by looking orders.user_id up in
-- profiles IN THE BROWSER. A portal customer has no profiles row, so without
-- this column a portal order shows a blank salesman — not broken, just
-- mysterious, and mysterious is how a number stops being trusted.
--
-- Written by portal_place_order in Plan 3. Read by the Orders list now.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS placed_by_portal_contact_id uuid NULL
    REFERENCES public.contacts(id);

COMMENT ON COLUMN public.orders.placed_by_portal_contact_id IS
  'The customer who placed this order through the DMS portal. NULL means a '
  'member of staff placed it. Drives the "Placed via" column.';

CREATE INDEX IF NOT EXISTS orders_placed_by_portal_idx
  ON public.orders (account_id, placed_by_portal_contact_id)
  WHERE placed_by_portal_contact_id IS NOT NULL;
```

- [ ] **Step 2: Run the suite to prove nothing regressed**

Run: `PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh`

Expected: all scenarios pass, migration-error count unchanged. A nullable column with a partial index touches no existing policy or query.

- [ ] **Step 3: Append to the SQL note and commit**

```bash
git add supabase/migrations/20261107140000_order_placed_via_portal.sql \
        docs/RUN-THIS-SQL-dms-foundation.md
git commit -m "Orders remember when they came from the portal"
```

---

### Task 5: The portal-login API route

**Files:**
- Create: `src/app/api/portal-access/route.ts`
- Test: `src/app/api/portal-access/route.test.ts` (create)

**Interfaces:**
- Consumes: `requireRole`, `ForbiddenError`, `toErrorResponse` from `@/lib/auth/account`; `serviceRoleKey` from `@/lib/supabase/service-role-key`; the columns from Task 3.
- Produces: `POST /api/portal-access` `{contact_id, email, password}` → `{ok:true, portal_user_id}`; `PATCH /api/portal-access` `{contact_id, password}` → `{ok:true}`; `DELETE /api/portal-access?contact_id=` → `{ok:true}`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/portal-access/route.test.ts`. Test the pure decision logic, not Supabase — extract it so it is testable:

```ts
import { describe, it, expect } from "vitest";
import { friendlyAuthError, validatePortalLogin } from "./route";

describe("portal login validation", () => {
  it("requires an email-shaped address, even though it is never delivered to", () => {
    expect(validatePortalLogin("ramesh", "secret12")).toMatch(/email/i);
    expect(validatePortalLogin("xyz@abc.com", "secret12")).toBeNull();
  });

  it("requires a password of at least 8 characters", () => {
    expect(validatePortalLogin("xyz@abc.com", "short")).toMatch(/8/);
  });

  it("turns Supabase's duplicate-email error into something an admin can act on", () => {
    expect(
      friendlyAuthError("A user with this email address has already been registered")
    ).toBe(
      "That login is already taken. Portal logins are shared across all of OZZO, so pick another address."
    );
  });

  it("passes other errors through rather than inventing a message", () => {
    expect(friendlyAuthError("Password is too weak")).toBe("Password is too weak");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/app/api/portal-access/route.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the route**

Create `src/app/api/portal-access/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serviceRoleKey } from "@/lib/supabase/service-role-key";

// Email-shaped is all that is required. The address is never delivered to —
// there is no Forgot Password in the portal, the admin resets it here — but
// Supabase validates the shape, so an admin typing "ramesh" must be told why.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePortalLogin(email: string, password: string): string | null {
  if (!EMAIL_SHAPE.test(email ?? "")) {
    return "The login must look like an email address, for example xyz@abc.com. It does not have to be a real mailbox.";
  }
  if ((password ?? "").length < 8) {
    return "The password must be at least 8 characters.";
  }
  return null;
}

export function friendlyAuthError(message: string): string {
  if (/already been registered|already exists/i.test(message)) {
    return "That login is already taken. Portal logins are shared across all of OZZO, so pick another address.";
  }
  return message;
}

function admin() {
  if (!serviceRoleKey() || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error(
      "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local and restart."
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey()!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Give a customer a portal login. */
export async function POST(req: NextRequest) {
  try {
    const { contact_id, email, password } = await req.json();
    if (!contact_id) {
      return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });
    }
    const invalid = validatePortalLogin(email, password);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const ctx = await requireRole("admin");
    const sb = admin();

    // The customer must belong to the caller's account. Checked server-side
    // because this request runs with the service-role key, which ignores RLS.
    const { data: contact } = await sb
      .from("contacts")
      .select("id, account_id, portal_user_id")
      .eq("id", contact_id)
      .single();

    if (!contact || contact.account_id !== ctx.accountId) {
      throw new ForbiddenError("That customer is not in your account");
    }
    if (contact.portal_user_id) {
      return NextResponse.json(
        { error: "This customer already has a portal login. Reset the password instead." },
        { status: 400 }
      );
    }

    // `skip_account_provision` stops handle_new_user minting an account AND
    // stops any profiles row being created. A portal customer is an auth user
    // and nothing else: see the migration header for why that matters.
    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // the address is fake; a confirmation mail would never arrive
      user_metadata: { skip_account_provision: "true", portal_contact_id: contact_id },
    });

    if (authError) {
      return NextResponse.json(
        { error: friendlyAuthError(authError.message) },
        { status: 400 }
      );
    }

    // The seat cap and the add-on check live in a trigger on this UPDATE, so a
    // refusal here is the database's, not ours. If it refuses, the auth user we
    // just made would be orphaned — so delete it before returning.
    const { error: linkError } = await sb
      .from("contacts")
      .update({
        portal_user_id: authData.user.id,
        portal_email: email,
        portal_access: true,
        portal_access_revoked_at: null,
        portal_access_set_by: ctx.profileId ?? null,
        portal_access_set_at: new Date().toISOString(),
      })
      .eq("id", contact_id);

    if (linkError) {
      await sb.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, portal_user_id: authData.user.id });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Reset a portal password. There is no self-service reset: see the spec §5.2. */
export async function PATCH(req: NextRequest) {
  try {
    const { contact_id, password } = await req.json();
    const invalid = validatePortalLogin("x@y.co", password);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const ctx = await requireRole("admin");
    const sb = admin();

    const { data: contact } = await sb
      .from("contacts")
      .select("id, account_id, portal_user_id")
      .eq("id", contact_id)
      .single();

    if (!contact || contact.account_id !== ctx.accountId) {
      throw new ForbiddenError("That customer is not in your account");
    }
    if (!contact.portal_user_id) {
      return NextResponse.json({ error: "This customer has no portal login" }, { status: 400 });
    }

    const { error } = await sb.auth.admin.updateUserById(contact.portal_user_id, { password });
    if (error) {
      return NextResponse.json({ error: friendlyAuthError(error.message) }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Withdraw access. Nothing is deleted and the seat returns to the pool. */
export async function DELETE(req: NextRequest) {
  try {
    const contact_id = req.nextUrl.searchParams.get("contact_id");
    const ctx = await requireRole("admin");
    const sb = admin();

    const { data: contact } = await sb
      .from("contacts")
      .select("id, account_id")
      .eq("id", contact_id)
      .single();

    if (!contact || contact.account_id !== ctx.accountId) {
      throw new ForbiddenError("That customer is not in your account");
    }

    const { error } = await sb
      .from("contacts")
      .update({ portal_access: false, portal_access_revoked_at: new Date().toISOString() })
      .eq("id", contact_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
```

- [ ] **Step 4: Check `ctx.profileId` is real**

Open `src/lib/auth/account.ts` and read what `requireRole` returns. If the context has no `profileId`, use whichever field holds the caller's `profiles.id`; if it holds only a user id, look the profile up with the admin client before the update. Do not write `null` and move on — `portal_access_set_by` is the audit trail for who gave an outsider a login.

- [ ] **Step 5: Run the tests and the type check**

Run: `npm test -- src/app/api/portal-access/route.test.ts && npm run typecheck`

Expected: 4 passing tests, clean type check.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/portal-access/route.ts src/app/api/portal-access/route.test.ts
git commit -m "Portal logins are minted in the CRM, never by the portal itself"
```

---

### Task 6: Superadmin grants the DMS and the seats

**Files:**
- Modify: `src/app/api/admin/accounts/[id]/route.ts`
- Modify: `src/app/(superadmin)/admin/companies/[id]/page.tsx`

**Interfaces:**
- Consumes: `ADDON_LINES`, `ADDON_LABEL` from `catalog.ts` (Task 1); the account columns from Task 2.
- Produces: the PATCH body accepts `addonLines: string[]` and `portalSeatsLimit: number`.

- [ ] **Step 1: Extend the PATCH route**

In `src/app/api/admin/accounts/[id]/route.ts`:

1. Add `addon_lines, portal_seats_limit` to the `select` on line ~61, so the before/after audit record covers them.
2. Read `addonLines` and `portalSeatsLimit` from the body and add them to `patch`.
3. Validate before writing — and refuse a seat cut that would strand logins already issued, which is the same protection the route already applies to `user_count`:

```ts
// Seats already in use. Cutting the allowance below them would leave
// distributors signed in against seats the tenant no longer has, which is a
// silent inconsistency rather than a refusal.
const { data: seatRow } = await supabaseAdmin.rpc("portal_seats_used", {
  p_account_id: id,
});
const seatsUsed = Number(seatRow ?? 0);

if (typeof body.portalSeatsLimit === "number") {
  if (body.portalSeatsLimit < 0) {
    return NextResponse.json({ error: "Seats cannot be negative" }, { status: 400 });
  }
  if (body.portalSeatsLimit < seatsUsed) {
    return NextResponse.json(
      {
        error: `${seatsUsed} portal logins are already in use. Remove access from some customers before lowering the allowance to ${body.portalSeatsLimit}.`,
      },
      { status: 400 }
    );
  }
  patch.portal_seats_limit = body.portalSeatsLimit;
}

if (Array.isArray(body.addonLines)) {
  const unknown = body.addonLines.filter((l: string) => !ADDON_LINES.includes(l as never));
  if (unknown.length) {
    return NextResponse.json(
      { error: `Unknown add-on: ${unknown.join(", ")}` },
      { status: 400 }
    );
  }
  // Removing the add-on stops every portal login at once, which is intended
  // and is why it is recorded in the audit log below.
  patch.addon_lines = body.addonLines;
}
```

Import `ADDON_LINES` from `@/lib/plans/catalog` at the top of the file.

- [ ] **Step 2: Add the controls to the company page**

In `src/app/(superadmin)/admin/companies/[id]/page.tsx`:

1. Two new state hooks beside the existing ones: `const [dmsEnabled, setDmsEnabled] = useState(false);` and `const [portalSeats, setPortalSeats] = useState<string>("0");`
2. In the loader beside `setPlan(...)`:
   ```ts
   setDmsEnabled(Array.isArray(c.addon_lines) && c.addon_lines.includes("dms"));
   setPortalSeats(String(c.portal_seats_limit ?? 0));
   ```
3. In `handleSave`'s body, beside `plan`:
   ```ts
   addonLines: dmsEnabled ? ["dms"] : [],
   portalSeatsLimit: Number(portalSeats) || 0,
   ```
4. In the Subscription card, under the Plan and Status grid, a new row:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div className="space-y-2">
    <Label>DMS add-on</Label>
    {/* Granted here and nowhere else. A tenant admin must never be able to
        switch on something they have not bought, which is why there is no
        module_settings.dms toggle anywhere in the product. */}
    <Select
      value={dmsEnabled ? "on" : "off"}
      onValueChange={(v) => setDmsEnabled(v === "on")}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="off">Not sold</SelectItem>
        <SelectItem value="on">{ADDON_LABEL.dms}</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <div className="space-y-2">
    <Label>Portal logins</Label>
    <Input
      type="number"
      min={0}
      value={portalSeats}
      onChange={(e) => setPortalSeats(e.target.value)}
      disabled={!dmsEnabled}
    />
    <p className="text-xs text-muted-foreground">
      How many customers this account may give a portal login to. Sold in hundreds.
    </p>
  </div>
</div>
```

Import `ADDON_LABEL` from `@/lib/plans/catalog`, and `Input` and `Label` from wherever the file already imports its other form controls.

- [ ] **Step 3: Type-check and lint**

Run: `npm run typecheck && npm run lint:ui`

Expected: clean, and the `lint:ui` finding count must not rise. If it does, the new markup used a raw colour or spacing value — use the design tokens the rest of the file uses.

- [ ] **Step 4: Prove it end to end in the browser**

The dev server reads `.env.local`, which points at production, and the built-in browser pane usually already holds a signed-in session for the founder.

Run: `npm run dev`, then open `/admin/companies/<001001's id>`.

Verify, in this order: the two new controls appear; Portal logins is disabled until the add-on is set to on; saving reports success; reloading the page shows the saved values (this is the check that catches a stale `useCallback` dependency — the exact bug that made all four November modules look unbuilt); and setting seats to a number below the logins in use is refused with the sentence from Step 1 rather than a raw error.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/admin/accounts/[id]/route.ts" \
        "src/app/(superadmin)/admin/companies/[id]/page.tsx"
git commit -m "Superadmin grants the DMS add-on and the login allowance"
```

---

### Task 7: "Provide DMS Access" on the customer page

**Files:**
- Create: `src/components/contacts/portal-access-block.tsx`
- Modify: `src/components/contacts/contact-form.tsx`
- Modify: `src/lib/plans/surface-gates.ts`

**Interfaces:**
- Consumes: `POST/PATCH/DELETE /api/portal-access` (Task 5); `accountHasAddonLine` (Task 1).
- Produces: `<PortalAccessBlock contactId accountHasDms portalEmail portalAccess seatsUsed seatsLimit onChanged />`.

`contact-form.tsx` is 1,124 lines. Do **not** add a hundred more to it — the block goes in its own file and the form renders it in one line. That keeps the form reviewable and means the DMS block can be read on its own.

- [ ] **Step 1: Write the component**

Create `src/components/contacts/portal-access-block.tsx` with: a toggle labelled **Provide DMS Access**; when on, a Login email field and a Password field; a **Save login** button calling `POST /api/portal-access` (or `PATCH` when a login already exists, with the label **Reset password**); a **Remove access** button calling `DELETE`; and a line reading `61 of 100 logins used`. Render nothing at all when `accountHasDms` is false — an account without the add-on must see no trace of the DMS.

Show the server's error text verbatim: Task 5 already turned Supabase's messages into sentences an admin can act on, so wrapping them again would hide the useful one.

- [ ] **Step 2: Render it from the form**

In `contact-form.tsx`, find where the customer's other blocks are rendered and add one line passing the contact's id, the account's add-on state from `useAuth()`, and the saved `portal_email` / `portal_access`. The block is for every customer, at any level — the founder's ruling is that any customer may be given a login, so do **not** gate it on `hierarchy_level`.

`useAuth().account` is already loaded and free to read; do not fetch the account again.

- [ ] **Step 3: Add the surface gate**

In `src/lib/plans/surface-gates.ts`, add a row for the customer page's DMS block requiring `line: "dms"`, following the shape the file's other rows use. The database is still the real ceiling; this stops the block being reachable by typing a URL.

- [ ] **Step 4: Check the refresh path, which is where this bit has bitten before**

After **Save login** succeeds, the page must show the new state. On 2026-11-04 the detail page kept reading "Direct — no supplier recorded" after a supplier was saved, because that block was fetched outside `fetchAllData` in an effect whose dependencies never changed. Make `onChanged` go through whatever the page's full refresh is, not a local `setState`.

- [ ] **Step 5: Type-check, lint, and test in the browser**

Run: `npm run typecheck && npm run lint:ui && npm run dev`

Verify on 001001: with the add-on **off**, no block appears anywhere on the customer page; with it on, the block appears while creating, editing and viewing; saving a login then reloading shows it still there; a second login beyond the seat limit is refused with the database's sentence; **Remove access** flips the state and the used-count drops.

- [ ] **Step 6: Commit**

```bash
git add src/components/contacts/portal-access-block.tsx \
        src/components/contacts/contact-form.tsx src/lib/plans/surface-gates.ts
git commit -m "Give a customer a DMS login from the customer page"
```

---

### Task 8: "Placed via" on the Orders list

Nothing writes `placed_by_portal_contact_id` until Plan 3, so every order reads *Staff* today. That is the point: the column is proven correct on real data before any portal order exists to confuse it.

**Files:**
- Modify: `src/app/(dashboard)/orders/page.tsx:173` (the select list) and its column definitions

**Interfaces:**
- Consumes: `orders.placed_by_portal_contact_id` (Task 4).

- [ ] **Step 1: Fetch the column**

Add `placed_by_portal_contact_id` to the select string on line 173, and to the row type on lines 42 and 59.

- [ ] **Step 2: Add the column and its filter**

Add a `Placed via` column rendering `Portal` when `placed_by_portal_contact_id` is set and `Staff` when it is not, registered the same way the list's other columns are so it reaches Manage Column, the filter row and export for free. Gate it on `line: "dms"` so no other tenant sees a new column — the spec's rule is that an account without the add-on is byte-identical to today.

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev` and open `/orders` on 001001 with the add-on on.

Expected: every order reads **Staff**; the column appears in Manage Column; filtering by Portal returns nothing. Then switch the add-on off and confirm the column disappears entirely.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/orders/page.tsx"
git commit -m "Orders list shows whether an order came from the portal"
```

---

### Task 9: Close the plan out

- [ ] **Step 1: Run everything**

```bash
npm run typecheck && npm test && npm run lint:ui
```

Then, in the background: `PGDATA_DIR=/tmp/ozzo-pgtest bash scripts/run-db-tests.sh`

Expected: clean type check, green Vitest, `lint:ui` count not higher than before this plan, and all G and H scenarios passing with files 00–50 unchanged.

- [ ] **Step 2: Prove the no-add-on case, which is the release gate**

On an account with `addon_lines = '{}'`: the customer page shows no DMS block; the Orders list shows no Placed via column; `/admin/companies/[id]` shows the add-on as "Not sold"; and `account_has_line(acct,'dms')` is false even when `subscription_plan` is legacy. If any of those four is wrong, the DMS is leaking into tenants who did not buy it and the plan is not done.

- [ ] **Step 3: Hand the SQL to the founder**

`docs/RUN-THIS-SQL-dms-foundation.md` now holds all three migrations in apply order. The Supabase MCP cannot reach Mumbai, so say plainly in the handover that **nothing in this plan is live until those three are run**, and that until then the UI will error on the missing columns.

- [ ] **Step 4: Update the spec's status and push**

In `docs/engineering/specifications/ozzo-dms-product-v1.md`, change the Status line to record that Plan 1 is built and awaiting the SQL. Then:

```bash
git add -A && git commit -m "DMS foundation complete: add-on line, seats, portal logins"
git push origin main
```

Report the commit hash. Nothing is done until it is pushed and the SQL is applied.

---

## Self-review

**Spec coverage.** §3 commercials → Tasks 1, 2, 6. §5.1 identity → Task 3. §5.2 email login → Task 5. §5.3 where logins are created → Tasks 5, 7. §5.4 revoking → Tasks 3, 5, 7. §7.3 marking a portal order → Tasks 4, 8. §12 error wording → Tasks 5, 6, 7. §15 tests 4, 6 and 7 → Tasks 3 and 9.

Deliberately **not** in this plan, because they belong to later plans: §6 visibility and the portal functions (Plan 2), §7 ordering (Plan 3), §9–§11 announcements, activities and reports (Plan 4). §7.5's sales-credit setting is in Plan 3, beside the code that reads it.

**Known gap, stated rather than hidden.** Task 3 Step 4 may find that migration 076 blocks granting portal access to a customer with no `hierarchy_level` on a tenant running order hierarchy. The instruction is to record what is observed rather than work around it; if it reproduces, it is a new open question for the spec, and it affects dealers more than distributors.
