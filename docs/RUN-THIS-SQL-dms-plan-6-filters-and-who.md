# Run this SQL — a filter on every column, and who booked or collected it

> **This is block 1 of 3.** Run it first — the other two use the small helpers it
> creates. The other two are `RUN-THIS-SQL-dms-plan-6-dispatch.md` (block 2) and
> `RUN-THIS-SQL-dms-plan-6-reports.md` (block 3). Nothing breaks if you only run
> this one; the other two sections simply keep saying "not switched on yet".

One block. Copy everything between the two lines near the bottom, paste it into
Supabase → **SQL Editor** → **Run**.

## What it gives a distributor

**A filter box under every heading.** Not one search box above the table — a
row of controls under the headings, one per column, exactly like the tables in
your own OZZO:

* **Order / Receipt number, Customer, Reference** — type a few letters.
* **Status, Mode, Placed via, Buying status** — tick one or several.
* **Total, Amount, Owes you** — From and To, because searching 100 in a money
  column also finds 1,100, which is not what anybody means.
* **Date** — Today, Yesterday, Last 7 days, This month, Last month, This
  quarter, This financial year, or two dates of their own.

A filter that is on shows as a small blue tag with an × on it, so a distributor
can always see **why** a list is short, and clear it with one click.

**Two new columns: "Booked by" and "Collected by."**

* On the order lists — who wrote the order down. An order the distributor
  placed himself shows his own business name.
* On the payments list — who took the money in. This is the one that matters:
  a distributor who can see ₹5,000 collected from a shop but not who is holding
  it cannot chase it.

## This changes a decision you made on 7 November

You ruled then that **no employee is ever named to a distributor**, and the
portal was built that way. You asked for Booked by and Collected by on
16 November, and you are right to — but it is a reversal, so it is worth saying
plainly what has and has not changed:

* **What a distributor now sees:** the person's **name**. Nothing else.
* **What is still hidden:** their phone number, their email, their employee
  code, their role, their territory, and every other employee they never dealt
  with. There is a test that reads the whole payload and fails the build if any
  of those appear.

If you want it back the way it was, say so and it comes out in one block.

## What does NOT change for your own team

Nothing. No table, no column, no trigger, no policy. It replaces five read-only
functions the portal already had and adds four small helpers they use.

Every filter is **optional** — a screen that sends none gets exactly the list it
got yesterday — so your own OZZO, your mobile app and the portal all keep
working either side of this paste.

**A distributor still cannot reach anything that is not theirs.** Every filter
runs *inside* the rule that decides which customers they may see, never beside
it: filtering for a shop in another distributor's area, or in another company,
finds nothing.

## How it is safe from a typed-in web address

The filters travel as one labelled bag of values. Nothing in that bag is ever
pasted into a database instruction — each value is read by name and checked for
its type first. A hand-typed amount of `1; drop table orders` is simply not a
number, so it becomes **no filter at all**: no error, no damage, and the list
carries on.

## After it runs

Open **dms.ozzo.co.in** and look at Sales orders. There should be a row of
boxes under the headings, a **Booked by** column, and on Payments a
**Collected by** column.

If the boxes are there but typing in one changes nothing, the block did not run
— come back and run it again.

---

