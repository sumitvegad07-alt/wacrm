# Rollback plan — FSM Phase 1: Customer Assets

Covers:
- `20260929150000_fsm_plan_line.sql` (plan backstop: `account_has_line` recognises `fsm`)
- `20260929151000_fsm_asset_masters.sql` (asset enum, `asset_types`, `account_sequences` counters)
- `20260929152000_fsm_customer_assets.sql` (Task 4: `customer_assets` and its trigger functions — Task 4
  must extend Level 3 below with any object names it adds beyond those listed here)

Nothing here touches CRM/WFA/SFA data. Everything FSM-specific is additive, with the two exceptions called
out in **Level 3**: dropping `asset_seq` destroys a tenant's counter, and dropping `customer_assets` /
`asset_types` destroys the tenant's asset records.

## Level 1 — switch the product off for a tenant (no schema change)

Move the account off an FSM plan (Admin → account → plan). `account_has_line(acct,'fsm')` then returns
false and the FSM RLS ceiling blocks new FSM rows; existing rows are kept, hidden from the UI. Reversible.

## Level 2 — remove seeded asset types only

```sql
-- Per tenant. Only untouched seed rows; tenant-created types are kept.
-- (A customer_assets row referencing a type blocks the delete: detach or archive instead.)
DELETE FROM public.asset_types WHERE account_id = '<ACCOUNT_ID>' AND is_seed_data = true;
```

## Level 3 — full teardown (reverse order of creation)

Run in this order. Run the whole block only if you accept losing every tenant's asset data.

```sql
-- 1. Policies (dropping the tables drops their policies too; explicit for clarity)
DROP POLICY IF EXISTS asset_types_select ON public.asset_types;
DROP POLICY IF EXISTS asset_types_insert ON public.asset_types;
DROP POLICY IF EXISTS asset_types_update ON public.asset_types;
DROP POLICY IF EXISTS asset_types_delete ON public.asset_types;
-- customer_assets policies: Task 4 lists them here (dropped with the table below).

-- 2. Tables (customer_assets first: it references asset_types)
DROP TABLE IF EXISTS public.customer_assets;
DROP TABLE IF EXISTS public.asset_types;

-- 3. Seed-on-provision hook and helpers
DROP TRIGGER  IF EXISTS trg_seed_new_account_asset_types ON public.accounts;
DROP FUNCTION IF EXISTS public.seed_new_account_asset_types();
DROP FUNCTION IF EXISTS public.seed_default_asset_types(uuid);

-- 4. Counter function, then the counter columns
DROP FUNCTION IF EXISTS public.get_next_asset_number(uuid);

-- !! DATA LOSS: dropping asset_seq destroys the tenant's asset-code counter. If FSM is
-- !! re-applied afterwards, numbering restarts at 1 and can collide with asset codes
-- !! that were already issued (and printed on labels / quoted to customers). Only drop
-- !! these columns if you are certain no asset codes were ever issued, or you will
-- !! re-seed asset_seq to MAX(issued number) per account before re-enabling.
-- !! job_seq is unused in Phase 1 and always 0, so dropping it loses nothing.
ALTER TABLE public.account_sequences DROP COLUMN IF EXISTS asset_seq;
ALTER TABLE public.account_sequences DROP COLUMN IF EXISTS job_seq;

-- 5. Task 4 trigger functions (e.g. customer_assets_defaults()) — Task 4 lists exact names.
-- DROP FUNCTION IF EXISTS public.customer_assets_defaults();

-- 6. Enum (only after every column using it is gone)
DROP TYPE IF EXISTS public.asset_status;
```

`territory_status` is shared with Territory Master and MUST NOT be dropped. `account_sequences` itself and its
policies are pre-existing and are not touched.

To keep the counters but stop issuing codes instead: leave step 4 out. Retaining `asset_seq` is what makes a
later re-apply safe.

## Level 4 — revert `account_has_line` (REQUIRED if rolling back `20260929150000_fsm_plan_line.sql`)

`CREATE OR REPLACE` replaced the function in place, so dropping tables does NOT undo it. It must be reverted
by restoring the previous body. Note it declares `SET search_path TO ''` (stricter than the `public` used
elsewhere) — preserve that exactly. Source of the original: `C:\Wacrm\tools\migration\01-schema.sql` line ~244
(first created by migration `20260907092613` plan_entitlement_db_backstop).

Do this only after nothing depends on the `fsm` line, and only after moving any tenant on `FSM`, `CRM_FSM` or
`SFA_FSM` back to a non-FSM plan (the restored body treats those unknown plans as full access).

```sql
CREATE OR REPLACE FUNCTION public.account_has_line(p_account_id uuid, p_line text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case a.subscription_plan
    when 'CRM'     then (p_line = 'crm')
    when 'WFA'     then (p_line = 'wfa')
    when 'CRM_WFA' then (p_line in ('crm','wfa'))
    when 'SFA'     then (p_line in ('wfa','sfa'))
    when 'CRM_SFA' then (p_line in ('crm','wfa','sfa'))
    else true  -- legacy / unknown / null => full access (matches catalog.ts planLines)
  end
  from public.accounts a
  where a.id = p_account_id;
$$;

COMMENT ON FUNCTION public.account_has_line(uuid, text) IS
  'True if the account''s subscription plan grants the given product line (crm|wfa|sfa). Legacy/unknown plans => true. Mirrors wacrm-web catalog.ts PLAN_LINES. Used as an RLS ceiling on line-specific INSERTs.';
```

(The comment text and grants are re-created by the FSM migration; the pre-FSM grants were
`GRANT EXECUTE ... TO authenticated, anon, service_role`, which are unchanged.)

Then revert the web code: `src/lib/plans/catalog.ts` (`fsm` line, FSM plans, `service` module key) and
`src/lib/service/*`.

## Notes
- The three migrations are idempotent, so re-applying after a Level 1–2 rollback is a no-op.
- Backfill seeded 8 default asset types into every existing account (`is_seed_data = true`); Level 2 removes
  exactly those.
