-- ============================================================
-- 20260820140000_order_rpcs_scheme_forwarding.sql   (Pricing Phase 4)
--
-- Teach create_order / update_order to carry CONFIRMED schemes end-to-end:
--   • new trailing param p_order_schemes jsonb DEFAULT NULL — the value-slab
--     (whole-order) schemes the salesman accepted — forwarded as the 6th arg to
--     calculate_order_pricing (engine_version 3).
--   • persist scheme_id on each order line (order_items.scheme_id already exists,
--     migration 075). Line-level scheme discounts (scheme_discount_amount) and
--     free-goods flags (is_scheme_goods) were already stored; scheme_id was the
--     one missing attribution column.
--
-- Both functions gain ONE optional parameter. Because a new parameter changes
-- the signature, the old signature is DROPped first so the new one is the sole
-- overload; every existing call (which omits p_order_schemes) resolves to it and
-- behaves byte-identically to before — p_order_schemes defaults to NULL, which
-- calculate_order_pricing treats as "no value-slab schemes".
--
-- Everything else in both bodies is preserved verbatim from the live definitions
-- (idempotency, drift log, offline review flags, dispatch-lock check, contact
-- re-attach validation).
-- ============================================================

DROP FUNCTION IF EXISTS create_order(uuid, uuid, uuid, uuid, date, jsonb, jsonb, jsonb, text, text, text, text);

