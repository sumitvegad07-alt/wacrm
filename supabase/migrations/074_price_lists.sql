-- ============================================================
-- 074_price_lists.sql
-- Customer-specific pricing. Structure lands now (Phase 1) so nothing
-- needs restructuring when the UI arrives in Phase 3.
--
-- A price list has two independent parts, either or both may be used:
--   (a) blanket_discount_percent — applies to every product
--   (b) price_list_items         — overrides for specific products only
--       (the list holds ONLY the overridden products, not the whole
--        catalogue)
--
-- Resolution order for a product: specific override > blanket > catalogue.
--
-- DISCOUNT-BASED, NOT STORED FINAL PRICE. This is deliberate: raising a
-- catalogue price must flow through to discounted customers. Order lines
-- still snapshot the final price actually charged, so historical orders
-- never change.
--
-- Additive only.
-- ============================================================

CREATE TABLE IF NOT EXISTS price_lists (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  blanket_discount_percent NUMERIC(5, 2),   -- NULL = no blanket discount
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, name),
  CONSTRAINT price_lists_blanket_sane
    CHECK (blanket_discount_percent IS NULL
           OR (blanket_discount_percent >= 0 AND blanket_discount_percent <= 100))
);

CREATE INDEX IF NOT EXISTS idx_price_lists_account_id ON price_lists(account_id);

CREATE TABLE IF NOT EXISTS price_list_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  price_list_id UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  discount_percent NUMERIC(5, 2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (price_list_id, product_id),
  CONSTRAINT price_list_items_discount_sane
    CHECK (discount_percent >= 0 AND discount_percent <= 100)
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_list ON price_list_items(price_list_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_product ON price_list_items(product_id);

-- Assignment lives on the customer, and is edited from the customer's own
-- page — not from Settings.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES price_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_price_list_id ON contacts(price_list_id);

ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "price_lists_select" ON price_lists;
CREATE POLICY price_lists_select ON price_lists FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS "price_lists_insert" ON price_lists;
CREATE POLICY price_lists_insert ON price_lists FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS "price_lists_update" ON price_lists;
CREATE POLICY price_lists_update ON price_lists FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS "price_lists_delete" ON price_lists;
CREATE POLICY price_lists_delete ON price_lists FOR DELETE
  USING (is_account_member(account_id, 'admin'));

ALTER TABLE price_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "price_list_items_select" ON price_list_items;
CREATE POLICY price_list_items_select ON price_list_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM price_lists pl
          WHERE pl.id = price_list_items.price_list_id AND is_account_member(pl.account_id))
);
DROP POLICY IF EXISTS "price_list_items_insert" ON price_list_items;
CREATE POLICY price_list_items_insert ON price_list_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM price_lists pl
          WHERE pl.id = price_list_id AND is_account_member(pl.account_id, 'admin'))
);
DROP POLICY IF EXISTS "price_list_items_update" ON price_list_items;
CREATE POLICY price_list_items_update ON price_list_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM price_lists pl
          WHERE pl.id = price_list_id AND is_account_member(pl.account_id, 'admin'))
);
DROP POLICY IF EXISTS "price_list_items_delete" ON price_list_items;
CREATE POLICY price_list_items_delete ON price_list_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM price_lists pl
          WHERE pl.id = price_list_id AND is_account_member(pl.account_id, 'admin'))
);

DROP TRIGGER IF EXISTS set_updated_at ON price_lists;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON price_lists
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
