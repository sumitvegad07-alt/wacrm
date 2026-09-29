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

-- ── Defaults + guards trigger ───────────────────────────────
-- BEFORE INSERT OR UPDATE, shaped like contacts_sync_geo_from_territory()
-- (20260916120000): do work only when it must. One block per responsibility, in
-- this order: (1) code assignment, (2) territory inheritance, (3) customer
-- snapshots, (4) archive guard, (5) asset_code immutability, (6) tenant integrity.
--
-- SECURITY DEFINER so the contact / accounts / master lookups are not filtered by
-- the caller's RLS (that is exactly what lets us detect a foreign-tenant reference
-- instead of silently seeing nothing). Every lookup is pinned to the asset's own
-- account_id. auth.uid() is a request GUC, unchanged inside a definer function, so
-- get_next_asset_number() and has_permission() still see the REAL caller.
--
-- Guard summary for whoever debugs a rejected write:
--   42501  archive / restore without delete_service_assets      (block 4)
--   22023  asset_code changed, or account_id changed            (blocks 5, 6)
--   23503  contact / asset type / product / territory / created_by not in this account
--                                                                (blocks 2, 6)
CREATE OR REPLACE FUNCTION public.customer_assets_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := (SELECT auth.uid());   -- NULL for migrations / service role
  v_prefix      text;
  v_seq         bigint;
  v_name        text;
  v_phone       text;
  v_territory   uuid;
  v_inherited   boolean := false;
  -- "Did this reference change?" flags, computed once. They are set from IF/ELSE
  -- rather than "TG_OP = 'INSERT' OR NEW.x IS DISTINCT FROM OLD.x", because OLD is
  -- unassigned on INSERT and SQL does not guarantee OR/AND short-circuits. Blocks 4-6
  -- below use a nested IF for the same reason.
  c_contact     boolean := true;
  c_type        boolean := true;
  c_product     boolean := true;
  c_territory   boolean := true;
  c_created_by  boolean := true;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    c_contact    := NEW.contact_id    IS DISTINCT FROM OLD.contact_id;
    c_type       := NEW.asset_type_id IS DISTINCT FROM OLD.asset_type_id;
    c_product    := NEW.product_id    IS DISTINCT FROM OLD.product_id;
    c_territory  := NEW.territory_id  IS DISTINCT FROM OLD.territory_id;
    c_created_by := NEW.created_by    IS DISTINCT FROM OLD.created_by;
  END IF;

  -- ── 1. Asset code assignment (INSERT only, only when null/blank) ──
  -- A code is printed on labels and quoted to customers, so it is issued once. An
  -- importer may supply its own code; it is then kept as given (uniqueness is
  -- enforced by customer_assets_uniq_code). The prefix lives in account settings
  -- and only affects NEW codes; the counter itself is prefix-independent.
  IF TG_OP = 'INSERT' AND (NEW.asset_code IS NULL OR btrim(NEW.asset_code) = '') THEN
    SELECT coalesce(nullif(btrim(a.settings->'service_settings'->>'asset_code_prefix'), ''), 'AST')
      INTO v_prefix
      FROM accounts a WHERE a.id = NEW.account_id;
    v_prefix := coalesce(v_prefix, 'AST');   -- no such account row: the FK rejects the insert anyway
    v_seq := public.get_next_asset_number(NEW.account_id);
    -- greatest(): lpad() TRUNCATES when the number is wider than the pad, which
    -- would wrap code 1,000,000 into 100000 and collide. Pad to at least 6.
    NEW.asset_code := v_prefix || '-' || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0');
  END IF;

  -- ── 2. Territory inheritance ──
  -- Inherit from the contact ONLY WHEN THE ASSET'S OWN VALUE IS NULL. Never
  -- overwrite an explicit value: the machine may sit somewhere other than the
  -- customer's registered address, and Phase 2 area-based assignment must follow
  -- the MACHINE, not the billing address.
  --
  -- The contact lookup is also the TENANT-INTEGRITY check for contact_id: it is
  -- scoped to NEW.account_id, so a contact belonging to another tenant finds no row
  -- and we RAISE instead of quietly leaving snapshots and territory empty. One query
  -- serves inheritance, snapshots and that check, and it is skipped when nothing
  -- needs it (an UPDATE that keeps its contact and already has a territory).
  IF TG_OP = 'INSERT' OR c_contact OR NEW.territory_id IS NULL THEN
    SELECT c.territory_id, c.name, c.phone
      INTO v_territory, v_name, v_phone
      FROM contacts c
     WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'customer_assets: contact % does not exist in account %',
        NEW.contact_id, NEW.account_id USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.territory_id IS NULL AND v_territory IS NOT NULL THEN
      NEW.territory_id := v_territory;
      v_inherited := true;    -- came from an in-account contact; block 6 need not re-check it
    END IF;
  END IF;

  -- ── 3. Customer snapshots (INSERT only, never refreshed on UPDATE) ──
  -- A snapshot that tracks the live record is not a snapshot: contacts get renamed,
  -- phones change, duplicates get merged, and the asset's history must not rewrite
  -- itself. coalesce(NEW.x, contact value) lets an importer supply the historical
  -- name/phone from a file when they differ from today's contact record.
  IF TG_OP = 'INSERT' THEN
    NEW.customer_name_snapshot  := coalesce(NEW.customer_name_snapshot,  v_name);
    NEW.customer_phone_snapshot := coalesce(NEW.customer_phone_snapshot, v_phone);
  END IF;

  -- ── 4. Archive / restore guard (UPDATE, either direction of deleted_at) ──
  -- Archiving is a soft delete, i.e. an UPDATE of deleted_at, so RLS alone would let
  -- anyone with edit_service_assets do it while delete_service_assets governs only a
  -- hard DELETE this product never performs. The database must refuse what the UI
  -- refuses (spec section 11), so the delete right is enforced here. Restoring is
  -- the same privilege as archiving. Bypassed when auth.uid() IS NULL (migrations,
  -- service role), exactly like get_next_asset_number().
  -- delete_service_assets is not registered in the permission catalogue until Task 5;
  -- has_permission() returns true for owner/admin regardless, so this is correct in
  -- the meantime (non-admins are simply refused until the key exists and is granted).
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.deleted_at IS NULL) IS DISTINCT FROM (NEW.deleted_at IS NULL)
       AND v_uid IS NOT NULL
       AND NOT public.has_permission(v_uid, NEW.account_id, 'delete_service_assets'::text) THEN
      RAISE EXCEPTION 'customer_assets: archiving or restoring an asset requires delete_service_assets'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ── 5. asset_code is immutable after insert ──
  -- The code is printed on labels and referenced through service history, and a
  -- later prefix change must affect new assets only, never issued codes. A genuine
  -- typo is fixed by archiving and recreating. Applies to everyone, including
  -- migrations: integrity is not a permission question. (customer_assets_code_not_blank
  -- guards a different thing: a blank code.)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.asset_code IS DISTINCT FROM OLD.asset_code THEN
      RAISE EXCEPTION 'customer_assets: asset_code is immutable (cannot change % to %)',
        OLD.asset_code, NEW.asset_code USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  -- ── 6. Tenant integrity of the remaining references ──
  -- The FKs only prove a row exists SOMEWHERE, so a member of tenant A could store
  -- tenant B's asset type, product or territory on their own asset. Each reference is
  -- checked only when non-NULL and, on UPDATE, only when it actually changed, so a
  -- bulk import or an unrelated edit does not re-pay for unchanged values. Applied
  -- unconditionally (not skipped for auth.uid() IS NULL): a cross-tenant row is
  -- wrong for the service role too. (The contact was checked in block 2.)
  -- Archived/inactive masters are still accepted: existing assets may keep them.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
      -- Moving a row between tenants would bypass every check above, which are all
      -- scoped to the account_id at write time.
      RAISE EXCEPTION 'customer_assets: account_id cannot be changed'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  IF NEW.asset_type_id IS NOT NULL AND c_type
     AND NOT EXISTS (SELECT 1 FROM asset_types t
                      WHERE t.id = NEW.asset_type_id AND t.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'customer_assets: asset_type_id % does not exist in account %',
      NEW.asset_type_id, NEW.account_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.product_id IS NOT NULL AND c_product
     AND NOT EXISTS (SELECT 1 FROM products p
                      WHERE p.id = NEW.product_id AND p.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'customer_assets: product_id % does not exist in account %',
      NEW.product_id, NEW.account_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.territory_id IS NOT NULL AND c_territory AND NOT v_inherited
     AND NOT EXISTS (SELECT 1 FROM territories tr
                      WHERE tr.id = NEW.territory_id AND tr.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'customer_assets: territory_id % does not exist in account %',
      NEW.territory_id, NEW.account_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.created_by IS NOT NULL AND c_created_by
     AND NOT EXISTS (SELECT 1 FROM profiles pr
                      WHERE pr.id = NEW.created_by AND pr.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'customer_assets: created_by % is not a member of account %',
      NEW.created_by, NEW.account_id USING ERRCODE = 'foreign_key_violation';
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
