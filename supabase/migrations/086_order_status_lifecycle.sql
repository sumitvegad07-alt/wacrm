-- ============================================================
-- 086_order_status_lifecycle.sql
-- A real order status lifecycle (was: free-text status + a dropdown of the
-- account's order_statuses, changed by a raw client UPDATE with NO permission
-- and NO transition rules).
--
-- State machine (fixed, canonical — replaces the account-configurable
-- order_statuses model for orders):
--   Pending   -> Approved | Rejected | Cancelled
--   Approved  -> Dispatched (auto, on dispatch) | Rejected | Cancelled
--   Dispatched | Rejected | Cancelled = terminal
--
-- Decisions (founder, 26 Jul 2026):
--  * Use 'Pending' as the initial state and MIGRATE existing data
--    ('Placed' -> 'Pending'; the one live 'Dispatched' order already fits).
--  * Enforce the TRANSITION server-side (RPC + trigger backstop). The
--    manage_order_status PERMISSION stays UI-gated (consistent with
--    add_orders/edit_orders); no SQL permission primitive is introduced.
--
-- module_activities action naming: standardize order events on lowercase
-- snake_case ('order_status_changed', 'order_created', 'order_edited') — the
-- existing web order rows already use lowercase, so this is the least-churn
-- convention. Mobile will log the same lowercase actions.
-- ============================================================

-- 1. Migrate existing data FIRST (before the transition trigger exists, so the
--    'Placed' -> 'Pending' move isn't itself blocked as an illegal transition).
UPDATE orders SET status = 'Pending' WHERE status = 'Placed';

-- 2. create_order: new orders start 'Pending' (was 'Placed'). Verbatim copy of
--    the live definition with ONLY that one literal changed.
CREATE OR REPLACE FUNCTION create_order(
  p_order_id uuid, p_account_id uuid, p_contact_id uuid, p_site_visit_id uuid, p_date date,
  p_lines jsonb, p_order_discount jsonb DEFAULT NULL, p_client_breakdown jsonb DEFAULT NULL,
  p_source text DEFAULT 'online', p_notes text DEFAULT NULL, p_platform text DEFAULT NULL, p_app_version text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql AS $function$
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

  v_calc := calculate_order_pricing(p_account_id, p_contact_id, p_lines, p_order_discount, now());
  v_classification := v_calc ->> 'classification';
  v_expected_total := (v_calc ->> 'total_amount')::numeric;

  IF p_source = 'offline_sync' AND p_client_breakdown IS NOT NULL THEN v_store := p_client_breakdown; ELSE v_store := v_calc; END IF;

  IF p_contact_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id AND account_id = p_account_id) THEN
    v_contact_missing := true; v_contact_final := NULL;
  ELSE
    v_contact_final := p_contact_id;
  END IF;

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
    catalogue_price, price_list_price, scheme_discount_amount, discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode
  )
  SELECT p_order_id, p.id, COALESCE(ln ->> 'product_name', 'Unknown product'), ln ->> 'unit',
    COALESCE((ln ->> 'quantity')::numeric, 0), COALESCE((ln ->> 'price_list_price')::numeric, 0),
    COALESCE((ln ->> 'tax_rate')::numeric, 0), COALESCE((ln ->> 'tax_amount')::numeric, 0),
    COALESCE((ln ->> 'sub_total')::numeric, 0), COALESCE((ln ->> 'total')::numeric, 0), COALESCE((ln ->> 'position')::int, 0),
    (ln ->> 'catalogue_price')::numeric, (ln ->> 'price_list_price')::numeric, COALESCE((ln ->> 'scheme_discount_amount')::numeric, 0),
    NULLIF(ln ->> 'discount_type', ''), COALESCE((ln ->> 'discount_value')::numeric, 0), COALESCE((ln ->> 'discount_amount')::numeric, 0),
    COALESCE((ln ->> 'order_discount_share')::numeric, 0), COALESCE((ln ->> 'is_scheme_goods')::boolean, false), COALESCE(ln ->> 'tax_mode', 'exclusive')
  FROM jsonb_array_elements(v_store -> 'lines') AS ln
  LEFT JOIN products p ON p.id = (ln ->> 'product_id')::uuid AND p.account_id = p_account_id;

  IF p_source = 'online' AND p_client_breakdown IS NOT NULL THEN
    v_client_total := (p_client_breakdown ->> 'total_amount')::numeric;
    IF v_client_total IS NOT NULL AND abs(v_client_total - v_expected_total) > 0.01 THEN
      INSERT INTO pricing_drift_log (account_id, order_id, platform, app_version, engine_version, server_engine_version,
        client_total, server_total, inputs, client_breakdown, server_breakdown)
      VALUES (p_account_id, p_order_id, p_platform, p_app_version,
        (p_client_breakdown ->> 'engine_version')::int, (v_calc ->> 'engine_version')::int, v_client_total, v_expected_total,
        jsonb_build_object('lines', p_lines, 'order_discount', p_order_discount, 'contact_id', p_contact_id), p_client_breakdown, v_calc);
    END IF;
  END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_order_number, 'pricing_status', v_status,
    'classification', v_classification, 'expected_total', v_expected_total,
    'pricing_variance', CASE WHEN v_variance = '[]'::jsonb THEN NULL ELSE v_variance END, 'idempotent_replay', false);
