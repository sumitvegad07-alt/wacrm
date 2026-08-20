-- ============================================================
-- 20260819160000_scheme_engine.sql   (Pricing Phase 4 — Schemes)
--
-- Two changes, both additive:
--   1. NEW  detect_eligible_schemes(account, contact, lines, as_of)
--      — the scheme "detection brain". It PROPOSES the schemes a draft order
--        qualifies for and the reward each would produce. It never sets an
--        order total; the salesman confirms a subset in the UI, and those
--        confirmed effects are fed back into calculate_order_pricing.
--   2. REV  calculate_order_pricing — the scheme step (a labelled pass-through
--        since 077) now consumes the CONFIRMED scheme effects as inputs:
--          • per line: scheme_id, scheme_discount_amount, is_scheme_goods
--          • order level: p_order_schemes (value-slab whole-order discounts)
--        It does NOT resolve slabs — all slab/reward logic lives in detection.
--        When no scheme inputs are present the function is byte-identical to
--        engine_version 2, so every pre-Phase-4 order prices exactly as before.
--      engine_version -> 3.
--
-- This SQL is the AUTHORITATIVE twin of src/lib/pricing/detectEligibleSchemes.ts
-- and calculateOrderPricing.ts. Both are pinned by the shared fixtures in
-- src/lib/pricing/fixtures.ts — see sql-parity.md for the rollback dry-run that
-- proves this file against those exact cases. Change one side, change and
-- re-verify the other.
--
-- Founder-confirmed rules (2026-08-19):
--   • quantity_slab / free_goods: BEST SINGLE scheme per line — priority ↓,
--     then customer value ↓, then scheme id ↑ (deterministic).
--   • value_slab: single best whole-order discount, may stack ON TOP of a
--     per-line scheme; value slabs never stack with each other.
--   • slab_mode changes only quantity-scaled rewards (free_goods, per-unit
--     amount). A percent / special_price is a rate on the whole line.
--   • free goods default to opt-in; money discounts default to accepted.
--   • max_free_units_per_order caps a scheme's total free units across lines.
--   • value-slab threshold = catalogue subtotal of the scheme's own products
--     (whole order when the scheme lists no products); ₹0 lines never count.
--
-- SECURITY INVOKER on both, so RLS applies and an account only ever sees its
-- own schemes, products and customers.
-- ============================================================


