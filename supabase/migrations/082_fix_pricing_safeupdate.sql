-- ============================================================
-- 082_fix_pricing_safeupdate.sql
--
-- FIX: calculate_order_pricing (migration 077) used four UNQUALIFIED
-- statements on its scratch temp table — one DELETE and three UPDATEs
-- with no WHERE clause. Supabase runs pg_safeupdate on the PostgREST /
-- authenticated connection, which REJECTS any DELETE/UPDATE without a
-- WHERE clause ("DELETE requires a WHERE clause", SQLSTATE 21000).
--
-- The function therefore worked in every superuser SQL test (pg_safeupdate
-- is loaded per-connection for the API roles only) but FAILED the moment a
-- real browser client called it — which first happened via the Phase-2
-- order form. Both the live pricing display and create_order (which calls
-- this function internally) failed from this one cause.
--
-- Surgical fix: add `WHERE true` to each of the four statements. Semantics
-- are unchanged — every scratch row is still targeted, exactly as before —
-- so the SQL<->TS parity fixtures are unaffected. This is a straight
-- CREATE OR REPLACE of the whole function so the deployed definition is
-- self-contained.
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
    min_price              numeric
  ) ON COMMIT DROP;
  DELETE FROM _pricing_scratch WHERE true;   -- WHERE true: satisfies pg_safeupdate

  INSERT INTO _pricing_scratch
  SELECT
    t.ord::int,
    p.id,
    COALESCE(p.name, 'Unknown product'),
    p.unit,
    q.quantity,
    COALESCE(p.price, 0)                                   AS catalogue_price,
    COALESCE(q.locked_price, p.price, 0)                   AS price_list_price,
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

  UPDATE _pricing_scratch
  SET gross = ROUND(price_list_price * quantity, 2)
  WHERE true;   -- WHERE true: satisfies pg_safeupdate

  UPDATE _pricing_scratch
  SET discount_amount = LEAST(
    CASE
      WHEN discount_type = 'percent' THEN ROUND(gross * discount_value / 100.0, 2)
      WHEN discount_type = 'amount'  THEN ROUND(discount_value, 2)
      ELSE 0
    END,
    gross
  )
  WHERE true;   -- WHERE true: satisfies pg_safeupdate

  UPDATE _pricing_scratch
  SET after_item = gross - discount_amount - scheme_discount_amount
  WHERE true;   -- WHERE true: satisfies pg_safeupdate

  SELECT COALESCE(SUM(after_item), 0) INTO v_base_sum FROM _pricing_scratch;

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
    'valid',            NOT (v_enforce_floor AND v_violations IS NOT NULL),
    'calculated_at',    p_as_of,
    'engine_version',   1
  );

  DROP TABLE IF EXISTS _pricing_scratch;
  RETURN v_result;
END;
$$;
