-- ============================================================
-- 101_territory_master.sql  — Territory Master, foundation schema
--
-- New tables:
--   territories                 — per-account adjacency-list geography tree
--   employee_area_assignments   — which employee covers which territory
-- Changed table:
--   contacts                    — adds territory_id (+ needs_territory_review flag)
--
-- Config (hierarchy levels + assignment mode) is NOT a table: it reuses the
-- accounts.settings jsonb pattern already used by order_settings, stored under
-- accounts.settings.territory_settings (written by the app / RPCs).
--
-- RLS mirrors the account-scoped pattern used across wacrm:
--   SELECT = any account member;  writes = admin/owner only.
-- Helper: is_account_member(account_id uuid, min_role account_role_enum DEFAULT 'viewer').
-- Updated-at: the shared update_updated_at_column() trigger fn (trigger named set_updated_at).
-- ============================================================

-- ── status enum ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'territory_status') THEN
    CREATE TYPE territory_status AS ENUM ('active', 'inactive', 'archived');
  END IF;
END$$;

-- ── territories ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.territories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  parent_id     uuid NULL REFERENCES public.territories(id) ON DELETE RESTRICT,
  level         int  NOT NULL CHECK (level >= 1),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  code          text NULL,
  status        territory_status NOT NULL DEFAULT 'active',
  notes         text NULL,
  is_seed_data  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz NULL
);

-- Duplicate names rejected under the SAME parent, allowed under DIFFERENT parents.
-- COALESCE folds root rows (parent_id IS NULL) into one comparison bucket so two
-- root "India"s can't both exist. Partial (deleted_at IS NULL) so a name can be
-- reused after its previous holder is archived.
CREATE UNIQUE INDEX IF NOT EXISTS territories_uniq_name_per_parent
  ON public.territories (
    account_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS territories_account_parent_idx
  ON public.territories (account_id, parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS territories_account_level_idx
  ON public.territories (account_id, level) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS territories_account_seed_idx
  ON public.territories (account_id) WHERE is_seed_data;

DROP TRIGGER IF EXISTS set_updated_at ON public.territories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.territories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── employee_area_assignments ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_area_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  territory_id uuid NOT NULL REFERENCES public.territories(id) ON DELETE RESTRICT,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  assigned_by  uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT employee_area_assignments_uniq UNIQUE (employee_id, territory_id)
);

CREATE INDEX IF NOT EXISTS eaa_account_territory_idx
  ON public.employee_area_assignments (account_id, territory_id);
CREATE INDEX IF NOT EXISTS eaa_account_employee_idx
  ON public.employee_area_assignments (account_id, employee_id);

-- ── contacts: leaf-level territory + migration review flag ────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS territory_id uuid NULL REFERENCES public.territories(id) ON DELETE RESTRICT;
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS needs_territory_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS contacts_territory_idx
  ON public.contacts (territory_id) WHERE territory_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_area_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS territories_select ON public.territories;
CREATE POLICY territories_select ON public.territories
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS territories_write ON public.territories;
CREATE POLICY territories_write ON public.territories
  FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Assignments: admins see all in the account; an employee sees their own rows.
-- NOTE: the spec wrote `employee_id = auth.uid()`, but in this schema employee_id
-- is profiles.id while auth.uid() is profiles.user_id, so we translate.
DROP POLICY IF EXISTS employee_area_assignments_select ON public.employee_area_assignments;
CREATE POLICY employee_area_assignments_select ON public.employee_area_assignments
  FOR SELECT USING (
    is_account_member(account_id, 'admin')
    OR employee_id IN (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS employee_area_assignments_write ON public.employee_area_assignments;
CREATE POLICY employee_area_assignments_write ON public.employee_area_assignments
  FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

COMMENT ON TABLE public.territories IS
  'Territory Master: per-account geographic hierarchy (adjacency list via parent_id). Single source of truth for country/state/city/area; replaces the flat contacts.country/state/city/area text columns.';
COMMENT ON COLUMN public.contacts.territory_id IS
  'Leaf-level territory (lowest enabled level). Replaces the deprecated country/state/city/area text columns.';
COMMENT ON COLUMN public.contacts.needs_territory_review IS
  'Set by migrate_contact_geo_to_territory() when legacy geo text could not be matched to a territory; cleared once an admin assigns territory_id.';
