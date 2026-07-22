-- ============================================================
-- 073_order_pricing_columns.sql
-- Discount, price-transparency and pricing-variance columns.
--
-- TRANSPARENCY: the salesman must be able to say "standard is 100, your
-- rate is 90, and I'll give 10 more". That needs the whole chain stored
-- per line, not a single final number:
--     catalogue_price        -> the standard price (shown struck through)
--     price_list_price       -> the admin's price for this customer
--     scheme_discount_amount -> what the scheme took off
--     discount_amount        -> what the salesman took off
--
-- QUOTED PRICE WINS: the money columns always hold what was actually
-- promised to the customer. When the server recalculates and disagrees,
-- it records what it *expected* in expected_total / pricing_variance and
-- flags pricing_status='review' for an admin to judge. It never silently
-- overwrites a price a salesman already gave.
--
-- Additive only. No existing column is altered or dropped.
-- ============================================================

ALTER TABLE order_items
  -- Price chain snapshot (see TRANSPARENCY above)
  ADD COLUMN IF NOT EXISTS catalogue_price         NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS price_list_price        NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS scheme_discount_amount  NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- Salesman discount, entered as either a percentage or a rupee amount
  ADD COLUMN IF NOT EXISTS discount_type           TEXT CHECK (discount_type IN ('percent', 'amount')),
  ADD COLUMN IF NOT EXISTS discount_value          NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount         NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- This line's pro-rata slice of a whole-order discount. Held per line
  -- (not at the header) so each line's tax reduces correctly — invoice
  -- discounts must be applied at line level for tax compliance.
  ADD COLUMN IF NOT EXISTS order_discount_share    NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- Free goods issued by a scheme appear as an extra line at zero price,
  -- so the warehouse ships them and stock reduces correctly.
  ADD COLUMN IF NOT EXISTS is_scheme_goods         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheme_id               UUID;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_discount_type  TEXT CHECK (order_discount_type IN ('percent', 'amount')),
  ADD COLUMN IF NOT EXISTS order_discount_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total       NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- 'provisional' = created offline, server has not checked it yet
  -- 'confirmed'   = server agrees with the stored numbers
  -- 'review'      = server disagrees; see expected_total + pricing_variance
  ADD COLUMN IF NOT EXISTS pricing_status       TEXT NOT NULL DEFAULT 'confirmed'
      CHECK (pricing_status IN ('provisional', 'confirmed', 'review')),
  ADD COLUMN IF NOT EXISTS expected_total       NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS pricing_variance     JSONB,
  -- Set when the order is first dispatched. Once set, the order is a
  -- record rather than a draft and can no longer be edited.
  ADD COLUMN IF NOT EXISTS locked_at            TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_pricing_status
  ON orders(account_id, pricing_status) WHERE pricing_status <> 'confirmed';
