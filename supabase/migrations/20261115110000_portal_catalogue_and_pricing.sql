-- ============================================================
-- What a distributor may see of the catalogue, and what a line costs them.
--
-- Plan 4 Task 2, the half that does not write anything. Three reads:
-- portal_products (what can I order), portal_price_quote (what will it cost)
-- and portal_schemes_for (what is on offer). The order screen calls all three,
-- and portal_place_order afterwards.
--
-- THE PRICE IS NOT CALCULATED HERE. calculate_order_pricing has been the one
-- authority on price since migration 077, and detect_eligible_schemes since
-- 20260819160000. Both are called. A second copy of the arithmetic — even a
-- "simple" catalogue * (1 - discount) to price a product list — is how two
-- screens start disagreeing. The price list engine's own comment says where
-- that resolution lives: specific override > blanket > catalogue, in ONE place.
--
-- WHOSE PRICE. The buyer's, never the caller's (spec §7.2: the dealer is the
-- customer on that order, so the dealer's price list applies). Every function
-- here takes p_buyer_id and answers empty for one that is not in
-- portal_visible_contact_ids() — so a distributor cannot price-check a customer
-- they do not serve, let alone another tenant's.
--
-- WHAT IS STRIPPED OUT OF THE ENGINE'S ANSWER. products.min_price is the
-- company's price FLOOR, which is a margin signal, and the engine returns it
-- per line as min_price plus floor_breached, and per order as enforce_floor and
-- a floor_violations array naming the attempted price. No margin is ever shown
-- in the portal, so the quote is the engine's answer with those four keys
-- removed and `valid` kept: the screen still learns that something is wrong
-- without learning what the floor is.
--
-- Five questions (WORKING-AGREEMENT):
--   second FK between two tables? no — no table is altered at all.
--   does a touched column appear in a .select() string? nothing is touched.
--   new trigger/policy/constraint on a written table? none.
--   can an existing row fail a new rule? there is no new rule over rows.
--   what happens to a tenant without the add-on? account_has_line(.,'dms') is
--     false inside portal_caller(), so every function here answers empty.
-- ============================================================

-- NOT ONE OF THESE IS DECLARED STABLE, AND THAT IS DELIBERATE.
--
-- STABLE would read as the more careful choice — none of them writes anything a
-- caller can see. But PostgREST runs an IMMUTABLE or STABLE function inside a
-- READ ONLY transaction (and exposes it over GET), and both engines these
-- functions call — calculate_order_pricing and detect_eligible_schemes — begin
-- by creating TEMP TABLES. `CREATE TABLE` in a read-only transaction is an
-- error, so a STABLE marker here would work perfectly in psql and in every
-- scenario in supabase/tests, and fail for every real distributor the moment
-- the screen asked for a price. The marker is left off (so: volatile) for that
-- one reason. portal_normalize_lines keeps STABLE because it touches no engine
-- and creates nothing.
-- ── 0. What the browser is allowed to say about a line ───────
-- THREE FIELDS, and everything else about the line is looked up here: the
-- product, how many, and which unit they typed it in. The conversion factor is
-- read from product_unit_conversions and the tax mode from the account's own
-- order settings, because a browser that could send either could change the
-- price — a factor of 12 sent as 1 prices a box as a piece, and the engine
-- would price it faithfully.
--
-- Used by BOTH portal_price_quote and portal_place_order, so the total on the
-- screen and the total that is saved come from identical input. Two normalisers
-- would be two prices.
CREATE OR REPLACE FUNCTION public.portal_normalize_lines(
  p_account_id uuid,
  p_lines      jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  WITH acct AS (
    SELECT coalesce(nullif(a.settings->'order_settings'->>'tax_mode', ''), 'exclusive') AS tax_mode
      FROM public.accounts a WHERE a.id = p_account_id
  ),
  raw AS (
    SELECT (l->>'product_id')::uuid                            AS product_id,
           greatest(coalesce((l->>'quantity')::numeric, 0), 0)  AS quantity,
           (l->>'entered_unit_id')::uuid                        AS entered_unit_id,
           ord
      FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t(l, ord)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id',      r.product_id,
           'quantity',        r.quantity,
           -- A unit id that is not this product's own is dropped rather than
           -- honoured, and the line falls back to the base unit, factor 1.
           'entered_unit_id', puc.unit_id,
           'conversion_factor', coalesce(puc.conversion_factor, 1),
           'tax_mode',        (SELECT tax_mode FROM acct)
         ) ORDER BY r.ord), '[]'::jsonb)
    FROM raw r
    LEFT JOIN public.product_unit_conversions puc
           ON puc.product_id = r.product_id
          AND puc.unit_id    = r.entered_unit_id
          AND puc.account_id = p_account_id
          AND puc.active
   WHERE r.product_id IS NOT NULL
     AND r.quantity > 0;
