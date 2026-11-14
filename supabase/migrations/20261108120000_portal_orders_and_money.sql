-- ============================================================
-- What the distributor can read: their orders, their customers' orders, the
-- money. All read only in v1 (founder decision 6 for payments).
--
-- PURCHASE vs SALES. A purchase order is an order whose customer IS the caller
-- — what they buy from the company, already classification = 'primary'. A sales
-- order is an order whose customer is someone BELOW them, already 'secondary'.
-- They see the ones they placed and the ones the company's reps booked.
--
-- WHAT IS DELIBERATELY NOT RETURNED. No salesman, anywhere. Spec §17 question 4
-- is assumed "no": naming a company employee to an outsider is a decision
-- nobody has taken. placed_via says 'portal' or 'company' and stops there.
-- No margin, no cost, no other customer's price list, no blacklist reason
-- (spec §12: the reason is not shown in the portal).
--
-- DATES ARE ACCOUNT-LOCAL. orders.date and payments.payment_date are DATE
-- columns already recorded in the account's own day, so a date range filters
-- them directly. created_at is timestamptz and is NOT returned: converting it
-- would need AT TIME ZONE the account's timezone, and nothing on these screens
-- needs it.
--
-- EVERY ONE of these starts from portal_visible_contact_ids(), which is '{}'
-- for an employee, for a revoked login, for an account whose add-on was taken
-- away, and for a visitor who is not signed in. `= any('{}')` is false for
-- every row, so each function returns an empty result rather than an error.
-- ============================================================

CREATE OR REPLACE FUNCTION public.portal_orders(
  p_kind   text DEFAULT 'all',
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_limit  int  DEFAULT 200,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_me    uuid;
  v_ids   uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
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

  -- One pass for the count and one for the page. The count is what the screen's
  -- pager needs, and it must agree with the rows, so both read the same WHERE.
  SELECT count(*) INTO v_total
    FROM public.orders o
   WHERE o.contact_id = any(v_ids)
     AND (p_kind = 'all'
       OR (p_kind = 'purchase' AND o.contact_id = v_me)
       OR (p_kind = 'sales'    AND o.contact_id IS DISTINCT FROM v_me))
     AND (p_from IS NULL OR o.date >= p_from)
     AND (p_to   IS NULL OR o.date <= p_to);

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
     ORDER BY o.date DESC, o.order_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

ALTER FUNCTION public.portal_orders(text, date, date, int, int) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_orders(text, date, date, int, int) TO authenticated, service_role;


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
                      'price',                   oi.price,
                      'discount_amount',         oi.discount_amount,
                      'scheme_discount_amount',  oi.scheme_discount_amount,
                      'is_scheme_goods',         oi.is_scheme_goods,
                      'tax_rate',                oi.tax_rate,
                      'tax_amount',              oi.tax_amount,
                      'sub_total',               oi.sub_total,
                      'total',                   oi.total
                    ) order by oi.position), '[]'::jsonb)
               from public.order_items oi where oi.order_id = o.id)
         )
    from public.orders o
    left join public.contacts c on c.id = o.contact_id
   where o.id = p_order_id
     and o.contact_id = any(public.portal_visible_contact_ids());
$$;

ALTER FUNCTION public.portal_order_detail(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_order_detail(uuid) TO authenticated, service_role;


-- `mine` is what the distributor owes the company; `customers` is what their own
-- customers owe them. outstanding_balance is maintained by
-- recalc_contact_outstanding, so this reads a stored number and does not re-add
-- invoices — one authority, as everywhere else in this build.
CREATE OR REPLACE FUNCTION public.portal_outstanding()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  with me as (select contact_id from public.portal_caller()),
  mine as (
    select c.outstanding_balance, c.credit_limit
      from public.contacts c join me on c.id = me.contact_id
  ),
  theirs as (
    select c.id, c.name, c.company, c.outstanding_balance, c.credit_limit
      from public.contacts c
     where c.id = any(public.portal_visible_contact_ids())
       and c.id is distinct from (select contact_id from me)
  )
  select jsonb_build_object(
           'mine',              coalesce((select outstanding_balance from mine), 0),
           'mine_credit_limit', (select credit_limit from mine),
           'customers_total',   coalesce((select sum(outstanding_balance) from theirs), 0),
           'customers', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', t.id, 'name', t.name, 'company', t.company,
                      'outstanding_balance', t.outstanding_balance,
                      'credit_limit', t.credit_limit)
                    order by t.outstanding_balance desc)
               from theirs t), '[]'::jsonb)
         )
    where exists (select 1 from me);
$$;

ALTER FUNCTION public.portal_outstanding() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_outstanding() TO authenticated, service_role;


-- Receipts, read only (founder decision 6). Rejected and cancelled receipts are
-- returned with their status rather than hidden: a distributor who paid and was
-- rejected must be able to see that, or the screen is lying to them.
CREATE OR REPLACE FUNCTION public.portal_payments(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_limit  int  DEFAULT 200,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_ids   uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows  jsonb;
BEGIN
  v_ids := public.portal_visible_contact_ids();
  IF v_ids = '{}'::uuid[] THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  END IF;

  SELECT count(*) INTO v_total
    FROM public.payments p
   WHERE p.contact_id = any(v_ids)
     AND (p_from IS NULL OR p.payment_date >= p_from)
     AND (p_to   IS NULL OR p.payment_date <= p_to);

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
     ORDER BY p.payment_date DESC, p.payment_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

ALTER FUNCTION public.portal_payments(date, date, int, int) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_payments(date, date, int, int) TO authenticated, service_role;
