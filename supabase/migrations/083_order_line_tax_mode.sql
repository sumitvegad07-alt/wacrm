-- ============================================================
-- 083_order_line_tax_mode.sql
-- Tax inclusive/exclusive, stored PER LINE (order_items.tax_mode).
--
-- WHY PER LINE, not per order: an order edited after the account setting
-- changes must keep its OLD lines on their original basis and price only
-- NEW lines on the current basis — exactly like locked_price for edited
-- prices. A single order-level value can't represent a mixed order, so the
-- basis rides on each line (an entry in p_lines, echoed into the pricing
-- breakdown, stored on order_items).
--
-- The account's current default lives in
-- accounts.settings.order_settings.tax_mode ('exclusive' | 'inclusive');
-- the client stamps it onto each new line. Changing the setting never
-- recalculates a past line because the line carries its own basis.
--
-- EXCLUSIVE (unchanged, the historical behaviour): the product price is
-- pre-tax; tax is added on top.
-- INCLUSIVE: the product price already CONTAINS the tax; we back the tax
-- out, so the customer sees the same final price with the tax inside it.
--
-- In both modes the stored money columns keep identical meaning:
--   sub_total = pre-tax net, tax_amount = tax, total = tax-inclusive total.
-- Only the derivation of net/tax from the price differs.
--
-- Additive: new column (DEFAULT 'exclusive', so existing lines are
-- correctly stamped exclusive automatically) + CREATE OR REPLACE of three
-- functions. No existing column altered or dropped.
-- ============================================================

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'exclusive'
    CHECK (tax_mode IN ('inclusive', 'exclusive'));

-- ---------- calculate_order_pricing: per-line tax basis ----------
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

  -- Pass 1 works in the line's NATIVE basis (pre-tax for exclusive,
  -- tax-inclusive for inclusive) — no branching needed. price_list_price is
  -- whatever basis the product price is in.
  UPDATE _pricing_scratch
  SET gross = ROUND(price_list_price * quantity, 2)
  WHERE true;

  UPDATE _pricing_scratch
  SET discount_amount = LEAST(
    CASE
      WHEN discount_type = 'percent' THEN ROUND(gross * discount_value / 100.0, 2)
      WHEN discount_type = 'amount'  THEN ROUND(discount_value, 2)
      ELSE 0
    END,
    gross
  )
  WHERE true;

  UPDATE _pricing_scratch
  SET after_item = gross - discount_amount - scheme_discount_amount
  WHERE true;

  SELECT COALESCE(SUM(after_item), 0) INTO v_base_sum FROM _pricing_scratch;

  v_order_discount := CASE
    WHEN v_od_type = 'percent' THEN ROUND(v_base_sum * v_od_value / 100.0, 2)
    WHEN v_od_type = 'amount'  THEN LEAST(ROUND(v_od_value, 2), v_base_sum)
    ELSE 0
  END;

  -- Pass 2: allocate the order discount pro-rata, then derive net/tax per the
  -- line's tax basis. native_after = the line amount (native basis) after both
  -- discounts.
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
        -- per-unit rate WITH tax, in the price's own basis (for display)
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
        -- inclusive: tax = total - net (penny-perfect, reconciles to the
        -- displayed inclusive amount). exclusive: tax added on top.
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

