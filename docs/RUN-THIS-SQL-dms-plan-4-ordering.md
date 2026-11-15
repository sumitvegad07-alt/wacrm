# Run this SQL — let a distributor place an order

This is the big one: after this, a distributor can send you an order themselves
instead of telephoning it in.

**Nothing changes for your own team.** No screen of yours changes, no existing
order changes, and no setting of yours is switched on by this. It adds five new
functions and nothing else. A company without the DMS add-on is untouched.

## What a distributor can do afterwards

Open **New order**, choose whether the order is for their own business or for one
of the shops they supply, search your catalogue, type quantities, and send it.
The order arrives in your normal Orders list as **Pending**, with **Placed via:
Portal** on it. There is no separate inbox to remember to check.

## Who works out the price — you do

Every figure on that screen is worked out by your database, by the same code that
prices an order your own salesman types on his phone:

* the price is the **buyer's** price list, so a shop on special rates gets its
  own rates, not the distributor's;
* your schemes are offered on the same terms your salesman would see them, and
  free goods have to be ticked before they are added, exactly as he has to tick
  them;
* nothing about the money is accepted from the portal. The screen may send only
  the product, the quantity and the unit. A page that has been tampered with
  cannot change a price, a discount, a free gift or a total.

If the price moved between the moment the distributor was shown a total and the
moment they pressed Send, the order is saved at **your current price** and marked
for review, so you see the disagreement before you dispatch rather than after.

## What they cannot do

* Order for a customer who is not theirs, or for another company's customer.
* Order for a customer you have **blacklisted** — and they are not told why,
  because the reason is your note to yourself.
* Choose the date. The order is always dated today, in your own timezone, so
  nobody can move an order into last month.
* Order a product you have switched off, or one that belongs to another company.
* Place the same order twice by tapping Send twice on a slow connection: the
  second tap finds the first order and does nothing.

## Who gets the sales credit

By default the order is credited to **the rep who owns that customer**, which is
what keeps your dashboards, reports and lists working the way they do today — a
portal login is not an employee, so an order left in its name shows a blank
salesman and disappears from the rep responsible for that beat.

If you would rather a portal order counted as nobody's sale, that is one setting
away and I can switch it for you. **Placed via: Portal** records the truth either
way.

## Tested before it reached you

Thirty-five scenarios on a throwaway copy of your database, including every
refusal above, and each rule tested twice: once to see it work, and once with the
rule deliberately removed to prove the test would have caught its absence.

## Part 1 of 2 — the catalogue and the price

Open Supabase → SQL Editor → paste everything below, Run. Safe to run twice.

Source file: `supabase/migrations/20261115110000_portal_catalogue_and_pricing.sql`

```sql
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
```

## Part 2 of 2 — placing the order

Run this one after Part 1, in the same place.

Source file: `supabase/migrations/20261115120000_portal_place_order.sql`

