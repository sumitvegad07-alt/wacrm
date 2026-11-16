# Run this SQL — searchable filters on the portal's lists

One block, and the last of the list he gave me.

## What it gives a distributor

A **search box and a status filter** above Purchase orders, Sales orders, My
customers and Payments — the same idea as the filters on your own tables.

* Orders search the **order number** and the **customer's name**.
* Payments search the **receipt number**, the **reference** and the customer.
* Customers search the **name, business name, phone and city**.

It filters on the **server**, so it searches all 98 orders rather than the ten
on screen, the count under the table follows the filter, and the Export button
beside it carries the filtered set rather than the whole table. A filtered list
also has its own address, so it survives a reload and can be sent to somebody.

## What changes for your own team

Nothing. No table, no column, no trigger, no policy — three read-only functions
gain two optional arguments each.

## The one thing to know about timing

These three functions are **live right now**, and this block replaces them. The
portal has been written to send the new arguments **only when somebody actually
types in a filter box**, so the lists keep working whether or not this has been
run — an unfiltered list looks identical either way. Only the act of filtering
needs this paste.

## Tested before it reached you

Eight scenarios, built around the two ways a filter goes wrong: an **empty**
search must not filter at all, and a search that **matches nothing** must return
nothing rather than everything. Also that the count narrows with the rows (or
the pager lies), that the status match is exact, and that a filter cannot reach
another distributor's orders — the visibility rule still runs underneath it.

Writing those found a trap worth recording: inside the test files the portal
login can read no tables, so a scenario that works out its own expected answer
with a sub-query gets an empty one and fails for a reason that has nothing to do
with the filter. The expectations are now read before the role switches.

Open Supabase → SQL Editor → paste everything below, Run. Safe to run twice.

Source file: `supabase/migrations/20261116130000_portal_list_filters.sql`