-- ---------- create_order: store the per-line tax basis ----------
CREATE OR REPLACE FUNCTION create_order(
  p_order_id         uuid,
  p_account_id       uuid,
  p_contact_id       uuid,
  p_site_visit_id    uuid,
  p_date             date,
  p_lines            jsonb,
  p_order_discount   jsonb DEFAULT NULL,
  p_client_breakdown jsonb DEFAULT NULL,
  p_source           text  DEFAULT 'online',
  p_notes            text  DEFAULT NULL,
  p_platform         text  DEFAULT NULL,
  p_app_version      text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
  v_existing_number   text;
  v_calc              jsonb;
  v_store             jsonb;
  v_expected_total    numeric;
  v_client_total      numeric;
  v_status            text := 'confirmed';
  v_variance          jsonb := '[]'::jsonb;
  v_contact_final     uuid;
  v_contact_missing   boolean := false;
  v_any_prod_missing  boolean := false;
  v_classification    text;
  v_order_number      text;
BEGIN
  SELECT order_number INTO v_existing_number FROM orders WHERE id = p_order_id;
  IF FOUND THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_existing_number, 'idempotent_replay', true);
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('online', 'offline_sync') THEN
    p_source := 'online';
  END IF;

  v_calc := calculate_order_pricing(p_account_id, p_contact_id, p_lines, p_order_discount, now());
  v_classification := v_calc ->> 'classification';
  v_expected_total := (v_calc ->> 'total_amount')::numeric;

  IF p_source = 'offline_sync' AND p_client_breakdown IS NOT NULL THEN
    v_store := p_client_breakdown;
  ELSE
    v_store := v_calc;
  END IF;

  IF p_contact_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id AND account_id = p_account_id) THEN
    v_contact_missing := true;
    v_contact_final := NULL;
  ELSE
    v_contact_final := p_contact_id;
  END IF;

  SELECT bool_or((ln ->> 'product_id') IS NOT NULL AND p.id IS NULL)
    INTO v_any_prod_missing
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = p_account_id;

  IF p_source = 'offline_sync' THEN
    v_client_total := (p_client_breakdown ->> 'total_amount')::numeric;
    IF v_client_total IS NOT NULL AND abs(v_client_total - v_expected_total) > 0.01 THEN
      v_status := 'review';
      v_variance := v_variance || jsonb_build_object(
        'kind', 'price_changed', 'quoted_total', v_client_total, 'expected_total', v_expected_total,
        'note', 'Catalogue price or tax changed after this order was quoted offline. Quoted price kept; review before dispatch.');
    END IF;
    IF (v_calc ->> 'valid')::boolean = false THEN
      v_status := 'review';
      v_variance := v_variance || jsonb_build_object(
        'kind', 'floor_breach', 'note', 'Current price floor is breached by the quoted price.',
        'floor_violations', v_calc -> 'floor_violations');
    END IF;
  END IF;

  IF v_contact_missing THEN
    v_status := 'review';
    v_variance := v_variance || jsonb_build_object(
      'kind', 'contact_detached',
      'note', 'The customer this order was quoted for no longer exists. Re-attach the correct customer.');
  END IF;
  IF COALESCE(v_any_prod_missing, false) THEN
    v_status := 'review';
    v_variance := v_variance || jsonb_build_object(
      'kind', 'product_detached',
      'note', 'One or more products on this order no longer exist. Line snapshots are preserved; re-attach the product.');
  END IF;

  INSERT INTO orders (
    id, account_id, user_id, contact_id, site_visit_id, date,
    sub_total, tax_total, total_amount, discount_total,
    order_discount_type, order_discount_value,
    status, classification, notes,
    pricing_status, expected_total, pricing_variance
  ) VALUES (
    p_order_id, p_account_id, auth.uid(), v_contact_final, p_site_visit_id, COALESCE(p_date, CURRENT_DATE),
    COALESCE((v_store ->> 'sub_total')::numeric, 0),
    COALESCE((v_store ->> 'tax_total')::numeric, 0),
    COALESCE((v_store ->> 'total_amount')::numeric, 0),
    COALESCE((v_store ->> 'discount_total')::numeric, 0),
    NULLIF(p_order_discount ->> 'type', ''),
    COALESCE((p_order_discount ->> 'value')::numeric, 0),
    'Placed', v_classification, p_notes,
    v_status, v_expected_total,
    CASE WHEN v_variance = '[]'::jsonb THEN NULL ELSE v_variance END
  );

  SELECT order_number INTO v_order_number FROM orders WHERE id = p_order_id;

  INSERT INTO order_items (
    order_id, product_id, product_name, unit, quantity, price,
    tax_rate, tax_amount, sub_total, total, position,
    catalogue_price, price_list_price, scheme_discount_amount,
    discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode
  )
  SELECT
    p_order_id,
    p.id,
    COALESCE(ln ->> 'product_name', 'Unknown product'),
    ln ->> 'unit',
    COALESCE((ln ->> 'quantity')::numeric, 0),
    COALESCE((ln ->> 'price_list_price')::numeric, 0),
    COALESCE((ln ->> 'tax_rate')::numeric, 0),
    COALESCE((ln ->> 'tax_amount')::numeric, 0),
    COALESCE((ln ->> 'sub_total')::numeric, 0),
    COALESCE((ln ->> 'total')::numeric, 0),
    COALESCE((ln ->> 'position')::int, 0),
    (ln ->> 'catalogue_price')::numeric,
    (ln ->> 'price_list_price')::numeric,
    COALESCE((ln ->> 'scheme_discount_amount')::numeric, 0),
    NULLIF(ln ->> 'discount_type', ''),
    COALESCE((ln ->> 'discount_value')::numeric, 0),
    COALESCE((ln ->> 'discount_amount')::numeric, 0),
    COALESCE((ln ->> 'order_discount_share')::numeric, 0),
    COALESCE((ln ->> 'is_scheme_goods')::boolean, false),
    COALESCE(ln ->> 'tax_mode', 'exclusive')
  FROM jsonb_array_elements(v_store -> 'lines') AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = p_account_id;

  IF p_source = 'online' AND p_client_breakdown IS NOT NULL THEN
    v_client_total := (p_client_breakdown ->> 'total_amount')::numeric;
    IF v_client_total IS NOT NULL AND abs(v_client_total - v_expected_total) > 0.01 THEN
      INSERT INTO pricing_drift_log (
        account_id, order_id, platform, app_version, engine_version, server_engine_version,
        client_total, server_total, inputs, client_breakdown, server_breakdown
      ) VALUES (
        p_account_id, p_order_id, p_platform, p_app_version,
        (p_client_breakdown ->> 'engine_version')::int, (v_calc ->> 'engine_version')::int,
        v_client_total, v_expected_total,
        jsonb_build_object('lines', p_lines, 'order_discount', p_order_discount, 'contact_id', p_contact_id),
        p_client_breakdown, v_calc);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id, 'order_number', v_order_number, 'pricing_status', v_status,
    'classification', v_classification, 'expected_total', v_expected_total,
    'pricing_variance', CASE WHEN v_variance = '[]'::jsonb THEN NULL ELSE v_variance END,
    'idempotent_replay', false);
