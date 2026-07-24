-- ============================================================
-- 079_update_order.sql
-- Edits an existing order through the SAME pricing path as create.
--
-- NOT editable after dispatch: once locked_at is set (by the dispatch
-- trigger, migration 080) the order is a record, not a draft — later
-- changes are a return or a new order.
--
-- Existing lines KEEP their agreed price: the UI passes each existing
-- line with its stored unit price as `locked_price`, and
-- calculate_order_pricing already honours that
-- (COALESCE(q.locked_price, p.price, 0)). New lines omit locked_price and
-- price at today's rates. No separate edit-pricing logic.
--
-- SECURITY INVOKER — RLS orders_update (is_account_member) applies.
-- ============================================================

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
  v_account_id     uuid;
  v_contact_id     uuid;
  v_locked_at      timestamptz;
  v_calc           jsonb;
  v_status         text;
  v_variance       jsonb;
BEGIN
  SELECT account_id, contact_id, locked_at
    INTO v_account_id, v_contact_id, v_locked_at
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or not accessible';
  END IF;
  IF v_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This order has been dispatched and can no longer be edited. Create a return or a new order instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Recompute through the single pricing authority. Customer is not changed
  -- on edit, so classification is recomputed from the order's own contact.
  v_calc := calculate_order_pricing(v_account_id, v_contact_id, p_lines, p_order_discount, now());

  -- Interactive online edit. The UI blocks a floor breach before calling
  -- this; if one still arrives (crafted call), record review rather than
  -- reject — uniform with create's "record, don't reject" persistence rule.
  IF (v_calc ->> 'valid')::boolean = false THEN
    v_status := 'review';
    v_variance := jsonb_build_array(jsonb_build_object(
      'kind', 'floor_breach', 'note', 'Price floor is breached.',
      'floor_violations', v_calc -> 'floor_violations'));
  ELSE
    v_status := 'confirmed';
    v_variance := NULL;
  END IF;

  -- Replace line items.
  DELETE FROM order_items WHERE order_id = p_order_id;

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
  FROM jsonb_array_elements(v_calc -> 'lines') AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = v_account_id;

  UPDATE orders SET
    sub_total           = COALESCE((v_calc ->> 'sub_total')::numeric, 0),
    tax_total           = COALESCE((v_calc ->> 'tax_total')::numeric, 0),
    total_amount        = COALESCE((v_calc ->> 'total_amount')::numeric, 0),
    discount_total      = COALESCE((v_calc ->> 'discount_total')::numeric, 0),
    order_discount_type = NULLIF(p_order_discount ->> 'type', ''),
    order_discount_value= COALESCE((p_order_discount ->> 'value')::numeric, 0),
    classification      = v_calc ->> 'classification',
    notes               = COALESCE(p_notes, notes),
    pricing_status      = v_status,
    expected_total      = (v_calc ->> 'total_amount')::numeric,
    pricing_variance    = v_variance
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'pricing_status', v_status,
    'classification', v_calc ->> 'classification',
    'total_amount', (v_calc ->> 'total_amount')::numeric);
END;
$fn$;
