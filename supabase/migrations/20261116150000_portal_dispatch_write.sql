-- OZZO DMS Plan 6 §2 — a distributor dispatches their own sales orders.
--
-- Founder, 2026-11-16:
--   "Create Dispatch and pending dispatch sections for Distributors same to
--    same as our OZZO Standard so that distributors can dispatch their sales
--    orders."
--
-- This is NOT the dispatch work of 2026-11-16 earlier today. That one showed a
-- distributor what the COMPANY had sent THEM, on their purchase orders, and it
-- is read-only. This is the other direction — the distributor shipping to
-- their own shops — and it is the portal's first write against
-- `order_dispatches`.
--
-- ─────────────────────────────────────────────────────────────
-- THE FIVE QUESTIONS (working agreement, 2026-11-06)
--
-- 1. A second foreign key between two tables that already have one?  NO.  No
--    table, no column and no constraint is added anywhere.
--
-- 2. A column that appears in a `.select()` string in either repo?  This
--    WRITES `order_dispatches` and `dispatch_items`, which the admin app reads
--    in `app/(dashboard)/dispatches/page.tsx` and `pending-dispatch/page.tsx`.
--    It writes the SAME columns the admin app's own form writes and no others,
--    so a row this produces is indistinguishable in shape from one a salesman
--    produced.  `dispatch_number` is deliberately left NULL for
--    `trg_set_dispatch_number` to fill (068_orders_module), because a second
--    generator is how an account ends up with two dispatch series.
--
-- 3. A trigger, policy or constraint on a written table?  NO new ones — but it
--    deliberately FIRES two existing ones, and that is the point:
--    `trg_set_dispatch_number` numbers the load, and
--    `trg_sync_order_dispatch_status` (089) recomputes the order's status from
--    delivered-versus-ordered.  Both are scenario-covered below (D1, D9).
--
-- 4. Can an existing row fail a new rule?  No existing row is touched.  A
--    dispatch already recorded by the company is read by the portal and never
--    altered by it.
--
-- 5. A tenant who has not configured this?  Nothing happens.  These are new
--    functions nobody calls unless the portal is in use, and a tenant without
--    the DMS line fails `portal_caller()` on the first line of each.
--
-- ─────────────────────────────────────────────────────────────
-- THE RULES, and why each is in the DATABASE and not in the form
--
--  * ONLY A SALES ORDER.  The buyer must be inside
--    `portal_visible_contact_ids()` AND must not be the caller themselves.  A
--    distributor marking their OWN purchase order shipped would be signing for
--    a delivery the company has not made, and it would move the primary
--    ledger's status on the company's behalf.
--  * NEVER MORE THAN REMAINS, per line: ordered minus already dispatched.  The
--    form caps the input as a courtesy; this is the rule.  Without it a
--    distributor ships 10 of an order for 4 and the order reads Dispatched
--    with a negative remainder nobody can see.
--  * IDEMPOTENT on `p_dispatch_id`, like `portal_place_order`.  A double tap
--    on a slow connection must not ship twice.
--  * `SET search_path = public`, NOT ''.  It writes, so the two triggers above
--    run, and they name their tables unqualified — Plan 4's trap 2, which cost
--    a whole suite run the first time.
--  * NO PERSON IS NAMED on the way out.  A transporter is a company and a
--    docket is a number.  Spec §17 q4 was reversed on 2026-11-16 for who
--    BOOKED and who COLLECTED, and only for those two.