END;
$fn$;

-- ---------- update_order: preserve per-line tax basis on edit ----------
CREATE OR REPLACE FUNCTION update_order(
  p_order_id       uuid,
  p_lines          jsonb,
  p_order_discount jsonb DEFAULT NULL,
  p_notes          text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
  v_account_id uuid; v_contact_id uuid; v_locked_at timestamptz;
  v_calc jsonb; v_status text; v_variance jsonb;
BEGIN
  SELECT account_id, contact_id, locked_at INTO v_account_id, v_contact_id, v_locked_at
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found or not accessible'; END IF;
  IF v_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This order has been dispatched and can no longer be edited. Create a return or a new order instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_calc := calculate_order_pricing(v_account_id, v_contact_id, p_lines, p_order_discount, now());

  IF (v_calc ->> 'valid')::boolean = false THEN
    v_status := 'review';
    v_variance := jsonb_build_array(jsonb_build_object(
      'kind', 'floor_breach', 'note', 'Price floor is breached.', 'floor_violations', v_calc -> 'floor_violations'));
  ELSE
    v_status := 'confirmed';
    v_variance := NULL;
  END IF;

  DELETE FROM order_items WHERE order_id = p_order_id;

  INSERT INTO order_items (
    order_id, product_id, product_name, unit, quantity, price,
    tax_rate, tax_amount, sub_total, total, position,
    catalogue_price, price_list_price, scheme_discount_amount,
    discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode
  )
  SELECT
    p_order_id, p.id, COALESCE(ln ->> 'product_name', 'Unknown product'), ln ->> 'unit',
    COALESCE((ln ->> 'quantity')::numeric, 0), COALESCE((ln ->> 'price_list_price')::numeric, 0),
    COALESCE((ln ->> 'tax_rate')::numeric, 0), COALESCE((ln ->> 'tax_amount')::numeric, 0),
    COALESCE((ln ->> 'sub_total')::numeric, 0), COALESCE((ln ->> 'total')::numeric, 0),
    COALESCE((ln ->> 'position')::int, 0), (ln ->> 'catalogue_price')::numeric, (ln ->> 'price_list_price')::numeric,
    COALESCE((ln ->> 'scheme_discount_amount')::numeric, 0), NULLIF(ln ->> 'discount_type', ''),
    COALESCE((ln ->> 'discount_value')::numeric, 0), COALESCE((ln ->> 'discount_amount')::numeric, 0),
    COALESCE((ln ->> 'order_discount_share')::numeric, 0), COALESCE((ln ->> 'is_scheme_goods')::boolean, false),
    COALESCE(ln ->> 'tax_mode', 'exclusive')
  FROM jsonb_array_elements(v_calc -> 'lines') AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = v_account_id;

  UPDATE orders SET
    sub_total = COALESCE((v_calc ->> 'sub_total')::numeric, 0),
    tax_total = COALESCE((v_calc ->> 'tax_total')::numeric, 0),
    total_amount = COALESCE((v_calc ->> 'total_amount')::numeric, 0),
    discount_total = COALESCE((v_calc ->> 'discount_total')::numeric, 0),
    order_discount_type = NULLIF(p_order_discount ->> 'type', ''),
    order_discount_value = COALESCE((p_order_discount ->> 'value')::numeric, 0),
    classification = v_calc ->> 'classification', notes = COALESCE(p_notes, notes),
    pricing_status = v_status, expected_total = (v_calc ->> 'total_amount')::numeric, pricing_variance = v_variance
  WHERE id = p_order_id;

  RETURN jsonb_build_object('order_id', p_order_id, 'pricing_status', v_status,
    'classification', v_calc ->> 'classification', 'total_amount', (v_calc ->> 'total_amount')::numeric);
END;
$fn$;
