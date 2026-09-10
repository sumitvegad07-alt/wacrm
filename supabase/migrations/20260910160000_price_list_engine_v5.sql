-- ============================================================================
-- Price Lists — engine v4 -> v5  (activates the dormant 074_price_lists schema)
-- ----------------------------------------------------------------------------
-- The price_lists / price_list_items tables and contacts.price_list_id have
-- existed since migration 074 but NOTHING read them — calculate_order_pricing
-- passed price_list_price straight through as COALESCE(locked_price, catalogue).
-- This migration wires them in.
--
-- Resolution per product (all figures are DISCOUNT PERCENTAGES off catalogue,
-- never stored final prices, so a catalogue price rise flows through):
--     specific price_list_items override  >  list blanket %  >  catalogue (0%)
--   price_list_price = ROUND(catalogue * (1 - resolved% / 100), 2)
--   ...but a locked_price (an edited existing line) always wins, so a quoted
--   order never silently re-prices.
--
-- SALESMAN DISCOUNT GATE. New setting
-- accounts.settings.order_settings.allow_discount_over_price_list (default
-- false). When a customer is on an ACTIVE price list and this is false, every
-- manual salesman discount — per line AND whole-order — is dropped here, in the
-- single source of truth, regardless of the rep's apply_order_discount right.
-- Turn it on to let reps discount on top of price-list pricing.
--
-- 100% additive & backward compatible: a customer with no (active) price list
-- resolves 0% => catalogue price and no discount gating => byte-identical to
-- engine_version 4. Only calculate_order_pricing changes; create_order /
-- update_order already persist the price_list_price the engine returns.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_order_pricing(p_account_id uuid, p_contact_id uuid, p_lines jsonb, p_order_discount jsonb DEFAULT NULL::jsonb, p_as_of timestamp with time zone DEFAULT now(), p_order_schemes jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_hierarchy_enabled boolean; v_enforce_floor boolean; v_customer_level integer; v_classification text;
  v_amount_disc_basis text; v_od_type text; v_od_value numeric := 0; v_base_sum numeric := 0; v_order_discount numeric := 0;
  v_order_scheme_total numeric := 0; v_scheme_line_total numeric := 0; v_result jsonb; v_lines jsonb;
  v_sub_total numeric := 0; v_tax_total numeric := 0; v_discount_total numeric := 0; v_total numeric := 0; v_violations jsonb;
  -- Price list (v5)
  v_price_list_id uuid; v_blanket_pct numeric; v_allow_disc_over_pl boolean; v_block_manual boolean := false;
BEGIN
  SELECT COALESCE((settings -> 'order_settings' ->> 'hierarchy_enabled')::boolean, false),
         COALESCE((settings -> 'order_settings' ->> 'enforce_price_floor')::boolean, true),
         COALESCE(NULLIF(settings -> 'order_settings' ->> 'amount_discount_basis', ''), 'entered'),
         COALESCE((settings -> 'order_settings' ->> 'allow_discount_over_price_list')::boolean, false)
  INTO v_hierarchy_enabled, v_enforce_floor, v_amount_disc_basis, v_allow_disc_over_pl FROM accounts WHERE id = p_account_id;

  -- Customer level + assigned (active) price list, in one look-up.
  IF p_contact_id IS NOT NULL THEN
    SELECT c.hierarchy_level, pl.id, pl.blanket_discount_percent
    INTO v_customer_level, v_price_list_id, v_blanket_pct
    FROM contacts c
    LEFT JOIN price_lists pl ON pl.id = c.price_list_id AND pl.active AND pl.account_id = p_account_id
    WHERE c.id = p_contact_id;
  END IF;

  -- A customer on a price list gets no manual discount unless the account opted in.
  v_block_manual := (v_price_list_id IS NOT NULL) AND NOT COALESCE(v_allow_disc_over_pl, false);

  IF NOT v_hierarchy_enabled THEN v_classification := 'direct';
  ELSIF v_customer_level IS NULL THEN v_classification := 'direct';
  ELSIF v_customer_level <= 1 THEN v_classification := 'primary';
  ELSE v_classification := 'secondary'; END IF;

  IF p_order_discount IS NOT NULL AND NOT v_block_manual THEN
    v_od_type := NULLIF(p_order_discount ->> 'type', ''); v_od_value := COALESCE((p_order_discount ->> 'value')::numeric, 0);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _pricing_scratch (
    position int, product_id uuid, product_name text, unit text, entered_unit_id uuid,
    conversion_factor numeric, quantity numeric, base_quantity numeric, catalogue_price numeric,
    price_list_price numeric, scheme_discount_amount numeric, scheme_id uuid, is_scheme_goods boolean,
    discount_type text, discount_value numeric, discount_amount numeric, gross numeric, after_item numeric,
    tax_rate numeric, min_price numeric, tax_mode text) ON COMMIT DROP;
  DELETE FROM _pricing_scratch WHERE true;

  INSERT INTO _pricing_scratch
  -- unit = the ENTERED unit name (BOX) when a unit was picked, else the base unit.
  SELECT t.ord::int, p.id, COALESCE(p.name, 'Unknown product'), COALESCE(eu.name, p.unit), q.entered_unit_id,
    q.conversion_factor, q.quantity, ROUND(q.quantity * q.conversion_factor, 6), COALESCE(p.price, 0),
    -- price_list_price: locked (edit) wins; else catalogue less the resolved
    -- price-list discount (per-product override > blanket > 0). No list => 0%.
    COALESCE(q.locked_price, ROUND(COALESCE(p.price, 0) * (1 - COALESCE(pli.discount_percent, v_blanket_pct, 0) / 100.0), 2), 0),
    q.scheme_discount_amount, q.scheme_id, q.is_scheme_goods,
    -- Manual salesman discount is dropped when a price list blocks it.
    CASE WHEN v_block_manual THEN NULL ELSE q.discount_type END,
    CASE WHEN v_block_manual THEN 0 ELSE q.discount_value END,
    0::numeric, 0::numeric, 0::numeric, COALESCE(ts.rate, 0), p.min_price,
    COALESCE(q.tax_mode, 'exclusive')
  FROM (SELECT t2.ord, (l ->> 'product_id')::uuid AS product_id,
      GREATEST(COALESCE((l ->> 'quantity')::numeric, 0), 0) AS quantity,
      GREATEST(COALESCE((l ->> 'conversion_factor')::numeric, 1), 0.000001) AS conversion_factor,
      (l ->> 'entered_unit_id')::uuid AS entered_unit_id,
      NULLIF(l ->> 'discount_type', '') AS discount_type,
      GREATEST(COALESCE((l ->> 'discount_value')::numeric, 0), 0) AS discount_value,
      (l ->> 'locked_price')::numeric AS locked_price, NULLIF(l ->> 'tax_mode', '') AS tax_mode,
      (l ->> 'scheme_id')::uuid AS scheme_id, COALESCE((l ->> 'is_scheme_goods')::boolean, false) AS is_scheme_goods,
      GREATEST(COALESCE((l ->> 'scheme_discount_amount')::numeric, 0), 0) AS scheme_discount_amount
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t2(l, ord)) q
  LEFT JOIN products p ON p.id = q.product_id AND p.account_id = p_account_id
  LEFT JOIN product_units eu ON eu.id = q.entered_unit_id AND eu.account_id = p_account_id
  LEFT JOIN tax_slabs ts ON ts.id = p.tax_slab_id
  LEFT JOIN price_list_items pli ON pli.price_list_id = v_price_list_id AND pli.product_id = q.product_id
  CROSS JOIN LATERAL (SELECT q.ord AS ord) t;

  UPDATE _pricing_scratch SET gross = 0, after_item = 0, scheme_discount_amount = 0 WHERE is_scheme_goods;
  -- gross works in BASE units: price_list_price is the base-unit price, base_quantity = qty * factor.
  UPDATE _pricing_scratch SET gross = ROUND(price_list_price * base_quantity, 2) WHERE NOT is_scheme_goods;
  UPDATE _pricing_scratch SET scheme_discount_amount = LEAST(ROUND(scheme_discount_amount, 2), gross) WHERE NOT is_scheme_goods;
  -- Amount discount basis is admin-configurable (order_settings.amount_discount_basis):
  -- 'entered' (default, = pre-multi-unit behaviour) multiplies by entered quantity;
  -- 'base' multiplies by base_quantity. Percentage is unaffected (works off gross).
  UPDATE _pricing_scratch SET discount_amount = LEAST(
    CASE WHEN discount_type = 'percent' THEN ROUND(gross * discount_value / 100.0, 2)
         WHEN discount_type = 'amount' THEN ROUND(discount_value * (CASE WHEN v_amount_disc_basis = 'base' THEN base_quantity ELSE quantity END), 2)
         ELSE 0 END,
    gross - scheme_discount_amount) WHERE NOT is_scheme_goods;
  UPDATE _pricing_scratch SET after_item = gross - scheme_discount_amount - discount_amount WHERE NOT is_scheme_goods;

  SELECT COALESCE(SUM(after_item), 0) INTO v_base_sum FROM _pricing_scratch;
  SELECT COALESCE(SUM(scheme_discount_amount), 0) INTO v_scheme_line_total FROM _pricing_scratch;

  v_order_discount := CASE WHEN v_od_type = 'percent' THEN ROUND(v_base_sum * v_od_value / 100.0, 2)
    WHEN v_od_type = 'amount' THEN LEAST(ROUND(v_od_value, 2), v_base_sum) ELSE 0 END;

  CREATE TEMP TABLE _order_scheme_alloc (scheme_id uuid, positions int[], amount numeric, denom numeric) ON COMMIT DROP;
  DELETE FROM _order_scheme_alloc WHERE true;
  INSERT INTO _order_scheme_alloc
  SELECT (os ->> 'scheme_id')::uuid, ARRAY(SELECT jsonb_array_elements_text(os -> 'positions')::int), 0::numeric, 0::numeric
  FROM jsonb_array_elements(COALESCE(p_order_schemes, '[]'::jsonb)) AS os;
  UPDATE _order_scheme_alloc a SET denom = COALESCE((SELECT SUM(sc.after_item) FROM _pricing_scratch sc WHERE sc.position = ANY(a.positions)), 0) WHERE true;
  UPDATE _order_scheme_alloc a SET amount = LEAST(GREATEST(COALESCE((
    SELECT GREATEST(COALESCE((os ->> 'discount_amount')::numeric, 0), 0) FROM jsonb_array_elements(COALESCE(p_order_schemes, '[]'::jsonb)) AS os
    WHERE (os ->> 'scheme_id')::uuid = a.scheme_id LIMIT 1), 0), 0), GREATEST(a.denom, 0)) WHERE true;
  SELECT COALESCE(SUM(amount), 0) INTO v_order_scheme_total FROM _order_scheme_alloc;

  SELECT jsonb_agg(line ORDER BY position), jsonb_agg(violation) FILTER (WHERE violation IS NOT NULL)
  INTO v_lines, v_violations
  FROM (SELECT s.position, jsonb_build_object(
      'position', s.position, 'product_id', s.product_id, 'product_name', s.product_name, 'unit', s.unit,
      'entered_unit_id', s.entered_unit_id, 'conversion_factor', s.conversion_factor, 'base_quantity', s.base_quantity,
      'base_unit_price', s.price_list_price,
      'quantity', s.quantity, 'tax_mode', s.tax_mode, 'catalogue_price', s.catalogue_price, 'price_list_price', s.price_list_price,
      'rate_incl_unit', CASE WHEN s.tax_mode = 'inclusive' THEN s.catalogue_price ELSE ROUND(s.catalogue_price * (1 + s.tax_rate / 100.0), 2) END,
      'scheme_discount_amount', s.scheme_discount_amount, 'discount_type', s.discount_type, 'discount_value', s.discount_value,
      'discount_amount', s.discount_amount, 'order_discount_share', alloc.share, 'sub_total', calc.net, 'tax_rate', s.tax_rate,
      'tax_amount', calc.tax, 'total', calc.net + calc.tax, 'is_scheme_goods', s.is_scheme_goods, 'scheme_id', s.scheme_id,
      'min_price', s.min_price, 'effective_unit_price', alloc.effective_unit,
      'floor_breached', (NOT s.is_scheme_goods AND s.min_price IS NOT NULL AND alloc.effective_unit < s.min_price)) AS line,
    CASE WHEN NOT s.is_scheme_goods AND s.min_price IS NOT NULL AND alloc.effective_unit < s.min_price
      THEN jsonb_build_object('product_id', s.product_id, 'product_name', s.product_name, 'min_price', s.min_price, 'attempted_price', alloc.effective_unit)
      ELSE NULL END AS violation
    FROM _pricing_scratch s
    CROSS JOIN LATERAL (SELECT share_calc.share, s.after_item - share_calc.share AS native_after,
        -- effective unit price is PER BASE UNIT (÷ base_quantity), so it stays comparable to
        -- products.min_price, which is a base-unit floor. Factor 1 => identical to v3 (÷ quantity).
        CASE WHEN s.base_quantity > 0 THEN ROUND((s.after_item - share_calc.share) / s.base_quantity, 4) ELSE 0 END AS effective_unit
      FROM (SELECT LEAST(CASE WHEN v_base_sum > 0 THEN ROUND(v_order_discount * s.after_item / v_base_sum, 2) ELSE 0 END
        + COALESCE((SELECT SUM(CASE WHEN a.denom > 0 THEN ROUND(a.amount * s.after_item / a.denom, 2) ELSE 0 END)
            FROM _order_scheme_alloc a WHERE s.position = ANY(a.positions)), 0), s.after_item) AS share) share_calc) alloc
    CROSS JOIN LATERAL (SELECT
        CASE WHEN s.tax_mode = 'inclusive' THEN ROUND(alloc.native_after / (1 + s.tax_rate / 100.0), 2) ELSE alloc.native_after END AS net,
        CASE WHEN s.tax_mode = 'inclusive' THEN alloc.native_after - ROUND(alloc.native_after / (1 + s.tax_rate / 100.0), 2)
             ELSE ROUND(alloc.native_after * s.tax_rate / 100.0, 2) END AS tax) calc) built;

  SELECT COALESCE(SUM((l ->> 'sub_total')::numeric), 0), COALESCE(SUM((l ->> 'tax_amount')::numeric), 0), COALESCE(SUM((l ->> 'total')::numeric), 0)
  INTO v_sub_total, v_tax_total, v_total FROM jsonb_array_elements(COALESCE(v_lines, '[]'::jsonb)) AS l;

  SELECT COALESCE(SUM(discount_amount), 0) INTO v_discount_total FROM _pricing_scratch;
  v_discount_total := v_discount_total + v_scheme_line_total + v_order_discount + v_order_scheme_total;

  v_result := jsonb_build_object('lines', COALESCE(v_lines, '[]'::jsonb), 'sub_total', v_sub_total,
    'discount_total', v_discount_total, 'order_discount', v_order_discount + v_order_scheme_total,
    'tax_total', v_tax_total, 'total_amount', v_total, 'classification', v_classification,
    'floor_violations', COALESCE(v_violations, '[]'::jsonb), 'enforce_floor', v_enforce_floor,
    'valid', NOT (v_enforce_floor AND v_violations IS NOT NULL), 'calculated_at', p_as_of, 'engine_version', 5);

  DROP TABLE IF EXISTS _pricing_scratch; DROP TABLE IF EXISTS _order_scheme_alloc;
  RETURN v_result;
END;
$function$;
