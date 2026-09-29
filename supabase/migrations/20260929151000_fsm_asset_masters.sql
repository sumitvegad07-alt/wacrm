-- ============================================================
-- 20260929151000_fsm_asset_masters.sql
-- OZZO FSM Phase 1: asset_status enum, asset_types master, and the per-account
-- asset-code counter. Task 4 (20260929152000_fsm_customer_assets.sql) adds the
-- customer_assets table on top of this.
-- Spec: docs/engineering/specifications/ozzo-fsm-phase-1-2-assets-and-jobs.md
--
-- COUNTER: reuses the existing `account_sequences` table (one row per account,
-- one BIGINT column per counter; used by deals, quotations, payments, leave).
-- We add `asset_seq` and `job_seq` columns and a `get_next_asset_number()` that
-- mirrors get_next_payment_number / get_next_leave_number. We deliberately do
-- NOT create a second counter table.
--   * It returns a raw bigint. The counter is PREFIX-INDEPENDENT: the
--     customer_assets trigger (Task 4) reads asset_code_prefix from
--     accounts.settings->'service_settings' and formats PREFIX-000123 itself, so
--     renaming the prefix never restarts or collides numbering.
--   * `job_seq` is added now (unused in Phase 1) so Phase 2 needs no ALTER.
--   * account_sequences rows are created LAZILY by the upsert, never on account
--     provision, so the upsert must work for an account with no row.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DO-EXCEPTION guards; the seed
-- helper only seeds an account that has no asset_types rows at all.
-- ============================================================

-- ── Enums ───────────────────────────────────────────────────
-- Must match src/lib/service/types.ts AssetStatus exactly, in this order.
DO $$ BEGIN
  CREATE TYPE public.asset_status AS ENUM ('active','under_repair','replaced','scrapped','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Asset Types master ──────────────────────────────────────
-- status reuses the existing territory_status enum (active/inactive/archived),
-- matching AssetType.status in src/lib/service/types.ts.
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

-- The unique index is partial (live rows only) so a name is reusable after
-- archive; because it is partial it can NOT serve the account_id FK, whose
-- ON DELETE CASCADE scans every row (soft-deleted included). The FK is covered
-- by the FULL (account_id, status) index below, by its leading column, so it is
-- deliberately not partial.
CREATE UNIQUE INDEX IF NOT EXISTS asset_types_uniq_name_per_account
  ON public.asset_types (account_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS asset_types_account_status_idx
  ON public.asset_types (account_id, status);

-- Shared update_updated_at_column() trigger fn, trigger named set_updated_at
-- (same as territories / product_categories).
DROP TRIGGER IF EXISTS set_updated_at ON public.asset_types;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.asset_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── RLS ─────────────────────────────────────────────────────
-- Structure copied from the LIVE product_units policies (created in
-- 115_product_categories_and_units.sql, re-keyed by 20260823170000_rbac_phase3_masters.sql,
-- initplan-wrapped by 20260913120000_perf_rls_initplan_optimization.sql):
--   SELECT                   : any account member
--   INSERT / UPDATE / DELETE : agent-or-above member AND a permission key
-- The three write policies share the single key manage_service_settings AND carry
-- the plan ceiling account_has_line(account_id,'fsm'), so a tenant without the fsm
-- line is refused at the database, not just hidden in the UI. SELECT is
-- deliberately NOT plan-gated: the seed rows are plan-neutral by design.
-- The seed trigger/helper and the backfill are SECURITY DEFINER / migration-owner
-- and bypass RLS, so the ceiling does not affect seeding.
-- auth.uid() is wrapped as (SELECT auth.uid()) so it is planned once, not per row.
ALTER TABLE public.asset_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_types_select ON public.asset_types;
CREATE POLICY asset_types_select ON public.asset_types
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS asset_types_insert ON public.asset_types;
CREATE POLICY asset_types_insert ON public.asset_types
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum)
              AND has_permission((SELECT auth.uid()), account_id, 'manage_service_settings'::text)
              AND account_has_line(account_id, 'fsm'::text));

