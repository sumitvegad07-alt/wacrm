-- ============================================================
-- 078_create_order.sql
-- Writes an order header + its line items in ONE transaction, priced
-- through the single source of truth (calculate_order_pricing). This is
-- why a plain enqueueMutation (single-table) can't create an order.
--
-- SECURITY INVOKER: runs as the calling rep, so RLS's
-- orders_insert (is_account_member AND user_id = auth.uid()) holds
-- naturally and a rep can only ever create their own orders.
--
-- IDEMPOTENT: takes a client-generated order id. A retried offline queue
-- item can never create a duplicate. We check existence EXPLICITLY before
-- inserting (not ON CONFLICT) so the BEFORE INSERT set_order_number
-- trigger doesn't fire on a retry and burn an order number.
--
-- MONEY AUTHORITY (p_source):
--   'online'        -> store the server's fresh compute (authoritative).
--                      If the client's breakdown disagrees on identical
--                      data, that's a TS-mirror bug -> log to
--                      pricing_drift_log. Money unaffected.
--   'offline_sync'  -> the rep quoted against a possibly-stale snapshot.
--                      The QUOTED price WINS: store the client breakdown.
--                      If it differs from the server recompute, flag
--                      pricing_status='review' with an explanation.
--                      Never overwrite quoted money; the admin decides.
--
-- DETACH, NEVER LOSE: if the customer or a product was deleted between an
-- offline quote and sync, inserting their id would FK-violate. Instead we
-- null the dangling reference (snapshot fields preserved) and flag review,
-- so the order is kept and an admin can re-attach it. Losing a rep's order
-- is far worse than an order needing a fix.
-- ============================================================

CREATE OR REPLACE FUNCTION create_order(
  p_order_id         uuid,
  p_account_id       uuid,
  p_contact_id       uuid,
  p_site_visit_id    uuid,
  p_date             date,
  p_lines            jsonb,
  p_order_discount   jsonb DEFAULT NULL,
  p_client_breakdown jsonb DEFAULT NULL,
  p_source           text  DEFAULT 'online',   -- 'online' | 'offline_sync'
  p_notes            text  DEFAULT NULL,
  p_platform         text  DEFAULT NULL,        -- 'web' | 'mobile', for the drift log
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
  -- 1. Idempotency: if this id already exists, return it untouched. Done
  --    BEFORE any insert so a retry doesn't fire set_order_number.
  SELECT order_number INTO v_existing_number FROM orders WHERE id = p_order_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id, 'order_number', v_existing_number,
      'idempotent_replay', true);
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('online', 'offline_sync') THEN
    p_source := 'online';
  END IF;

  -- 2. Single pricing authority.
  v_calc := calculate_order_pricing(p_account_id, p_contact_id, p_lines, p_order_discount, now());
  v_classification := v_calc ->> 'classification';
  v_expected_total := (v_calc ->> 'total_amount')::numeric;

  -- 3. Which breakdown becomes the stored money.
  IF p_source = 'offline_sync' AND p_client_breakdown IS NOT NULL THEN
    v_store := p_client_breakdown;
  ELSE
    v_store := v_calc;
  END IF;

  -- 4. Detach dangling references (never lose the order).
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

  -- 5. pricing_status + variance.
  IF p_source = 'offline_sync' THEN
    v_client_total := (p_client_breakdown ->> 'total_amount')::numeric;
    IF v_client_total IS NOT NULL AND abs(v_client_total - v_expected_total) > 0.01 THEN
      v_status := 'review';
      v_variance := v_variance || jsonb_build_object(
        'kind', 'price_changed',
        'quoted_total', v_client_total, 'expected_total', v_expected_total,
        'note', 'Catalogue price or tax changed after this order was quoted offline. Quoted price kept; review before dispatch.');
    END IF;
    -- Offline order that now breaches the floor (floor lowered after quote): review, do not reject.
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

  -- 6. Header. order_number left NULL so the trigger fills it.
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

  -- 7. Line items from the stored breakdown. LEFT JOIN nulls product_id for
  --    any product that no longer exists, preserving the snapshot fields.
  INSERT INTO order_items (
    order_id, product_id, product_name, unit, quantity, price,
    tax_rate, tax_amount, sub_total, total, position,
    catalogue_price, price_list_price, scheme_discount_amount,
    discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods
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
    COALESCE((ln ->> 'is_scheme_goods')::boolean, false)
  FROM jsonb_array_elements(v_store -> 'lines') AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = p_account_id;

  -- 8. Drift log: ONLINE only, identical inputs, so any client/server
  --    disagreement is a real TS-mirror bug, not staleness.
  IF p_source = 'online' AND p_client_breakdown IS NOT NULL THEN
    v_client_total := (p_client_breakdown ->> 'total_amount')::numeric;
    IF v_client_total IS NOT NULL AND abs(v_client_total - v_expected_total) > 0.01 THEN
      INSERT INTO pricing_drift_log (
        account_id, order_id, platform, app_version,
        engine_version, server_engine_version,
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
    'order_id', p_order_id,
    'order_number', v_order_number,
    'pricing_status', v_status,
    'classification', v_classification,
    'expected_total', v_expected_total,
    'pricing_variance', CASE WHEN v_variance = '[]'::jsonb THEN NULL ELSE v_variance END,
    'idempotent_replay', false);
END;
$fn$;
