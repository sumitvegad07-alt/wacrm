-- ============================================================
-- 068_orders_module.sql
-- FMCG Order Module: orders, items, custom values, dispatches,
-- configurable statuses, customer hierarchy level, product stock.
-- Mirrors the quotations module patterns (auto-numbering, RLS).
-- Additive only (IF NOT EXISTS).
-- ============================================================

-- 1. Product stock (manual for now; accounting integration overwrites later).
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock NUMERIC;

-- 2. Customer hierarchy level (nullable; only meaningful when hierarchy on).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS hierarchy_level INTEGER;

-- 3. Sequences for order + dispatch numbers.
ALTER TABLE account_sequences ADD COLUMN IF NOT EXISTS order_seq BIGINT DEFAULT 0;
ALTER TABLE account_sequences ADD COLUMN IF NOT EXISTS dispatch_seq BIGINT DEFAULT 0;

-- 4. Configurable order statuses (per account, like lead_statuses).
CREATE TABLE IF NOT EXISTS order_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_statuses_account_id ON order_statuses(account_id);
ALTER TABLE order_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_statuses_select" ON order_statuses;
CREATE POLICY order_statuses_select ON order_statuses FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "order_statuses_insert" ON order_statuses;
CREATE POLICY order_statuses_insert ON order_statuses FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS "order_statuses_update" ON order_statuses;
CREATE POLICY order_statuses_update ON order_statuses FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS "order_statuses_delete" ON order_statuses;
CREATE POLICY order_statuses_delete ON order_statuses FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 5. Orders.
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  site_visit_id UUID REFERENCES site_visits(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  sub_total NUMERIC(15, 2) DEFAULT 0,
  tax_total NUMERIC(15, 2) DEFAULT 0,
  total_amount NUMERIC(15, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Placed',
  classification TEXT NOT NULL DEFAULT 'direct' CHECK (classification IN ('direct', 'primary', 'secondary')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, order_number)
);
CREATE INDEX IF NOT EXISTS idx_orders_account_id ON orders(account_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_contact_id ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_site_visit_id ON orders(site_visit_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(account_id, date);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_select" ON orders;
CREATE POLICY orders_select ON orders FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "orders_insert" ON orders;
CREATE POLICY orders_insert ON orders FOR INSERT WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());
DROP POLICY IF EXISTS "orders_update" ON orders;
CREATE POLICY orders_update ON orders FOR UPDATE USING (is_account_member(account_id));
DROP POLICY IF EXISTS "orders_delete" ON orders;
CREATE POLICY orders_delete ON orders FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 6. Order items.
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit TEXT,
  quantity NUMERIC(15, 2) NOT NULL DEFAULT 1,
  price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  sub_total NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_items_select" ON order_items;
CREATE POLICY order_items_select ON order_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND is_account_member(o.account_id))
);
DROP POLICY IF EXISTS "order_items_insert" ON order_items;
CREATE POLICY order_items_insert ON order_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND is_account_member(o.account_id))
);
DROP POLICY IF EXISTS "order_items_update" ON order_items;
CREATE POLICY order_items_update ON order_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND is_account_member(o.account_id))
);
DROP POLICY IF EXISTS "order_items_delete" ON order_items;
CREATE POLICY order_items_delete ON order_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND is_account_member(o.account_id))
);

-- 7. Order custom values (shared custom_fields, module_name 'order').
CREATE TABLE IF NOT EXISTS order_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, custom_field_id)
);
ALTER TABLE order_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_cv_select" ON order_custom_values;
CREATE POLICY order_cv_select ON order_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_custom_values.order_id AND is_account_member(o.account_id))
);
DROP POLICY IF EXISTS "order_cv_insert" ON order_custom_values;
CREATE POLICY order_cv_insert ON order_custom_values FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND is_account_member(o.account_id))
);
DROP POLICY IF EXISTS "order_cv_update" ON order_custom_values;
CREATE POLICY order_cv_update ON order_custom_values FOR UPDATE USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND is_account_member(o.account_id))
);
DROP POLICY IF EXISTS "order_cv_delete" ON order_custom_values;
CREATE POLICY order_cv_delete ON order_custom_values FOR DELETE USING (
  EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND is_account_member(o.account_id))
);