-- ── 1. Orders still waiting to go out ────────────────────────
-- An order is "pending dispatch" while its status is Approved or Part
-- Dispatch: 089's trigger flips it to Dispatched once every line has shipped,
-- so the status IS the answer to "not fully dispatched" and counting
-- quantities to decide would be a second, disagreeing source of truth.
CREATE OR REPLACE FUNCTION public.portal_pending_dispatch(
  p_limit   int   DEFAULT 200,
  p_offset  int   DEFAULT 0,
  p_search  text  DEFAULT NULL,
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
  v_f_num  text   := public.portal_filter_text(p_filters, 'order_number');
  v_f_cust text   := public.portal_filter_text(p_filters, 'customer_name');
  v_f_st   text[] := public.portal_filter_list(p_filters, 'status');
  v_f_from date   := public.portal_filter_date(p_filters, 'date_from');
  v_f_to   date   := public.portal_filter_date(p_filters, 'date_to');
  v_total int;
  v_rows  jsonb;
BEGIN
  SELECT contact_id INTO v_me FROM public.portal_caller();
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  END IF;
  v_ids := public.portal_visible_contact_ids();

  SELECT count(*) INTO v_total
    FROM public.orders o
    LEFT JOIN public.contacts c ON c.id = o.contact_id
   WHERE o.contact_id = any(v_ids)
     AND o.contact_id IS DISTINCT FROM v_me
     AND o.status IN ('Approved', 'Part Dispatch')
     AND (v_q IS NULL
          OR o.order_number ILIKE '%' || v_q || '%'
          OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%')
     AND (v_f_num  IS NULL OR o.order_number ILIKE '%' || v_f_num || '%')
     AND (v_f_cust IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_f_cust || '%')
     AND (v_f_st   IS NULL OR o.status = any(v_f_st))
     AND (v_f_from IS NULL OR o.date >= v_f_from)
     AND (v_f_to   IS NULL OR o.date <= v_f_to);

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id',            o.id,
             'order_number',  o.order_number,
             'date',          o.date,
             'customer_id',   o.contact_id,
             'customer_name', coalesce(c.company, c.name),
             'status',        o.status,
             'total_amount',  o.total_amount,
             -- Ordered / Delivered / Difference, the three figures the admin
             -- app's own Pending Dispatch shows, computed the same way.
             'ordered',   coalesce((SELECT sum(oi.quantity) FROM public.order_items oi
                                     WHERE oi.order_id = o.id), 0),
             'delivered', coalesce((SELECT sum(di.quantity)
                                      FROM public.dispatch_items di
                                      JOIN public.order_dispatches d ON d.id = di.dispatch_id
                                     WHERE d.order_id = o.id), 0),
             'difference', coalesce((SELECT sum(oi.quantity) FROM public.order_items oi
                                      WHERE oi.order_id = o.id), 0)
                         - coalesce((SELECT sum(di.quantity)
                                      FROM public.dispatch_items di
                                      JOIN public.order_dispatches d ON d.id = di.dispatch_id
                                     WHERE d.order_id = o.id), 0)
           ) AS x
      FROM public.orders o
      LEFT JOIN public.contacts c ON c.id = o.contact_id
     WHERE o.contact_id = any(v_ids)
       AND o.contact_id IS DISTINCT FROM v_me
       AND o.status IN ('Approved', 'Part Dispatch')
       AND (v_q IS NULL
            OR o.order_number ILIKE '%' || v_q || '%'
            OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%')
       AND (v_f_num  IS NULL OR o.order_number ILIKE '%' || v_f_num || '%')
       AND (v_f_cust IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_f_cust || '%')
       AND (v_f_st   IS NULL OR o.status = any(v_f_st))
       AND (v_f_from IS NULL OR o.date >= v_f_from)
       AND (v_f_to   IS NULL OR o.date <= v_f_to)
     ORDER BY o.date ASC, o.order_number ASC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$fn$;

ALTER FUNCTION public.portal_pending_dispatch(int, int, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_pending_dispatch(int, int, text, jsonb)
  TO authenticated, service_role;

-- ── 2. What has gone out ─────────────────────────────────────
-- Only loads against the distributor's own SALES orders. A dispatch the
-- company made against the distributor's purchase order belongs on that order,
-- which `portal_order_detail` already shows.
CREATE OR REPLACE FUNCTION public.portal_dispatches(
  p_limit   int   DEFAULT 200,
  p_offset  int   DEFAULT 0,
  p_search  text  DEFAULT NULL,
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
  v_f_num   text := public.portal_filter_text(p_filters, 'dispatch_number');
  v_f_order text := public.portal_filter_text(p_filters, 'order_number');
  v_f_cust  text := public.portal_filter_text(p_filters, 'customer_name');
  v_f_inv   text := public.portal_filter_text(p_filters, 'invoice_no');
  v_f_tr    text := public.portal_filter_text(p_filters, 'transport_name');
  v_f_from  date := public.portal_filter_date(p_filters, 'date_from');
  v_f_to    date := public.portal_filter_date(p_filters, 'date_to');
  v_total int;
  v_rows  jsonb;
BEGIN
  SELECT contact_id INTO v_me FROM public.portal_caller();
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  END IF;
  v_ids := public.portal_visible_contact_ids();

  SELECT count(*) INTO v_total
    FROM public.order_dispatches d
    JOIN public.orders o   ON o.id = d.order_id
    LEFT JOIN public.contacts c ON c.id = o.contact_id
   WHERE o.contact_id = any(v_ids)
     AND o.contact_id IS DISTINCT FROM v_me
     AND (v_q IS NULL
          OR d.dispatch_number ILIKE '%' || v_q || '%'
          OR coalesce(o.order_number, '') ILIKE '%' || v_q || '%'
          OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%')
     AND (v_f_num   IS NULL OR d.dispatch_number ILIKE '%' || v_f_num || '%')
     AND (v_f_order IS NULL OR coalesce(o.order_number, '') ILIKE '%' || v_f_order || '%')
     AND (v_f_cust  IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_f_cust || '%')
     AND (v_f_inv   IS NULL OR coalesce(d.invoice_no, '') ILIKE '%' || v_f_inv || '%')
     AND (v_f_tr    IS NULL OR coalesce(d.transport_name, '') ILIKE '%' || v_f_tr || '%')
     AND (v_f_from  IS NULL OR d.dispatched_at >= v_f_from)
     AND (v_f_to    IS NULL OR d.dispatched_at <= v_f_to);

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id',              d.id,
             'dispatch_number', d.dispatch_number,
             'dispatched_at',   d.dispatched_at,
             'order_id',        d.order_id,
             'order_number',    o.order_number,
             'customer_id',     o.contact_id,
             'customer_name',   coalesce(c.company, c.name),
             'invoice_no',      d.invoice_no,
             'transport_name',  d.transport_name,
             'tracking_number', d.tracking_number,
             'item_count',      (SELECT count(*) FROM public.dispatch_items di
                                  WHERE di.dispatch_id = d.id),
             'quantity',        coalesce((SELECT sum(di.quantity) FROM public.dispatch_items di
                                           WHERE di.dispatch_id = d.id), 0),
             -- Priced from the ORDER's own line, never re-priced here: a
             -- dispatch is a movement of goods and carries no price of its own.
             'value',           coalesce((SELECT sum(di.quantity * coalesce(oi.price, 0))
                                            FROM public.dispatch_items di
                                            LEFT JOIN public.order_items oi
                                              ON oi.id = di.order_item_id
                                           WHERE di.dispatch_id = d.id), 0)
           ) AS x
      FROM public.order_dispatches d
      JOIN public.orders o   ON o.id = d.order_id
      LEFT JOIN public.contacts c ON c.id = o.contact_id
     WHERE o.contact_id = any(v_ids)
       AND o.contact_id IS DISTINCT FROM v_me
       AND (v_q IS NULL
            OR d.dispatch_number ILIKE '%' || v_q || '%'
            OR coalesce(o.order_number, '') ILIKE '%' || v_q || '%'
            OR coalesce(c.company, c.name, '') ILIKE '%' || v_q || '%')
       AND (v_f_num   IS NULL OR d.dispatch_number ILIKE '%' || v_f_num || '%')
       AND (v_f_order IS NULL OR coalesce(o.order_number, '') ILIKE '%' || v_f_order || '%')
       AND (v_f_cust  IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_f_cust || '%')
       AND (v_f_inv   IS NULL OR coalesce(d.invoice_no, '') ILIKE '%' || v_f_inv || '%')
       AND (v_f_tr    IS NULL OR coalesce(d.transport_name, '') ILIKE '%' || v_f_tr || '%')
       AND (v_f_from  IS NULL OR d.dispatched_at >= v_f_from)
       AND (v_f_to    IS NULL OR d.dispatched_at <= v_f_to)
     ORDER BY d.dispatched_at DESC, d.dispatch_number DESC
     LIMIT v_limit OFFSET v_off
  ) s;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$fn$;

ALTER FUNCTION public.portal_dispatches(int, int, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_dispatches(int, int, text, jsonb)
  TO authenticated, service_role;

-- ── 3. One load, with its lines ──────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_dispatch_detail(p_dispatch_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  select jsonb_build_object(
           'id',                  d.id,
           'dispatch_number',     d.dispatch_number,
           'dispatched_at',       d.dispatched_at,
           'order_id',            d.order_id,
           'order_number',        o.order_number,
           'customer_id',         o.contact_id,
           'customer_name',       coalesce(c.company, c.name),
           'invoice_no',          d.invoice_no,
           'invoice_date',        d.invoice_date,
           'transport_name',      d.transport_name,
           'transport_contact_no', d.transport_contact_no,
           'lr_no',               d.lr_no,
           'lr_date',             d.lr_date,
           'tracking_number',     d.tracking_number,
           'notes',               d.notes,
           'lines', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'product_name', di.product_name,
                      'unit',         di.unit,
                      'quantity',     di.quantity,
                      'price',        oi.price,
                      'ordered',      oi.quantity,
                      'value',        di.quantity * coalesce(oi.price, 0))
                    order by oi.position nulls last, di.product_name), '[]'::jsonb)
               from public.dispatch_items di
               left join public.order_items oi on oi.id = di.order_item_id
              where di.dispatch_id = d.id)
         )
    from public.order_dispatches d
    join public.orders o on o.id = d.order_id
    left join public.contacts c on c.id = o.contact_id
   where d.id = p_dispatch_id
     and o.contact_id = any(public.portal_visible_contact_ids())
     and o.contact_id is distinct from (select contact_id from public.portal_caller());
$fn$;

ALTER FUNCTION public.portal_dispatch_detail(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_dispatch_detail(uuid) TO authenticated, service_role;

-- ── 4. The lines a new dispatch may carry ────────────────────
-- Ordered, already shipped, and what is left. The form reads this to build its
-- rows; `portal_create_dispatch` computes the same figures again rather than
-- trusting what comes back, because this answer travels through a browser.
CREATE OR REPLACE FUNCTION public.portal_dispatch_lines(
  p_order_id uuid,
  p_exclude_dispatch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_item_id', oi.id,
           'product_name',  oi.product_name,
           'unit',          oi.unit,
           'price',         oi.price,
           'ordered',       oi.quantity,
           'shipped',       v.shipped,
           'remaining',     greatest(oi.quantity - v.shipped, 0))
         order by oi.position), '[]'::jsonb)
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    cross join lateral (
      select coalesce(sum(di.quantity), 0) as shipped
        from public.dispatch_items di
        join public.order_dispatches d on d.id = di.dispatch_id
       where di.order_item_id = oi.id
         and d.order_id = oi.order_id
         -- Editing a load must not count that load against itself.
         and (p_exclude_dispatch_id is null or d.id <> p_exclude_dispatch_id)
    ) v
   where oi.order_id = p_order_id
     and o.contact_id = any(public.portal_visible_contact_ids())
     and o.contact_id is distinct from (select contact_id from public.portal_caller());