$fn$;

ALTER FUNCTION public.portal_normalize_lines(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_normalize_lines(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_normalize_lines(uuid, jsonb) TO authenticated, service_role;

-- ── 1b. The offers, applied server-side ─────────────────────
-- WHAT THE READER MAY DECIDE, AND WHAT THEY MAY NOT. A money discount the
-- detector marks default_selected is applied without being asked - nobody
-- declines a discount. FREE GOODS are not: detect_eligible_schemes sets
-- default_selected FALSE for them on purpose (migration 20260908130000), because
-- free goods are stock somebody has to ship, and the admin app makes a salesman
-- tick them. The portal mirrors that with p_accept: a list of keys the reader
-- has ticked - "<position>:<scheme_id>" for a line offer, "order:<scheme_id>"
-- for a whole-order one, the same keys order-form.tsx uses.
--
-- An acceptance is a CHOICE, not a figure. The discount, the free product and
-- the quantity all still come from the detector, so a forged key can only accept
-- an offer that genuinely exists for these lines, and one that names an offer
-- that does not is ignored.
--
-- THE PORTAL DOES NOT SEND SCHEME DATA, IT IS GIVEN IT. The admin app lets a
-- salesman tick and untick each detected offer, so its browser sends scheme_id,
-- scheme_discount_amount and the free-goods lines. A distributor cannot be
-- allowed to do that — those fields move money — and portal_normalize_lines
-- strips them. So the offers are applied HERE instead, from the detector's own
-- answer, and every offer it marks default_selected is taken.
--
-- A distributor is therefore never offered the chance to DECLINE a discount,
-- which is the one way this differs from the salesman's screen. Nobody declines
-- a discount, and the alternative is a browser that can name its own.
--
-- The shape is copied from what the admin app builds (order-form.tsx): a money
-- line-scheme attaches scheme_id + scheme_discount_amount to its own line;
-- free goods become their own lines APPENDED AFTER the product lines, so the
-- positions a value-slab scheme refers to still point at the product lines; and
-- value-slab schemes go to create_order's p_order_schemes.
CREATE OR REPLACE FUNCTION public.portal_apply_schemes(
  p_account_id uuid,
  p_buyer_id   uuid,
  p_lines      jsonb,
  p_accept     jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_det    jsonb;
  v_lines  jsonb;
  v_free   jsonb;
  v_orders jsonb;
  v_keys   text[] := coalesce(
    (SELECT array_agg(k) FROM jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(coalesce(p_accept, '[]'::jsonb)) = 'array'
            THEN p_accept ELSE '[]'::jsonb END) k),
    '{}'::text[]);
BEGIN
  v_det := coalesce(
    public.detect_eligible_schemes(p_account_id, p_buyer_id, p_lines),
    jsonb_build_object('line_schemes', '[]'::jsonb, 'order_schemes', '[]'::jsonb));

  -- Money line-schemes, attached to the line they were detected for.
  SELECT coalesce(jsonb_agg(
           CASE WHEN ls.scheme_id IS NULL THEN t.ln
                ELSE t.ln || jsonb_build_object('scheme_id', ls.scheme_id,
                                                'scheme_discount_amount', ls.amount)
           END ORDER BY t.ord), '[]'::jsonb)
    INTO v_lines
    FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t(ln, ord)
    LEFT JOIN LATERAL (
      SELECT (s->>'scheme_id') AS scheme_id,
             coalesce((s->>'scheme_discount_amount')::numeric, 0) AS amount
        FROM jsonb_array_elements(coalesce(v_det->'line_schemes', '[]'::jsonb)) s
       WHERE (s->>'position')::int = t.ord
         AND coalesce(s->>'reward_type', '') <> 'free_goods'
         AND (coalesce((s->>'default_selected')::boolean, false)
              OR ((s->>'position') || ':' || (s->>'scheme_id')) = any(v_keys))
       LIMIT 1
    ) ls ON true;

  -- Free goods, as their own lines at the end.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id',      s->>'free_product_id',
           'quantity',        (s->>'free_qty')::numeric,
           'is_scheme_goods', true,
           'scheme_id',       s->>'scheme_id')), '[]'::jsonb)
    INTO v_free
    FROM jsonb_array_elements(coalesce(v_det->'line_schemes', '[]'::jsonb)) s
   WHERE coalesce(s->>'reward_type', '') = 'free_goods'
     AND (s->>'free_product_id') IS NOT NULL
     AND coalesce((s->>'free_qty')::numeric, 0) > 0
     AND (coalesce((s->>'default_selected')::boolean, false)
          OR ((s->>'position') || ':' || (s->>'scheme_id')) = any(v_keys));

  -- Whole-order (value slab) schemes.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'scheme_id',       s->>'scheme_id',
           'discount_amount', (s->>'discount_amount')::numeric,
           'positions',       s->'applies_to_positions')), '[]'::jsonb)
    INTO v_orders
    FROM jsonb_array_elements(coalesce(v_det->'order_schemes', '[]'::jsonb)) s
   WHERE coalesce((s->>'default_selected')::boolean, false)
      OR ('order:' || (s->>'scheme_id')) = any(v_keys);

  RETURN jsonb_build_object(
    'lines',         v_lines || v_free,
    'order_schemes', v_orders,
    -- The detector's own answer travels with it, so the screen can say
    -- "2 × Soap free" without asking a second time and getting a third answer.
    'offers',        jsonb_build_object('line_schemes', coalesce(v_det->'line_schemes', '[]'::jsonb),
                                        'order_schemes', coalesce(v_det->'order_schemes', '[]'::jsonb)));
