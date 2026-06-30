-- ============================================================
-- PRODUCTS MODULE
-- ============================================================

-- PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  price NUMERIC(15, 2),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_account_id ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_select" ON products;
CREATE POLICY products_select ON products FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "products_insert" ON products;
CREATE POLICY products_insert ON products FOR INSERT WITH CHECK (is_account_member(account_id));
DROP POLICY IF EXISTS "products_update" ON products;
CREATE POLICY products_update ON products FOR UPDATE USING (is_account_member(account_id));
DROP POLICY IF EXISTS "products_delete" ON products;
CREATE POLICY products_delete ON products FOR DELETE USING (is_account_member(account_id, 'admin'));

-- PRODUCT CUSTOM VALUES
CREATE TABLE IF NOT EXISTS product_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, custom_field_id)
);

ALTER TABLE product_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_cv_select" ON product_custom_values;
CREATE POLICY product_cv_select ON product_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM products p WHERE p.id = product_custom_values.product_id AND is_account_member(p.account_id))
);
DROP POLICY IF EXISTS "product_cv_insert" ON product_custom_values;
CREATE POLICY product_cv_insert ON product_custom_values FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND is_account_member(p.account_id))
);
DROP POLICY IF EXISTS "product_cv_update" ON product_custom_values;
CREATE POLICY product_cv_update ON product_custom_values FOR UPDATE USING (
  EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND is_account_member(p.account_id))
);
DROP POLICY IF EXISTS "product_cv_delete" ON product_custom_values;
CREATE POLICY product_cv_delete ON product_custom_values FOR DELETE USING (
  EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND is_account_member(p.account_id))
);

-- LINK TASKS TO PRODUCTS
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_product_id ON tasks(product_id);

-- ADD MODULE_NAME to custom_fields (if missing, although it should already exist based on UI, we add just in case)
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS module_name TEXT DEFAULT 'contact';

-- Add updated_at trigger to products
DROP TRIGGER IF EXISTS set_updated_at ON products;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
