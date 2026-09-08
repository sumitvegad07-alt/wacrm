-- ============================================================================
-- Multi Unit v1  (spec: docs/engineering/specifications/multi-unit-v1.md)
-- ----------------------------------------------------------------------------
-- Product unit conversion. A product's BASE unit is its existing products.unit_id
-- (implicit conversion factor 1). Alternate units + decimal factors live in the
-- new product_unit_conversions table. Order/dispatch lines snapshot the entered
-- unit + factor + base quantity; stock and pricing work in BASE units.
--
-- BACKWARD COMPATIBILITY CONTRACT: every function change below is a NO-OP when
-- conversion_factor = 1 (the default). An account with Multi Unit OFF sends no
-- factor, so factor defaults to 1, base_quantity = quantity, and every number is
-- byte-identical to the pre-migration engine (engine_version 3 behaviour).
--
-- 100% additive. No column dropped, no type narrowed. Rollback:
-- supabase/migrations/ROLLBACK-multi-unit.md
-- ============================================================================

-- ── 1. Feature toggle helper ────────────────────────────────────────────────
-- Mirrors stock_module_enabled(uuid). The switch lives in
-- accounts.settings.extra_settings.multi_unit_enabled (Settings → Extra Settings).
-- Absent key => false => today's behaviour.
CREATE OR REPLACE FUNCTION public.multi_unit_enabled(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((settings -> 'extra_settings' ->> 'multi_unit_enabled')::boolean, false)
  FROM public.accounts WHERE id = p_account_id;
$function$;

-- ── 2. Conversion units (per product) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_unit_conversions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_id           uuid NOT NULL REFERENCES public.product_units(id),
  -- How many BASE units one of this unit equals (BOX -> 12, CARTON -> 144).
  -- numeric(18,6) supports decimal factors (e.g. 0.333333).
  conversion_factor numeric(18,6) NOT NULL CHECK (conversion_factor > 0),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_puc_product ON public.product_unit_conversions(product_id);
CREATE INDEX IF NOT EXISTS idx_puc_account ON public.product_unit_conversions(account_id);

DROP TRIGGER IF EXISTS trg_puc_updated_at ON public.product_unit_conversions;
CREATE TRIGGER trg_puc_updated_at BEFORE UPDATE ON public.product_unit_conversions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_unit_conversions ENABLE ROW LEVEL SECURITY;

-- RLS mirrors product_units exactly (reuses the same catalogue permission keys).
DROP POLICY IF EXISTS puc_select ON public.product_unit_conversions;
CREATE POLICY puc_select ON public.product_unit_conversions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS puc_insert ON public.product_unit_conversions;
CREATE POLICY puc_insert ON public.product_unit_conversions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum)
             AND has_permission(auth.uid(), account_id, 'create_product_units'));

DROP POLICY IF EXISTS puc_update ON public.product_unit_conversions;
CREATE POLICY puc_update ON public.product_unit_conversions FOR UPDATE
  USING (is_account_member(account_id, 'agent'::account_role_enum)
         AND has_permission(auth.uid(), account_id, 'edit_product_units'));

DROP POLICY IF EXISTS puc_delete ON public.product_unit_conversions;
CREATE POLICY puc_delete ON public.product_unit_conversions FOR DELETE
  USING (is_account_member(account_id, 'agent'::account_role_enum)
         AND has_permission(auth.uid(), account_id, 'delete_product_units'));

-- ── 3. Order / dispatch line columns (additive) ─────────────────────────────
-- order_items.quantity KEEPS its meaning = the ENTERED quantity. New columns
-- carry the multi-unit context; base_quantity is nullable and readers fall back
-- to quantity (i.e. factor 1) for all pre-existing rows.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS entered_unit_id   uuid REFERENCES public.product_units(id),
  ADD COLUMN IF NOT EXISTS conversion_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity     numeric(18,6),
  ADD COLUMN IF NOT EXISTS base_unit_price   numeric(15,2);

ALTER TABLE public.dispatch_items
  ADD COLUMN IF NOT EXISTS conversion_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity     numeric(18,6);