-- ------------------------------------------------------------
-- 0. helper: a human label for a slab reward, used in the "add N more" nudge.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION _scheme_reward_label(
  p_reward_type text,
  p_reward_value numeric,
  p_free_qty numeric,
  p_free_name text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_reward_type
    WHEN 'free_goods'       THEN COALESCE(p_free_qty, 0)::text || ' × ' || COALESCE(p_free_name, 'free goods') || ' free'
    WHEN 'discount_percent' THEN COALESCE(p_reward_value, 0)::text || '% off'
    WHEN 'discount_amount'  THEN '₹' || COALESCE(p_reward_value, 0)::text || '/unit off'
    WHEN 'special_price'    THEN 'special price ₹' || COALESCE(p_reward_value, 0)::text
    ELSE 'reward'
  END;
$$;


-- ------------------------------------------------------------
-- 1. detect_eligible_schemes
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION detect_eligible_schemes(
  p_account_id uuid,
  p_contact_id uuid,
  p_lines      jsonb,                       -- [{product_id, quantity}]
  p_as_of      timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_today        date := p_as_of::date;
  v_line         record;
  v_scheme       record;
  v_slab         record;
  v_next         record;
  v_catalogue    numeric;
  v_free_price   numeric;
  v_free_name    text;
  v_free_qty     numeric;
  v_disc         numeric;
  v_cust_value   numeric;
  v_default_sel  boolean;
  v_sets         numeric;
  v_remainder    numeric;
  v_nudge        jsonb;
  v_cap          numeric;
  v_used         numeric;
  v_allowed      numeric;
  v_subtotal     numeric;
  v_positions    int[];
  v_line_schemes jsonb;
  v_order_schemes jsonb;
BEGIN
  -- Clean any leftovers so the function is safe to call more than once inside a
  -- single transaction (the parity dry-run does exactly this).
  DROP TABLE IF EXISTS _det_lines;
  DROP TABLE IF EXISTS _det_candidates;
  DROP TABLE IF EXISTS _det_best;
  DROP TABLE IF EXISTS _det_value;

  -- Draft lines, resolved to catalogue price. Non-free lines only.
  CREATE TEMP TABLE _det_lines (
    position        int,
    product_id      uuid,
    quantity        numeric,
    catalogue_price numeric
  ) ON COMMIT DROP;
  DELETE FROM _det_lines WHERE true;

  INSERT INTO _det_lines
  SELECT
    t.ord::int,
    (l ->> 'product_id')::uuid,
    GREATEST(COALESCE((l ->> 'quantity')::numeric, 0), 0),
    COALESCE(p.price, 0)
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t(l, ord)
  LEFT JOIN products p
    ON p.id = (l ->> 'product_id')::uuid AND p.account_id = p_account_id;

  -- Every candidate line-level scheme (quantity_slab / free_goods).
  CREATE TEMP TABLE _det_candidates (
    position               int,
    product_id             uuid,
    scheme_id              uuid,
    scheme_name            text,
    scheme_type            text,
    priority               int,
    reward_type            text,
    reward_value           numeric,
    matched_slab_id        uuid,
    scheme_discount_amount numeric,
    free_product_id        uuid,
    free_product_name      text,
    free_qty               numeric,
    default_selected       boolean,
    customer_value         numeric,
    nudge                  jsonb
  ) ON COMMIT DROP;
  DELETE FROM _det_candidates WHERE true;

  FOR v_line IN SELECT * FROM _det_lines WHERE quantity > 0 LOOP
    v_catalogue := v_line.catalogue_price;

    FOR v_scheme IN
      SELECT s.*
      FROM schemes s
      WHERE s.account_id = p_account_id
        AND s.scheme_type IN ('quantity_slab', 'free_goods')
        AND s.active
        AND s.starts_on <= v_today
        AND (s.ends_on IS NULL OR s.ends_on >= v_today)
        AND (
          s.target_type = 'all'
          OR (p_contact_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM scheme_customers sc
                WHERE sc.scheme_id = s.id AND sc.contact_id = p_contact_id))
        )
        AND (
          NOT EXISTS (SELECT 1 FROM scheme_products sp WHERE sp.scheme_id = s.id)
          OR EXISTS (SELECT 1 FROM scheme_products sp
                     WHERE sp.scheme_id = s.id AND sp.product_id = v_line.product_id)
        )
    LOOP
      -- Highest qty slab whose band contains the line quantity.
      SELECT * INTO v_slab
      FROM scheme_slabs ss
      WHERE ss.scheme_id = v_scheme.id
        AND (ss.min_qty IS NOT NULL OR ss.max_qty IS NOT NULL)
        AND v_line.quantity >= COALESCE(ss.min_qty, 0)
        AND (ss.max_qty IS NULL OR v_line.quantity <= ss.max_qty)
      ORDER BY COALESCE(ss.min_qty, 0) DESC
      LIMIT 1;
      CONTINUE WHEN NOT FOUND;

      v_free_qty    := 0;
      v_disc        := 0;
      v_cust_value  := 0;
      v_default_sel := true;
      v_free_name   := NULL;
      v_free_price  := 0;

      IF v_slab.free_product_id IS NOT NULL THEN
        SELECT name, COALESCE(price, 0) INTO v_free_name, v_free_price
        FROM products WHERE id = v_slab.free_product_id;
      END IF;

      IF v_slab.reward_type = 'free_goods' THEN
        IF v_scheme.slab_mode = 'repeat' THEN
          v_sets := CASE WHEN COALESCE(v_slab.min_qty, 0) > 0
                         THEN floor(v_line.quantity / v_slab.min_qty) ELSE 0 END;
          v_free_qty := COALESCE(v_slab.free_qty, 0) * v_sets;
        ELSE
          v_free_qty := COALESCE(v_slab.free_qty, 0);
        END IF;
        CONTINUE WHEN v_free_qty <= 0;
        v_cust_value  := round(v_free_qty * v_free_price, 2);
        v_default_sel := false;                          -- free goods are opt-in

      ELSIF v_slab.reward_type = 'discount_percent' THEN
        v_disc := round(v_catalogue * v_line.quantity * COALESCE(v_slab.reward_value, 0) / 100.0, 2);
        v_cust_value := v_disc;

      ELSIF v_slab.reward_type = 'discount_amount' THEN
        v_disc := round(COALESCE(v_slab.reward_value, 0) * v_line.quantity, 2);  -- per unit
        v_cust_value := v_disc;

      ELSIF v_slab.reward_type = 'special_price' THEN
        v_disc := GREATEST(0, round((v_catalogue - COALESCE(v_slab.reward_value, 0)) * v_line.quantity, 2));
        v_cust_value := v_disc;
      END IF;

      CONTINUE WHEN v_cust_value <= 0 AND v_free_qty <= 0;

      -- "Add N more" nudge.
      v_nudge := NULL;
      IF v_scheme.slab_mode = 'repeat' THEN
        IF COALESCE(v_slab.min_qty, 0) > 0 THEN
          v_remainder := v_line.quantity - (floor(v_line.quantity / v_slab.min_qty) * v_slab.min_qty);
          IF v_remainder > 0 THEN
            v_nudge := jsonb_build_object(
              'units_to_next', v_slab.min_qty - v_remainder,
              'next_reward_label', _scheme_reward_label(v_slab.reward_type, v_slab.reward_value, v_slab.free_qty, v_free_name));
          END IF;
        END IF;
      ELSE
        SELECT * INTO v_next
        FROM scheme_slabs ss
        WHERE ss.scheme_id = v_scheme.id
          AND COALESCE(ss.min_qty, 0) > v_line.quantity
        ORDER BY COALESCE(ss.min_qty, 0) ASC
        LIMIT 1;
        IF FOUND THEN
          v_nudge := jsonb_build_object(
            'units_to_next', COALESCE(v_next.min_qty, 0) - v_line.quantity,
            'next_reward_label', _scheme_reward_label(v_next.reward_type, v_next.reward_value, v_next.free_qty, v_free_name));
        END IF;
      END IF;

      INSERT INTO _det_candidates VALUES (
        v_line.position, v_line.product_id, v_scheme.id, v_scheme.name, v_scheme.scheme_type,
        v_scheme.priority, v_slab.reward_type, COALESCE(v_slab.reward_value, 0), v_slab.id,
        v_disc, v_slab.free_product_id, v_free_name, v_free_qty, v_default_sel, v_cust_value, v_nudge);
    END LOOP;
  END LOOP;

  -- Best single scheme per line: priority ↓, customer value ↓, scheme id ↑.
  CREATE TEMP TABLE _det_best ON COMMIT DROP AS
  SELECT DISTINCT ON (position) *
  FROM _det_candidates
  ORDER BY position, priority DESC, customer_value DESC, scheme_id ASC;

  -- Apply each scheme's max_free_units_per_order cap across the chosen lines,
  -- in position order.
  FOR v_line IN
    SELECT b.ctid, b.position, b.scheme_id, b.reward_type, b.free_qty
    FROM _det_best b
    WHERE b.reward_type = 'free_goods' AND b.free_qty > 0
    ORDER BY b.position
  LOOP
    SELECT max_free_units_per_order INTO v_cap FROM schemes WHERE id = v_line.scheme_id;
    CONTINUE WHEN v_cap IS NULL;
    SELECT COALESCE(SUM(free_qty), 0) INTO v_used
    FROM _det_best
    WHERE scheme_id = v_line.scheme_id AND position < v_line.position AND reward_type = 'free_goods';
    v_allowed := GREATEST(0, v_cap - v_used);
    UPDATE _det_best SET free_qty = LEAST(free_qty, v_allowed) WHERE ctid = v_line.ctid;
  END LOOP;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'position',               position,
             'product_id',             product_id,
             'scheme_id',              scheme_id,
             'scheme_name',            scheme_name,
             'scheme_type',            scheme_type,
             'reward_type',            reward_type,
             'reward_value',           reward_value,
             'matched_slab_id',        matched_slab_id,
             'scheme_discount_amount', scheme_discount_amount,
             'free_product_id',        free_product_id,
             'free_product_name',      free_product_name,
             'free_qty',               free_qty,
             'default_selected',       default_selected,
             'nudge',                  nudge
           ) ORDER BY position), '[]'::jsonb)
  INTO v_line_schemes FROM _det_best;

  -- ---------- value_slab (whole-order) schemes ----------
  CREATE TEMP TABLE _det_value (
    scheme_id uuid, scheme_name text, priority int,
    reward_type text, reward_value numeric, qualifying_subtotal numeric,
    discount_amount numeric, positions int[], nudge jsonb
  ) ON COMMIT DROP;

  FOR v_scheme IN
    SELECT s.*
    FROM schemes s
    WHERE s.account_id = p_account_id
      AND s.scheme_type = 'value_slab'
      AND s.active
      AND s.starts_on <= v_today
      AND (s.ends_on IS NULL OR s.ends_on >= v_today)
      AND (
        s.target_type = 'all'
        OR (p_contact_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM scheme_customers sc
              WHERE sc.scheme_id = s.id AND sc.contact_id = p_contact_id))
      )
  LOOP
    SELECT COALESCE(array_agg(d.position ORDER BY d.position), '{}'),
           COALESCE(round(SUM(d.catalogue_price * d.quantity), 2), 0)
    INTO v_positions, v_subtotal
    FROM _det_lines d
    WHERE d.quantity > 0
      AND (
        NOT EXISTS (SELECT 1 FROM scheme_products sp WHERE sp.scheme_id = v_scheme.id)
        OR EXISTS (SELECT 1 FROM scheme_products sp
                   WHERE sp.scheme_id = v_scheme.id AND sp.product_id = d.product_id)
      );
    CONTINUE WHEN array_length(v_positions, 1) IS NULL;

    -- highest value slab whose band contains the subtotal
    SELECT * INTO v_slab
    FROM scheme_slabs ss
    WHERE ss.scheme_id = v_scheme.id
      AND (ss.min_value IS NOT NULL OR ss.max_value IS NOT NULL)
      AND v_subtotal >= COALESCE(ss.min_value, 0)
      AND (ss.max_value IS NULL OR v_subtotal <= ss.max_value)
    ORDER BY COALESCE(ss.min_value, 0) DESC
    LIMIT 1;

    -- Whether the subtotal matches a slab is decided by v_slab, NOT by the FOUND
    -- flag: the nudge query below runs its own SELECT and would clobber FOUND.
    CONTINUE WHEN v_slab.id IS NULL;
    CONTINUE WHEN v_slab.reward_type NOT IN ('discount_percent', 'discount_amount');

    -- nudge from the next value slab up (if any)
    v_nudge := NULL;
    SELECT * INTO v_next
    FROM scheme_slabs ss
    WHERE ss.scheme_id = v_scheme.id
      AND COALESCE(ss.min_value, 0) > v_subtotal
    ORDER BY COALESCE(ss.min_value, 0) ASC
    LIMIT 1;
    IF FOUND THEN
      v_nudge := jsonb_build_object(
        'value_to_next', round(COALESCE(v_next.min_value, 0) - v_subtotal, 2),
        'next_reward_label', _scheme_reward_label(v_next.reward_type, v_next.reward_value, NULL, NULL));
    END IF;

    v_disc := CASE
                WHEN v_slab.reward_type = 'discount_percent'
                THEN round(v_subtotal * COALESCE(v_slab.reward_value, 0) / 100.0, 2)
                ELSE round(COALESCE(v_slab.reward_value, 0), 2)
              END;
    CONTINUE WHEN v_disc <= 0;

    INSERT INTO _det_value VALUES (
      v_scheme.id, v_scheme.name, v_scheme.priority, v_slab.reward_type,
      COALESCE(v_slab.reward_value, 0), v_subtotal, v_disc, v_positions, v_nudge);
  END LOOP;

  -- Value slabs do not stack: keep the single best (priority ↓, amount ↓, id ↑).
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'scheme_id',            scheme_id,
             'scheme_name',          scheme_name,
             'reward_type',          reward_type,
             'reward_value',         reward_value,
             'qualifying_subtotal',  qualifying_subtotal,
             'discount_amount',      discount_amount,
             'applies_to_positions', to_jsonb(positions),
             'default_selected',     true,
             'nudge',                nudge
           )), '[]'::jsonb)
  INTO v_order_schemes
  FROM (
    SELECT * FROM _det_value
    ORDER BY priority DESC, discount_amount DESC, scheme_id ASC
    LIMIT 1
  ) best;

  RETURN jsonb_build_object(
    'line_schemes',   COALESCE(v_line_schemes, '[]'::jsonb),
    'order_schemes',  COALESCE(v_order_schemes, '[]'::jsonb),
    'as_of',          p_as_of,
    'engine_version', 3
  );
