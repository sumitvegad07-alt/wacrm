-- ============================================================
-- 071_tax_slabs.sql
-- Account-scoped, admin-defined tax slabs (0%, 5%, 12%, 18%...).
-- Products pick one; order lines snapshot the resolved rate.
--
-- Deliberately called "tax", never "GST" — this must work outside India.
-- Mirrors the lead_statuses / order_statuses lookup-table pattern.
-- Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS tax_slabs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                        -- "5%", "Zero rated", "Exempt"
  rate        NUMERIC(5, 2) NOT NULL DEFAULT 0,     -- 5.00 = five percent
  is_default  BOOLEAN NOT NULL DEFAULT false,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, name),
  CONSTRAINT tax_slabs_rate_sane CHECK (rate >= 0 AND rate <= 100)
);

CREATE INDEX IF NOT EXISTS idx_tax_slabs_account_id ON tax_slabs(account_id);

-- Only one default slab per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_slabs_one_default
  ON tax_slabs(account_id) WHERE is_default;

ALTER TABLE tax_slabs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tax_slabs_select" ON tax_slabs;
CREATE POLICY tax_slabs_select ON tax_slabs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "tax_slabs_insert" ON tax_slabs;
CREATE POLICY tax_slabs_insert ON tax_slabs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "tax_slabs_update" ON tax_slabs;
CREATE POLICY tax_slabs_update ON tax_slabs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "tax_slabs_delete" ON tax_slabs;
CREATE POLICY tax_slabs_delete ON tax_slabs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON tax_slabs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tax_slabs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
