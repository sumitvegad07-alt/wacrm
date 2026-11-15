-- ============================================================
-- 2026-11-15 — a distributor places an order. Plan 4 Task 2.
--
-- Spec §15 item 5 is the release gate: an order may be placed only for
-- yourself or someone below you, and the money on it must be the database's
-- own answer rather than anything the browser said.
--
-- Reuses the tree 70_portal_visibility.sql builds:
--
--   Tenant A                              Tenant B
--     DIST_A1  (login PORTAL_U_A1)          DIST_B1 (login PORTAL_U_B1)
--       STK_A1 -> DLR_A1
--     DIST_A2  (login PORTAL_U_A2)
--       DLR_A2
--
-- Ids this file owns: products dd…c1/c2, price list aa11…1f, orders ee…f1-f9.
-- Nothing in the 64000000xx phone block is touched (that is 71's).
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ACCT_B '''bbbb0000-0000-0000-0000-000000000002'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''
\set ADMIN_B '''22220000-0000-0000-0000-000000000001'''

\set PORTAL_U_A1 '''00000000-0000-0000-0000-00000000a001'''
\set PORTAL_U_A2 '''00000000-0000-0000-0000-00000000a002'''
\set PORTAL_U_B1 '''00000000-0000-0000-0000-00000000b001'''

\set DIST_A1 '''cc000000-0000-0000-0000-0000000000a1'''
\set DIST_A2 '''cc000000-0000-0000-0000-0000000000a2'''
\set STK_A1  '''cc000000-0000-0000-0000-0000000000a3'''
\set DLR_A1  '''cc000000-0000-0000-0000-0000000000a4'''
\set DLR_A2  '''cc000000-0000-0000-0000-0000000000a5'''
\set DIST_B1 '''cc000000-0000-0000-0000-0000000000b1'''

\set PROD_C1 '''dd000000-0000-0000-0000-0000000000c1'''
\set PROD_C2 '''dd000000-0000-0000-0000-0000000000c2'''
\set PROD_B  '''dd000000-0000-0000-0000-0000000000b1'''
\set PLIST   '''aa110000-0000-0000-0000-00000000001f'''
\set SCHEME  '''bb110000-0000-0000-0000-00000000002f'''

\set ORD_F1 '''ee000000-0000-0000-0000-0000000000f1'''
\set ORD_F2 '''ee000000-0000-0000-0000-0000000000f2'''
\set ORD_F3 '''ee000000-0000-0000-0000-0000000000f3'''
\set ORD_F4 '''ee000000-0000-0000-0000-0000000000f4'''
\set ORD_F5 '''ee000000-0000-0000-0000-0000000000f5'''
\set ORD_F6 '''ee000000-0000-0000-0000-0000000000f6'''
\set ORD_F7 '''ee000000-0000-0000-0000-0000000000f7'''
\set ORD_F8 '''ee000000-0000-0000-0000-0000000000f8'''
\set ORD_F9 '''ee000000-0000-0000-0000-0000000000f9'''
\set ORD_FA '''ee000000-0000-0000-0000-0000000000fa'''
\set ORD_FB '''ee000000-0000-0000-0000-0000000000fb'''
\set ORD_FC '''ee000000-0000-0000-0000-0000000000fc'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

-- Clean anything a previous run left behind.
DELETE FROM public.order_items WHERE order_id IN (:ORD_F1,:ORD_F2,:ORD_F3,:ORD_F4,:ORD_F5,:ORD_F6,:ORD_F7,:ORD_F8,:ORD_F9,:ORD_FA,:ORD_FB,:ORD_FC);
DELETE FROM public.orders WHERE id IN (:ORD_F1,:ORD_F2,:ORD_F3,:ORD_F4,:ORD_F5,:ORD_F6,:ORD_F7,:ORD_F8,:ORD_F9,:ORD_FA,:ORD_FB,:ORD_FC);
DELETE FROM public.pricing_drift_log WHERE order_id IN (:ORD_F1,:ORD_F2,:ORD_F3,:ORD_F4,:ORD_F5,:ORD_F6,:ORD_F7,:ORD_F8,:ORD_F9,:ORD_FA,:ORD_FB,:ORD_FC);
UPDATE public.contacts SET price_list_id = NULL WHERE id IN (:DIST_A1, :STK_A1);
DELETE FROM public.price_list_items WHERE price_list_id = :PLIST;
DELETE FROM public.price_lists WHERE id = :PLIST;
DELETE FROM public.scheme_products WHERE scheme_id = :SCHEME;
DELETE FROM public.scheme_slabs WHERE scheme_id = :SCHEME;
DELETE FROM public.schemes WHERE id = :SCHEME;
DELETE FROM public.products WHERE id IN (:PROD_C1, :PROD_C2);

-- One sellable product at 100, and one the company has switched off.
INSERT INTO public.products (id, account_id, user_id, name, sku, price, active) VALUES
  (:PROD_C1, :ACCT_A, :ADMIN_A, 'Order Product C1', 'OP-C1', 100, true),
  (:PROD_C2, :ACCT_A, :ADMIN_A, 'Order Product C2', 'OP-C2', 100, false);

-- The add-on and a clean settings block. 70 leaves the add-on on, but this
-- file must not depend on the order the suite happens to run in.
UPDATE public.accounts SET addon_lines = ARRAY['dms'] WHERE id IN (:ACCT_A, :ACCT_B);
UPDATE public.accounts
   SET settings = COALESCE(settings, '{}'::jsonb) - 'dms_settings'
 WHERE id = :ACCT_A;

-- ── W0: the volatility trap that no scenario could otherwise see ──
-- PostgREST runs an IMMUTABLE or STABLE function in a READ ONLY transaction,
-- and both pricing engines begin by creating TEMP TABLES. So a STABLE marker on
-- any function that reaches an engine passes every test in this file and fails
-- for every real distributor the moment the screen asks for a price. psql
-- cannot reproduce that, so the marker itself is what gets asserted.
SELECT qa('W0 no portal function that reaches a pricing engine is STABLE',
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('portal_products', 'portal_price_quote',
                         'portal_schemes_for', 'portal_apply_schemes',
                         'portal_place_order')
       AND p.provolatile <> 'v'),
  'these must be volatile: '
  -- provolatile is "char", not text, and `text || "char"` is ambiguous in
  -- Postgres ("operator is not unique") — which aborted this whole file once.
  || coalesce((SELECT string_agg(p.proname || '=' || p.provolatile::text, ', ')
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                  AND p.proname IN ('portal_products', 'portal_price_quote',
                                    'portal_schemes_for', 'portal_apply_schemes',
                                    'portal_place_order')
                  AND p.provolatile <> 'v'), 'none'));

