-- ============================================================
-- 115_product_categories_and_units.sql
-- ============================================================

-- 1. Product Categories Table
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  parent_id UUID REFERENCES product_categories(id) ON DELETE CASCADE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_categories_account_id ON product_categories(account_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_parent_id ON product_categories(parent_id);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_categories_select" ON product_categories;
CREATE POLICY product_categories_select ON product_categories FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "product_categories_insert" ON product_categories;
CREATE POLICY product_categories_insert ON product_categories FOR INSERT WITH CHECK (is_account_member(account_id, 'admin') OR is_account_member(account_id, 'owner'));
DROP POLICY IF EXISTS "product_categories_update" ON product_categories;
CREATE POLICY product_categories_update ON product_categories FOR UPDATE USING (is_account_member(account_id, 'admin') OR is_account_member(account_id, 'owner'));
DROP POLICY IF EXISTS "product_categories_delete" ON product_categories;
CREATE POLICY product_categories_delete ON product_categories FOR DELETE USING (is_account_member(account_id, 'admin') OR is_account_member(account_id, 'owner'));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at ON product_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Product Units Table
CREATE TABLE IF NOT EXISTS product_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_units_account_id ON product_units(account_id);

ALTER TABLE product_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_units_select" ON product_units;
CREATE POLICY product_units_select ON product_units FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "product_units_insert" ON product_units;
CREATE POLICY product_units_insert ON product_units FOR INSERT WITH CHECK (is_account_member(account_id, 'admin') OR is_account_member(account_id, 'owner'));
DROP POLICY IF EXISTS "product_units_update" ON product_units;
CREATE POLICY product_units_update ON product_units FOR UPDATE USING (is_account_member(account_id, 'admin') OR is_account_member(account_id, 'owner'));
DROP POLICY IF EXISTS "product_units_delete" ON product_units;
CREATE POLICY product_units_delete ON product_units FOR DELETE USING (is_account_member(account_id, 'admin') OR is_account_member(account_id, 'owner'));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at ON product_units;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON product_units FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Modify Products Table
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES product_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_unit_id ON products(unit_id);