```sql
-- ============================================================
-- Searchable filters on the portal's lists.
--
-- Founder, 2026-11-15: "all the tables view has no filtering option similar to
-- what we have in our OZZO table searchable filters on the tables in all
-- modules so make it too."
--
-- The CRM filters in the browser, through useServerTable, because it holds the
-- rows. The portal's lists are server components reading these functions, so a
-- filter has to reach the function — there is nowhere else for it to go.
--
-- THESE THREE FUNCTIONS ARE LIVE ON PRODUCTION. Appending an argument makes a
-- new OVERLOAD rather than replacing anything, and two overloads make PostgREST
-- answer "function is not unique". So each old signature is dropped by name at
-- the end of its section — and the portal app sends the new arguments only when
-- a filter is actually in use, so the lists keep working either side of this
-- paste rather than breaking in the window between the two.
--
-- WHAT "SEARCH" MEANS, PER LIST. Not a wildcard over everything: the two or
-- three columns somebody actually types into. Orders: the order number and the
-- customer's name. Payments: the receipt number, the reference and the
-- customer. Customers: the name, the business name, the phone and the city.
-- A LIKE over every column of a big table on Mumbai is a slow screen.
--
-- Five questions (WORKING-AGREEMENT):
--   second FK between two tables? no table is altered.
--   does a touched column appear in a .select() string? none is touched.
--   new trigger/policy/constraint on a written table? none.
--   can an existing row fail a new rule? no rule is applied to rows.
--   a tenant without the add-on? portal_visible_contact_ids() is '{}' for
--     them, so every list answers empty exactly as it does today.
-- ============================================================

-- ── 1. Orders ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_orders(
  p_kind   text DEFAULT 'all',
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_limit  int  DEFAULT 200,
  p_offset int  DEFAULT 0,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_me    uuid;
  v_ids   uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(btrim(coalesce(p_search, '')), '');
  v_st    text := nullif(btrim(coalesce(p_status, '')), '');
  v_total int;
  v_rows  jsonb;
BEGIN
  IF coalesce(p_kind, 'all') NOT IN ('all', 'purchase', 'sales') THEN
    RAISE EXCEPTION 'Unknown order kind. Use purchase, sales or all.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT contact_id INTO v_me FROM public.portal_caller();
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  END IF;
  v_ids := public.portal_visible_contact_ids();

  SELECT count(*) INTO v_total
    FROM public.orders o
    LEFT JOIN public.contacts c ON c.id = o.contact_id
   WHERE o.contact_id = any(v_ids)
     AND (p_kind = 'all'
       OR (p_kind = 'purchase' AND o.contact_id = v_me)
       OR (p_kind = 'sales'    AND o.contact_id IS DISTINCT FROM v_me))
     AND (p_from IS NULL OR o.date >= p_from)
     AND (p_to   IS NULL OR o.date <= p_to)
     AND (v_st IS NULL OR o.status = v_st)
     AND (v_q IS NULL
          OR o.order_number ILIKE '%' || v_q || '%'
          OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%');

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id',             o.id,
             'order_number',   o.order_number,
             'date',           o.date,
             'customer_id',    o.contact_id,
             'customer_name',  coalesce(c.company, c.name),
             'classification', o.classification,
             'status',         o.status,
             'pricing_status', o.pricing_status,
             'total_amount',   o.total_amount,
             'item_count',     (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id),
             'placed_via',     CASE WHEN o.placed_by_portal_contact_id IS NOT NULL
                                    THEN 'portal' ELSE 'company' END
           ) AS x
      FROM public.orders o
      LEFT JOIN public.contacts c ON c.id = o.contact_id
     WHERE o.contact_id = any(v_ids)
       AND (p_kind = 'all'
         OR (p_kind = 'purchase' AND o.contact_id = v_me)
         OR (p_kind = 'sales'    AND o.contact_id IS DISTINCT FROM v_me))
       AND (p_from IS NULL OR o.date >= p_from)
       AND (p_to   IS NULL OR o.date <= p_to)
       AND (v_st IS NULL OR o.status = v_st)
       AND (v_q IS NULL
            OR o.order_number ILIKE '%' || v_q || '%'
            OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%')
     ORDER BY o.date DESC, o.order_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$fn$;

ALTER FUNCTION public.portal_orders(text, date, date, int, int, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_orders(text, date, date, int, int, text, text)
  TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.portal_orders(text, date, date, int, int);

-- ── 2. Payments ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_payments(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_limit  int  DEFAULT 200,
  p_offset int  DEFAULT 0,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_ids   uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(btrim(coalesce(p_search, '')), '');
  v_st    text := nullif(btrim(coalesce(p_status, '')), '');
  v_total int;
  v_rows  jsonb;
BEGIN
  v_ids := public.portal_visible_contact_ids();
  IF v_ids = '{}'::uuid[] THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  END IF;

  SELECT count(*) INTO v_total
    FROM public.payments p
    LEFT JOIN public.contacts c ON c.id = p.contact_id
   WHERE p.contact_id = any(v_ids)
     AND (p_from IS NULL OR p.payment_date >= p_from)
     AND (p_to   IS NULL OR p.payment_date <= p_to)
     AND (v_st IS NULL OR p.status = v_st)
     AND (v_q IS NULL
          OR p.payment_number ILIKE '%' || v_q || '%'
          OR coalesce(p.reference_number, '') ILIKE '%' || v_q || '%'
          OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%');

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id',               p.id,
             'payment_number',   p.payment_number,
             'payment_date',     p.payment_date,
             'customer_id',      p.contact_id,
             'customer_name',    coalesce(c.company, c.name),
             'amount',           p.amount,
             'verified_amount',  p.verified_amount,
             'payment_type',     p.payment_type,
             'status',           p.status,
             'reference_number', p.reference_number
           ) AS x
      FROM public.payments p
      LEFT JOIN public.contacts c ON c.id = p.contact_id
     WHERE p.contact_id = any(v_ids)
       AND (p_from IS NULL OR p.payment_date >= p_from)
       AND (p_to   IS NULL OR p.payment_date <= p_to)
       AND (v_st IS NULL OR p.status = v_st)
       AND (v_q IS NULL
            OR p.payment_number ILIKE '%' || v_q || '%'
            OR coalesce(p.reference_number, '') ILIKE '%' || v_q || '%'
            OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%')
     ORDER BY p.payment_date DESC, p.payment_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$fn$;

ALTER FUNCTION public.portal_payments(date, date, int, int, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_payments(date, date, int, int, text, text)
  TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.portal_payments(date, date, int, int);

-- ── 3. Customers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_customers(
  p_search        text DEFAULT NULL,
  p_buying_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  select coalesce(jsonb_agg(x order by x ->> 'hierarchy_level', x ->> 'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id',                  c.id,
               'name',                c.name,
               'company',             c.company,
               'phone',               c.phone,
               'city',                c.city,
               'state',               c.state,
               'hierarchy_level',     c.hierarchy_level,
               'parent_id',           c.parent_id,
               'parent_name',         p.name,
               'is_active',           c.is_active,
               'buying_status',       c.buying_status,
               'outstanding_balance', c.outstanding_balance,
               'credit_limit',        c.credit_limit,
               'has_portal_login',    (c.portal_user_id is not null
                                        and c.portal_access
                                        and c.portal_access_revoked_at is null)
             ) as x
        from public.contacts c
        left join public.contacts p on p.id = c.parent_id
       where c.id = any(public.portal_visible_contact_ids())
         and c.id is distinct from (select contact_id from public.portal_caller())
         and (nullif(btrim(coalesce(p_buying_status, '')), '') is null
              or c.buying_status = btrim(p_buying_status))
         and (nullif(btrim(coalesce(p_search, '')), '') is null
              or c.name    ilike '%' || btrim(p_search) || '%'
              or coalesce(c.company, '') ilike '%' || btrim(p_search) || '%'
              or coalesce(c.phone, '')   ilike '%' || btrim(p_search) || '%'
              or coalesce(c.city, '')    ilike '%' || btrim(p_search) || '%')
    ) s;
$fn$;

ALTER FUNCTION public.portal_customers(text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_customers(text, text) TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.portal_customers();
```
