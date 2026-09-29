-- ============================================================
-- 20260929152000_fsm_customer_assets.sql
-- OZZO FSM Phase 1: customer_assets, the installed-base table (every machine a
-- customer owns). Nine later tasks read and write this table.
-- Spec: docs/engineering/specifications/ozzo-fsm-phase-1-2-assets-and-jobs.md
--   section 4.3 (columns / constraints / trigger rules), 4.10 (RLS), 4.12 (readiness).
-- Builds on 20260929151000_fsm_asset_masters.sql (asset_status, asset_types,
-- get_next_asset_number) and 20260929150000_fsm_plan_line.sql (account_has_line 'fsm').
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF
-- EXISTS before every policy and trigger. Applying twice is a no-op.
--
-- TypeScript mirror: CustomerAsset in src/lib/service/types.ts. Column names and
-- nullability below must stay in step with it.
-- ============================================================

-- ── Table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_assets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES public.accounts(id)   ON DELETE CASCADE,
  -- Assigned by customer_assets_defaults() on INSERT when left null/blank, so a
  -- caller never has to supply it, yet the column is still NOT NULL afterwards.
  asset_code              text NOT NULL,
  -- RESTRICT: a customer that owns machines cannot be hard-deleted out from
  -- under its service history. (Contacts are soft-deleted in normal use.)
  contact_id              uuid NOT NULL REFERENCES public.contacts(id)   ON DELETE RESTRICT,
  asset_type_id           uuid NULL     REFERENCES public.asset_types(id) ON DELETE SET NULL,
  product_id              uuid NULL     REFERENCES public.products(id)   ON DELETE SET NULL,
  name                    text NOT NULL CONSTRAINT customer_assets_name_not_blank CHECK (btrim(name) <> ''),
  make                    text NULL,
  model_no                text NULL,
  serial_no               text NULL,
  installation_date       date NULL,
  warranty_start          date NULL,
  warranty_end            date NULL,
  status                  public.asset_status NOT NULL DEFAULT 'active',
  customer_name_snapshot  text NULL,
  customer_phone_snapshot text NULL,
  site_label              text NULL,
  territory_id            uuid NULL     REFERENCES public.territories(id) ON DELETE SET NULL,
  notes                   text NULL,
  created_by              uuid NULL     REFERENCES public.profiles(id)   ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz NULL,

  -- Not in the spec's list: the trigger only assigns a code on INSERT, so without
  -- this an UPDATE could blank the code and nothing would ever refill it.
  -- (On INSERT the BEFORE trigger has already filled a blank code by the time
  -- CHECK constraints run.)
  CONSTRAINT customer_assets_code_not_blank CHECK (btrim(asset_code) <> ''),
  CONSTRAINT customer_assets_warranty_order_chk
    CHECK (warranty_end IS NULL OR warranty_start IS NULL OR warranty_end >= warranty_start),
  -- +1 day tolerates a timezone edge (a device in IST stamping "today" while the
  -- DB is still on the previous UTC date) rather than rejecting today's install.
  CONSTRAINT customer_assets_install_date_chk
    CHECK (installation_date IS NULL OR installation_date <= current_date + 1)
);

COMMENT ON COLUMN public.customer_assets.customer_name_snapshot IS
  'Customer name AT THE MOMENT THE ASSET WAS CREATED. Write-once (INSERT only). History and search only - NEVER render as the customer; resolve the customer through contact_id.';
COMMENT ON COLUMN public.customer_assets.customer_phone_snapshot IS
  'Customer phone AT THE MOMENT THE ASSET WAS CREATED, as captured. Write-once (INSERT only). History and search only - NEVER render as the customer; resolve the customer through contact_id.';

-- ── Indexes ─────────────────────────────────────────────────
-- Rule for this file: every foreign key is covered by a FULL (non-partial) index
-- whose LEADING column is the FK column. A partial index (WHERE deleted_at IS
-- NULL) can NOT serve an FK check or an ON DELETE CASCADE/RESTRICT/SET NULL scan,
-- because those look at soft-deleted rows too. The partial indexes below exist for
-- uniqueness and for list queries, not for FK coverage.
--
--   FK account_id    -> customer_assets_account_status_idx  (leading column)
--   FK contact_id    -> customer_assets_contact_id_idx
--   FK asset_type_id -> customer_assets_asset_type_id_idx
--   FK product_id    -> customer_assets_product_id_idx
--   FK territory_id  -> customer_assets_territory_id_idx
--   FK created_by    -> customer_assets_created_by_idx