-- 8. Order dispatches (one order -> many partial dispatches).
CREATE TABLE IF NOT EXISTS order_dispatches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dispatch_number TEXT NOT NULL,
  dispatched_at DATE NOT NULL DEFAULT CURRENT_DATE,
  transport_name TEXT,
  tracking_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, dispatch_number)
);
CREATE INDEX IF NOT EXISTS idx_order_dispatches_order_id ON order_dispatches(order_id);
CREATE INDEX IF NOT EXISTS idx_order_dispatches_account_id ON order_dispatches(account_id);
ALTER TABLE order_dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_dispatches_select" ON order_dispatches;
CREATE POLICY order_dispatches_select ON order_dispatches FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "order_dispatches_insert" ON order_dispatches;
CREATE POLICY order_dispatches_insert ON order_dispatches FOR INSERT WITH CHECK (is_account_member(account_id));
DROP POLICY IF EXISTS "order_dispatches_update" ON order_dispatches;
CREATE POLICY order_dispatches_update ON order_dispatches FOR UPDATE USING (is_account_member(account_id));
DROP POLICY IF EXISTS "order_dispatches_delete" ON order_dispatches;
CREATE POLICY order_dispatches_delete ON order_dispatches FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 9. Dispatch items.
CREATE TABLE IF NOT EXISTS dispatch_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispatch_id UUID NOT NULL REFERENCES order_dispatches(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit TEXT,
  quantity NUMERIC(15, 2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dispatch_items_dispatch_id ON dispatch_items(dispatch_id);
ALTER TABLE dispatch_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dispatch_items_select" ON dispatch_items;
CREATE POLICY dispatch_items_select ON dispatch_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM order_dispatches d WHERE d.id = dispatch_items.dispatch_id AND is_account_member(d.account_id))
);
DROP POLICY IF EXISTS "dispatch_items_insert" ON dispatch_items;
CREATE POLICY dispatch_items_insert ON dispatch_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM order_dispatches d WHERE d.id = dispatch_id AND is_account_member(d.account_id))
);
DROP POLICY IF EXISTS "dispatch_items_update" ON dispatch_items;
CREATE POLICY dispatch_items_update ON dispatch_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM order_dispatches d WHERE d.id = dispatch_id AND is_account_member(d.account_id))
);
DROP POLICY IF EXISTS "dispatch_items_delete" ON dispatch_items;
CREATE POLICY dispatch_items_delete ON dispatch_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM order_dispatches d WHERE d.id = dispatch_id AND is_account_member(d.account_id))
);

-- 10. Auto-numbering: ORD-0001 and DSP-0001.
CREATE OR REPLACE FUNCTION get_next_order_number(p_account_id UUID)
RETURNS TEXT AS $$
DECLARE v_seq BIGINT;
BEGIN
  INSERT INTO account_sequences (account_id, order_seq)
  VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
  SET order_seq = account_sequences.order_seq + 1
  RETURNING order_seq INTO v_seq;
  RETURN 'ORD-' || LPAD(v_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_order_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    NEW.order_number := get_next_order_number(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_order_number ON orders;
CREATE TRIGGER trg_set_order_number BEFORE INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION set_order_number();

DROP TRIGGER IF EXISTS set_updated_at ON orders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION get_next_dispatch_number(p_account_id UUID)
RETURNS TEXT AS $$
DECLARE v_seq BIGINT;
BEGIN
  INSERT INTO account_sequences (account_id, dispatch_seq)
  VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
  SET dispatch_seq = account_sequences.dispatch_seq + 1
  RETURNING dispatch_seq INTO v_seq;
  RETURN 'DSP-' || LPAD(v_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_dispatch_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.dispatch_number IS NULL OR NEW.dispatch_number = '' THEN
    NEW.dispatch_number := get_next_dispatch_number(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_dispatch_number ON order_dispatches;
CREATE TRIGGER trg_set_dispatch_number BEFORE INSERT ON order_dispatches
FOR EACH ROW EXECUTE FUNCTION set_dispatch_number();