```sql
-- OZZO DMS Plan 6, group A — a filter on every column, and who did it.
--
-- Founder, 2026-11-16:
--   "I want searchable filters on each raw on the table not the universal"
--   "Build collected by/booked by column."
--
-- ─────────────────────────────────────────────────────────────
-- THE FIVE QUESTIONS (working agreement, 2026-11-06)
--
-- 1. Does this add a second foreign key between two tables that already have
--    one?  NO.  This migration adds no column, no table and no constraint.  It
--    replaces five functions and adds four pure helpers.
--
-- 2. Does it touch a column that appears in a `.select()` string in either
--    repo?  It READS `orders.salesman_name`, `payments.user_id`,
--    `profiles.full_name` and `payment_handovers.by_contact_id`, and changes
--    none of them.  The two new keys — `booked_by_name` and
--    `collected_by_name` — are ADDED to a jsonb payload; a key added to a
--    jsonb object cannot break a reader that does not look for it, which is
--    why the portal's lists carry their columns in jsonb rather than as a
--    composite type.
--
-- 3. Does it add a trigger, policy or constraint to a written table?  NO.
--
-- 4. Can an existing row fail a new rule?  There is no new rule.  Every new
--    argument defaults to NULL and NULL means "do not filter", so a caller
--    that passes nothing gets exactly the list it got yesterday.
--
-- 5. What happens to a tenant who has not configured any of this?  Nothing.
--    `p_filters` defaults to NULL; `salesman_name` is already maintained for
--    every tenant by `trg_orders_denormalise` (20261012100000); a payment with
--    no profile row behind its `user_id` reads NULL and the screen says
--    "Company", exactly as it did before.
--
-- ─────────────────────────────────────────────────────────────
-- WHY ONE jsonb ARGUMENT AND NOT ONE ARGUMENT PER COLUMN
--
-- Orders would need seven new arguments and payments eight.  Every new
-- argument list means `DROP FUNCTION <old signature>` on deploy, and between
-- the CREATE and the DROP a running portal can call a signature that no longer
-- exists — which is exactly how `portal_place_order` came to answer 404 for a
-- week.  One jsonb bag is added once and never again.
--
-- It is not a SQL injection surface: NOTHING inside it is interpolated.  Each
-- key is read by name through a typed helper below, and a key the function
-- does not name is ignored.  `amount_min=1; drop table orders` fails the
-- numeric helper's regex and becomes NULL — no filter, no cast error, no SQL.
-- ─────────────────────────────────────────────────────────────

-- ── 0. The four typed readers ────────────────────────────────
-- STABLE rather than IMMUTABLE: `to_date` is not immutable, and a function
-- that lies about its volatility is a planner bug waiting for a partial index.

CREATE OR REPLACE FUNCTION public.portal_filter_text(p_filters jsonb, p_key text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO ''
AS $fn$
  SELECT nullif(btrim(coalesce(p_filters ->> p_key, '')), '')
$fn$;

-- A multi-select.  An empty array is NOT an empty filter set that matches
-- nothing — it means the reader ticked nothing, so it means no filter.
CREATE OR REPLACE FUNCTION public.portal_filter_list(p_filters jsonb, p_key text)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path TO ''
AS $fn$
  SELECT CASE
           WHEN p_filters IS NULL THEN NULL
           WHEN jsonb_typeof(p_filters -> p_key) <> 'array' THEN NULL
           ELSE nullif(
                  ARRAY(SELECT btrim(v)
                          FROM jsonb_array_elements_text(p_filters -> p_key) AS t(v)
                         WHERE btrim(v) <> ''),
                  '{}'::text[])
         END
$fn$;

-- A money bound.  Anything that is not a plain number is no filter at all,
-- which is both the safe answer and the honest one.
CREATE OR REPLACE FUNCTION public.portal_filter_num(p_filters jsonb, p_key text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO ''
AS $fn$
  SELECT CASE
           WHEN public.portal_filter_text(p_filters, p_key) ~ '^-?[0-9]+(\.[0-9]+)?$'
             THEN public.portal_filter_text(p_filters, p_key)::numeric
         END
$fn$;

-- An ISO date.  The regex pins the shape first so `to_date` can never raise;
-- `to_date` rather than `::date` so a nonsense day cannot abort the whole list.
CREATE OR REPLACE FUNCTION public.portal_filter_date(p_filters jsonb, p_key text)
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO ''
AS $fn$
  SELECT CASE
           WHEN public.portal_filter_text(p_filters, p_key) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             THEN to_date(public.portal_filter_text(p_filters, p_key), 'YYYY-MM-DD')
         END
$fn$;

REVOKE ALL ON FUNCTION public.portal_filter_text(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_filter_list(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_filter_num(jsonb, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_filter_date(jsonb, text) FROM PUBLIC;
ALTER FUNCTION public.portal_filter_text(jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.portal_filter_list(jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.portal_filter_num(jsonb, text)  OWNER TO postgres;
ALTER FUNCTION public.portal_filter_date(jsonb, text) OWNER TO postgres;

-- ── 1. Orders: per-column filters and "Booked by" ────────────
--
-- BOOKED BY reverses spec §17 q4 (2026-11-07, "no employee is ever named to a
-- distributor") on the founder's own instruction of 2026-11-16, and only as
-- far as the NAME.  No employee code, no phone, no role, no territory — a
-- distributor whose retailer disputes a quantity needs to know who wrote it
-- down, and nothing else.
--
-- `orders.salesman_name` is already denormalised on the row (20261012100000),
-- so this is a column read and not a join.  An order the distributor placed
-- themselves names THEM, not an employee: they booked it.
CREATE OR REPLACE FUNCTION public.portal_orders(
  p_kind    text  DEFAULT 'all',
  p_from    date  DEFAULT NULL,
  p_to      date  DEFAULT NULL,
  p_limit   int   DEFAULT 200,
  p_offset  int   DEFAULT 0,
  p_search  text  DEFAULT NULL,
  p_status  text  DEFAULT NULL,
  p_filters jsonb DEFAULT NULL
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
  -- Per-column filters, read once so the count pass and the rows pass cannot
  -- drift apart.  The two WHERE clauses below are the same text twice; that is
  -- deliberate and the variables are what keep it true.
  v_f_number text   := public.portal_filter_text(p_filters, 'order_number');
  v_f_cust   text   := public.portal_filter_text(p_filters, 'customer_name');
  v_f_booked text   := public.portal_filter_text(p_filters, 'booked_by_name');
  v_f_status text[] := public.portal_filter_list(p_filters, 'status');
  v_f_class  text[] := public.portal_filter_list(p_filters, 'classification');
  v_f_via    text[] := public.portal_filter_list(p_filters, 'placed_via');
  v_f_from   date   := public.portal_filter_date(p_filters, 'date_from');
  v_f_to     date   := public.portal_filter_date(p_filters, 'date_to');
  v_f_min    numeric := public.portal_filter_num(p_filters, 'total_amount_min');
  v_f_max    numeric := public.portal_filter_num(p_filters, 'total_amount_max');
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
    LEFT JOIN public.contacts c  ON c.id  = o.contact_id
    LEFT JOIN public.contacts pb ON pb.id = o.placed_by_portal_contact_id
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
     AND (v_f_number IS NULL OR o.order_number ILIKE '%' || v_f_number || '%')
     AND (v_f_cust   IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_f_cust || '%')
     AND (v_f_booked IS NULL
          OR coalesce(pb.company, pb.name, o.salesman_name, '') ILIKE '%' || v_f_booked || '%')
     AND (v_f_status IS NULL OR o.status = any(v_f_status))
     AND (v_f_class  IS NULL OR o.classification = any(v_f_class))
     AND (v_f_via    IS NULL
          OR (CASE WHEN o.placed_by_portal_contact_id IS NOT NULL
                   THEN 'portal' ELSE 'company' END) = any(v_f_via))
     AND (v_f_from IS NULL OR o.date >= v_f_from)
     AND (v_f_to   IS NULL OR o.date <= v_f_to)
     AND (v_f_min  IS NULL OR coalesce(o.total_amount, 0) >= v_f_min)
     AND (v_f_max  IS NULL OR coalesce(o.total_amount, 0) <= v_f_max);

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
                                    THEN 'portal' ELSE 'company' END,
             -- The name and nothing else.
             'booked_by_name', coalesce(pb.company, pb.name, o.salesman_name)
           ) AS x
      FROM public.orders o
      LEFT JOIN public.contacts c  ON c.id  = o.contact_id
      LEFT JOIN public.contacts pb ON pb.id = o.placed_by_portal_contact_id
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
       AND (v_f_number IS NULL OR o.order_number ILIKE '%' || v_f_number || '%')
       AND (v_f_cust   IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_f_cust || '%')
       AND (v_f_booked IS NULL
            OR coalesce(pb.company, pb.name, o.salesman_name, '') ILIKE '%' || v_f_booked || '%')
       AND (v_f_status IS NULL OR o.status = any(v_f_status))
       AND (v_f_class  IS NULL OR o.classification = any(v_f_class))
       AND (v_f_via    IS NULL
            OR (CASE WHEN o.placed_by_portal_contact_id IS NOT NULL
                     THEN 'portal' ELSE 'company' END) = any(v_f_via))
       AND (v_f_from IS NULL OR o.date >= v_f_from)
       AND (v_f_to   IS NULL OR o.date <= v_f_to)
       AND (v_f_min  IS NULL OR coalesce(o.total_amount, 0) >= v_f_min)
       AND (v_f_max  IS NULL OR coalesce(o.total_amount, 0) <= v_f_max)
     ORDER BY o.date DESC, o.order_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$fn$;

ALTER FUNCTION public.portal_orders(text, date, date, int, int, text, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_orders(text, date, date, int, int, text, text, jsonb)
  TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.portal_orders(text, date, date, int, int, text, text);

-- ── 2. Payments: per-column filters and "Collected by" ───────
--
-- COLLECTED BY is the accountability chain, not a nicety: a distributor who
-- can see that ₹5,000 was collected from a shop but not who is holding it
-- cannot chase it.  Plan 5 §0 is the research that settles it.
--
-- Two sources, because a portal-recorded receipt carries the SHOP'S OWN REP in
-- `payments.user_id` (portal_record_payment sets it from `contacts.user_id`,
-- since a portal login has no profile).  Reading `user_id` alone would name an
-- employee who never touched the money.  So: a receipt whose `source` is
-- 'customer' is named from the first handover's `by_contact_id`, which IS the
-- party that entered it; everything else resolves through `profiles`.
CREATE OR REPLACE FUNCTION public.portal_payments(
  p_from    date  DEFAULT NULL,
  p_to      date  DEFAULT NULL,
  p_limit   int   DEFAULT 200,
  p_offset  int   DEFAULT 0,
  p_search  text  DEFAULT NULL,
  p_status  text  DEFAULT NULL,
  p_filters jsonb DEFAULT NULL
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
  v_f_number text   := public.portal_filter_text(p_filters, 'payment_number');
  v_f_cust   text   := public.portal_filter_text(p_filters, 'customer_name');
  v_f_ref    text   := public.portal_filter_text(p_filters, 'reference_number');
  v_f_by     text   := public.portal_filter_text(p_filters, 'collected_by_name');
  v_f_status text[] := public.portal_filter_list(p_filters, 'status');
  v_f_type   text[] := public.portal_filter_list(p_filters, 'payment_type');
  v_f_from   date   := public.portal_filter_date(p_filters, 'date_from');
  v_f_to     date   := public.portal_filter_date(p_filters, 'date_to');
  v_f_min    numeric := public.portal_filter_num(p_filters, 'amount_min');
  v_f_max    numeric := public.portal_filter_num(p_filters, 'amount_max');
  v_total int;
  v_rows  jsonb;
BEGIN
  v_ids := public.portal_visible_contact_ids();
  IF v_ids = '{}'::uuid[] THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  END IF;

  SELECT count(*) INTO v_total
    FROM public.payments p
    LEFT JOIN public.contacts c  ON c.id = p.contact_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.user_id AND pr.account_id = p.account_id
    LEFT JOIN LATERAL (
      SELECT h.by_contact_id
        FROM public.payment_handovers h
       WHERE h.payment_id = p.id AND h.by_contact_id IS NOT NULL
       ORDER BY h.seq
       LIMIT 1
    ) hv ON TRUE
    LEFT JOIN public.contacts hc ON hc.id = hv.by_contact_id
   WHERE p.contact_id = any(v_ids)
     AND (p_from IS NULL OR p.payment_date >= p_from)
     AND (p_to   IS NULL OR p.payment_date <= p_to)
     AND (v_st IS NULL OR p.status = v_st)
     AND (v_q IS NULL
          OR p.payment_number ILIKE '%' || v_q || '%'
          OR coalesce(p.reference_number, '') ILIKE '%' || v_q || '%'
          OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%')
     AND (v_f_number IS NULL OR coalesce(p.payment_number, '') ILIKE '%' || v_f_number || '%')
     AND (v_f_cust   IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_f_cust || '%')
     AND (v_f_ref    IS NULL OR coalesce(p.reference_number, '') ILIKE '%' || v_f_ref || '%')
     AND (v_f_by     IS NULL
          OR coalesce(CASE WHEN p.source = 'customer' THEN coalesce(hc.company, hc.name) END,
                      pr.full_name, '') ILIKE '%' || v_f_by || '%')
     AND (v_f_status IS NULL OR p.status = any(v_f_status))
     AND (v_f_type   IS NULL OR p.payment_type = any(v_f_type))
     AND (v_f_from IS NULL OR p.payment_date >= v_f_from)
     AND (v_f_to   IS NULL OR p.payment_date <= v_f_to)
     AND (v_f_min  IS NULL OR coalesce(p.amount, 0) >= v_f_min)
     AND (v_f_max  IS NULL OR coalesce(p.amount, 0) <= v_f_max);

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
             'reference_number', p.reference_number,
             'collected_by_name',
               coalesce(CASE WHEN p.source = 'customer' THEN coalesce(hc.company, hc.name) END,
                        pr.full_name)
           ) AS x
      FROM public.payments p
      LEFT JOIN public.contacts c  ON c.id = p.contact_id
      LEFT JOIN public.profiles pr ON pr.user_id = p.user_id AND pr.account_id = p.account_id
      LEFT JOIN LATERAL (
        SELECT h.by_contact_id
          FROM public.payment_handovers h
         WHERE h.payment_id = p.id AND h.by_contact_id IS NOT NULL
         ORDER BY h.seq
         LIMIT 1
      ) hv ON TRUE
      LEFT JOIN public.contacts hc ON hc.id = hv.by_contact_id
     WHERE p.contact_id = any(v_ids)
       AND (p_from IS NULL OR p.payment_date >= p_from)
       AND (p_to   IS NULL OR p.payment_date <= p_to)
       AND (v_st IS NULL OR p.status = v_st)
       AND (v_q IS NULL
            OR p.payment_number ILIKE '%' || v_q || '%'
            OR coalesce(p.reference_number, '') ILIKE '%' || v_q || '%'
            OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%')
       AND (v_f_number IS NULL OR coalesce(p.payment_number, '') ILIKE '%' || v_f_number || '%')
       AND (v_f_cust   IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_f_cust || '%')
       AND (v_f_ref    IS NULL OR coalesce(p.reference_number, '') ILIKE '%' || v_f_ref || '%')
       AND (v_f_by     IS NULL
            OR coalesce(CASE WHEN p.source = 'customer' THEN coalesce(hc.company, hc.name) END,
                        pr.full_name, '') ILIKE '%' || v_f_by || '%')
       AND (v_f_status IS NULL OR p.status = any(v_f_status))
       AND (v_f_type   IS NULL OR p.payment_type = any(v_f_type))
       AND (v_f_from IS NULL OR p.payment_date >= v_f_from)
       AND (v_f_to   IS NULL OR p.payment_date <= v_f_to)
       AND (v_f_min  IS NULL OR coalesce(p.amount, 0) >= v_f_min)
       AND (v_f_max  IS NULL OR coalesce(p.amount, 0) <= v_f_max)
     ORDER BY p.payment_date DESC, p.payment_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$fn$;

ALTER FUNCTION public.portal_payments(date, date, int, int, text, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_payments(date, date, int, int, text, text, jsonb)
  TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.portal_payments(date, date, int, int, text, text);

-- ── 3. Customers: per-column filters ─────────────────────────
-- The return shape stays a bare array.  The screen reads it that way and a
-- change of shape here is a blank list, not an error anyone would see.
CREATE OR REPLACE FUNCTION public.portal_customers(
  p_search        text  DEFAULT NULL,
  p_buying_status text  DEFAULT NULL,
  p_filters       jsonb DEFAULT NULL
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
         -- Per-column.
         --
         -- `customer_name` matches company OR name — both, not
         -- `coalesce(company, name)`. The column SHOWS whichever of the two
         -- exists, so coalesce would match what is displayed and nothing
         -- else: a shop entered as "Dealer A1" with a contact person "Dlr A1"
         -- would be unfindable by the person's name, which is often the only
         -- name the reader knows.
         and (public.portal_filter_text(p_filters, 'customer_name') is null
              or coalesce(c.company, '')
                 ilike '%' || public.portal_filter_text(p_filters, 'customer_name') || '%'
              or coalesce(c.name, '')
                 ilike '%' || public.portal_filter_text(p_filters, 'customer_name') || '%')
         and (public.portal_filter_text(p_filters, 'name') is null
              or c.name ilike '%' || public.portal_filter_text(p_filters, 'name') || '%')
         and (public.portal_filter_text(p_filters, 'company') is null
              or coalesce(c.company, '') ilike '%' || public.portal_filter_text(p_filters, 'company') || '%')
         and (public.portal_filter_text(p_filters, 'phone') is null
              or coalesce(c.phone, '') ilike '%' || public.portal_filter_text(p_filters, 'phone') || '%')
         and (public.portal_filter_text(p_filters, 'city') is null
              or coalesce(c.city, '') ilike '%' || public.portal_filter_text(p_filters, 'city') || '%')
         and (public.portal_filter_text(p_filters, 'state') is null
              or coalesce(c.state, '') ilike '%' || public.portal_filter_text(p_filters, 'state') || '%')
         and (public.portal_filter_text(p_filters, 'parent_name') is null
              or coalesce(p.name, '') ilike '%' || public.portal_filter_text(p_filters, 'parent_name') || '%')
         and (public.portal_filter_list(p_filters, 'buying_status') is null
              or c.buying_status = any(public.portal_filter_list(p_filters, 'buying_status')))
         -- `hierarchy_level` is an INTEGER (migration 068), and the filter bag
         -- carries text. Compare as text rather than casting the filter: a
         -- hand-typed `f_hierarchy_level=abc` would abort the whole list on an
         -- integer cast, where as text it simply matches nothing.
         and (public.portal_filter_list(p_filters, 'hierarchy_level') is null
              or c.hierarchy_level::text = any(public.portal_filter_list(p_filters, 'hierarchy_level')))
         and (public.portal_filter_num(p_filters, 'outstanding_balance_min') is null
              or coalesce(c.outstanding_balance, 0) >= public.portal_filter_num(p_filters, 'outstanding_balance_min'))
         and (public.portal_filter_num(p_filters, 'outstanding_balance_max') is null
              or coalesce(c.outstanding_balance, 0) <= public.portal_filter_num(p_filters, 'outstanding_balance_max'))
    ) s;
$fn$;

ALTER FUNCTION public.portal_customers(text, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_customers(text, text, jsonb) TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.portal_customers(text, text);

-- ── 4. The order screen learns who booked it ─────────────────
-- Re-emitted whole rather than patched: it is one `jsonb_build_object` and
-- there is nothing to patch into.  Everything else is byte-identical to
-- 20261116110000.
CREATE OR REPLACE FUNCTION public.portal_order_detail(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
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
           'booked_by_name', coalesce(pb.company, pb.name, o.salesman_name),
           'lines', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'position',                oi.position,
                      'product_name',            oi.product_name,
                      'unit',                    oi.unit,
                      'quantity',                oi.quantity,
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
    left join public.contacts c  on c.id  = o.contact_id
    left join public.contacts pb on pb.id = o.placed_by_portal_contact_id
   where o.id = p_order_id
     and o.contact_id = any(public.portal_visible_contact_ids());
$fn$;

ALTER FUNCTION public.portal_order_detail(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_order_detail(uuid) TO authenticated, service_role;
```