$fn$;

ALTER FUNCTION public.portal_dispatch_lines(uuid, uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_dispatch_lines(uuid, uuid) TO authenticated, service_role;

-- ── 5. The write ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_create_dispatch(
  p_dispatch_id uuid,
  p_order_id    uuid,
  p_lines       jsonb,
  p_header      jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
-- Not '': this writes, so `trg_set_dispatch_number` and
-- `trg_sync_order_dispatch_status` run, and both name their tables unqualified.
SET search_path TO 'public'
AS $fn$
DECLARE
  v_caller  uuid;
  v_acct    uuid;
  v_ids     uuid[];
  v_order   record;
  v_today   date;
  v_date    date;
  v_count   int := 0;
  v_line    jsonb;
  v_item    record;
  v_qty     numeric;
  v_shipped numeric;
  v_existing record;
BEGIN
  SELECT contact_id, account_id INTO v_caller, v_acct FROM public.portal_caller();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'This login cannot dispatch.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_dispatch_id IS NULL THEN
    RAISE EXCEPTION 'A dispatch needs an id.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- A REPLAY, not a second load. The ownership check matters as much as the
  -- idempotence: without it a guessed uuid hands an outsider a real dispatch
  -- number from another tenant (the same hole W11b found in create_order).
  SELECT d.id, d.dispatch_number, d.order_id INTO v_existing
    FROM public.order_dispatches d
    JOIN public.orders o ON o.id = d.order_id
   WHERE d.id = p_dispatch_id
     AND o.contact_id = any(public.portal_visible_contact_ids())
     AND o.contact_id IS DISTINCT FROM v_caller;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id,
                              'dispatch_number', v_existing.dispatch_number,
                              'replayed', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_dispatches WHERE id = p_dispatch_id) THEN
    -- Somebody else's row carries this id. Say no, and say nothing about it.
    RAISE EXCEPTION 'This dispatch cannot be saved.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_ids := public.portal_visible_contact_ids();

  SELECT o.id, o.account_id, o.contact_id, o.status
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.contact_id = any(v_ids)
     -- THE LINE: their customers' orders are theirs to ship; their own order
     -- on the company is the company's to ship.
     AND o.contact_id IS DISTINCT FROM v_caller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That order is not one of yours to dispatch.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_order.account_id IS DISTINCT FROM v_acct THEN
    RAISE EXCEPTION 'That order is not one of yours to dispatch.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_order.status NOT IN ('Approved', 'Part Dispatch') THEN
    RAISE EXCEPTION 'An order must be approved before it can be dispatched. This one is %.',
      v_order.status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Enter a quantity for at least one item.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_today := (now() AT TIME ZONE public.account_timezone(v_acct))::date;
  v_date  := coalesce(public.portal_filter_date(p_header, 'dispatched_at'), v_today);
  IF v_date > v_today THEN
    RAISE EXCEPTION 'A dispatch cannot be dated in the future.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.order_dispatches (
    id, account_id, order_id, dispatched_at,
    invoice_no, invoice_date, transport_name, transport_contact_no,
    lr_no, lr_date, tracking_number, notes
  ) VALUES (
    p_dispatch_id, v_acct, p_order_id, v_date,
    nullif(btrim(coalesce(p_header ->> 'invoice_no', '')), ''),
    public.portal_filter_date(p_header, 'invoice_date'),
    nullif(btrim(coalesce(p_header ->> 'transport_name', '')), ''),
    nullif(btrim(coalesce(p_header ->> 'transport_contact_no', '')), ''),
    nullif(btrim(coalesce(p_header ->> 'lr_no', '')), ''),
    public.portal_filter_date(p_header, 'lr_date'),
    nullif(btrim(coalesce(p_header ->> 'tracking_number', '')), ''),
    nullif(btrim(coalesce(p_header ->> 'notes', '')), '')
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    -- A quantity that is not a number is not a quantity. Checked rather than
    -- cast, so a hostile value is a refusal with a sentence on it and not a
    -- raw cast error from the middle of a transaction.
    IF coalesce(v_line ->> 'quantity', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Quantity must be a number.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_qty := (v_line ->> 'quantity')::numeric;
    CONTINUE WHEN v_qty = 0;
    IF v_qty < 0 THEN
      RAISE EXCEPTION 'Quantity must be more than zero.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- The line must belong to THIS order. Without this a caller could ship
    -- another order's item under this order's number.
    SELECT oi.id, oi.product_name, oi.unit, oi.quantity
      INTO v_item
      FROM public.order_items oi
     WHERE oi.id = (v_line ->> 'order_item_id')::uuid
       AND oi.order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That item is not on this order.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT coalesce(sum(di.quantity), 0) INTO v_shipped
      FROM public.dispatch_items di
      JOIN public.order_dispatches d ON d.id = di.dispatch_id
     WHERE di.order_item_id = v_item.id
       AND d.order_id = p_order_id
       AND d.id <> p_dispatch_id;

    IF v_qty > v_item.quantity - v_shipped THEN
      RAISE EXCEPTION '% — you can send % more, not %.',
        v_item.product_name, v_item.quantity - v_shipped, v_qty
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.dispatch_items
      (dispatch_id, order_item_id, product_name, unit, quantity)
    VALUES (p_dispatch_id, v_item.id, v_item.product_name, v_item.unit, v_qty);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Enter a quantity for at least one item.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN jsonb_build_object(
           'id', p_dispatch_id,
           'dispatch_number',
             (SELECT dispatch_number FROM public.order_dispatches WHERE id = p_dispatch_id),
           'order_status', (SELECT status FROM public.orders WHERE id = p_order_id),
           'lines', v_count,
           'replayed', false);
END;
$fn$;

ALTER FUNCTION public.portal_create_dispatch(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_create_dispatch(uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;
