-- ============================================================
-- 072_product_tax_and_floor.sql
-- Gives products a tax slab and an optional price floor.
--
-- NOTE: `products` previously had NO tax column at all, which is why
-- wacrm-mobile's LineItemsEditor.tsx (selecting products.tax_rate) has
-- been failing with Postgres 42703 and never loading products.
-- That client is fixed to read tax_slab_id alongside this migration.
--
-- NO BACKFILL. Existing products keep tax_slab_id = NULL until an admin
-- assigns one, either per product or via the explicit
-- "assign this slab to all products" action in Settings. Silently
-- retro-taxing 103 live products is not something a migration should do.
--
-- Additive only.
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tax_slab_id UUID REFERENCES tax_slabs(id) ON DELETE SET NULL;

-- Minimum price this product may ever be sold at, after every discount
-- layer has been applied. NULL = no floor for this product.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS min_price NUMERIC(15, 2);

CREATE INDEX IF NOT EXISTS idx_products_tax_slab_id ON products(tax_slab_id);
