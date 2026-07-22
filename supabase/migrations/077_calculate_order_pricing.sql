-- ============================================================
-- 077_calculate_order_pricing.sql
--
-- THE single source of truth for order money. Every path calls this one
-- function: the price preview tool, web order creation, mobile sync, and
-- (Phase 2) create_order / update_order. That is what makes "if the
-- preview is right, orders are right" true rather than aspirational.
--
-- PRICING SEQUENCE — FIXED, NOT CONFIGURABLE. Each step operates on the
-- result of the last:
--     catalogue price
--       -> price list (admin's customer pricing)   [Phase 3]
--       -> scheme                                   [Phase 4]
--       -> salesman discount
--       -> whole-order discount, spread pro-rata
--       -> price floor check
--
-- A configurable order would mean every order must permanently store the
-- whole active configuration or its price could never be explained to a
-- customer later. Do not reintroduce configurable ordering.
--
-- PHASE 1 SCOPE: catalogue price, tax slabs, salesman discount, pro-rata
-- order discount, price floor, classification. The price-list and scheme
-- steps are marked below and currently PASS THROUGH UNCHANGED — they are
-- labelled, not faked. Nothing here pretends to do work it does not do.
--
-- WHOLE-ORDER DISCOUNT is allocated across the lines rather than held at
-- the header, so each line's tax reduces correctly. Invoice-level
-- discounts must apply at line level for tax compliance.
--
-- SECURITY INVOKER: runs as the caller so RLS applies and an account can
-- only ever price its own products and customers.
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_order_pricing(
  p_account_id     uuid,
  p_contact_id     uuid,
  p_lines          jsonb,                          -- [{product_id, quantity, discount_type, discount_value, locked_price?}]
  p_order_discount jsonb       DEFAULT NULL,       -- {type:'percent'|'amount', value:number}
  p_as_of          timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_hierarchy_enabled  boolean;
  v_enforce_floor      boolean;
  v_customer_level     integer;
  v_classification     text;
  v_od_type            text;
  v_od_value           numeric := 0;
  v_base_sum           numeric := 0;   -- sum of lines after item discount
  v_order_discount     numeric := 0;
  v_result             jsonb;
  v_lines              jsonb;
  v_sub_total          numeric := 0;
  v_tax_total          numeric := 0;
  v_discount_total     numeric := 0;
  v_total              numeric := 0;
  v_violations         jsonb;
BEGIN
  -- ---------- account configuration ----------
  SELECT
    COALESCE((settings -> 'order_settings' ->> 'hierarchy_enabled')::boolean, false),
    COALESCE((settings -> 'order_settings' ->> 'enforce_price_floor')::boolean, true)
  INTO v_hierarchy_enabled, v_enforce_floor
  FROM accounts
  WHERE id = p_account_id;

  -- ---------- classification ----------
  -- hierarchy off                      -> direct
  -- level 1 (top of chain)             -> primary
  -- any level below top                -> secondary
  -- hierarchy on but level not set     -> direct, meaning "not known yet"
  --   (deliberately NOT secondary: that would assert a position in the
  --    hierarchy that nobody has actually stated)
  IF p_contact_id IS NOT NULL THEN
    SELECT hierarchy_level INTO v_customer_level FROM contacts WHERE id = p_contact_id;
  END IF;

  IF NOT v_hierarchy_enabled THEN
    v_classification := 'direct';
  ELSIF v_customer_level IS NULL THEN
    v_classification := 'direct';
  ELSIF v_customer_level <= 1 THEN
    v_classification := 'primary';
  ELSE
    v_classification := 'secondary';
  END IF;

  -- ---------- whole-order discount inputs ----------
  IF p_order_discount IS NOT NULL THEN
    v_od_type  := NULLIF(p_order_discount ->> 'type', '');
    v_od_value := COALESCE((p_order_discount ->> 'value')::numeric, 0);
  END IF;

  -- ---------- pass 1: resolve products, apply item-level discount ----------
  CREATE TEMP TABLE IF NOT EXISTS _pricing_scratch (
    position               int,
    product_id             uuid,
    product_name           text,
    unit                   text,
    quantity               numeric,
    catalogue_price        numeric,
    price_list_price       numeric,
    scheme_discount_amount numeric,
    discount_type          text,
    discount_value         numeric,
    discount_amount        numeric,
    gross                  numeric,
    after_item             numeric,
    tax_rate               numeric,
    min_price              numeric
  ) ON COMMIT DROP;
  DELETE FROM _pricing_scratch;

  INSERT INTO _pricing_scratch
  SELECT
    t.ord::int,
    p.id,
    COALESCE(p.name, 'Unknown product'),
    p.unit,
    q.quantity,
    COALESCE(p.price, 0)                                   AS catalogue_price,
    -- Phase 3 will resolve the customer's price list here. Until then the
    -- admin price is the catalogue price, or the locked price when an
    -- existing order line is being re-priced during an edit.
    COALESCE(q.locked_price, p.price, 0)                   AS price_list_price,
    -- Phase 4 will apply schemes here.
    0::numeric                                             AS scheme_discount_amount,
    q.discount_type,
    q.discount_value,
    0::numeric                                             AS discount_amount,
    0::numeric                                             AS gross,
    0::numeric                                             AS after_item,
    COALESCE(ts.rate, 0)                                   AS tax_rate,
    p.min_price
  FROM (
    SELECT
      t2.ord,
      (l ->> 'product_id')::uuid                     AS product_id,
      GREATEST(COALESCE((l ->> 'quantity')::numeric, 0), 0) AS quantity,
      NULLIF(l ->> 'discount_type', '')              AS discount_type,
      GREATEST(COALESCE((l ->> 'discount_value')::numeric, 0), 0) AS discount_value,
      (l ->> 'locked_price')::numeric                AS locked_price
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t2(l, ord)
  ) q
  LEFT JOIN products  p  ON p.id = q.product_id AND p.account_id = p_account_id
  LEFT JOIN tax_slabs ts ON ts.id = p.tax_slab_id
  CROSS JOIN LATERAL (SELECT q.ord AS ord) t;

  -- gross and item-level discount
  UPDATE _pricing_scratch
  SET gross = ROUND(price_list_price * quantity, 2);

  UPDATE _pricing_scratch
  SET discount_amount = LEAST(
    CASE
      WHEN discount_type = 'percent' THEN ROUND(gross * discount_value / 100.0, 2)
      WHEN discount_type = 'amount'  THEN ROUND(discount_value, 2)
      ELSE 0
    END,
    gross                                  -- a discount can never exceed the line
  );

  UPDATE _pricing_scratch
  SET after_item = gross - discount_amount - scheme_discount_amount;

  SELECT COALESCE(SUM(after_item), 0) INTO v_base_sum FROM _pricing_scratch;

  -- ---------- whole-order discount, allocated pro-rata ----------
  v_order_discount := CASE
    WHEN v_od_type = 'percent' THEN ROUND(v_base_sum * v_od_value / 100.0, 2)
    WHEN v_od_type = 'amount'  THEN LEAST(ROUND(v_od_value, 2), v_base_sum)
    ELSE 0
  END;

  -- ---------- pass 2: allocate, tax, floor check ----------
  SELECT jsonb_agg(line ORDER BY position), jsonb_agg(violation) FILTER (WHERE violation IS NOT NULL)
  INTO v_lines, v_violations
  FROM (
    SELECT
      s.position,
      jsonb_build_object(
        'position',               s.position,
        'product_id',             s.product_id,
        'product_name',           s.product_name,
        'unit',                   s.unit,
        'quantity',               s.quantity,
        'catalogue_price',        s.catalogue_price,
        'price_list_price',       s.price_list_price,
        'scheme_discount_amount', s.scheme_discount_amount,
        'discount_type',          s.discount_type,
        'discount_value',         s.discount_value,
        'discount_amount',        s.discount_amount,
        'order_discount_share',   alloc.share,
        'sub_total',              alloc.net,
        'tax_rate',               s.tax_rate,
        'tax_amount',             ROUND(alloc.net * s.tax_rate / 100.0, 2),
        'total',                  alloc.net + ROUND(alloc.net * s.tax_rate / 100.0, 2),
        'is_scheme_goods',        false,
        'min_price',              s.min_price,
        'effective_unit_price',   alloc.effective_unit,
        'floor_breached',         (s.min_price IS NOT NULL AND alloc.effective_unit < s.min_price)
      ) AS line,
      CASE
        WHEN s.min_price IS NOT NULL AND alloc.effective_unit < s.min_price
        THEN jsonb_build_object(
               'product_id',   s.product_id,
               'product_name', s.product_name,
               'min_price',    s.min_price,
               'attempted_price', alloc.effective_unit
             )
        ELSE NULL
      END AS violation
    FROM _pricing_scratch s
    CROSS JOIN LATERAL (
      SELECT
        share_calc.share,
        s.after_item - share_calc.share AS net,
        CASE WHEN s.quantity > 0
             THEN ROUND((s.after_item - share_calc.share) / s.quantity, 4)
             ELSE 0 END AS effective_unit
      FROM (
        SELECT CASE
                 WHEN v_base_sum > 0
                 THEN ROUND(v_order_discount * s.after_item / v_base_sum, 2)
                 ELSE 0
               END AS share
      ) share_calc
    ) alloc
  ) built;

  SELECT
    COALESCE(SUM((l ->> 'sub_total')::numeric), 0),
    COALESCE(SUM((l ->> 'tax_amount')::numeric), 0),
    COALESCE(SUM((l ->> 'total')::numeric), 0)
  INTO v_sub_total, v_tax_total, v_total
  FROM jsonb_array_elements(COALESCE(v_lines, '[]'::jsonb)) AS l;

  SELECT COALESCE(SUM(discount_amount), 0) INTO v_discount_total FROM _pricing_scratch;
  v_discount_total := v_discount_total + v_order_discount;

  v_result := jsonb_build_object(
    'lines',            COALESCE(v_lines, '[]'::jsonb),
    'sub_total',        v_sub_total,
    'discount_total',   v_discount_total,
    'order_discount',   v_order_discount,
    'tax_total',        v_tax_total,
    'total_amount',     v_total,
    'classification',   v_classification,
    'floor_violations', COALESCE(v_violations, '[]'::jsonb),
    'enforce_floor',    v_enforce_floor,
    -- valid = safe to save. A floor breach only blocks when the account
    -- has floor enforcement switched on.
    'valid',            NOT (v_enforce_floor AND v_violations IS NOT NULL),
    'calculated_at',    p_as_of,
    'engine_version',   1
  );

  DROP TABLE IF EXISTS _pricing_scratch;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION calculate_order_pricing IS
'Single source of truth for order money. Phase 1: catalogue price, tax slabs, salesman discount, pro-rata order discount, price floor, classification. Price-list (Phase 3) and scheme (Phase 4) steps are present but pass through unchanged.';