CREATE OR REPLACE FUNCTION create_order(
  p_order_id uuid, p_account_id uuid, p_contact_id uuid, p_site_visit_id uuid, p_date date,
  p_lines jsonb, p_order_discount jsonb DEFAULT NULL, p_client_breakdown jsonb DEFAULT NULL,
  p_source text DEFAULT 'online', p_notes text DEFAULT NULL, p_platform text DEFAULT NULL,
  p_app_version text DEFAULT NULL, p_order_schemes jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
  v_existing_number text; v_calc jsonb; v_store jsonb; v_expected_total numeric; v_client_total numeric;
  v_status text := 'confirmed'; v_variance jsonb := '[]'::jsonb; v_contact_final uuid;
  v_contact_missing boolean := false; v_any_prod_missing boolean := false; v_classification text; v_order_number text;
BEGIN
  SELECT order_number INTO v_existing_number FROM orders WHERE id = p_order_id;
  IF FOUND THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_existing_number, 'idempotent_replay', true);
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('online', 'offline_sync') THEN p_source := 'online'; END IF;
  v_calc := calculate_order_pricing(p_account_id, p_contact_id, p_lines, p_order_discount, now(), p_order_schemes);
  v_classification := v_calc ->> 'classification';
  v_expected_total := (v_calc ->> 'total_amount')::numeric;
  IF p_source = 'offline_sync' AND p_client_breakdown IS NOT NULL THEN v_store := p_client_breakdown; ELSE v_store := v_calc; END IF;
  IF p_contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id AND account_id = p_account_id) THEN
    v_contact_missing := true; v_contact_final := NULL;
  ELSE v_contact_final := p_contact_id; END IF;
  SELECT bool_or((ln ->> 'product_id') IS NOT NULL AND p.id IS NULL) INTO v_any_prod_missing
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = p_account_id;
  IF p_source = 'offline_sync' THEN
    v_client_total := (p_client_breakdown ->> 'total_amount')::numeric;
    IF v_client_total IS NOT NULL AND abs(v_client_total - v_expected_total) > 0.01 THEN
      v_status := 'review';
      v_variance := v_variance || jsonb_build_object('kind', 'price_changed', 'quoted_total', v_client_total, 'expected_total', v_expected_total,
        'note', 'Catalogue price or tax changed after this order was quoted offline. Quoted price kept; review before dispatch.');
    END IF;
    IF (v_calc ->> 'valid')::boolean = false THEN
      v_status := 'review';
      v_variance := v_variance || jsonb_build_object('kind', 'floor_breach', 'note', 'Current price floor is breached by the quoted price.',
        'floor_violations', v_calc -> 'floor_violations');
    END IF;
  END IF;
  IF v_contact_missing THEN
    v_status := 'review';
    v_variance := v_variance || jsonb_build_object('kind', 'contact_detached', 'note', 'The customer this order was quoted for no longer exists. Re-attach the correct customer.');
  END IF;
  IF COALESCE(v_any_prod_missing, false) THEN
    v_status := 'review';
    v_variance := v_variance || jsonb_build_object('kind', 'product_detached', 'note', 'One or more products on this order no longer exist. Line snapshots are preserved; re-attach the product.');
  END IF;
  INSERT INTO orders (
    id, account_id, user_id, contact_id, site_visit_id, date,
    sub_total, tax_total, total_amount, discount_total, order_discount_type, order_discount_value,
    status, classification, notes, pricing_status, expected_total, pricing_variance
  ) VALUES (
    p_order_id, p_account_id, auth.uid(), v_contact_final, p_site_visit_id, COALESCE(p_date, CURRENT_DATE),
    COALESCE((v_store ->> 'sub_total')::numeric, 0), COALESCE((v_store ->> 'tax_total')::numeric, 0),
    COALESCE((v_store ->> 'total_amount')::numeric, 0), COALESCE((v_store ->> 'discount_total')::numeric, 0),
    NULLIF(p_order_discount ->> 'type', ''), COALESCE((p_order_discount ->> 'value')::numeric, 0),
    'Pending', v_classification, p_notes, v_status, v_expected_total,
    CASE WHEN v_variance = '[]'::jsonb THEN NULL ELSE v_variance END
  );
  SELECT order_number INTO v_order_number FROM orders WHERE id = p_order_id;
  INSERT INTO order_items (
    order_id, product_id, product_name, unit, quantity, price, tax_rate, tax_amount, sub_total, total, position,
    catalogue_price, price_list_price, scheme_discount_amount, discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode, scheme_id
  )
  SELECT p_order_id, p.id, COALESCE(ln ->> 'product_name', 'Unknown product'), ln ->> 'unit',
    COALESCE((ln ->> 'quantity')::numeric, 0), COALESCE((ln ->> 'price_list_price')::numeric, 0),
    COALESCE((ln ->> 'tax_rate')::numeric, 0), COALESCE((ln ->> 'tax_amount')::numeric, 0),
    COALESCE((ln ->> 'sub_total')::numeric, 0), COALESCE((ln ->> 'total')::numeric, 0), COALESCE((ln ->> 'position')::int, 0),
    (ln ->> 'catalogue_price')::numeric, (ln ->> 'price_list_price')::numeric, COALESCE((ln ->> 'scheme_discount_amount')::numeric, 0),
    NULLIF(ln ->> 'discount_type', ''), COALESCE((ln ->> 'discount_value')::numeric, 0), COALESCE((ln ->> 'discount_amount')::numeric, 0),
    COALESCE((ln ->> 'order_discount_share')::numeric, 0), COALESCE((ln ->> 'is_scheme_goods')::boolean, false), COALESCE(ln ->> 'tax_mode', 'exclusive'),
    (ln ->> 'scheme_id')::uuid
  FROM jsonb_array_elements(v_store -> 'lines') AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = p_account_id;
  IF p_source = 'online' AND p_client_breakdown IS NOT NULL THEN
    v_client_total := (p_client_breakdown ->> 'total_amount')::numeric;
    IF v_client_total IS NOT NULL AND abs(v_client_total - v_expected_total) > 0.01 THEN
      INSERT INTO pricing_drift_log (account_id, order_id, platform, app_version, engine_version, server_engine_version,
        client_total, server_total, inputs, client_breakdown, server_breakdown)
      VALUES (p_account_id, p_order_id, p_platform, p_app_version,
        (p_client_breakdown ->> 'engine_version')::int, (v_calc ->> 'engine_version')::int, v_client_total, v_expected_total,
        jsonb_build_object('lines', p_lines, 'order_discount', p_order_discount, 'order_schemes', p_order_schemes, 'contact_id', p_contact_id), p_client_breakdown, v_calc);
    END IF;
  END IF;
  RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_order_number, 'pricing_status', v_status,
    'classification', v_classification, 'expected_total', v_expected_total,
    'pricing_variance', CASE WHEN v_variance = '[]'::jsonb THEN NULL ELSE v_variance END, 'idempotent_replay', false);
END;
$function$;


DROP FUNCTION IF EXISTS update_order(uuid, jsonb, jsonb, text, uuid);

CREATE OR REPLACE FUNCTION update_order(
  p_order_id uuid, p_lines jsonb, p_order_discount jsonb DEFAULT NULL, p_notes text DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_order_schemes jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $function$
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

  IF p_contact_id IS NOT NULL AND p_contact_id IS DISTINCT FROM v_contact_id THEN
    IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id AND account_id = v_account_id) THEN
      RAISE EXCEPTION 'That customer does not belong to this account.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_contact_id := p_contact_id;
  END IF;

  v_calc := calculate_order_pricing(v_account_id, v_contact_id, p_lines, p_order_discount, now(), p_order_schemes);

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
    discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode, scheme_id
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
    COALESCE(ln ->> 'tax_mode', 'exclusive'), (ln ->> 'scheme_id')::uuid
  FROM jsonb_array_elements(v_calc -> 'lines') AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = v_account_id;

  UPDATE orders SET
    contact_id = v_contact_id,
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
    'classification', v_calc ->> 'classification', 'total_amount', (v_calc ->> 'total_amount')::numeric,
    'contact_id', v_contact_id);
END;
$function$;
