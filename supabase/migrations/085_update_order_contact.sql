-- ============================================================
-- 085_update_order_contact.sql
-- Close the customer-change gap in order editing.
--
-- BEFORE: the edit UIs changed/re-attached an order's customer with a DIRECT
-- update to orders.contact_id, then called update_order. That direct write
-- bypassed update_order's dispatched-lock check (RLS orders_update is only
-- is_account_member(account_id) — no locked_at check, no trigger), so a locked
-- order's customer could be changed; and nothing validated the new contact
-- belonged to the order's account.
--
-- AFTER: update_order takes an optional p_contact_id. When provided it goes
-- through the SAME lock check as every other edit, is validated to belong to
-- the order's account, and is applied inside the one transaction before pricing
-- recomputes classification. One audited path instead of a direct write + RPC.
--
-- p_contact_id semantics: NULL (or omitted) = leave the customer unchanged;
-- non-null = set the customer to this id (after validation). The edit UIs always
-- pass the currently-selected customer, so a re-attach and a no-op both flow
-- through the validated path.
--
-- Only the signature + two added blocks differ from migration 083; everything
-- else is identical. CREATE OR REPLACE so the deployed definition is self-contained.
--
-- NOTE: adding p_contact_id changes the function's argument list, so Postgres
-- would keep the old 4-arg update_order as a separate overload. Two overloads
-- make PostgREST ambiguous when 4 args are passed, so we DROP the old one first.
-- Safe: order editing had not shipped, so nothing in production called it.
-- ============================================================

DROP FUNCTION IF EXISTS update_order(uuid, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION update_order(
  p_order_id       uuid,
  p_lines          jsonb,
  p_order_discount jsonb DEFAULT NULL,
  p_notes          text  DEFAULT NULL,
  p_contact_id     uuid  DEFAULT NULL   -- NULL = leave customer unchanged; else set (validated)
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

  -- Customer change/re-attach — same transaction, after the lock check, with a
  -- multi-tenant validation the direct write never had.
  IF p_contact_id IS NOT NULL AND p_contact_id IS DISTINCT FROM v_contact_id THEN
    IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id AND account_id = v_account_id) THEN
      RAISE EXCEPTION 'That customer does not belong to this account.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_contact_id := p_contact_id;
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
$fn$;