```sql
-- ============================================================
-- A distributor places an order.
--
-- Founder, 2026-11-14: "Currently there is no option for placing a new order."
-- Plan 4 Task 2. Spec §7.
--
-- THIS IS A GATE, NOT A SECOND ORDER PATH. create_order has been the one way an
-- order is written since migration 068, and it is what the CRM and the Android
-- app call: it prices the order with calculate_order_pricing, numbers it,
-- classifies it primary/secondary, replays idempotently on a retried submit and
-- records a variance for review. None of that is reimplemented here. What this
-- function does is answer five questions BEFORE handing the order to it, and
-- stamp two columns afterwards.
--
-- THE OFFERS ARE APPLIED HERE, NOT SENT. portal_apply_schemes asks the same
-- detector the quote screen asked and takes every offer it marks
-- default_selected, so a distributor gets the schemes a salesman would have
-- ticked for them — and cannot name a scheme, or its discount, itself.
--
-- NO MONEY COMES IN FROM THE BROWSER. The only line fields this accepts are
-- product, quantity and the unit it was typed in (portal_normalize_lines reads
-- the conversion factor and the tax mode itself). Prices, discounts, totals and
-- scheme amounts are the database's own answer, so there is no figure a tampered
-- payload could move. p_quoted_total is the exception and it is advisory: it is
-- what the screen last SHOWED the distributor, kept only so that a price that
-- changed between quoting and saving is logged and the order is held for review
-- instead of quietly costing more than the number they agreed to.
--
-- WHO GETS THE SALES CREDIT — spec §7.5, a per-tenant setting.
-- accounts.settings.dms_settings.portal_order_sales_credit:
--   'dealer_salesman' (DEFAULT) — orders.user_id becomes the rep who owns the
--      buyer's contact row, which is what every existing policy, dashboard,
--      report and list already reads. A portal user has no profiles row, so
--      leaving them on the order makes the Salesman column blank AND hides the
--      order from the rep responsible for that beat, because the web and mobile
--      lists scope by user_id in the client. Invisible orders are a worse fault
--      than a credited rep, and this way nothing existing changes shape.
--   'portal' — leave the portal login on the order. Honest about who typed it,
--      at the price above. A company running incentives on booked orders may
--      want this; it is one setting away either way.
-- placed_by_portal_contact_id always records the truth, whichever is chosen, and
-- the Orders list's "Placed via" column reads it (migration 20261107140000).
--
-- WHAT A REFUSAL SAYS. An order that cannot be placed RAISES rather than
-- returning null: a submit button that silently does nothing is how the same
-- order gets typed three times. The message is in the founder's plain English
-- and short, because qa_refused only keeps the first 70 characters. A
-- blacklisted buyer is refused WITHOUT the reason (spec §12): the reason is the
-- company's note to itself.
--
-- Five questions (WORKING-AGREEMENT):
--   second FK between two tables? no. placed_by_portal_contact_id already
--     exists (20261107140000) and is the only orders->contacts FK besides
--     contact_id, which is the pair 2026-11-06 proved is survivable; nothing new
--     is added here.
--   does a touched column appear in a .select() string? orders.user_id and
--     placed_by_portal_contact_id do, in both repos, and both keep their type
--     and meaning. No column is renamed or dropped.
--   new trigger/policy/constraint on a written table? none. Only functions.
--   can an existing row fail a new rule? no rule is applied to existing rows.
--   what happens to a tenant without the add-on? portal_caller() is empty, so
--     the function raises for them and nothing else changes. No CRM behaviour
--     moves for any tenant: this file adds one function.
-- ============================================================

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
CREATE OR REPLACE FUNCTION public.portal_place_order(
  p_order_id     uuid,
  p_buyer_id     uuid,
  p_date         date    DEFAULT NULL,
  p_lines        jsonb   DEFAULT '[]'::jsonb,
  p_notes        text    DEFAULT NULL,
  p_quoted_total numeric DEFAULT NULL,
  p_accept       jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller    uuid;
  v_acct      uuid;
  v_ids       uuid[];
  v_existing  record;
  v_today     date;
  v_lines     jsonb;
  v_applied   jsonb;
  v_bad       int;
  v_result    jsonb;
  v_expected  numeric;
  v_credit    text;
  v_owner     uuid;
BEGIN
  -- 1. Is this a portal login at all? portal_caller() is empty for an employee,
  --    for a revoked login, and for an account whose DMS add-on was taken away
  --    (it checks account_has_line itself), so this one question covers three
  --    of the plan's five checks. A second copy of the add-on check here would
  --    be a rule whose removal broke nothing.
  SELECT contact_id, account_id INTO v_caller, v_acct FROM public.portal_caller();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'You cannot place orders. Ask your company.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'This order has no id.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 2. Whose order is this? Only themselves, or someone below them.
  v_ids := public.portal_visible_contact_ids();
  IF p_buyer_id IS NULL OR NOT (p_buyer_id = any(v_ids)) THEN
    RAISE EXCEPTION 'That customer is not one of yours.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3. A retried submit must replay, not duplicate — and must not become a way
  --    to read somebody else's order. create_order replays by id and returns
  --    the existing order NUMBER, so without this check a guessed id would hand
  --    an outsider a real order number from another tenant.
  SELECT o.id, o.order_number, o.contact_id, o.pricing_status
    INTO v_existing FROM public.orders o WHERE o.id = p_order_id;
  IF v_existing.id IS NOT NULL THEN
    IF NOT (v_existing.contact_id = any(v_ids)) THEN
      RAISE EXCEPTION 'That order is not yours.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN jsonb_build_object(
      'order_id', v_existing.id, 'order_number', v_existing.order_number,
      'pricing_status', v_existing.pricing_status, 'idempotent_replay', true);
  END IF;

  -- 4. A blacklisted buyer cannot be ordered for, and is not told why.
  IF EXISTS (SELECT 1 FROM public.contacts c
              WHERE c.id = p_buyer_id AND c.buying_status = 'blacklist') THEN
    RAISE EXCEPTION 'Orders are blocked for this customer. Ask your company.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 5. The lines, normalised, then every product checked. An inactive or
  --    deleted product is refused rather than priced at zero.
  v_lines := public.portal_normalize_lines(v_acct, p_lines);
  IF v_lines = '[]'::jsonb THEN
    RAISE EXCEPTION 'Add at least one product.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_lines) ln
   WHERE NOT EXISTS (
     SELECT 1 FROM public.products p
      WHERE p.id = (ln->>'product_id')::uuid
        AND p.account_id = v_acct
        AND coalesce(p.active, true));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'A product on this order is not available.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 6. The date is today in the ACCOUNT's own day, never the browser's. A
  --    distributor choosing the date is a distributor moving an order into last
  --    month, which moves money between two months' reports.
  v_today := (now() AT TIME ZONE public.account_timezone(v_acct))::date;
  IF p_date IS NOT NULL AND p_date <> v_today THEN
    RAISE EXCEPTION 'An order can only be dated today.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 7. Apply the offers, from the detector rather than from the browser, and
  --    hand the result to the one order path. The quote screen applied exactly
  --    the same function to exactly the same lines, so the reader has already
  --    seen this price.
  v_applied := public.portal_apply_schemes(v_acct, p_buyer_id, v_lines, p_accept);

  v_result := public.create_order(
                p_order_id      => p_order_id,
                p_account_id    => v_acct,
                p_contact_id    => p_buyer_id,
                p_site_visit_id => NULL,
                p_date          => v_today,
                p_lines         => v_applied->'lines',
                p_order_discount  => NULL,
                p_client_breakdown => CASE WHEN p_quoted_total IS NULL THEN NULL
                                          ELSE jsonb_build_object('total_amount', p_quoted_total,
                                                                  'engine_version', 5) END,
                p_source        => 'online',
                p_notes         => p_notes,
                p_platform      => 'portal',
                p_app_version   => NULL,
                p_order_schemes => v_applied->'order_schemes');

  -- 8. Stamp who placed it, and decide the sales credit.
  v_credit := coalesce(
    nullif((SELECT a.settings->'dms_settings'->>'portal_order_sales_credit'
              FROM public.accounts a WHERE a.id = v_acct), ''),
    'dealer_salesman');

  IF v_credit = 'dealer_salesman' THEN
    SELECT c.user_id INTO v_owner FROM public.contacts c WHERE c.id = p_buyer_id;
  END IF;

  UPDATE public.orders
     SET placed_by_portal_contact_id = v_caller,
         user_id = coalesce(v_owner, user_id)
   WHERE id = p_order_id;

  -- 9. Did the price move between the quote and the save? The saved figure is
  --    the database's either way — create_order re-priced it — so this does not
  --    change a number. It holds the order for review, because a distributor who
  --    agreed to one total and is invoiced another has a dispute, and the
  --    company should see it before dispatch, not after.
  v_expected := (v_result->>'expected_total')::numeric;
  IF p_quoted_total IS NOT NULL AND v_expected IS NOT NULL
     AND abs(p_quoted_total - v_expected) > 0.01 THEN
    UPDATE public.orders
       SET pricing_status = 'review',
           pricing_variance = coalesce(pricing_variance, '[]'::jsonb) || jsonb_build_object(
             'kind', 'portal_quote_changed',
             'quoted_total', p_quoted_total,
             'expected_total', v_expected,
             'note', 'The price changed between the portal quote and this order. The current price was saved; check it before dispatch.')
     WHERE id = p_order_id;
    v_result := v_result || jsonb_build_object('pricing_status', 'review');
  END IF;

  RETURN v_result;
END;
$fn$;

ALTER FUNCTION public.portal_place_order(uuid, uuid, date, jsonb, text, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_place_order(uuid, uuid, date, jsonb, text, numeric, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_place_order(uuid, uuid, date, jsonb, text, numeric, jsonb) TO authenticated, service_role;

-- Earlier drafts of this signature must not survive beside it. Two overloads
-- and PostgREST answers "function is not unique" — which is how this file
-- failed once already — and the draft that took the schemes THEMSELVES as a
-- parameter is the one that would let a browser name its own discount, so both
-- are dropped by name rather than left to chance.
DROP FUNCTION IF EXISTS public.portal_place_order(uuid, uuid, date, jsonb, jsonb, text, numeric);
DROP FUNCTION IF EXISTS public.portal_place_order(uuid, uuid, date, jsonb, text, numeric);

COMMENT ON FUNCTION public.portal_place_order(uuid, uuid, date, jsonb, text, numeric, jsonb) IS
  'The DMS portal''s only write to orders. A gate in front of create_order: '
  'checks the login, the buyer, replay, the blacklist, the products and the '
  'date, then stamps placed_by_portal_contact_id and the sales credit.';
```