END;
$fn$;

ALTER FUNCTION public.portal_apply_schemes(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_apply_schemes(uuid, uuid, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_apply_schemes(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.portal_apply_schemes(uuid, uuid, jsonb);

-- WHY search_path IS public AND NOT '' HERE.
-- Every read-only portal function pins search_path to the empty string and
-- qualifies every name itself, which is the strictest setting. A function that
-- WRITES cannot: the triggers on contacts (the customer-code generator, the
-- territory denormaliser, enforce_customer_parent) and the engines this gate
-- calls (create_order, calculate_order_pricing, detect_eligible_schemes) are
-- older plpgsql that names its tables unqualified, and a function it is called
-- from with an empty search_path makes every one of those fail with
-- `relation "accounts" does not exist` — which is exactly how the first run of
-- 71 and 72 aborted. `= public` is still a pin: the caller cannot change it,
-- and it is what every other SECURITY DEFINER function in this schema uses.
-- ── 1. The catalogue, priced for one buyer ───────────────────
-- One call to the engine for the whole page of products, each as a line of
-- quantity 1, and price_list_price read back off each line. That is the
-- buyer's own unit price by construction rather than by a formula repeated
-- here.
CREATE OR REPLACE FUNCTION public.portal_products(
  p_buyer_id uuid,
  p_search   text DEFAULT NULL,
  p_limit    int  DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_acct  uuid;
  v_ids   uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_multi boolean;
  v_prods jsonb;
  v_lines jsonb;
  v_calc  jsonb;
  v_rows  jsonb;
BEGIN
  SELECT account_id INTO v_acct FROM public.portal_caller();
  IF v_acct IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb);
  END IF;

  v_ids := public.portal_visible_contact_ids();
  IF p_buyer_id IS NULL OR NOT (p_buyer_id = any(v_ids)) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb);
  END IF;

  v_multi := public.multi_unit_enabled(v_acct);

  -- The page of products, in name order so the list is stable between calls.
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb) INTO v_prods FROM (
    SELECT jsonb_build_object(
             'id',       p.id,
             'name',     p.name,
             'sku',      p.sku,
             'unit',     p.unit,
             'tax_rate', coalesce(ts.rate, 0),
             -- Alternate units, only when the account runs Multi Unit. An
             -- account with it off sends no entered_unit_id and the engine
             -- treats every line as base units, factor 1.
             'units',    CASE WHEN v_multi THEN (
                           SELECT coalesce(jsonb_agg(jsonb_build_object(
                                    'id', pu.id, 'name', pu.name,
                                    'factor', puc.conversion_factor) ORDER BY pu.name), '[]'::jsonb)
                             FROM public.product_unit_conversions puc
                             JOIN public.product_units pu ON pu.id = puc.unit_id
                            WHERE puc.product_id = p.id AND puc.active AND pu.active
                         ) ELSE '[]'::jsonb END
           ) AS x
      FROM public.products p
      LEFT JOIN public.tax_slabs ts ON ts.id = p.tax_slab_id
     WHERE p.account_id = v_acct
       AND coalesce(p.active, true)
       AND (p_search IS NULL OR btrim(p_search) = ''
            OR p.name ILIKE '%' || btrim(p_search) || '%'
            OR coalesce(p.sku, '') ILIKE '%' || btrim(p_search) || '%')
     ORDER BY p.name
     LIMIT v_limit
  ) s;

  IF v_prods = '[]'::jsonb THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(jsonb_build_object('product_id', pr->>'id', 'quantity', 1))
    INTO v_lines FROM jsonb_array_elements(v_prods) pr;

  v_calc := public.calculate_order_pricing(v_acct, p_buyer_id, v_lines);

  -- Join the engine's answer back onto the catalogue row by product_id.
  SELECT coalesce(jsonb_agg(pr || jsonb_build_object('price',
           coalesce((SELECT (ln->>'price_list_price')::numeric
                       FROM jsonb_array_elements(v_calc->'lines') ln
                      WHERE ln->>'product_id' = pr->>'id'
                      LIMIT 1), 0))
         ORDER BY pr->>'name'), '[]'::jsonb)
    INTO v_rows FROM jsonb_array_elements(v_prods) pr;

  RETURN jsonb_build_object('rows', v_rows);
END;
$fn$;

ALTER FUNCTION public.portal_products(uuid, text, int) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_products(uuid, text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_products(uuid, text, int) TO authenticated, service_role;

-- ── 2. What will this order cost? ────────────────────────────
-- The engine's own answer, minus the four keys that describe the company's
-- price floor. Used for live totals on the order screen; the figure actually
-- saved is recalculated by create_order, so a tampered quote changes nothing
-- (scenario W8).
CREATE OR REPLACE FUNCTION public.portal_price_quote(
  p_buyer_id uuid,
  p_lines    jsonb,
  p_accept   jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_acct    uuid;
  v_ids     uuid[];
  v_applied jsonb;
  v_calc    jsonb;
  v_lines   jsonb;
BEGIN
  SELECT account_id INTO v_acct FROM public.portal_caller();
  IF v_acct IS NULL THEN
    RETURN NULL;
  END IF;

  v_ids := public.portal_visible_contact_ids();
  IF p_buyer_id IS NULL OR NOT (p_buyer_id = any(v_ids)) THEN
    RETURN NULL;
  END IF;

  -- No p_order_discount parameter: a distributor does not grant themselves a
  -- discount. The offers are not a parameter either — portal_apply_schemes
  -- takes them from the detector, so the quote shows the same offers the write
  -- will apply.
  v_applied := public.portal_apply_schemes(
                 v_acct, p_buyer_id,
                 public.portal_normalize_lines(v_acct, p_lines),
                 p_accept);

  v_calc := public.calculate_order_pricing(
              v_acct, p_buyer_id,
              v_applied->'lines',
              NULL, now(), v_applied->'order_schemes');

  SELECT coalesce(jsonb_agg((ln - 'min_price' - 'floor_breached') ORDER BY (ln->>'position')::int), '[]'::jsonb)
    INTO v_lines FROM jsonb_array_elements(coalesce(v_calc->'lines', '[]'::jsonb)) ln;

  RETURN (v_calc - 'floor_violations' - 'enforce_floor')
         || jsonb_build_object('lines', v_lines, 'offers', v_applied->'offers');
END;
$fn$;

ALTER FUNCTION public.portal_price_quote(uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_price_quote(uuid, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_price_quote(uuid, jsonb, jsonb) TO authenticated, service_role;

-- The two-argument draft must not survive beside it: two overloads, and
-- PostgREST picks whichever it likes.
DROP FUNCTION IF EXISTS public.portal_price_quote(uuid, jsonb);

-- ── 3. What is on offer? ─────────────────────────────────────
-- Schemes are in v1 for a correctness reason, not a feature one: the SQL
-- detector already exists, so a portal order that ignored it would be priced
-- WORSE than the identical order typed by a salesman, and the distributor
-- would notice.
CREATE OR REPLACE FUNCTION public.portal_schemes_for(
  p_buyer_id uuid,
  p_lines    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_acct uuid;
  v_ids  uuid[];
  v_none jsonb := jsonb_build_object('line_schemes', '[]'::jsonb, 'order_schemes', '[]'::jsonb);
BEGIN
  -- The detector answers an OBJECT — {line_schemes, order_schemes, as_of,
  -- engine_version} — so "nothing on offer" is that object with two empty
  -- arrays, never an empty array. A screen that read '[]' here would walk
  -- .line_schemes of an array and find undefined.
  SELECT account_id INTO v_acct FROM public.portal_caller();
  IF v_acct IS NULL THEN
    RETURN v_none;
  END IF;

  v_ids := public.portal_visible_contact_ids();
  IF p_buyer_id IS NULL OR NOT (p_buyer_id = any(v_ids)) THEN
    RETURN v_none;
  END IF;

  -- The same normaliser the quote and the write use, so the offer is made
  -- against the same lines that will be priced.
  RETURN coalesce(
    public.detect_eligible_schemes(v_acct, p_buyer_id,
      public.portal_normalize_lines(v_acct, p_lines)),
    v_none);
END;
$fn$;

ALTER FUNCTION public.portal_schemes_for(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_schemes_for(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_schemes_for(uuid, jsonb) TO authenticated, service_role;
