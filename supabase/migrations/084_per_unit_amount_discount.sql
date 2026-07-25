-- ============================================================
-- 084_per_unit_amount_discount.sql
-- A per-LINE amount discount now means "off EACH unit", not off the whole
-- line. Field discounts are spoken per unit ("5 rupees off each"), and this
-- makes the amount discount consistent with the percentage discount (which
-- already scales with quantity).
--
-- Before: amount ₹5 on qty 101 = ₹5 off the line (5 paise/unit — looked broken).
-- After:  amount ₹5 on qty 101 = ₹505 off the line (₹5/unit; 150 -> 145).
--
-- Percentage discount is UNCHANGED (already correct). The WHOLE-ORDER amount
-- discount is UNCHANGED — it is deliberately one amount across the whole order,
-- not per unit.
--
-- One-line change to calculate_order_pricing's discount step; everything else
-- is identical to migration 083. CREATE OR REPLACE so the deployed definition
-- is self-contained.
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_order_pricing(
  p_account_id     uuid,
  p_contact_id     uuid,
  p_lines          jsonb,
  p_order_discount jsonb       DEFAULT NULL,
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
  v_base_sum           numeric := 0;
  v_order_discount     numeric := 0;
  v_result             jsonb;
  v_lines              jsonb;
  v_sub_total          numeric := 0;
  v_tax_total          numeric := 0;
  v_discount_total     numeric := 0;
  v_total              numeric := 0;
  v_violations         jsonb;
BEGIN
  SELECT
    COALESCE((settings -> 'order_settings' ->> 'hierarchy_enabled')::boolean, false),
    COALESCE((settings -> 'order_settings' ->> 'enforce_price_floor')::boolean, true)
  INTO v_hierarchy_enabled, v_enforce_floor
  FROM accounts
  WHERE id = p_account_id;

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

  IF p_order_discount IS NOT NULL THEN
    v_od_type  := NULLIF(p_order_discount ->> 'type', '');
    v_od_value := COALESCE((p_order_discount ->> 'value')::numeric, 0);
  END IF;

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
    min_price              numeric,
    tax_mode               text
  ) ON COMMIT DROP;
  DELETE FROM _pricing_scratch WHERE true;

  INSERT INTO _pricing_scratch
  SELECT
    t.ord::int,
    p.id,
    COALESCE(p.name, 'Unknown product'),
    p.unit,
    q.quantity,
    COALESCE(p.price, 0),
    COALESCE(q.locked_price, p.price, 0),
    0::numeric,
    q.discount_type,
    q.discount_value,
    0::numeric,
    0::numeric,
    0::numeric,
    COALESCE(ts.rate, 0),
    p.min_price,
    COALESCE(q.tax_mode, 'exclusive')
  FROM (
    SELECT
      t2.ord,
      (l ->> 'product_id')::uuid                     AS product_id,
      GREATEST(COALESCE((l ->> 'quantity')::numeric, 0), 0) AS quantity,
      NULLIF(l ->> 'discount_type', '')              AS discount_type,
      GREATEST(COALESCE((l ->> 'discount_value')::numeric, 0), 0) AS discount_value,
      (l ->> 'locked_price')::numeric                AS locked_price,
      NULLIF(l ->> 'tax_mode', '')                   AS tax_mode
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t2(l, ord)
  ) q
  LEFT JOIN products  p  ON p.id = q.product_id AND p.account_id = p_account_id
  LEFT JOIN tax_slabs ts ON ts.id = p.tax_slab_id
  CROSS JOIN LATERAL (SELECT q.ord AS ord) t;

  UPDATE _pricing_scratch
  SET gross = ROUND(price_list_price * quantity, 2)
  WHERE true;

  -- Per-line discount. 'amount' is PER UNIT (× quantity); 'percent' scales
  -- with the line. Capped at the line so it can never go negative.
  UPDATE _pricing_scratch
  SET discount_amount = LEAST(
    CASE
      WHEN discount_type = 'percent' THEN ROUND(gross * discount_value / 100.0, 2)
      WHEN discount_type = 'amount'  THEN ROUND(discount_value * quantity, 2)
      ELSE 0
    END,
    gross
  )
  WHERE true;

  UPDATE _pricing_scratch
  SET after_item = gross - discount_amount - scheme_discount_amount
  WHERE true;

  SELECT COALESCE(SUM(after_item), 0) INTO v_base_sum FROM _pricing_scratch;

  -- Whole-order discount: 'amount' stays ONE amount across the order (NOT per unit).
  v_order_discount := CASE
    WHEN v_od_type = 'percent' THEN ROUND(v_base_sum * v_od_value / 100.0, 2)
    WHEN v_od_type = 'amount'  THEN LEAST(ROUND(v_od_value, 2), v_base_sum)
    ELSE 0
  END;

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
        'tax_mode',               s.tax_mode,
        'catalogue_price',        s.catalogue_price,
        'price_list_price',       s.price_list_price,
        'rate_incl_unit',         CASE WHEN s.tax_mode = 'inclusive'
                                       THEN s.catalogue_price
                                       ELSE ROUND(s.catalogue_price * (1 + s.tax_rate / 100.0), 2) END,
        'scheme_discount_amount', s.scheme_discount_amount,
        'discount_type',          s.discount_type,
        'discount_value',         s.discount_value,
        'discount_amount',        s.discount_amount,
        'order_discount_share',   alloc.share,
        'sub_total',              calc.net,
        'tax_rate',               s.tax_rate,
        'tax_amount',             calc.tax,
        'total',                  calc.net + calc.tax,
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
        s.after_item - share_calc.share AS native_after,
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
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN s.tax_mode = 'inclusive'
             THEN ROUND(alloc.native_after / (1 + s.tax_rate / 100.0), 2)
             ELSE alloc.native_after
        END AS net,
        CASE WHEN s.tax_mode = 'inclusive'
             THEN alloc.native_after - ROUND(alloc.native_after / (1 + s.tax_rate / 100.0), 2)
             ELSE ROUND(alloc.native_after * s.tax_rate / 100.0, 2)
        END AS tax
    ) calc
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
    'valid',            NOT (v_enforce_floor AND v_violations IS NOT NULL),
    'calculated_at',    p_as_of,
    'engine_version',   2
  );

  DROP TABLE IF EXISTS _pricing_scratch;
  RETURN v_result;
END;
$$;