-- ── W1/W2: for myself, and for someone below me ──────────────
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT public.portal_place_order(
  :ORD_F1::uuid, :DIST_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 3))
) AS r \gset w1_

SELECT qa('W1 a distributor places their own purchase order',
  (:'w1_r'::jsonb ->> 'order_id') = trim(both '''' from :'ORD_F1')
  AND (:'w1_r'::jsonb ->> 'order_number') IS NOT NULL,
  'returned ' || :'w1_r');

SELECT qa_allowed('W2 and one for a customer below them',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f2'::uuid,
       'cc000000-0000-0000-0000-0000000000a3'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 2))) $$);

-- ── W3/W4: not yours, and not your tenant's ──────────────────
SELECT qa_refused('W3 but not for another distributor''s customer',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f3'::uuid,
       'cc000000-0000-0000-0000-0000000000a5'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 1))) $$);

SELECT qa_refused('W4 nor for a customer in another tenant',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f3'::uuid,
       'cc000000-0000-0000-0000-0000000000b1'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 1))) $$);

RESET ROLE;
SELECT qa('W3b and neither attempt wrote anything',
  NOT EXISTS (SELECT 1 FROM public.orders WHERE id = :ORD_F3),
  'a refused order must leave no row — assert the ROW, not the error');

-- ── W5: a blacklisted buyer, and the reason stays private ────
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT public.set_buying_status(:DLR_A1, 'blacklist', 'Cheques keep bouncing');

SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa_refused('W5 a blacklisted customer cannot be ordered for',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f4'::uuid,
       'cc000000-0000-0000-0000-0000000000a4'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 1))) $$);

SELECT qa('W5b and the reason was never sent to the portal',
  (SELECT detail FROM public.qa_results
    WHERE scenario = 'W5 a blacklisted customer cannot be ordered for'
    ORDER BY id DESC LIMIT 1) NOT LIKE '%bouncing%'
  AND public.portal_customers()::text NOT LIKE '%bouncing%',
  'spec §12: the blacklist reason is the company''s note to itself');

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT public.set_buying_status(:DLR_A1, 'yet_to_buy', NULL);

-- ── W6: the add-on is gone ───────────────────────────────────
UPDATE public.accounts SET addon_lines = '{}' WHERE id = :ACCT_A;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa_refused('W6 an account without the DMS add-on cannot place orders',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f5'::uuid,
       'cc000000-0000-0000-0000-0000000000a1'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 1))) $$);

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
UPDATE public.accounts SET addon_lines = ARRAY['dms'] WHERE id = :ACCT_A;

-- ── W7: a revoked login ──────────────────────────────────────
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_access = false, portal_access_revoked_at = now()
 WHERE id = :DIST_A1;
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa_refused('W7 a revoked login cannot place an order',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f5'::uuid,
       'cc000000-0000-0000-0000-0000000000a1'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 1))) $$);

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_access = true, portal_access_revoked_at = NULL
 WHERE id = :DIST_A1;
RESET ROLE;

-- ── W8: a tampered total changes no money ────────────────────
-- The quoted total says 1, the real price is 100 x 4. The order is saved at
-- the database's figure and held for review.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT public.portal_place_order(
  :ORD_F6::uuid, :DIST_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 4)),
  NULL, 1.00
) AS r \gset w8_

RESET ROLE;
SELECT qa('W8 a tampered total is overwritten by the database''s own price',
  (SELECT total_amount FROM public.orders WHERE id = :ORD_F6) = 400,
  'saw ' || (SELECT total_amount FROM public.orders WHERE id = :ORD_F6)::text);

SELECT qa('W8b ... and the order is held for review, saying why',
  (SELECT pricing_status FROM public.orders WHERE id = :ORD_F6) = 'review'
  AND (SELECT pricing_variance::text FROM public.orders WHERE id = :ORD_F6) LIKE '%portal_quote_changed%',
  'a distributor who agreed to one total and is invoiced another has a dispute');

-- ── W9/W10: it is an ordinary order ──────────────────────────
SELECT qa('W9 the order lands in the normal Orders list as Pending',
  (SELECT status FROM public.orders WHERE id = :ORD_F1) = 'Pending'
  AND (SELECT count(*) FROM public.order_items WHERE order_id = :ORD_F1) = 1,
  'spec §7.3: no separate inbox');

SELECT qa('W10 placed_by_portal_contact_id is the caller, not the buyer',
  (SELECT placed_by_portal_contact_id FROM public.orders WHERE id = :ORD_F2) = :DIST_A1::uuid
  AND (SELECT contact_id FROM public.orders WHERE id = :ORD_F2) = :STK_A1::uuid,
  'the dealer is the customer; the distributor is who typed it');

SELECT qa('W10b the sales credit defaults to the rep who owns the buyer',
  (SELECT user_id FROM public.orders WHERE id = :ORD_F2)
  = (SELECT user_id FROM public.contacts WHERE id = :STK_A1),
  'spec §7.5 default: a portal login on orders.user_id hides the order from the rep');

-- ── W11: a retried submit replays ────────────────────────────
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT public.portal_place_order(
  :ORD_F1::uuid, :DIST_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 3))
) AS r \gset w11_

RESET ROLE;
SELECT qa('W11 the same order id twice makes ONE order',
  (:'w11_r'::jsonb ->> 'idempotent_replay') = 'true'
  AND (SELECT count(*) FROM public.order_items WHERE order_id = :ORD_F1) = 1,
  'a retried submit is how one order becomes three');

SELECT set_config('test.uid', :PORTAL_U_A2, false);
SET ROLE authenticated;
SELECT qa_refused('W11b and a replay cannot be used to read somebody else''s order',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f1'::uuid,
       'cc000000-0000-0000-0000-0000000000a2'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 1))) $$);

-- ── W12: the BUYER's price list, not the caller's ────────────
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
INSERT INTO public.price_lists (id, account_id, name, blanket_discount_percent, active)
VALUES (:PLIST, :ACCT_A, 'Portal Test List 25pc', 25, true);
UPDATE public.contacts SET price_list_id = :PLIST WHERE id = :STK_A1;

SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT public.portal_place_order(
  :ORD_F7::uuid, :STK_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 2))
) AS r \gset w12_

-- The quote is taken HERE, as the portal user, so the comparison below is
-- between what the screen would have shown and what the order holds.
SELECT public.portal_price_quote(:STK_A1::uuid,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 2))) AS q \gset w12q_

RESET ROLE;
SELECT qa('W12 the buyer''s own price list is used, not the distributor''s',
  (SELECT total_amount FROM public.orders WHERE id = :ORD_F7) = 150,
  'STK_A1 is on 25% off, DIST_A1 is on none: 2 x 75 = 150, saw '
  || (SELECT total_amount FROM public.orders WHERE id = :ORD_F7)::text);

SELECT qa('W12b and the quote the screen shows agrees with what was saved',
  (:'w12q_q'::jsonb ->> 'total_amount')::numeric
  = (SELECT total_amount FROM public.orders WHERE id = :ORD_F7),
  'quote said ' || (:'w12q_q'::jsonb ->> 'total_amount')
  || ' — two prices on one screen is how a portal stops being believed');

SELECT qa('W12c the quote never carries the company''s price floor',
  :'w12q_q' NOT LIKE '%min_price%'
  AND :'w12q_q' NOT LIKE '%floor_violations%'
  AND :'w12q_q' NOT LIKE '%enforce_floor%',
  'min_price and floor_violations are margin signals');

UPDATE public.contacts SET price_list_id = NULL WHERE id = :STK_A1;

-- ── W13: schemes are the same ones a salesman would get ──
-- A real scheme, because an equality between two empty lists proves only that
-- both are empty. Buy 10 of C1, get 2 of C1 free — the commonest FMCG offer
-- there is, and the one the detector returns as free_goods.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

INSERT INTO public.schemes (id, account_id, name, scheme_type, slab_mode, target_type,
                            priority, starts_on, active)
VALUES (:SCHEME, :ACCT_A, 'Portal Test Buy 10 Get 2', 'quantity_slab', 'step_up', 'all',
        0, CURRENT_DATE - 1, true);
INSERT INTO public.scheme_slabs (scheme_id, min_qty, max_qty, reward_type, free_product_id, free_qty)
VALUES (:SCHEME, 10, NULL, 'free_goods', :PROD_C1, 2);
INSERT INTO public.scheme_products (scheme_id, product_id) VALUES (:SCHEME, :PROD_C1);

-- The portal's answer, taken as the portal user.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT public.portal_schemes_for(:DIST_A1::uuid,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 10))) AS s \gset w13_

SELECT qa('W13 the distributor is offered the free goods a salesman would see',
  (:'w13_s'::jsonb -> 'line_schemes' -> 0 ->> 'reward_type') = 'free_goods'
  AND (:'w13_s'::jsonb -> 'line_schemes' -> 0 ->> 'free_qty')::numeric = 2
  -- NOT default_selected, and that is the admin app's own rule: free goods are
  -- stock somebody has to ship, so a salesman ticks them. The portal offers
  -- them the same way rather than helping itself.
  AND (:'w13_s'::jsonb -> 'line_schemes' -> 0 ->> 'default_selected')::boolean = false,
  'saw ' || left(:'w13_s', 200));

-- The detector's own answer, taken as postgres - which is the privilege the
-- definer wrapper runs with. As the PORTAL user it would answer nothing at all,
-- because RLS hides every scheme row from an outsider, and an equality between
-- two empty lists is not a test. Two statements and not one: the detector drops
-- its own temp tables at the start, and in a single statement those tables are
-- still owned by whichever definer call ran first ("must be owner of table
-- _det_lines"), which is how this file first aborted.
RESET ROLE;
SELECT public.detect_eligible_schemes(:ACCT_A::uuid, :DIST_A1::uuid,
  public.portal_normalize_lines(:ACCT_A::uuid,
    jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 10)))) AS s \gset w13d_

-- as_of is now() in both answers and the calls are microseconds apart, so the
-- comparison is of the two offer lists rather than of the whole object.
SELECT qa('W13b and it is the detector''s answer, not a portal version of it',
  (:'w13_s'::jsonb - 'as_of' - 'engine_version')
  = (:'w13d_s'::jsonb - 'as_of' - 'engine_version'),
  'a portal order priced without the scheme costs MORE than the same order typed by a salesman');

-- Not ticked, so not applied: one line, no free goods.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT public.portal_place_order(
  :ORD_FA::uuid, :DIST_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 10))
) AS r \gset w13p_

RESET ROLE;
SELECT qa('W13c an offer nobody ticked is not applied',
  (SELECT count(*) FROM public.order_items WHERE order_id = :ORD_FA) = 1
  AND (SELECT total_amount FROM public.orders WHERE id = :ORD_FA) = 1000,
  'items=' || (SELECT count(*) FROM public.order_items WHERE order_id = :ORD_FA)::text
  || ' total=' || (SELECT total_amount FROM public.orders WHERE id = :ORD_FA)::text);

-- Ticked, so applied: the free line lands at no charge and the total is the
-- same, because free goods are goods and not a discount.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT public.portal_place_order(
  :ORD_FB::uuid, :DIST_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 10)),
  NULL, NULL,
  jsonb_build_array('1:' || trim(both '''' from :'SCHEME'))
) AS r \gset w13q_

RESET ROLE;
SELECT qa('W13d a ticked offer puts the free goods ON the order, at zero',
  (SELECT count(*) FROM public.order_items WHERE order_id = :ORD_FB) = 2
  AND (SELECT sum(quantity) FROM public.order_items
        WHERE order_id = :ORD_FB AND is_scheme_goods) = 2
  AND (SELECT sum(total) FROM public.order_items
        WHERE order_id = :ORD_FB AND is_scheme_goods) = 0
  AND (SELECT total_amount FROM public.orders WHERE id = :ORD_FB) = 1000,
  'items=' || (SELECT count(*) FROM public.order_items WHERE order_id = :ORD_FB)::text
  || ' total=' || (SELECT total_amount FROM public.orders WHERE id = :ORD_FB)::text);

SELECT qa('W13e the scheme is recorded on the free line, so the company sees why',
  (SELECT scheme_id FROM public.order_items
    WHERE order_id = :ORD_FB AND is_scheme_goods LIMIT 1) = :SCHEME::uuid);

-- A tick is a CHOICE, never a figure. Accepting an offer that does not exist
-- for these lines buys nothing - the free product, the quantity and the
-- discount all still come from the detector.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT public.portal_place_order(
  :ORD_FC::uuid, :DIST_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 1)),
  NULL, NULL,
  jsonb_build_array('1:' || trim(both '''' from :'SCHEME'),
                    '1:bb110000-0000-0000-0000-0000000000ff',
                    'order:bb110000-0000-0000-0000-0000000000ff')
) AS r \gset w13r_

RESET ROLE;
SELECT qa('W13f a tick for an offer that does not apply is ignored',
  (SELECT count(*) FROM public.order_items WHERE order_id = :ORD_FC) = 1
  AND (SELECT total_amount FROM public.orders WHERE id = :ORD_FC) = 100,
  'one of 1 unit is below the scheme''s slab of 10, so there is nothing to tick; saw total='
  || (SELECT total_amount FROM public.orders WHERE id = :ORD_FC)::text);

SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('W13g and no offer is made for a customer who is not theirs',
  public.portal_schemes_for(:DLR_A2::uuid,
    jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 10)))
  = jsonb_build_object('line_schemes', '[]'::jsonb, 'order_schemes', '[]'::jsonb),
  'and the shape is the one the screen expects, not an empty array');

-- ── W14: a product that cannot be sold ───────────────────────
SELECT qa_refused('W14 a product the company has switched off is refused',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f8'::uuid,
       'cc000000-0000-0000-0000-0000000000a1'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c2', 'quantity', 1))) $$);

SELECT qa_refused('W14b and so is another tenant''s product',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f8'::uuid,
       'cc000000-0000-0000-0000-0000000000a1'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000b1', 'quantity', 1))) $$);

SELECT qa_refused('W14c an order with no lines at all is refused',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f8'::uuid,
       'cc000000-0000-0000-0000-0000000000a1'::uuid, NULL, '[]'::jsonb) $$);

-- ── W15: nothing about the money comes from the browser ──────
-- A forged conversion factor would price a box as a piece. The factor is read
-- from product_unit_conversions, so a line that invents one is priced as base
-- units: 2 x 100, not 2 x 100 x 12.
SELECT public.portal_place_order(
  :ORD_F9::uuid, :DIST_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object(
    'product_id', :PROD_C1, 'quantity', 2,
    'conversion_factor', 12, 'price', 1, 'price_list_price', 1,
    'discount_type', 'percent', 'discount_value', 90,
    'total', 1, 'is_scheme_goods', true))
) AS r \gset w15_

RESET ROLE;
SELECT qa('W15 a line''s invented factor, price and discount are all ignored',
  (SELECT total_amount FROM public.orders WHERE id = :ORD_F9) = 200
  AND (SELECT discount_amount FROM public.order_items WHERE order_id = :ORD_F9) = 0
  AND NOT (SELECT is_scheme_goods FROM public.order_items WHERE order_id = :ORD_F9),
  '2 x 100 with no discount; saw '
  || (SELECT total_amount FROM public.orders WHERE id = :ORD_F9)::text);

-- ── W16: the date is the account's today ─────────────────────
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa_refused('W16 an order cannot be dated yesterday or tomorrow',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f8'::uuid,
       'cc000000-0000-0000-0000-0000000000a1'::uuid, CURRENT_DATE - 30,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 1))) $$);

RESET ROLE;
SELECT qa('W16b and the one that was placed carries the account''s own day',
  (SELECT date FROM public.orders WHERE id = :ORD_F1)
  = (now() AT TIME ZONE public.account_timezone(:ACCT_A))::date,
  'never the browser''s day, and never UTC''s');

-- ── W17: the sales credit setting ────────────────────────────
SELECT set_config('test.uid', :ADMIN_A, false);
-- Built with || and not jsonb_set: see the note in 71 — jsonb_set cannot make
-- the dms_settings object that is missing here, and the setting would silently
-- stay at its default.
UPDATE public.accounts
   SET settings = COALESCE(settings, '{}'::jsonb)
       || jsonb_build_object('dms_settings',
            COALESCE(settings->'dms_settings', '{}'::jsonb)
            || jsonb_build_object('portal_order_sales_credit', 'portal'))
 WHERE id = :ACCT_A;

SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT public.portal_place_order(
  :ORD_F8::uuid, :STK_A1::uuid, NULL,
  jsonb_build_array(jsonb_build_object('product_id', :PROD_C1, 'quantity', 1))
) AS r \gset w17_

RESET ROLE;
SELECT qa('W17 with the setting on "portal", the login keeps the order',
  (SELECT user_id FROM public.orders WHERE id = :ORD_F8) = :PORTAL_U_A1::uuid
  AND (SELECT placed_by_portal_contact_id FROM public.orders WHERE id = :ORD_F8) = :DIST_A1::uuid,
  'the company chooses; the truth about who typed it is recorded either way');

-- ── W18: nobody else can call these at all ───────────────────
SELECT set_config('test.uid', :ADMIN_A, false);
SET ROLE authenticated;
SELECT qa_refused('W18 an employee who found the function is refused',
  $$ SELECT public.portal_place_order(
       'ee000000-0000-0000-0000-0000000000f8'::uuid,
       'cc000000-0000-0000-0000-0000000000a1'::uuid, NULL,
       jsonb_build_array(jsonb_build_object('product_id', 'dd000000-0000-0000-0000-0000000000c1', 'quantity', 1))) $$);

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_B1, false);
SET ROLE authenticated;
SELECT qa('W18b and the other tenant''s catalogue is empty to them',
  public.portal_products(:DIST_A1::uuid) -> 'rows' = '[]'::jsonb,
  'the buyer is not theirs, so there is nothing to price');

-- ── Put the tenant back the way the next file expects ────────
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
DELETE FROM public.scheme_products WHERE scheme_id = :SCHEME;
DELETE FROM public.scheme_slabs WHERE scheme_id = :SCHEME;
DELETE FROM public.schemes WHERE id = :SCHEME;
UPDATE public.accounts
   SET settings = COALESCE(settings, '{}'::jsonb) - 'dms_settings'
 WHERE id = :ACCT_A;
