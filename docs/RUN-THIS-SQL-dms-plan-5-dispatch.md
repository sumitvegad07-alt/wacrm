# Run this SQL — dispatch details in the portal

One block. After this, a distributor sees what has actually been sent.

## What it adds to his order screen

* **A "Sent" column** beside the quantity on every line. Ten ordered and four
  sent reads as four, in amber, so a short delivery is one glance rather than a
  phone call.
* **The loads themselves** — dispatch number, date, transporter, docket number
  and what was in each one. An order sent in two loads shows both.
* Nothing about a person. A transporter is a company and a docket is a number;
  no driver and no delivery boy is named.

It also teaches the portal **how each distributor collects** — the Direct /
Salesman / Both setting from the last block — so the payment form offers "my
salesman collected this" only where that is how the distributor actually works.

## What does NOT change

Nothing of yours. This replaces two read-only functions the portal already had
and adds no table, no column, no trigger and no policy. Your dispatch screens
are untouched.

## Tested before it reached you

Five scenarios on a throwaway copy: a part-dispatched line reads 1 of 3, the
load carries its number, date, transporter and docket, no person appears in it,
another distributor sees none of it, and — because one of these functions was
rewritten to add a field, and a rewrite is how a field goes missing — the
currency and timezone are asserted to still be there. That check earned its
keep: the rewrite had reached for the wrong currency column and would have
changed the symbol on every figure for any tenant not on rupees.

Open Supabase → SQL Editor → paste everything below, Run. Safe to run twice.

Source file: `supabase/migrations/20261116110000_portal_dispatch_and_route.sql`

```sql
-- ============================================================
-- What has actually been sent, and how this distributor collects.
--
-- Founder, 2026-11-15: "once the purchase order is placed and the order is
-- dispatched the dispatched details should be visible here in portal too
-- similar to our web admin portal like ordered quantity, dispatch quantity,
-- summary, dispatch details, order status and all."
--
-- Two changes, both to functions that already exist:
--
--   portal_order_detail  — every line gains dispatched_quantity, and the order
--                          gains a dispatches array: number, date, transporter,
--                          tracking and what was in each one.
--   portal_me            — returns the distributor's collection route, so the
--                          payment screen can show "my salesman collected this"
--                          only where the company has said that is how this
--                          distributor works.
--
-- TRANSPORT AND TRACKING ARE INCLUDED, and Plan 5 said they would not be. The
-- plan's line was "nothing about the vehicle, the driver or the delivery boy —
-- it is a person". A DRIVER is a person; a transporter's name and a docket
-- number are not, and they are the two things somebody chasing a late delivery
-- actually needs. No person is named by this file.
--
-- Five questions (WORKING-AGREEMENT):
--   second FK between two tables? no table is altered at all.
--   does a touched column appear in a .select() string? none is touched.
--   new trigger/policy/constraint on a written table? none.
--   can an existing row fail a new rule? there is no new rule over rows.
--   a tenant without the add-on? portal_caller() is empty for them, so both
--     functions answer as they always did: nothing.
-- ============================================================

-- ── 1. The order, with what has been sent ────────────────────
CREATE OR REPLACE FUNCTION public.portal_order_detail(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select jsonb_build_object(
           'id',             o.id,
           'order_number',   o.order_number,
           'date',           o.date,
           'customer_id',    o.contact_id,
           'customer_name',  coalesce(c.company, c.name),
           'classification', o.classification,
           'status',         o.status,
           'pricing_status', o.pricing_status,
           'notes',          o.notes,
           'sub_total',      o.sub_total,
           'discount_total', o.discount_total,
           'tax_total',      o.tax_total,
           'total_amount',   o.total_amount,
           'placed_via',     case when o.placed_by_portal_contact_id is not null
                                  then 'portal' else 'company' end,
           'lines', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'position',                oi.position,
                      'product_name',            oi.product_name,
                      'unit',                    oi.unit,
                      'quantity',                oi.quantity,
                      -- How much of this line has actually gone out. Summed
                      -- across every dispatch of this order, so a line sent in
                      -- two loads reads 10 of 10 and not 4.
                      'dispatched_quantity', coalesce((
                         select sum(di.quantity)
                           from public.dispatch_items di
                           join public.order_dispatches d on d.id = di.dispatch_id
                          where di.order_item_id = oi.id and d.order_id = o.id), 0),
                      'price',                   oi.price,
                      'discount_amount',         oi.discount_amount,
                      'scheme_discount_amount',  oi.scheme_discount_amount,
                      'is_scheme_goods',         oi.is_scheme_goods,
                      'tax_rate',                oi.tax_rate,
                      'tax_amount',              oi.tax_amount,
                      'sub_total',               oi.sub_total,
                      'total',                   oi.total
                    ) order by oi.position), '[]'::jsonb)
               from public.order_items oi where oi.order_id = o.id),
           -- The loads themselves, newest first. No person is named: a
           -- transporter is a company and a docket number is a number, and
           -- they are what somebody chasing a late delivery needs.
           'dispatches', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id',              d.id,
                      'dispatch_number', d.dispatch_number,
                      'dispatched_at',   d.dispatched_at,
                      'transport_name',  d.transport_name,
                      'tracking_number', d.tracking_number,
                      'notes',           d.notes,
                      'items', (
                        select coalesce(jsonb_agg(jsonb_build_object(
                                 'product_name', di.product_name,
                                 'unit',         di.unit,
                                 'quantity',     di.quantity)), '[]'::jsonb)
                          from public.dispatch_items di where di.dispatch_id = d.id)
                    ) order by d.dispatched_at desc, d.dispatch_number desc), '[]'::jsonb)
               from public.order_dispatches d where d.order_id = o.id)
         )
    from public.orders o
    left join public.contacts c on c.id = o.contact_id
   where o.id = p_order_id
     and o.contact_id = any(public.portal_visible_contact_ids());
$$;

ALTER FUNCTION public.portal_order_detail(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_order_detail(uuid) TO authenticated, service_role;

-- ── 2. portal_me learns the collection route ─────────────────
-- The screen needs it to decide whether to offer "my salesman collected this".
-- Rebuilt rather than patched, because the original is one jsonb_build_object
-- and there is nothing to patch into.
CREATE OR REPLACE FUNCTION public.portal_me()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select jsonb_build_object(
           'contact_id',          c.id,
           'account_id',          c.account_id,
           'name',                c.name,
           'company',             c.company,
           'phone',               c.phone,
           'email',               c.email,
           'address',             c.address,
           'city',                c.city,
           'state',               c.state,
           'hierarchy_level',     c.hierarchy_level,
           'credit_limit',        c.credit_limit,
           'outstanding_balance', c.outstanding_balance,
           'account_name',        a.name,
           -- a.default_currency, NOT settings->>'currency'. Rewriting this
           -- function from memory reached for the settings key and would have
           -- changed the currency symbol on every figure for any tenant not on
           -- INR - invisibly here, because this one IS on INR.
           'currency',            coalesce(a.default_currency, 'INR'),
           'timezone',            public.account_timezone(c.account_id),
           'collection_route',    coalesce(c.portal_collection_route, 'direct')
         )
    from public.portal_caller() pc
    join public.contacts c on c.id = pc.contact_id
    join public.accounts a on a.id = pc.account_id;
$$;

ALTER FUNCTION public.portal_me() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_me() TO authenticated, service_role;
```