END;
$$;

COMMENT ON FUNCTION detect_eligible_schemes IS
'Scheme detection brain (Phase 4). Proposes the schemes a draft order qualifies for; never sets a total. Authoritative twin of src/lib/pricing/detectEligibleSchemes.ts, pinned by fixtures.ts. SECURITY INVOKER.';


-- ------------------------------------------------------------
-- 2. calculate_order_pricing  (engine_version -> 3)
--
-- The pre-Phase-4 function has FIVE args. Adding a sixth (p_order_schemes) as a
-- new arg would create a SECOND overload, leaving the old 5-arg v2 live for
-- every existing 5-arg caller. Drop the old signature first so the 6-arg version
-- below is the sole function: a 5-arg call resolves to it (p_order_schemes
-- defaults to NULL) and prices byte-identically to v2.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS calculate_order_pricing(uuid, uuid, jsonb, jsonb, timestamptz);

CREATE OR REPLACE FUNCTION calculate_order_pricing(
  p_account_id     uuid,
  p_contact_id     uuid,
  p_lines          jsonb,       -- + optional scheme_id, scheme_discount_amount, is_scheme_goods per line
  p_order_discount jsonb       DEFAULT NULL,
  p_as_of          timestamptz DEFAULT now(),
  p_order_schemes  jsonb       DEFAULT NULL   -- [{scheme_id, discount_amount, positions:[int]}]
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
  v_order_scheme_total numeric := 0;
  v_scheme_line_total  numeric := 0;
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
    scheme_id              uuid,
    is_scheme_goods        boolean,
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
    q.scheme_discount_amount,                     -- raw; capped / zeroed below
    q.scheme_id,
    q.is_scheme_goods,
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
      NULLIF(l ->> 'tax_mode', '')                   AS tax_mode,
      (l ->> 'scheme_id')::uuid                      AS scheme_id,
      COALESCE((l ->> 'is_scheme_goods')::boolean, false) AS is_scheme_goods,
      GREATEST(COALESCE((l ->> 'scheme_discount_amount')::numeric, 0), 0) AS scheme_discount_amount
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t2(l, ord)
  ) q
  LEFT JOIN products  p  ON p.id = q.product_id AND p.account_id = p_account_id
  LEFT JOIN tax_slabs ts ON ts.id = p.tax_slab_id
  CROSS JOIN LATERAL (SELECT q.ord AS ord) t;

  -- Free-goods reward lines are priced to ₹0: no gross, no discount, no floor.
  UPDATE _pricing_scratch SET gross = 0, after_item = 0, scheme_discount_amount = 0
  WHERE is_scheme_goods;

  -- Paid lines: gross, then scheme discount (capped at the line), then salesman
  -- discount (capped at what the scheme left) — scheme + salesman jointly never
  -- exceed the line.
  UPDATE _pricing_scratch
  SET gross = ROUND(price_list_price * quantity, 2)
  WHERE NOT is_scheme_goods;

  UPDATE _pricing_scratch
  SET scheme_discount_amount = LEAST(ROUND(scheme_discount_amount, 2), gross)
  WHERE NOT is_scheme_goods;

  UPDATE _pricing_scratch
  SET discount_amount = LEAST(
        CASE
          WHEN discount_type = 'percent' THEN ROUND(gross * discount_value / 100.0, 2)
          WHEN discount_type = 'amount'  THEN ROUND(discount_value * quantity, 2)
          ELSE 0
        END,
        gross - scheme_discount_amount)
  WHERE NOT is_scheme_goods;

  UPDATE _pricing_scratch
  SET after_item = gross - scheme_discount_amount - discount_amount
  WHERE NOT is_scheme_goods;

  SELECT COALESCE(SUM(after_item), 0) INTO v_base_sum FROM _pricing_scratch;
  SELECT COALESCE(SUM(scheme_discount_amount), 0) INTO v_scheme_line_total FROM _pricing_scratch;

  -- Whole-order manual discount: 'amount' stays one amount across the order.
  v_order_discount := CASE
    WHEN v_od_type = 'percent' THEN ROUND(v_base_sum * v_od_value / 100.0, 2)
    WHEN v_od_type = 'amount'  THEN LEAST(ROUND(v_od_value, 2), v_base_sum)
    ELSE 0
  END;

  -- value_slab (whole-order scheme) discounts: each is capped at its scoped
  -- subtotal, spread pro-rata across its positions in pass 2.
  CREATE TEMP TABLE _order_scheme_alloc (
    scheme_id uuid, positions int[], amount numeric, denom numeric
  ) ON COMMIT DROP;
  DELETE FROM _order_scheme_alloc WHERE true;

  INSERT INTO _order_scheme_alloc
  SELECT
    (os ->> 'scheme_id')::uuid,
    ARRAY(SELECT jsonb_array_elements_text(os -> 'positions')::int),
    0::numeric,
    0::numeric
  FROM jsonb_array_elements(COALESCE(p_order_schemes, '[]'::jsonb)) AS os;

  -- WHERE true is required: production blocks UPDATE without a WHERE clause
  -- (safeupdate guard) for the authenticated role, even on a temp table.
  UPDATE _order_scheme_alloc a
  SET denom = COALESCE((
    SELECT SUM(sc.after_item) FROM _pricing_scratch sc WHERE sc.position = ANY(a.positions)
  ), 0)
  WHERE true;

  UPDATE _order_scheme_alloc a
  SET amount = LEAST(
    GREATEST(COALESCE((
      SELECT GREATEST(COALESCE((os ->> 'discount_amount')::numeric, 0), 0)
      FROM jsonb_array_elements(COALESCE(p_order_schemes, '[]'::jsonb)) AS os
      WHERE (os ->> 'scheme_id')::uuid = a.scheme_id
      LIMIT 1), 0), 0),
    GREATEST(a.denom, 0))
  WHERE true;

  SELECT COALESCE(SUM(amount), 0) INTO v_order_scheme_total FROM _order_scheme_alloc;

  -- pass 2: allocate order-level discounts pro-rata, tax, floor check.
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
        'is_scheme_goods',        s.is_scheme_goods,
        'scheme_id',              s.scheme_id,
        'min_price',              s.min_price,
        'effective_unit_price',   alloc.effective_unit,
        'floor_breached',         (NOT s.is_scheme_goods AND s.min_price IS NOT NULL AND alloc.effective_unit < s.min_price)
      ) AS line,
      CASE
        WHEN NOT s.is_scheme_goods AND s.min_price IS NOT NULL AND alloc.effective_unit < s.min_price
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
        SELECT LEAST(
                 -- manual order discount share
                 CASE WHEN v_base_sum > 0
                      THEN ROUND(v_order_discount * s.after_item / v_base_sum, 2)
                      ELSE 0 END
                 -- + this line's slice of every value slab that scopes it
                 + COALESCE((
                     SELECT SUM(CASE WHEN a.denom > 0
                                     THEN ROUND(a.amount * s.after_item / a.denom, 2)
                                     ELSE 0 END)
                     FROM _order_scheme_alloc a
                     WHERE s.position = ANY(a.positions)), 0),
                 s.after_item                       -- never take more than the line has
               ) AS share
      ) share_calc
    ) alloc
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN s.tax_mode = 'inclusive'
             THEN ROUND(alloc.native_after / (1 + s.tax_rate / 100.0), 2)
             ELSE alloc.native_after
        END AS net,
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
  v_discount_total := v_discount_total + v_scheme_line_total + v_order_discount + v_order_scheme_total;

  v_result := jsonb_build_object(
    'lines',            COALESCE(v_lines, '[]'::jsonb),
    'sub_total',        v_sub_total,
    'discount_total',   v_discount_total,
    'order_discount',   v_order_discount + v_order_scheme_total,
    'tax_total',        v_tax_total,
    'total_amount',     v_total,
    'classification',   v_classification,
    'floor_violations', COALESCE(v_violations, '[]'::jsonb),
    'enforce_floor',    v_enforce_floor,
    'valid',            NOT (v_enforce_floor AND v_violations IS NOT NULL),
    'calculated_at',    p_as_of,
    'engine_version',   3
  );

  DROP TABLE IF EXISTS _pricing_scratch;
  DROP TABLE IF EXISTS _order_scheme_alloc;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION calculate_order_pricing(uuid, uuid, jsonb, jsonb, timestamptz, jsonb) IS
'Single source of truth for order money. engine_version 3 (Phase 4): consumes CONFIRMED scheme effects — per-line scheme_id/scheme_discount_amount/is_scheme_goods and value-slab p_order_schemes. Slab resolution lives in detect_eligible_schemes, not here. Byte-identical to v2 when no scheme inputs are present.';