-- Same serial twice in one tenant is almost always double entry; the import
-- framework reports per-row reasons so a rejection is visible, not silent.
CREATE UNIQUE INDEX IF NOT EXISTS customer_assets_uniq_serial
  ON public.customer_assets (account_id, lower(serial_no))
  WHERE serial_no IS NOT NULL AND deleted_at IS NULL;

-- MANDATORY. This is the defence against a known pre-existing hazard: the RLS
-- policy account_sequences_update is FOR ALL USING (is_account_member(account_id)),
-- so any tenant member can rewind their OWN counter through PostgREST. Without
-- this index a rewound asset_seq would silently hand out duplicate asset codes;
-- with it the second insert fails loudly with 23505 instead.
CREATE UNIQUE INDEX IF NOT EXISTS customer_assets_uniq_code
  ON public.customer_assets (account_id, asset_code)
  WHERE deleted_at IS NULL;

-- List query: "this customer's assets" (customer detail tab).
CREATE INDEX IF NOT EXISTS customer_assets_contact_live_idx
  ON public.customer_assets (account_id, contact_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_assets_account_status_idx
  ON public.customer_assets (account_id, status);
CREATE INDEX IF NOT EXISTS customer_assets_account_warranty_end_idx
  ON public.customer_assets (account_id, warranty_end);

CREATE INDEX IF NOT EXISTS customer_assets_contact_id_idx
  ON public.customer_assets (contact_id);
CREATE INDEX IF NOT EXISTS customer_assets_asset_type_id_idx
  ON public.customer_assets (asset_type_id);
CREATE INDEX IF NOT EXISTS customer_assets_product_id_idx
  ON public.customer_assets (product_id);
CREATE INDEX IF NOT EXISTS customer_assets_territory_id_idx
  ON public.customer_assets (territory_id);
CREATE INDEX IF NOT EXISTS customer_assets_created_by_idx
  ON public.customer_assets (created_by);

-- Search-only: "the customer called from their old number" still finds the machine.
CREATE INDEX IF NOT EXISTS customer_assets_phone_snapshot_idx
  ON public.customer_assets (account_id, lower(customer_phone_snapshot))
  WHERE customer_phone_snapshot IS NOT NULL AND deleted_at IS NULL;

-- ── Defaults trigger ────────────────────────────────────────
-- BEFORE INSERT OR UPDATE, shaped like contacts_sync_geo_from_territory()
-- (20260916120000): do work only when it must. Three rules, each with a reason:
--
--  1. asset_code - INSERT only, only when null/blank. A code is printed on labels
--     and quoted to customers; it must never change after it is issued. An
--     importer may supply its own code; it is then kept as given.
--
--  2. territory_id - inherit from the contact ONLY WHEN THE ASSET'S OWN VALUE IS
--     NULL. Never overwrite an explicit value: the machine may sit somewhere other
--     than the customer's registered address, and Phase 2 area-based assignment
--     must follow the MACHINE, not the billing address.
--
--  3. customer snapshots - INSERT only, never refreshed on UPDATE. A snapshot that
--     tracks the live record is not a snapshot: contacts get renamed, phones
--     change, duplicates get merged, and the asset's history must not rewrite
--     itself. coalesce(NEW.x, <contact value>) lets an importer supply the
--     historical name/phone from a file when they differ from today's contact.
--
-- SECURITY DEFINER so the contact/accounts lookups are not filtered by the
-- caller's RLS; every lookup is pinned to NEW.account_id, so a contact_id from
-- another tenant yields nothing (no cross-tenant read of name/phone/territory).
-- get_next_asset_number() still checks the REAL caller (auth.uid() is a request
-- GUC, unchanged inside a definer function).
CREATE OR REPLACE FUNCTION public.customer_assets_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix    text;
  v_seq       bigint;
  v_name      text;
  v_phone     text;
  v_territory uuid;
BEGIN
  -- 1. Asset code (INSERT only).
  IF TG_OP = 'INSERT' AND (NEW.asset_code IS NULL OR btrim(NEW.asset_code) = '') THEN
    SELECT coalesce(nullif(btrim(a.settings->'service_settings'->>'asset_code_prefix'), ''), 'AST')
      INTO v_prefix
      FROM accounts a WHERE a.id = NEW.account_id;
    v_prefix := coalesce(v_prefix, 'AST');   -- no such account row: FK will reject the insert anyway
    v_seq := public.get_next_asset_number(NEW.account_id);
    -- greatest(): lpad() TRUNCATES when the number is wider than the pad, which
    -- would wrap code 1,000,000 into 100000 and collide. Pad to at least 6.
    NEW.asset_code := v_prefix || '-' || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0');
  END IF;

  -- 2 + 3. One contact lookup serves both, and only when something needs it.
  IF NEW.territory_id IS NULL OR TG_OP = 'INSERT' THEN
    SELECT c.territory_id, c.name, c.phone
      INTO v_territory, v_name, v_phone
      FROM contacts c
     WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id;

    -- 2. Territory: inherit only when the asset has none of its own.
    IF NEW.territory_id IS NULL THEN
      NEW.territory_id := v_territory;
    END IF;

    -- 3. Snapshots: INSERT only, never refreshed on UPDATE.
    IF TG_OP = 'INSERT' THEN
      NEW.customer_name_snapshot  := coalesce(NEW.customer_name_snapshot,  v_name);
      NEW.customer_phone_snapshot := coalesce(NEW.customer_phone_snapshot, v_phone);
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Trigger function: never callable from the API.
REVOKE EXECUTE ON FUNCTION public.customer_assets_defaults() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customer_assets_defaults_trg ON public.customer_assets;
CREATE TRIGGER customer_assets_defaults_trg
  BEFORE INSERT OR UPDATE ON public.customer_assets
  FOR EACH ROW EXECUTE FUNCTION public.customer_assets_defaults();

-- ── RLS ─────────────────────────────────────────────────────
-- Modelled on the LIVE orders policies (20260823120000 / 20260823140000, initplan-
-- wrapped by 20260913120000) and on Task 3's asset_types, which follows the same
-- shape:
--   SELECT                   : any account member (matches asset_types; the client
--                              additionally gates the screen on view_service_assets)
--   INSERT / UPDATE / DELETE : agent-or-above member
--                              AND the matching PERMISSION KEY via has_permission()
--                              AND the plan ceiling account_has_line(.., 'fsm')
--
-- Spec 4.12 point 1: INSERT is PERMISSION-based, not admin-only. It admits any
-- agent-or-above member holding create_service_assets - owners/admins always (has_permission
-- returns true for them), and a Technician role the day a tenant grants it. No
-- policy rewrite is needed in Phase 4. (The three permission keys are registered
-- in Task 5; until then only owner/admin/superadmin satisfy has_permission, which
-- is expected.)
--
-- The plan ceiling is on the WRITE policies only, NOT on SELECT - same decision
-- already shipped for asset_types.
-- Every auth call is wrapped (SELECT auth.uid()) so it is planned once, not per row.
ALTER TABLE public.customer_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_assets_select ON public.customer_assets;
CREATE POLICY customer_assets_select ON public.customer_assets
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS customer_assets_insert ON public.customer_assets;
CREATE POLICY customer_assets_insert ON public.customer_assets
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum)
              AND has_permission((SELECT auth.uid()), account_id, 'create_service_assets'::text)
              AND account_has_line(account_id, 'fsm'::text));

DROP POLICY IF EXISTS customer_assets_update ON public.customer_assets;
CREATE POLICY customer_assets_update ON public.customer_assets
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'agent'::account_role_enum)
         AND has_permission((SELECT auth.uid()), account_id, 'edit_service_assets'::text)
         AND account_has_line(account_id, 'fsm'::text));

DROP POLICY IF EXISTS customer_assets_delete ON public.customer_assets;
CREATE POLICY customer_assets_delete ON public.customer_assets
  FOR DELETE TO authenticated
  USING (is_account_member(account_id, 'agent'::account_role_enum)
         AND has_permission((SELECT auth.uid()), account_id, 'delete_service_assets'::text)
         AND account_has_line(account_id, 'fsm'::text));

-- ANALYZE the new table and its neighbour so the planner is not blind after
-- the migration (skipping this has bitten this project before).
ANALYZE public.customer_assets;
ANALYZE public.asset_types;
