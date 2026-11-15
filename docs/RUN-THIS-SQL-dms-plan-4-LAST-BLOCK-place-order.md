# Run this SQL — the last block, and ordering is finished

You ran everything except this one. Of the eighteen functions the portal needs,
seventeen are on the database; the missing one is **`portal_place_order`**, and
it is the one that actually writes the order.

So right now a distributor can build an order on screen, see the right prices
and the right total, press **Send order** — and get "something went wrong and
the order was not saved", because there is nothing on the database to save it.
Nothing is broken and nothing is half-saved: the order simply never starts.

This is Part 2 of the ordering document, by itself, so there is no second block
to miss this time.

Open Supabase → SQL Editor → paste everything below, Run. Safe to run twice.

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

## How to check it worked

Run this afterwards. It should say one row:

```sql
select proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'portal_place_order';
```

Then place a small order from the portal and look for it in your own Orders
list. It arrives as **Pending** with **Placed via: Portal**, exactly like an
order your own team typed, and you approve and dispatch it the same way.

## While you are there

The other paste you ran also switched on **"let distributors add their own
customers"**, so the **Add customer** button should now be on their My
customers screen. If it is not there, reload the page once.