END;
$function$;

-- 2b. Server-side flat-permission check (the SQL mirror of the client
--     hasPermission): owner/admin OR superadmin OR the exact key OR the
--     "<action>_*" wildcard in employee_roles.permissions. SECURITY DEFINER so
--     it can read profiles/employee_roles regardless of the caller's RLS;
--     auth.uid() still resolves to the CALLER. Reusable for any flat key.
CREATE OR REPLACE FUNCTION has_permission(p_user_id uuid, p_account_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    LEFT JOIN employee_roles er ON er.id = p.employee_role_id
    WHERE p.user_id = p_user_id
      AND p.account_id = p_account_id
      AND (
        p.account_role IN ('owner', 'admin')
        OR p.is_superadmin = true
        OR (er.permissions ->> p_key) = 'true'
        OR (er.permissions ->> (split_part(p_key, '_', 1) || '_*')) = 'true'
      )
  );
$$;

-- 3. The single source of truth for legal transitions.
CREATE OR REPLACE FUNCTION order_status_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('Pending','Approved'), ('Pending','Rejected'), ('Pending','Cancelled'),
    ('Approved','Dispatched'), ('Approved','Rejected'), ('Approved','Cancelled')
  );
$$;

-- 4. RPC: the ONLY sanctioned way the app changes status. Checks permission,
--    validates the transition, writes it, and logs. SECURITY INVOKER so tenancy
--    holds via the orders RLS UPDATE policy and auth.uid() is the caller.
CREATE OR REPLACE FUNCTION update_order_status(p_order_id uuid, p_new_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_account_id uuid; v_current text;
BEGIN
  SELECT account_id, status INTO v_account_id, v_current FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found or not accessible'; END IF;
  IF NOT has_permission(auth.uid(), v_account_id, 'manage_order_status') THEN
    RAISE EXCEPTION 'You do not have permission to change order status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_current = p_new_status THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', v_current, 'unchanged', true);
  END IF;
  IF NOT order_status_transition_allowed(v_current, p_new_status) THEN
    RAISE EXCEPTION 'Illegal order status transition: % -> %', v_current, p_new_status USING ERRCODE = 'check_violation';
  END IF;
  UPDATE orders SET status = p_new_status WHERE id = p_order_id;
  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message)
  VALUES (v_account_id, auth.uid(), 'order', p_order_id, 'order_status_changed', 'Order status changed to ' || p_new_status);
  RETURN jsonb_build_object('order_id', p_order_id, 'status', p_new_status);
END;
$$;

-- 5. Defense-in-depth backstop: reject ANY status change (RPC or raw client)
--    that (a) isn't a legal transition, or (b) is made by someone lacking
--    manage_order_status. Closes the raw-client-bypass the RPC alone can't
--    (same reasoning as the 085 contact_id fix) — now for BOTH the transition
--    and who may make it.
--    Exemption: the dispatch auto-advance (Approved->Dispatched, set by
--    lock_order_on_dispatch) is a SYSTEM transition flagged via
--    app.order_status_system, so dispatch stays governed by dispatch access, not
--    manage_order_status. The transition itself is still validated.
CREATE OR REPLACE FUNCTION enforce_order_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT order_status_transition_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'Illegal order status transition: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(current_setting('app.order_status_system', true), '') <> '1'
       AND NOT has_permission(auth.uid(), NEW.account_id, 'manage_order_status') THEN
      RAISE EXCEPTION 'You do not have permission to change order status' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_order_status_transition ON orders;
CREATE TRIGGER trg_enforce_order_status_transition
  BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION enforce_order_status_transition();

-- 6. Auto-advance to Dispatched atomically on dispatch (extends the existing
--    lock-on-dispatch trigger). Sets the app.order_status_system flag so the
--    backstop exempts this SYSTEM transition from the manage_order_status check
--    (dispatch keeps its own access), while still validating Approved->Dispatched
--    — so dispatching a non-Approved order still fails.
CREATE OR REPLACE FUNCTION lock_order_on_dispatch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.order_status_system', '1', true);
  UPDATE orders SET locked_at = now(), status = 'Dispatched'
  WHERE id = NEW.order_id AND locked_at IS NULL;
  PERFORM set_config('app.order_status_system', '', true);
  RETURN NEW;
END;
$$;