-- ── 4. Scheme quantity basis (per scheme) ───────────────────────────────────
-- Admin choice: quantity thresholds measured in base or entered units.
ALTER TABLE public.schemes
  ADD COLUMN IF NOT EXISTS qty_unit_basis text NOT NULL DEFAULT 'base'
    CHECK (qty_unit_basis IN ('base','entered'));

-- ============================================================================
-- 5. calculate_order_pricing  (engine_version 3 -> 4)
-- ----------------------------------------------------------------------------
-- Changes vs v3 (all no-op when conversion_factor = 1):
--   * each line carries conversion_factor (default 1) and base_quantity = qty*factor
--   * gross uses base_quantity (was quantity) — price is per BASE unit
--   * amount discount multiplies by base or entered qty per
--     order_settings.amount_discount_basis (default 'entered' = today)
--   * floor check divides after_item by base_quantity (per-base effective price)
--   * lines echo conversion_factor, base_quantity, base_unit_price, entered_unit_id
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
BEGIN
  SELECT COALESCE((settings -> 'order_settings' ->> 'hierarchy_enabled')::boolean, false),
         COALESCE((settings -> 'order_settings' ->> 'enforce_price_floor')::boolean, true),
         COALESCE(NULLIF(settings -> 'order_settings' ->> 'amount_discount_basis', ''), 'entered')
  INTO v_hierarchy_enabled, v_enforce_floor, v_amount_disc_basis FROM accounts WHERE id = p_account_id;

  IF p_contact_id IS NOT NULL THEN SELECT hierarchy_level INTO v_customer_level FROM contacts WHERE id = p_contact_id; END IF;

  IF NOT v_hierarchy_enabled THEN v_classification := 'direct';
  ELSIF v_customer_level IS NULL THEN v_classification := 'direct';
  ELSIF v_customer_level <= 1 THEN v_classification := 'primary';
  ELSE v_classification := 'secondary'; END IF;

  IF p_order_discount IS NOT NULL THEN
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
    COALESCE(q.locked_price, p.price, 0), q.scheme_discount_amount, q.scheme_id, q.is_scheme_goods,
    q.discount_type, q.discount_value, 0::numeric, 0::numeric, 0::numeric, COALESCE(ts.rate, 0), p.min_price,
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
    'valid', NOT (v_enforce_floor AND v_violations IS NOT NULL), 'calculated_at', p_as_of, 'engine_version', 4);

  DROP TABLE IF EXISTS _pricing_scratch; DROP TABLE IF EXISTS _order_scheme_alloc;
  RETURN v_result;
END;
$function$;

-- ============================================================================
-- 6. create_order  — persist the four new order_items columns
--    (only the INSERT INTO order_items column list + SELECT changed)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order(p_order_id uuid, p_account_id uuid, p_contact_id uuid, p_site_visit_id uuid, p_date date, p_lines jsonb, p_order_discount jsonb DEFAULT NULL::jsonb, p_client_breakdown jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'online'::text, p_notes text DEFAULT NULL::text, p_platform text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_order_schemes jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
    catalogue_price, price_list_price, scheme_discount_amount, discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode, scheme_id,
    entered_unit_id, conversion_factor, base_quantity, base_unit_price
  )
  SELECT p_order_id, p.id, COALESCE(ln ->> 'product_name', 'Unknown product'), ln ->> 'unit',
    COALESCE((ln ->> 'quantity')::numeric, 0), COALESCE((ln ->> 'price_list_price')::numeric, 0),
    COALESCE((ln ->> 'tax_rate')::numeric, 0), COALESCE((ln ->> 'tax_amount')::numeric, 0),
    COALESCE((ln ->> 'sub_total')::numeric, 0), COALESCE((ln ->> 'total')::numeric, 0), COALESCE((ln ->> 'position')::int, 0),
    (ln ->> 'catalogue_price')::numeric, (ln ->> 'price_list_price')::numeric, COALESCE((ln ->> 'scheme_discount_amount')::numeric, 0),
    NULLIF(ln ->> 'discount_type', ''), COALESCE((ln ->> 'discount_value')::numeric, 0), COALESCE((ln ->> 'discount_amount')::numeric, 0),
    COALESCE((ln ->> 'order_discount_share')::numeric, 0), COALESCE((ln ->> 'is_scheme_goods')::boolean, false), COALESCE(ln ->> 'tax_mode', 'exclusive'),
    (ln ->> 'scheme_id')::uuid,
    (ln ->> 'entered_unit_id')::uuid,
    COALESCE((ln ->> 'conversion_factor')::numeric, 1),
    COALESCE((ln ->> 'base_quantity')::numeric, (ln ->> 'quantity')::numeric),
    COALESCE((ln ->> 'base_unit_price')::numeric, (ln ->> 'price_list_price')::numeric)
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

