-- ============================================================
-- 075_schemes.sql
-- Scheme structure. Lands in Phase 1 so Phase 4 adds behaviour, not
-- tables. No scheme logic runs until Phase 4.
--
-- Three types for now:
--   quantity_slab — buy N of a product, get a discount or a special price
--   free_goods    — buy N of product A, get M of product B free
--   value_slab    — order value over a threshold earns a discount
--
-- slab_mode:
--   step_up — 10-19 -> 1 free, 20-49 -> 3 free, 50+ -> 10 free
--   repeat  — every 10 -> 1 free; only COMPLETE sets count (25 -> 2 free)
--
-- Schemes auto-expire by date. There is no manual switch-off step:
-- a scheme is live when starts_on <= today AND (ends_on IS NULL OR
-- ends_on >= today) AND active.
--
-- Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS schemes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  scheme_type TEXT NOT NULL CHECK (scheme_type IN ('quantity_slab', 'free_goods', 'value_slab')),
  slab_mode   TEXT NOT NULL DEFAULT 'step_up' CHECK (slab_mode IN ('step_up', 'repeat')),
  -- 'all' plus optional specific customers today. Kept as a CHECK-constrained
  -- text column precisely so 'customer_level' and 'area' can be added later
  -- without restructuring.
  target_type TEXT NOT NULL DEFAULT 'all' CHECK (target_type IN ('all', 'specific_customers')),
  -- Cap on total free units per order. NULL = uncapped.
  max_free_units_per_order INTEGER,
  -- Deterministic tie-break when more than one scheme matches.
  priority    INTEGER NOT NULL DEFAULT 0,
  starts_on   DATE NOT NULL,
  ends_on     DATE,                          -- NULL = open ended
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT schemes_dates_sane CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT schemes_free_cap_sane CHECK (max_free_units_per_order IS NULL OR max_free_units_per_order > 0)
);

CREATE INDEX IF NOT EXISTS idx_schemes_account_id ON schemes(account_id);
CREATE INDEX IF NOT EXISTS idx_schemes_active_window
  ON schemes(account_id, starts_on, ends_on) WHERE active;

CREATE TABLE IF NOT EXISTS scheme_slabs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheme_id   UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  -- quantity_slab / free_goods use qty bounds; value_slab uses value bounds.
  min_qty     NUMERIC(15, 2),
  max_qty     NUMERIC(15, 2),
  min_value   NUMERIC(15, 2),
  max_value   NUMERIC(15, 2),
  reward_type TEXT NOT NULL CHECK (reward_type IN ('discount_percent', 'discount_amount', 'special_price', 'free_goods')),
  reward_value NUMERIC(15, 2),
  -- free_goods only: the product given away may differ from the one bought.
  free_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  free_qty    NUMERIC(15, 2),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT scheme_slabs_qty_sane   CHECK (max_qty IS NULL OR min_qty IS NULL OR max_qty >= min_qty),
  CONSTRAINT scheme_slabs_value_sane CHECK (max_value IS NULL OR min_value IS NULL OR max_value >= min_value),
  CONSTRAINT scheme_slabs_free_goods_complete
    CHECK (reward_type <> 'free_goods' OR (free_product_id IS NOT NULL AND free_qty IS NOT NULL AND free_qty > 0))
);

CREATE INDEX IF NOT EXISTS idx_scheme_slabs_scheme ON scheme_slabs(scheme_id);

-- Which products a scheme applies to.
CREATE TABLE IF NOT EXISTS scheme_products (
  scheme_id  UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (scheme_id, product_id)
);

-- Targeting when target_type = 'specific_customers'.
CREATE TABLE IF NOT EXISTS scheme_customers (
  scheme_id  UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (scheme_id, contact_id)
);

-- order_items.scheme_id was added in 073 without its FK, because schemes
-- did not exist yet. Wire it up now.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_scheme_fk'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_scheme_fk
      FOREIGN KEY (scheme_id) REFERENCES schemes(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE schemes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schemes_select" ON schemes;
CREATE POLICY schemes_select ON schemes FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "schemes_insert" ON schemes;
CREATE POLICY schemes_insert ON schemes FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS "schemes_update" ON schemes;
CREATE POLICY schemes_update ON schemes FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS "schemes_delete" ON schemes;
CREATE POLICY schemes_delete ON schemes FOR DELETE USING (is_account_member(account_id, 'admin'));

ALTER TABLE scheme_slabs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheme_slabs_select" ON scheme_slabs;
CREATE POLICY scheme_slabs_select ON scheme_slabs FOR SELECT USING (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_slabs.scheme_id AND is_account_member(s.account_id))
);
DROP POLICY IF EXISTS "scheme_slabs_write" ON scheme_slabs;
CREATE POLICY scheme_slabs_write ON scheme_slabs FOR ALL USING (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_slabs.scheme_id AND is_account_member(s.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_id AND is_account_member(s.account_id, 'admin'))
);

ALTER TABLE scheme_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheme_products_select" ON scheme_products;
CREATE POLICY scheme_products_select ON scheme_products FOR SELECT USING (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_products.scheme_id AND is_account_member(s.account_id))
);
DROP POLICY IF EXISTS "scheme_products_write" ON scheme_products;
CREATE POLICY scheme_products_write ON scheme_products FOR ALL USING (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_products.scheme_id AND is_account_member(s.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_id AND is_account_member(s.account_id, 'admin'))
);

ALTER TABLE scheme_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheme_customers_select" ON scheme_customers;
CREATE POLICY scheme_customers_select ON scheme_customers FOR SELECT USING (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_customers.scheme_id AND is_account_member(s.account_id))
);
DROP POLICY IF EXISTS "scheme_customers_write" ON scheme_customers;
CREATE POLICY scheme_customers_write ON scheme_customers FOR ALL USING (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_customers.scheme_id AND is_account_member(s.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM schemes s WHERE s.id = scheme_id AND is_account_member(s.account_id, 'admin'))
);

DROP TRIGGER IF EXISTS set_updated_at ON schemes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON schemes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