DROP POLICY IF EXISTS asset_types_update ON public.asset_types;
CREATE POLICY asset_types_update ON public.asset_types
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'agent'::account_role_enum)
         AND has_permission((SELECT auth.uid()), account_id, 'manage_service_settings'::text)
         AND account_has_line(account_id, 'fsm'::text));

DROP POLICY IF EXISTS asset_types_delete ON public.asset_types;
CREATE POLICY asset_types_delete ON public.asset_types
  FOR DELETE TO authenticated
  USING (is_account_member(account_id, 'agent'::account_role_enum)
         AND has_permission((SELECT auth.uid()), account_id, 'manage_service_settings'::text)
         AND account_has_line(account_id, 'fsm'::text));

-- ── Per-account asset / job counters (reuse account_sequences) ──
-- Existing policies on account_sequences are NOT touched. NOT NULL DEFAULT 0
-- backfills every existing row with 0.
ALTER TABLE public.account_sequences ADD COLUMN IF NOT EXISTS asset_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE public.account_sequences ADD COLUMN IF NOT EXISTS job_seq   bigint NOT NULL DEFAULT 0;

-- Gapless per tenant: the upsert takes a row lock, so concurrent inserts
-- serialise here rather than racing to the same number. Upserting the row means
-- an account with no account_sequences row yet still works.
-- SECURITY DEFINER (unlike get_next_payment_number) so it works regardless of
-- the caller's RLS on account_sequences. Because a definer function would let
-- any signed-in user burn another tenant's numbers, a signed-in caller must be an
-- agent-or-above member of p_account_id (a viewer cannot create assets, so cannot
-- legitimately need a number and must not open gaps in the tenant's codes);
-- service-role / internal callers (auth.uid() IS NULL) are unrestricted.
CREATE OR REPLACE FUNCTION public.get_next_asset_number(p_account_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seq bigint;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT is_account_member(p_account_id, 'agent'::account_role_enum) THEN
    RAISE EXCEPTION 'Not a member of this account' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO account_sequences (account_id, asset_seq)
  VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
    SET asset_seq = account_sequences.asset_seq + 1
  RETURNING asset_seq INTO v_seq;

  RETURN v_seq;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_next_asset_number(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_next_asset_number(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_next_asset_number(uuid) TO authenticated, service_role;

-- ── Default asset types ─────────────────────────────────────
-- One idempotent helper used by both the on-provision trigger and the backfill.
-- Only seeds an account that has NO asset_types rows at all (archived included),
-- so it never resurrects types a tenant deliberately removed.
CREATE OR REPLACE FUNCTION public.seed_default_asset_types(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM asset_types WHERE account_id = p_account_id) THEN
    RETURN;
  END IF;

  INSERT INTO asset_types (account_id, name, is_seed_data)
  SELECT p_account_id, t.name, true
  FROM (VALUES
    ('Water Purifier'), ('Air Conditioner'), ('Elevator'), ('CCTV Camera'),
    ('UPS / Inverter'), ('Generator'), ('Pump / Motor'), ('Other')
  ) AS t(name)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Internal helper: not callable from the API.
REVOKE EXECUTE ON FUNCTION public.seed_default_asset_types(uuid) FROM PUBLIC, anon, authenticated;

-- Seed on account creation. Plan-neutral (like territories): a tenant moved onto
-- an FSM plan later must not find an empty master. Fail-safe: a seed hiccup
-- never blocks signup.
CREATE OR REPLACE FUNCTION public.seed_new_account_asset_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_asset_types(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed_new_account_asset_types failed for account %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_new_account_asset_types() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_seed_new_account_asset_types ON public.accounts;
CREATE TRIGGER trg_seed_new_account_asset_types
AFTER INSERT ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.seed_new_account_asset_types();

-- Backfill every existing account (idempotent: the helper skips any account
-- that already has asset types).
DO $$
DECLARE tgt uuid;
BEGIN
  FOR tgt IN SELECT id FROM public.accounts LOOP
    PERFORM public.seed_default_asset_types(tgt);
  END LOOP;
END $$;