-- ============================================================================
-- 7. update_order — persist the four new order_items columns
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_order(p_order_id uuid, p_lines jsonb, p_order_discount jsonb DEFAULT NULL::jsonb, p_notes text DEFAULT NULL::text, p_contact_id uuid DEFAULT NULL::uuid, p_order_schemes jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
    discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode, scheme_id,
    entered_unit_id, conversion_factor, base_quantity, base_unit_price
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
    COALESCE(ln ->> 'tax_mode', 'exclusive'), (ln ->> 'scheme_id')::uuid,
    (ln ->> 'entered_unit_id')::uuid,
    COALESCE((ln ->> 'conversion_factor')::numeric, 1),
    COALESCE((ln ->> 'base_quantity')::numeric, (ln ->> 'quantity')::numeric),
    COALESCE((ln ->> 'base_unit_price')::numeric, (ln ->> 'price_list_price')::numeric)
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

-- ============================================================================
-- 8. Stock reconciliation — deduct BASE quantity, not entered quantity
--    SUM(quantity) -> SUM(COALESCE(base_quantity, quantity)). Legacy rows have
--    base_quantity NULL => fall back to quantity => identical to today.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.stock_reconcile_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account uuid; v_status text; v_ref text; v_event text;
  v_consumes boolean; r RECORD; v_delta numeric; v_reason text;
BEGIN
  SELECT account_id, status, order_number INTO v_account, v_status, v_ref
  FROM public.orders WHERE id = p_order_id;
  IF v_account IS NULL THEN RETURN; END IF;
  IF NOT public.stock_module_enabled(v_account) THEN RETURN; END IF;
  v_event := public.stock_out_event(v_account);
  IF v_event NOT IN ('order_created','order_closed') THEN RETURN; END IF;
  IF v_event = 'order_created' THEN
    v_consumes := v_status NOT IN ('Cancelled','Rejected');
  ELSE
    v_consumes := v_status = 'Closed';
  END IF;
  IF v_consumes AND v_status IN ('Cancelled','Rejected') THEN
    v_reason := 'Order ' || v_status;
  END IF;
  FOR r IN
    WITH involved AS (
      SELECT DISTINCT oi.product_id FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL AND p.track_stock IS TRUE
      UNION
      SELECT DISTINCT sl.product_id FROM public.stock_ledger sl
      WHERE sl.source_type = 'order' AND sl.source_id = p_order_id
        AND sl.posted_mode IN ('order_created','order_closed')
    ),
    target AS (
      SELECT i.product_id,
        CASE WHEN v_consumes THEN
          -1 * COALESCE((SELECT SUM(COALESCE(oi.base_quantity, oi.quantity)) FROM public.order_items oi
            WHERE oi.order_id = p_order_id AND oi.product_id = i.product_id), 0)
        ELSE 0 END AS target_qty
      FROM involved i
    ),
    posted AS (
      SELECT i.product_id,
        COALESCE((SELECT SUM(sl.quantity) FROM public.stock_ledger sl
          WHERE sl.source_type = 'order' AND sl.source_id = p_order_id
            AND sl.product_id = i.product_id
            AND sl.posted_mode IN ('order_created','order_closed')), 0) AS posted_qty
      FROM involved i
    )
    SELECT t.product_id, t.target_qty - p.posted_qty AS delta
    FROM target t JOIN posted p ON p.product_id = t.product_id
    WHERE t.target_qty - p.posted_qty <> 0
  LOOP
    v_delta := r.delta;
    INSERT INTO public.stock_ledger
      (account_id, product_id, quantity, entry_type, reason_code,
       source_type, source_id, source_ref, posted_mode)
    VALUES
      (v_account, r.product_id, v_delta,
       CASE WHEN v_delta < 0 THEN 'sale_out' ELSE 'reversal' END,
       CASE WHEN v_delta > 0 THEN COALESCE(v_reason, 'Order Adjustment') ELSE NULL END,
       'order', p_order_id, v_ref, v_event);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stock_reconcile_dispatch(p_dispatch_id uuid, p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_event text; v_ref text; r RECORD; v_delta numeric;
BEGIN
  IF p_account_id IS NULL THEN RETURN; END IF;
  IF NOT public.stock_module_enabled(p_account_id) THEN RETURN; END IF;
  v_event := public.stock_out_event(p_account_id);
  IF v_event <> 'dispatch' THEN RETURN; END IF;
  SELECT dispatch_number INTO v_ref FROM public.order_dispatches WHERE id = p_dispatch_id;
  FOR r IN
    WITH involved AS (
      SELECT DISTINCT oi.product_id FROM public.dispatch_items di
      JOIN public.order_items oi ON oi.id = di.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      WHERE di.dispatch_id = p_dispatch_id AND oi.product_id IS NOT NULL AND p.track_stock IS TRUE
      UNION
      SELECT DISTINCT sl.product_id FROM public.stock_ledger sl
      WHERE sl.source_type = 'dispatch' AND sl.source_id = p_dispatch_id AND sl.posted_mode = 'dispatch'
    ),
    target AS (
      SELECT i.product_id,
        -1 * COALESCE((SELECT SUM(COALESCE(di.base_quantity, di.quantity)) FROM public.dispatch_items di
          JOIN public.order_items oi ON oi.id = di.order_item_id
          WHERE di.dispatch_id = p_dispatch_id AND oi.product_id = i.product_id), 0) AS target_qty
      FROM involved i
    ),
    posted AS (
      SELECT i.product_id,
        COALESCE((SELECT SUM(sl.quantity) FROM public.stock_ledger sl
          WHERE sl.source_type = 'dispatch' AND sl.source_id = p_dispatch_id
            AND sl.product_id = i.product_id AND sl.posted_mode = 'dispatch'), 0) AS posted_qty
      FROM involved i
    )
    SELECT t.product_id, t.target_qty - p.posted_qty AS delta
    FROM target t JOIN posted p ON p.product_id = t.product_id
    WHERE t.target_qty - p.posted_qty <> 0
  LOOP
    v_delta := r.delta;
    INSERT INTO public.stock_ledger
      (account_id, product_id, quantity, entry_type, reason_code,
       source_type, source_id, source_ref, posted_mode)
    VALUES
      (p_account_id, r.product_id, v_delta,
       CASE WHEN v_delta < 0 THEN 'sale_out' ELSE 'reversal' END,
       CASE WHEN v_delta > 0 THEN 'Dispatch Adjustment' ELSE NULL END,
       'dispatch', p_dispatch_id, v_ref, 'dispatch');
  END LOOP;
END;
$function$;

-- ============================================================================
-- 9. detect_eligible_schemes  (engine_version 3 -> 4)
-- ----------------------------------------------------------------------------
-- Honours schemes.qty_unit_basis for quantity_slab / free_goods THRESHOLDS:
--   'base'    -> compare base_quantity (entered × factor)  [default]
--   'entered' -> compare entered quantity
-- Discount MONEY is always computed on base_quantity (catalogue price is per
-- base unit), so the rupee reward stays proportional to the real line value.
-- value_slab money subtotal always uses base_quantity for the same reason.
-- v_thr_qty = threshold quantity (basis-dependent); base_quantity = money qty.
-- Factor 1 => identical to v3 for every existing scheme.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.detect_eligible_schemes(p_account_id uuid, p_contact_id uuid, p_lines jsonb, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_today date := p_as_of::date;
  v_line record; v_scheme record; v_slab record; v_next record;
  v_catalogue numeric; v_free_price numeric; v_free_name text; v_free_qty numeric;
  v_disc numeric; v_cust_value numeric; v_default_sel boolean; v_sets numeric;
  v_remainder numeric; v_nudge jsonb; v_cap numeric; v_used numeric; v_allowed numeric;
  v_subtotal numeric; v_positions int[]; v_line_schemes jsonb; v_order_schemes jsonb;
  v_thr_qty numeric; v_base_qty numeric;
BEGIN
  DROP TABLE IF EXISTS _det_lines; DROP TABLE IF EXISTS _det_candidates;
  DROP TABLE IF EXISTS _det_best; DROP TABLE IF EXISTS _det_value;

  CREATE TEMP TABLE _det_lines (position int, product_id uuid, quantity numeric, conversion_factor numeric, base_quantity numeric, catalogue_price numeric) ON COMMIT DROP;
  INSERT INTO _det_lines
  SELECT t.ord::int, (l ->> 'product_id')::uuid,
         GREATEST(COALESCE((l ->> 'quantity')::numeric, 0), 0),
         GREATEST(COALESCE((l ->> 'conversion_factor')::numeric, 1), 0.000001),
         ROUND(GREATEST(COALESCE((l ->> 'quantity')::numeric, 0), 0) * GREATEST(COALESCE((l ->> 'conversion_factor')::numeric, 1), 0.000001), 6),
         COALESCE(p.price, 0)
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t(l, ord)
  LEFT JOIN products p ON p.id = (l ->> 'product_id')::uuid AND p.account_id = p_account_id;

  CREATE TEMP TABLE _det_candidates (
    position int, product_id uuid, scheme_id uuid, scheme_name text, scheme_type text,
    priority int, reward_type text, reward_value numeric, matched_slab_id uuid,
    scheme_discount_amount numeric, free_product_id uuid, free_product_name text,
    free_qty numeric, default_selected boolean, customer_value numeric, nudge jsonb
  ) ON COMMIT DROP;

  FOR v_line IN SELECT * FROM _det_lines WHERE quantity > 0 LOOP
    v_catalogue := v_line.catalogue_price;
    v_base_qty := v_line.base_quantity;
    FOR v_scheme IN
      SELECT s.* FROM schemes s
      WHERE s.account_id = p_account_id AND s.scheme_type IN ('quantity_slab','free_goods')
        AND s.active AND s.starts_on <= v_today AND (s.ends_on IS NULL OR s.ends_on >= v_today)
        AND (s.target_type = 'all' OR (p_contact_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM scheme_customers sc WHERE sc.scheme_id = s.id AND sc.contact_id = p_contact_id)))
        AND (NOT EXISTS (SELECT 1 FROM scheme_products sp WHERE sp.scheme_id = s.id)
             OR EXISTS (SELECT 1 FROM scheme_products sp WHERE sp.scheme_id = s.id AND sp.product_id = v_line.product_id))
    LOOP
      -- Threshold quantity per the scheme's admin-chosen basis.
      v_thr_qty := CASE WHEN v_scheme.qty_unit_basis = 'base' THEN v_base_qty ELSE v_line.quantity END;

      SELECT * INTO v_slab FROM scheme_slabs ss
      WHERE ss.scheme_id = v_scheme.id AND (ss.min_qty IS NOT NULL OR ss.max_qty IS NOT NULL)
        AND v_thr_qty >= COALESCE(ss.min_qty, 0) AND (ss.max_qty IS NULL OR v_thr_qty <= ss.max_qty)
      ORDER BY COALESCE(ss.min_qty, 0) DESC LIMIT 1;
      CONTINUE WHEN NOT FOUND;

      v_free_qty := 0; v_disc := 0; v_cust_value := 0; v_default_sel := true; v_free_name := NULL; v_free_price := 0;
      IF v_slab.free_product_id IS NOT NULL THEN
        SELECT name, COALESCE(price, 0) INTO v_free_name, v_free_price FROM products WHERE id = v_slab.free_product_id;
      END IF;

      IF v_slab.reward_type = 'free_goods' THEN
        IF v_scheme.slab_mode = 'repeat' THEN
          v_sets := CASE WHEN COALESCE(v_slab.min_qty, 0) > 0 THEN floor(v_thr_qty / v_slab.min_qty) ELSE 0 END;
          v_free_qty := COALESCE(v_slab.free_qty, 0) * v_sets;
        ELSE v_free_qty := COALESCE(v_slab.free_qty, 0); END IF;
        CONTINUE WHEN v_free_qty <= 0;
        v_cust_value := round(v_free_qty * v_free_price, 2); v_default_sel := false;
      ELSIF v_slab.reward_type = 'discount_percent' THEN
        -- money on base_quantity (catalogue is per base unit)
        v_disc := round(v_catalogue * v_base_qty * COALESCE(v_slab.reward_value, 0) / 100.0, 2); v_cust_value := v_disc;
      ELSIF v_slab.reward_type = 'discount_amount' THEN
        -- per-unit amount reward: per unit of the chosen basis
        v_disc := round(COALESCE(v_slab.reward_value, 0) * v_thr_qty, 2); v_cust_value := v_disc;
      ELSIF v_slab.reward_type = 'special_price' THEN
        -- special price is a per-base-unit price; applied to base_quantity
        v_disc := GREATEST(0, round((v_catalogue - COALESCE(v_slab.reward_value, 0)) * v_base_qty, 2)); v_cust_value := v_disc;
      END IF;
      CONTINUE WHEN v_cust_value <= 0 AND v_free_qty <= 0;

      v_nudge := NULL;
      IF v_scheme.slab_mode = 'repeat' THEN
        IF COALESCE(v_slab.min_qty, 0) > 0 THEN
          v_remainder := v_thr_qty - (floor(v_thr_qty / v_slab.min_qty) * v_slab.min_qty);
          IF v_remainder > 0 THEN v_nudge := jsonb_build_object('units_to_next', v_slab.min_qty - v_remainder,
            'next_reward_label', _scheme_reward_label(v_slab.reward_type, v_slab.reward_value, v_slab.free_qty, v_free_name)); END IF;
        END IF;
      ELSE
        SELECT * INTO v_next FROM scheme_slabs ss WHERE ss.scheme_id = v_scheme.id AND COALESCE(ss.min_qty, 0) > v_thr_qty
        ORDER BY COALESCE(ss.min_qty, 0) ASC LIMIT 1;
        IF FOUND THEN v_nudge := jsonb_build_object('units_to_next', COALESCE(v_next.min_qty, 0) - v_thr_qty,
          'next_reward_label', _scheme_reward_label(v_next.reward_type, v_next.reward_value, v_next.free_qty, v_free_name)); END IF;
      END IF;

      INSERT INTO _det_candidates VALUES (v_line.position, v_line.product_id, v_scheme.id, v_scheme.name, v_scheme.scheme_type,
        v_scheme.priority, v_slab.reward_type, COALESCE(v_slab.reward_value, 0), v_slab.id,
        v_disc, v_slab.free_product_id, v_free_name, v_free_qty, v_default_sel, v_cust_value, v_nudge);
    END LOOP;
  END LOOP;

  CREATE TEMP TABLE _det_best ON COMMIT DROP AS
  SELECT DISTINCT ON (position) * FROM _det_candidates
  ORDER BY position, priority DESC, customer_value DESC, scheme_id ASC;

  FOR v_line IN SELECT b.ctid, b.position, b.scheme_id, b.reward_type, b.free_qty FROM _det_best b
    WHERE b.reward_type = 'free_goods' AND b.free_qty > 0 ORDER BY b.position
  LOOP
    SELECT max_free_units_per_order INTO v_cap FROM schemes WHERE id = v_line.scheme_id;
    CONTINUE WHEN v_cap IS NULL;
    SELECT COALESCE(SUM(free_qty), 0) INTO v_used FROM _det_best
    WHERE scheme_id = v_line.scheme_id AND position < v_line.position AND reward_type = 'free_goods';
    v_allowed := GREATEST(0, v_cap - v_used);
    UPDATE _det_best SET free_qty = LEAST(free_qty, v_allowed) WHERE ctid = v_line.ctid;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'position', position, 'product_id', product_id, 'scheme_id', scheme_id, 'scheme_name', scheme_name,
    'scheme_type', scheme_type, 'reward_type', reward_type, 'reward_value', reward_value,
    'matched_slab_id', matched_slab_id, 'scheme_discount_amount', scheme_discount_amount,
    'free_product_id', free_product_id, 'free_product_name', free_product_name, 'free_qty', free_qty,
    'default_selected', default_selected, 'nudge', nudge) ORDER BY position), '[]'::jsonb)
  INTO v_line_schemes FROM _det_best;

  CREATE TEMP TABLE _det_value (scheme_id uuid, scheme_name text, priority int, reward_type text,
    reward_value numeric, qualifying_subtotal numeric, discount_amount numeric, positions int[], nudge jsonb) ON COMMIT DROP;

  FOR v_scheme IN
    SELECT s.* FROM schemes s WHERE s.account_id = p_account_id AND s.scheme_type = 'value_slab'
      AND s.active AND s.starts_on <= v_today AND (s.ends_on IS NULL OR s.ends_on >= v_today)
      AND (s.target_type = 'all' OR (p_contact_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM scheme_customers sc WHERE sc.scheme_id = s.id AND sc.contact_id = p_contact_id)))
  LOOP
    -- value subtotal uses base_quantity (catalogue price is per base unit)
    SELECT COALESCE(array_agg(d.position ORDER BY d.position), '{}'),
           COALESCE(round(SUM(d.catalogue_price * d.base_quantity), 2), 0)
    INTO v_positions, v_subtotal FROM _det_lines d
    WHERE d.quantity > 0 AND (NOT EXISTS (SELECT 1 FROM scheme_products sp WHERE sp.scheme_id = v_scheme.id)
      OR EXISTS (SELECT 1 FROM scheme_products sp WHERE sp.scheme_id = v_scheme.id AND sp.product_id = d.product_id));
    CONTINUE WHEN array_length(v_positions, 1) IS NULL;

    SELECT * INTO v_slab FROM scheme_slabs ss WHERE ss.scheme_id = v_scheme.id
      AND (ss.min_value IS NOT NULL OR ss.max_value IS NOT NULL)
      AND v_subtotal >= COALESCE(ss.min_value, 0) AND (ss.max_value IS NULL OR v_subtotal <= ss.max_value)
    ORDER BY COALESCE(ss.min_value, 0) DESC LIMIT 1;

    CONTINUE WHEN v_slab.id IS NULL;
    CONTINUE WHEN v_slab.reward_type NOT IN ('discount_percent', 'discount_amount');

    v_nudge := NULL;
    SELECT * INTO v_next FROM scheme_slabs ss WHERE ss.scheme_id = v_scheme.id AND COALESCE(ss.min_value, 0) > v_subtotal
    ORDER BY COALESCE(ss.min_value, 0) ASC LIMIT 1;
    IF FOUND THEN v_nudge := jsonb_build_object('value_to_next', round(COALESCE(v_next.min_value, 0) - v_subtotal, 2),
      'next_reward_label', _scheme_reward_label(v_next.reward_type, v_next.reward_value, NULL, NULL)); END IF;

    v_disc := CASE WHEN v_slab.reward_type = 'discount_percent'
                THEN round(v_subtotal * COALESCE(v_slab.reward_value, 0) / 100.0, 2)
                ELSE round(COALESCE(v_slab.reward_value, 0), 2) END;
    CONTINUE WHEN v_disc <= 0;
    INSERT INTO _det_value VALUES (v_scheme.id, v_scheme.name, v_scheme.priority, v_slab.reward_type,
      COALESCE(v_slab.reward_value, 0), v_subtotal, v_disc, v_positions, v_nudge);
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('scheme_id', scheme_id, 'scheme_name', scheme_name,
    'reward_type', reward_type, 'reward_value', reward_value, 'qualifying_subtotal', qualifying_subtotal,
    'discount_amount', discount_amount, 'applies_to_positions', to_jsonb(positions),
    'default_selected', true, 'nudge', nudge)), '[]'::jsonb)
  INTO v_order_schemes FROM (SELECT * FROM _det_value ORDER BY priority DESC, discount_amount DESC, scheme_id ASC LIMIT 1) best;

  RETURN jsonb_build_object('line_schemes', COALESCE(v_line_schemes, '[]'::jsonb),
    'order_schemes', COALESCE(v_order_schemes, '[]'::jsonb), 'as_of', p_as_of, 'engine_version', 4);
END;
$function$;
