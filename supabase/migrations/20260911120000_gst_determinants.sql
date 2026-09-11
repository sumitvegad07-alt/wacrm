-- ============================================================
-- 20260911120000_gst_determinants.sql
--
-- Persist the GST DETERMINANTS on every order, at order time, so a future
-- Tally export is a pure read-and-map with no live joins to mutable masters.
--
-- WHY NOW (tech-debt prevention): a CGST/SGST/IGST amount is a pure function
-- of (tax_amount, gst_type, rate) and can be derived at export time forever.
-- What CANNOT be reconstructed later are the INPUTS that were true the day the
-- order was placed — the supplier's state, the customer's place of supply,
-- both GSTINs, and each line's HSN — because those live on accounts.settings,
-- contacts and products, which drift or get deleted. So we snapshot the
-- determinants and derive the money.
--
-- SCOPE (deliberately minimal):
--   • additive columns only — no column is altered or dropped;
--   • determinants are immutable snapshots written by the order RPCs;
--   • gst_type is a GENERATED STORED projection of those snapshots — kept (not
--     hand-written) because reporting/dashboards/Tally filter on it and a
--     generated column is indexable yet cannot drift from its inputs;
--   • NO cgst/sgst/igst amount columns (derive them in the exporter);
--   • NO invoice / accounting changes;
--   • existing orders keep NULL determinants — we never back-fill a guessed GST
--     basis onto history (absence classifies as 'unknown').
--
-- WHAT IS DERIVED, NOT STORED (a GSTIN's first two chars ARE its state code):
--   supplier_state_code  = left(supplier_gstin, 2)
--   place_of_supply name = canonical map of place_of_supply_code
--   cgst/sgst/igst        = order_items.tax_amount split by gst_type at export
--
-- BACKWARD COMPATIBLE: create_order / update_order keep their exact existing
-- signatures (CREATE OR REPLACE, no DROP), so every current caller — web,
-- mobile, offline sync — is unaffected. The new columns are populated as a
-- side effect; a caller that reads none of them behaves exactly as before.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Party GSTIN needs a home. contacts had NO gst_number column, yet the
--    order/quotation/dispatch print routes already read `cust.gst_number`
--    (it silently rendered blank). This adds the backing column, which both
--    fixes that dangling read and gives party_gstin a source to snapshot.
-- ------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS gst_number text;

-- ------------------------------------------------------------
-- 1a. Order-level GST determinants — immutable snapshots (RPC-written).
-- ------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS supplier_gstin       text,   -- snapshot: our GSTIN on this sale (supplier state = its first 2 digits)
  ADD COLUMN IF NOT EXISTS party_gstin          text,   -- snapshot: customer GSTIN (NULL for B2C / unregistered)
  ADD COLUMN IF NOT EXISTS place_of_supply_code text;   -- snapshot: 2-digit GST state code where the supply is taxed

COMMENT ON COLUMN orders.place_of_supply_code IS
'GST place-of-supply state code, frozen at order time. Registered (B2B) customer: the party GSTIN''s first two digits; B2C: derived from the customer state. Kept independently of party_gstin because place of supply can legally differ from the buyer''s registration (bill-to vs ship-to). The supplier state code is derived as left(supplier_gstin,2).';

-- ------------------------------------------------------------
-- 1b. gst_type — a DB-MAINTAINED PROJECTION of the two determinants on this
--     row, not an independently written value. GENERATED ... STORED means:
--       • it can never drift from its inputs (you cannot write it directly);
--       • it needs zero application code (the RPCs do NOT set it);
--       • it is a real, INDEXABLE column that reporting / dashboards / the
--         Phase-2 Tally export filter and group on without re-deriving.
--     A missing place of supply or a non-15-char supplier GSTIN classifies as
--     'unknown' — never a silent 'interstate'. The comparison is over frozen
--     snapshot inputs, so a given order's value is stable over time.
--     (Requires Postgres 12+/Supabase — STORED generated columns.)
-- ------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gst_type text
    GENERATED ALWAYS AS (
      CASE
        WHEN supplier_gstin IS NULL OR length(supplier_gstin) <> 15
          OR place_of_supply_code IS NULL OR place_of_supply_code = ''
          THEN 'unknown'
        WHEN left(supplier_gstin, 2) = place_of_supply_code THEN 'intrastate'
        ELSE 'interstate'
      END
    ) STORED;

-- Reporting / analytics filter on gst_type constantly; index it tenant-scoped.
CREATE INDEX IF NOT EXISTS idx_orders_gst_type ON orders(account_id, gst_type);

-- ------------------------------------------------------------
-- 2. Line-level HSN snapshot. HSN lived only on products; a deleted or edited
--    product would erase a historical line's tax identity. Snapshot it.
-- ------------------------------------------------------------
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS hsn_code text;

-- ------------------------------------------------------------
-- 3. Canonical India GST state-code map (single SQL source of truth).
--    IMMUTABLE reference data — reused by create_order/update_order today and
--    by the Tally exporter later. The TS mirror (src/lib/gst/states.ts) MUST
--    stay in sync with this list, exactly like the pricing engine's TS/SQL
--    parity contract.
--
--    Resolution: a registered party's authoritative code is the first two
--    digits of its 15-char GSTIN; this function is the fallback for an
--    unregistered (B2C) party, mapping a free-text state name to its code.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION gst_state_code(p_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE regexp_replace(lower(btrim(coalesce(p_state, ''))), '[^a-z]', '', 'g')
    WHEN 'jammuandkashmir'                       THEN '01'
    WHEN 'himachalpradesh'                       THEN '02'
    WHEN 'punjab'                                THEN '03'
    WHEN 'chandigarh'                            THEN '04'
    WHEN 'uttarakhand'                           THEN '05'
    WHEN 'uttaranchal'                           THEN '05'
    WHEN 'haryana'                               THEN '06'
    WHEN 'delhi'                                 THEN '07'
    WHEN 'newdelhi'                              THEN '07'
    WHEN 'rajasthan'                             THEN '08'
    WHEN 'uttarpradesh'                          THEN '09'
    WHEN 'bihar'                                 THEN '10'
    WHEN 'sikkim'                                THEN '11'
    WHEN 'arunachalpradesh'                      THEN '12'
    WHEN 'nagaland'                              THEN '13'
    WHEN 'manipur'                               THEN '14'
    WHEN 'mizoram'                               THEN '15'
    WHEN 'tripura'                               THEN '16'
    WHEN 'meghalaya'                             THEN '17'
    WHEN 'assam'                                 THEN '18'
    WHEN 'westbengal'                            THEN '19'
    WHEN 'jharkhand'                             THEN '20'
    WHEN 'odisha'                                THEN '21'
    WHEN 'orissa'                                THEN '21'
    WHEN 'chhattisgarh'                          THEN '22'
    WHEN 'chattisgarh'                           THEN '22'
    WHEN 'madhyapradesh'                         THEN '23'
    WHEN 'gujarat'                               THEN '24'
    WHEN 'damananddiu'                           THEN '25'
    WHEN 'dadranagarhaveli'                       THEN '26'
    WHEN 'dadraandnagarhaveli'                   THEN '26'
    WHEN 'dadraandnagarhavelianddamananddiu'     THEN '26'
    WHEN 'maharashtra'                           THEN '27'
    WHEN 'karnataka'                             THEN '29'
    WHEN 'goa'                                   THEN '30'
    WHEN 'lakshadweep'                           THEN '31'
    WHEN 'kerala'                                THEN '32'
    WHEN 'tamilnadu'                             THEN '33'
    WHEN 'puducherry'                            THEN '34'
    WHEN 'pondicherry'                           THEN '34'
    WHEN 'andamanandnicobarislands'              THEN '35'
    WHEN 'andamannicobar'                        THEN '35'
    WHEN 'telangana'                             THEN '36'
    WHEN 'andhrapradesh'                         THEN '37'
    WHEN 'ladakh'                                THEN '38'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION gst_state_code(text) IS
'Canonical India GST state-name to 2-digit state-code map. Keep in sync with src/lib/gst/states.ts. Returns NULL for an unknown/blank name so callers treat GST type as unknown rather than guessing.';

-- ============================================================
-- 4. create_order — unchanged signature. Computes and snapshots the GST
--    determinants after the contact-detach decision, and snapshots hsn_code
--    per line. Every other line is preserved verbatim from
--    20260820140000_order_rpcs_scheme_forwarding.sql.
-- ============================================================
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
  -- GST determinants (Tally) — pure immutable snapshots only
  v_supplier_gstin text; v_party_gstin text; v_pos_code text;
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

  -- ── GST determinants (Tally): snapshot the immutable inputs AT ORDER TIME —
  -- supplier + party GSTIN, and the place-of-supply state code (party GSTIN's
  -- first two digits when registered, else the customer state). gst_type and
  -- the supplier state code are DERIVED at export and deliberately not stored.
  SELECT NULLIF(btrim(settings -> 'company_profile' ->> 'gst_number'), '')
    INTO v_supplier_gstin
  FROM accounts WHERE id = p_account_id;
  IF v_contact_final IS NOT NULL THEN
    SELECT NULLIF(btrim(gst_number), ''),
           CASE WHEN NULLIF(btrim(gst_number), '') IS NOT NULL AND length(btrim(gst_number)) = 15
                THEN left(btrim(gst_number), 2)
                ELSE gst_state_code(state) END
      INTO v_party_gstin, v_pos_code
    FROM contacts WHERE id = v_contact_final;
  END IF;

  INSERT INTO orders (
    id, account_id, user_id, contact_id, site_visit_id, date,
    sub_total, tax_total, total_amount, discount_total, order_discount_type, order_discount_value,
    status, classification, notes, pricing_status, expected_total, pricing_variance,
    supplier_gstin, party_gstin, place_of_supply_code
  ) VALUES (
    p_order_id, p_account_id, auth.uid(), v_contact_final, p_site_visit_id, COALESCE(p_date, CURRENT_DATE),
    COALESCE((v_store ->> 'sub_total')::numeric, 0), COALESCE((v_store ->> 'tax_total')::numeric, 0),
    COALESCE((v_store ->> 'total_amount')::numeric, 0), COALESCE((v_store ->> 'discount_total')::numeric, 0),
    NULLIF(p_order_discount ->> 'type', ''), COALESCE((p_order_discount ->> 'value')::numeric, 0),
    'Pending', v_classification, p_notes, v_status, v_expected_total,
    CASE WHEN v_variance = '[]'::jsonb THEN NULL ELSE v_variance END,
    v_supplier_gstin, v_party_gstin, v_pos_code
  );
  SELECT order_number INTO v_order_number FROM orders WHERE id = p_order_id;
  INSERT INTO order_items (
    order_id, product_id, product_name, unit, quantity, price, tax_rate, tax_amount, sub_total, total, position,
    catalogue_price, price_list_price, scheme_discount_amount, discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode, scheme_id,
    hsn_code
  )
  SELECT p_order_id, p.id, COALESCE(ln ->> 'product_name', 'Unknown product'), ln ->> 'unit',
    COALESCE((ln ->> 'quantity')::numeric, 0), COALESCE((ln ->> 'price_list_price')::numeric, 0),
    COALESCE((ln ->> 'tax_rate')::numeric, 0), COALESCE((ln ->> 'tax_amount')::numeric, 0),
    COALESCE((ln ->> 'sub_total')::numeric, 0), COALESCE((ln ->> 'total')::numeric, 0), COALESCE((ln ->> 'position')::int, 0),
    (ln ->> 'catalogue_price')::numeric, (ln ->> 'price_list_price')::numeric, COALESCE((ln ->> 'scheme_discount_amount')::numeric, 0),
    NULLIF(ln ->> 'discount_type', ''), COALESCE((ln ->> 'discount_value')::numeric, 0), COALESCE((ln ->> 'discount_amount')::numeric, 0),
    COALESCE((ln ->> 'order_discount_share')::numeric, 0), COALESCE((ln ->> 'is_scheme_goods')::boolean, false), COALESCE(ln ->> 'tax_mode', 'exclusive'),
    (ln ->> 'scheme_id')::uuid,
    p.hsn_code
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

-- ============================================================
-- 5. update_order — unchanged signature. Re-computes the GST determinants on
--    edit (the customer, and therefore the place of supply, can change) and
--    re-snapshots hsn_code per line. Every other line is preserved verbatim
--    from 20260820140000_order_rpcs_scheme_forwarding.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION update_order(
  p_order_id uuid, p_lines jsonb, p_order_discount jsonb DEFAULT NULL, p_notes text DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_order_schemes jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
  v_account_id uuid; v_contact_id uuid; v_locked_at timestamptz;
  v_calc jsonb; v_status text; v_variance jsonb;
  -- GST determinants (Tally) — pure immutable snapshots only
  v_supplier_gstin text; v_party_gstin text; v_pos_code text;
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

  -- ── GST determinants (Tally): re-snapshot because the customer (and thus the
  -- place of supply) may have changed on this edit.
  SELECT NULLIF(btrim(settings -> 'company_profile' ->> 'gst_number'), '')
    INTO v_supplier_gstin
  FROM accounts WHERE id = v_account_id;
  IF v_contact_id IS NOT NULL THEN
    SELECT NULLIF(btrim(gst_number), ''),
           CASE WHEN NULLIF(btrim(gst_number), '') IS NOT NULL AND length(btrim(gst_number)) = 15
                THEN left(btrim(gst_number), 2)
                ELSE gst_state_code(state) END
      INTO v_party_gstin, v_pos_code
    FROM contacts WHERE id = v_contact_id;
  END IF;

  DELETE FROM order_items WHERE order_id = p_order_id;

  INSERT INTO order_items (
    order_id, product_id, product_name, unit, quantity, price,
    tax_rate, tax_amount, sub_total, total, position,
    catalogue_price, price_list_price, scheme_discount_amount,
    discount_type, discount_value, discount_amount, order_discount_share, is_scheme_goods, tax_mode, scheme_id,
    hsn_code
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
    p.hsn_code
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
    pricing_status = v_status, expected_total = (v_calc ->> 'total_amount')::numeric, pricing_variance = v_variance,
    supplier_gstin = v_supplier_gstin, party_gstin = v_party_gstin, place_of_supply_code = v_pos_code
  WHERE id = p_order_id;

  RETURN jsonb_build_object('order_id', p_order_id, 'pricing_status', v_status,
    'classification', v_calc ->> 'classification', 'total_amount', (v_calc ->> 'total_amount')::numeric,
    'contact_id', v_contact_id);
END;
$function$;
