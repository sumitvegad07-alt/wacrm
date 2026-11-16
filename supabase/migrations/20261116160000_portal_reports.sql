-- OZZO DMS Plan 6 §3 — the four reports a distributor actually runs.
--
-- Founder, 2026-11-16: "Than we need Reports … Same to same as we have in our
-- OZZO."
--
-- ─────────────────────────────────────────────────────────────
-- WHY NOT `execute_report`
--
-- The admin app's reports all run through one engine. It cannot be reused
-- here, for two independent reasons and either would be enough:
--
--  1. **Its live body is in no repo file.** It has been patched in place on
--     production, so a migration that re-created it would silently roll back
--     fixes nobody can see in git.
--  2. **Every one of its scopes reads `profiles` and the rights registry**, and
--     a portal login has neither. A portal caller would fall through every
--     scope — which, in a report engine, does not mean "no rows", it means
--     "the account's rows".
--
-- So these are four purpose-built, read-only functions, each scoped by
-- `portal_visible_contact_ids()` on its own first line.
--
-- ─────────────────────────────────────────────────────────────
-- THE FIVE QUESTIONS (working agreement, 2026-11-06)
--
-- 1. A second foreign key?  NO.  No table, column, constraint or trigger.
-- 2. A column in a `.select()` string?  Read-only throughout; nothing written.
-- 3. A trigger, policy or constraint on a written table?  NO.
-- 4. Can an existing row fail a new rule?  There is no rule and no write.
-- 5. A tenant who has not configured this?  Nothing.  New functions nobody
--    calls unless the portal is in use.
--
-- ─────────────────────────────────────────────────────────────
-- THE DEFINITIONS, taken from the admin app's own and not re-invented
--
--  * A SALE is an order at status 'Closed', dated by its DISPATCH COMPLETION
--    (the order's latest dispatch), not by its order date.  That is
--    `salesReportConfig.ts` word for word, and the auto-close trigger
--    (20260814151500) is what moves an order to Closed when its last item
--    ships.  A part-dispatched order therefore contributes NOTHING until it
--    completes, then contributes its whole value.  The screen says so, because
--    a distributor who has just started dispatching will otherwise read an
--    empty report as a broken one.
--  * OUTSTANDING is whatever `order_outstanding_balances` says, which carries
--    the account's own oldest-first allocation AND the account's own choice of
--    which statuses count as debt (20261005130000 / 20261019120000).  Joined,
--    never called per row — its own comment says so.
--  * COLLECTION is the `payments` rows against their shops.  Their own dues to
--    the COMPANY are a different ledger and are deliberately excluded: a shop's
--    money never reduces what the distributor owes upward, and a report that
--    mixed them would be the Plan 5 §1A mistake with a total on the end.
--
-- Every report returns the same shape — {columns, rows, totals} — so one
-- screen renders all four and they cannot drift into four layouts.

-- ── 1. Sales ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_report_sales(
  p_from     date DEFAULT NULL,
  p_to       date DEFAULT NULL,
  p_group_by text DEFAULT 'day',
  p_filters  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_me   uuid;
  v_ids  uuid[];
  v_g    text := lower(coalesce(nullif(btrim(p_group_by), ''), 'day'));
  v_cust text := public.portal_filter_text(p_filters, 'customer_name');
  v_rows jsonb;
  v_tot  jsonb;
  v_cols jsonb;
BEGIN
  IF v_g NOT IN ('day', 'month', 'customer', 'product') THEN
    RAISE EXCEPTION 'Group by day, month, customer or product.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT contact_id INTO v_me FROM public.portal_caller();
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb,
                              'totals', '{}'::jsonb, 'group_by', v_g);
  END IF;
  v_ids := public.portal_visible_contact_ids();

  -- The window is on the dispatch-completion date, which is the order's latest
  -- dispatch. An order placed on the 9th and finished on the 14th is the 14th's
  -- revenue, exactly as the admin app's Sales report counts it.
  WITH sold AS (
    SELECT o.id,
           o.contact_id,
           coalesce(c.company, c.name) AS customer_name,
           o.sub_total, o.discount_total, o.tax_total, o.total_amount,
           (SELECT max(d.dispatched_at) FROM public.order_dispatches d
             WHERE d.order_id = o.id) AS sold_on
      FROM public.orders o
      LEFT JOIN public.contacts c ON c.id = o.contact_id
     WHERE o.contact_id = any(v_ids)
       AND o.contact_id IS DISTINCT FROM v_me
       AND o.status = 'Closed'
       AND (v_cust IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_cust || '%')
  ), win AS (
    SELECT * FROM sold
     WHERE sold_on IS NOT NULL
       AND (p_from IS NULL OR sold_on >= p_from)
       AND (p_to   IS NULL OR sold_on <= p_to)
  )
  SELECT
    CASE v_g
      WHEN 'product' THEN (
        SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'label'), '[]'::jsonb) FROM (
          SELECT jsonb_build_object(
                   'label',    oi.product_name,
                   'orders',   count(DISTINCT w.id),
                   'quantity', sum(oi.quantity),
                   'amount',   sum(oi.total)) AS x
            FROM win w JOIN public.order_items oi ON oi.order_id = w.id
           GROUP BY oi.product_name) s)
      WHEN 'customer' THEN (
        SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'label'), '[]'::jsonb) FROM (
          SELECT jsonb_build_object(
                   'label',    w.customer_name,
                   'orders',   count(*),
                   'quantity', coalesce(sum((SELECT sum(oi.quantity) FROM public.order_items oi
                                              WHERE oi.order_id = w.id)), 0),
                   'gross',    sum(w.sub_total),
                   'discount', sum(w.discount_total),
                   'tax',      sum(w.tax_total),
                   'amount',   sum(w.total_amount)) AS x
            FROM win w GROUP BY w.customer_name) s)
      ELSE (
        SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'label'), '[]'::jsonb) FROM (
          SELECT jsonb_build_object(
                   'label', CASE WHEN v_g = 'month'
                                 THEN to_char(w.sold_on, 'YYYY-MM')
                                 ELSE to_char(w.sold_on, 'YYYY-MM-DD') END,
                   'orders',   count(*),
                   'quantity', coalesce(sum((SELECT sum(oi.quantity) FROM public.order_items oi
                                              WHERE oi.order_id = w.id)), 0),
                   'gross',    sum(w.sub_total),
                   'discount', sum(w.discount_total),
                   'tax',      sum(w.tax_total),
                   'amount',   sum(w.total_amount)) AS x
            FROM win w
           GROUP BY CASE WHEN v_g = 'month'
                         THEN to_char(w.sold_on, 'YYYY-MM')
                         ELSE to_char(w.sold_on, 'YYYY-MM-DD') END) s)
    END,
    -- THE TOTALS MUST BE COMPUTED AT THE SAME GRAIN AS THE ROWS.
    --
    -- Grouping by product moves the grain from the order to the ORDER LINE,
    -- and an order-level total under item-level rows is a footer that does not
    -- equal the column above it — the one thing a report must never do. The
    -- admin app's own configs carry the same warning: "never put an
    -- order-level quantity or amount on an item-level tab".
    CASE WHEN v_g = 'product' THEN
      (SELECT jsonb_build_object(
                'orders',   count(DISTINCT w.id),
                'quantity', coalesce(sum(oi.quantity), 0),
                'amount',   coalesce(sum(oi.total), 0))
         FROM win w JOIN public.order_items oi ON oi.order_id = w.id)
    ELSE
      (SELECT jsonb_build_object(
                'orders',   count(*),
                'quantity', coalesce(sum((SELECT sum(oi.quantity) FROM public.order_items oi
                                           WHERE oi.order_id = w.id)), 0),
                'gross',    coalesce(sum(w.sub_total), 0),
                'discount', coalesce(sum(w.discount_total), 0),
                'tax',      coalesce(sum(w.tax_total), 0),
                'amount',   coalesce(sum(w.total_amount), 0))
         FROM win w)
    END
  INTO v_rows, v_tot;

  v_cols := CASE v_g
    WHEN 'product' THEN '[{"key":"label","label":"Product","type":"text"},
                          {"key":"orders","label":"Orders","type":"number"},
                          {"key":"quantity","label":"Quantity","type":"number"},
                          {"key":"amount","label":"Amount","type":"money"}]'::jsonb
    WHEN 'customer' THEN '[{"key":"label","label":"Customer","type":"text"},
                           {"key":"orders","label":"Orders","type":"number"},
                           {"key":"quantity","label":"Quantity","type":"number"},
                           {"key":"gross","label":"Gross","type":"money"},
                           {"key":"discount","label":"Discount","type":"money"},
                           {"key":"tax","label":"Tax","type":"money"},
                           {"key":"amount","label":"Net","type":"money"}]'::jsonb
    ELSE '[{"key":"label","label":"Date","type":"text"},
           {"key":"orders","label":"Orders","type":"number"},
           {"key":"quantity","label":"Quantity","type":"number"},
           {"key":"gross","label":"Gross","type":"money"},
           {"key":"discount","label":"Discount","type":"money"},
           {"key":"tax","label":"Tax","type":"money"},
           {"key":"amount","label":"Net","type":"money"}]'::jsonb
  END;

  RETURN jsonb_build_object('columns', v_cols, 'rows', coalesce(v_rows, '[]'::jsonb),
                            'totals', coalesce(v_tot, '{}'::jsonb), 'group_by', v_g);
END;
$fn$;

ALTER FUNCTION public.portal_report_sales(date, date, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_report_sales(date, date, text, jsonb)
  TO authenticated, service_role;

-- ── 2. Orders ────────────────────────────────────────────────
-- Every sales order by its ORDER date, whatever its status, with what has been
-- sent and what is still to go. This is the report a distributor runs to find
-- out what they owe their shops — the one Sales deliberately cannot answer,
-- because Sales only counts an order once it is finished.
CREATE OR REPLACE FUNCTION public.portal_report_orders(
  p_from     date DEFAULT NULL,
  p_to       date DEFAULT NULL,
  p_group_by text DEFAULT 'day',
  p_filters  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_me   uuid;
  v_ids  uuid[];
  v_g    text := lower(coalesce(nullif(btrim(p_group_by), ''), 'day'));
  v_cust text   := public.portal_filter_text(p_filters, 'customer_name');
  v_st   text[] := public.portal_filter_list(p_filters, 'status');
  v_rows jsonb;
  v_tot  jsonb;
  v_cols jsonb;
BEGIN
  IF v_g NOT IN ('day', 'month', 'customer', 'status', 'product') THEN
    RAISE EXCEPTION 'Group by day, month, customer, status or product.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT contact_id INTO v_me FROM public.portal_caller();
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb,
                              'totals', '{}'::jsonb, 'group_by', v_g);
  END IF;
  v_ids := public.portal_visible_contact_ids();

  WITH win AS (
    SELECT o.id, o.date, o.status, o.total_amount,
           coalesce(c.company, c.name) AS customer_name,
           coalesce((SELECT sum(oi.quantity) FROM public.order_items oi
                      WHERE oi.order_id = o.id), 0) AS ordered,
           coalesce((SELECT sum(di.quantity)
                       FROM public.dispatch_items di
                       JOIN public.order_dispatches d ON d.id = di.dispatch_id
                      WHERE d.order_id = o.id), 0) AS dispatched
      FROM public.orders o
      LEFT JOIN public.contacts c ON c.id = o.contact_id
     WHERE o.contact_id = any(v_ids)
       AND o.contact_id IS DISTINCT FROM v_me
       AND (p_from IS NULL OR o.date >= p_from)
       AND (p_to   IS NULL OR o.date <= p_to)
       AND (v_cust IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_cust || '%')
       AND (v_st   IS NULL OR o.status = any(v_st))
  )
  SELECT
    CASE v_g
      WHEN 'product' THEN (
        SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'label'), '[]'::jsonb) FROM (
          SELECT jsonb_build_object(
                   'label',    oi.product_name,
                   'orders',   count(DISTINCT w.id),
                   'ordered',  sum(oi.quantity),
                   'amount',   sum(oi.total)) AS x
            FROM win w JOIN public.order_items oi ON oi.order_id = w.id
           GROUP BY oi.product_name) s)
      ELSE (
        SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'label'), '[]'::jsonb) FROM (
          SELECT jsonb_build_object(
                   'label', CASE v_g
                              WHEN 'customer' THEN w.customer_name
                              WHEN 'status'   THEN w.status
                              WHEN 'month'    THEN to_char(w.date, 'YYYY-MM')
                              ELSE to_char(w.date, 'YYYY-MM-DD') END,
                   'orders',     count(*),
                   'ordered',    sum(w.ordered),
                   'dispatched', sum(w.dispatched),
                   'pending',    sum(greatest(w.ordered - w.dispatched, 0)),
                   'amount',     sum(w.total_amount)) AS x
            FROM win w
           GROUP BY CASE v_g
                      WHEN 'customer' THEN w.customer_name
                      WHEN 'status'   THEN w.status
                      WHEN 'month'    THEN to_char(w.date, 'YYYY-MM')
                      ELSE to_char(w.date, 'YYYY-MM-DD') END) s)
    END,
    -- Same rule as the Sales report: by product the grain is the order LINE,
    -- so the footer has to be summed over lines or it will not equal the
    -- column above it.
    CASE WHEN v_g = 'product' THEN
      (SELECT jsonb_build_object(
                'orders',  count(DISTINCT w.id),
                'ordered', coalesce(sum(oi.quantity), 0),
                'amount',  coalesce(sum(oi.total), 0))
         FROM win w JOIN public.order_items oi ON oi.order_id = w.id)
    ELSE
      (SELECT jsonb_build_object(
                'orders',     count(*),
                'ordered',    coalesce(sum(w.ordered), 0),
                'dispatched', coalesce(sum(w.dispatched), 0),
                'pending',    coalesce(sum(greatest(w.ordered - w.dispatched, 0)), 0),
                'amount',     coalesce(sum(w.total_amount), 0))
         FROM win w)
    END
  INTO v_rows, v_tot;

  v_cols := CASE v_g
    WHEN 'product' THEN '[{"key":"label","label":"Product","type":"text"},
                          {"key":"orders","label":"Orders","type":"number"},
                          {"key":"ordered","label":"Quantity","type":"number"},
                          {"key":"amount","label":"Amount","type":"money"}]'::jsonb
    ELSE jsonb_build_array(
           jsonb_build_object('key', 'label', 'type', 'text', 'label',
             CASE v_g WHEN 'customer' THEN 'Customer'
                      WHEN 'status'   THEN 'Status'
                      ELSE 'Date' END),
           '{"key":"orders","label":"Orders","type":"number"}'::jsonb,
           '{"key":"ordered","label":"Ordered","type":"number"}'::jsonb,
           '{"key":"dispatched","label":"Dispatched","type":"number"}'::jsonb,
           '{"key":"pending","label":"Still to send","type":"number"}'::jsonb,
           '{"key":"amount","label":"Amount","type":"money"}'::jsonb)
  END;

  RETURN jsonb_build_object('columns', v_cols, 'rows', coalesce(v_rows, '[]'::jsonb),
                            'totals', coalesce(v_tot, '{}'::jsonb), 'group_by', v_g);
END;
$fn$;

ALTER FUNCTION public.portal_report_orders(date, date, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_report_orders(date, date, text, jsonb)
  TO authenticated, service_role;

-- ── 3. Collection ────────────────────────────────────────────
-- What their shops paid THEM. Their own dues to the company are a different
-- ledger and are excluded by `contact_id IS DISTINCT FROM v_me` — a shop's
-- money never reduces what the distributor owes upward, and a report that
-- mixed the two would put a wrong number under a right-looking heading.
CREATE OR REPLACE FUNCTION public.portal_report_collection(
  p_from     date DEFAULT NULL,
  p_to       date DEFAULT NULL,
  p_group_by text DEFAULT 'day',
  p_filters  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_me   uuid;
  v_ids  uuid[];
  v_g    text := lower(coalesce(nullif(btrim(p_group_by), ''), 'day'));
  v_cust text   := public.portal_filter_text(p_filters, 'customer_name');
  v_st   text[] := public.portal_filter_list(p_filters, 'status');
  v_rows jsonb;
  v_tot  jsonb;
  v_cols jsonb;
BEGIN
  IF v_g NOT IN ('day', 'month', 'customer', 'mode', 'status', 'collected_by') THEN
    RAISE EXCEPTION 'Group by day, month, customer, mode, status or collected_by.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT contact_id INTO v_me FROM public.portal_caller();
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb,
                              'totals', '{}'::jsonb, 'group_by', v_g);
  END IF;
  v_ids := public.portal_visible_contact_ids();

  WITH win AS (
    SELECT p.id, p.payment_date, p.amount, p.status, p.payment_type,
           coalesce(c.company, c.name) AS customer_name,
           coalesce(CASE WHEN p.source = 'customer' THEN coalesce(hc.company, hc.name) END,
                    pr.full_name, 'Company') AS collected_by
      FROM public.payments p
      LEFT JOIN public.contacts c  ON c.id = p.contact_id
      LEFT JOIN public.profiles pr ON pr.user_id = p.user_id AND pr.account_id = p.account_id
      LEFT JOIN LATERAL (
        SELECT h.by_contact_id FROM public.payment_handovers h
         WHERE h.payment_id = p.id AND h.by_contact_id IS NOT NULL
         ORDER BY h.seq LIMIT 1
      ) hv ON TRUE
      LEFT JOIN public.contacts hc ON hc.id = hv.by_contact_id
     WHERE p.contact_id = any(v_ids)
       AND p.contact_id IS DISTINCT FROM v_me
       AND (p_from IS NULL OR p.payment_date >= p_from)
       AND (p_to   IS NULL OR p.payment_date <= p_to)
       AND (v_cust IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_cust || '%')
       AND (v_st   IS NULL OR p.status = any(v_st))
  )
  SELECT
    (SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'label'), '[]'::jsonb) FROM (
       SELECT jsonb_build_object(
                'label', CASE v_g
                           WHEN 'customer'     THEN w.customer_name
                           WHEN 'mode'         THEN coalesce(w.payment_type, 'Not said')
                           WHEN 'status'       THEN w.status
                           WHEN 'collected_by' THEN w.collected_by
                           WHEN 'month'        THEN to_char(w.payment_date, 'YYYY-MM')
                           ELSE to_char(w.payment_date, 'YYYY-MM-DD') END,
                'receipts', count(*),
                'amount',   sum(w.amount),
                -- Approved is the money that has actually been accepted; the
                -- rest is still a claim, and a collection report that showed
                -- only one total would be read as the first and be the second.
                'approved', sum(w.amount) FILTER (WHERE w.status = 'Approved')) AS x
         FROM win w
        GROUP BY CASE v_g
                   WHEN 'customer'     THEN w.customer_name
                   WHEN 'mode'         THEN coalesce(w.payment_type, 'Not said')
                   WHEN 'status'       THEN w.status
                   WHEN 'collected_by' THEN w.collected_by
                   WHEN 'month'        THEN to_char(w.payment_date, 'YYYY-MM')
                   ELSE to_char(w.payment_date, 'YYYY-MM-DD') END) s),
    (SELECT jsonb_build_object(
              'receipts', count(*),
              'amount',   coalesce(sum(w.amount), 0),
              'approved', coalesce(sum(w.amount) FILTER (WHERE w.status = 'Approved'), 0))
       FROM win w)
  INTO v_rows, v_tot;

  v_cols := jsonb_build_array(
    jsonb_build_object('key', 'label', 'type', 'text', 'label',
      CASE v_g WHEN 'customer'     THEN 'Customer'
               WHEN 'mode'         THEN 'Mode'
               WHEN 'status'       THEN 'Status'
               WHEN 'collected_by' THEN 'Collected by'
               ELSE 'Date' END),
    '{"key":"receipts","label":"Receipts","type":"number"}'::jsonb,
    '{"key":"amount","label":"Collected","type":"money"}'::jsonb,
    '{"key":"approved","label":"Approved","type":"money"}'::jsonb);

  RETURN jsonb_build_object('columns', v_cols, 'rows', coalesce(v_rows, '[]'::jsonb),
                            'totals', coalesce(v_tot, '{}'::jsonb), 'group_by', v_g);
END;
$fn$;

ALTER FUNCTION public.portal_report_collection(date, date, text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_report_collection(date, date, text, jsonb)
  TO authenticated, service_role;

-- ── 4. Outstanding ───────────────────────────────────────────
-- Who owes the distributor what, by order or by customer, with the age of the
-- debt.
--
-- The figure is NOT computed here. `order_outstanding_balances` carries the
-- account's own oldest-first allocation and the account's own list of which
-- statuses count as debt, so this report cannot disagree with the customer
-- list, the dashboard, or the admin app's own Customer Outstanding. The view
-- is JOINED, not called per row — `order_outstanding_amount`'s own comment
-- says so in as many words.
CREATE OR REPLACE FUNCTION public.portal_report_outstanding(
  p_group_by text  DEFAULT 'order',
  p_filters  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_me   uuid;
  v_ids  uuid[];
  v_g    text := lower(coalesce(nullif(btrim(p_group_by), ''), 'order'));
  v_cust text := public.portal_filter_text(p_filters, 'customer_name');
  v_rows jsonb;
  v_tot  jsonb;
  v_cols jsonb;
BEGIN
  IF v_g NOT IN ('order', 'customer') THEN
    RAISE EXCEPTION 'Group by order or customer.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT contact_id INTO v_me FROM public.portal_caller();
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb,
                              'totals', '{}'::jsonb, 'group_by', v_g);
  END IF;
  v_ids := public.portal_visible_contact_ids();

  IF v_g = 'customer' THEN
    SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'balance')::numeric DESC), '[]'::jsonb),
           jsonb_build_object('customers', count(*),
                              'balance', coalesce(sum((x ->> 'balance')::numeric), 0))
      INTO v_rows, v_tot
      FROM (
        SELECT jsonb_build_object(
                 'label',   coalesce(c.company, c.name),
                 'phone',   c.phone,
                 'balance', coalesce(c.outstanding_balance, 0),
                 -- The age of the oldest order still carrying debt, which is
                 -- what makes a collections list actionable rather than a list
                 -- of names.
                 'oldest_days', (
                    SELECT max(((now() AT TIME ZONE public.account_timezone(o.account_id))::date - o.date))
                      FROM public.orders o
                      JOIN public.order_outstanding_balances b ON b.order_id = o.id
                     WHERE o.contact_id = c.id AND b.outstanding > 0)
               ) AS x
          FROM public.contacts c
         WHERE c.id = any(v_ids)
           AND c.id IS DISTINCT FROM v_me
           AND coalesce(c.outstanding_balance, 0) <> 0
           AND (v_cust IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_cust || '%')
      ) s;

    v_cols := '[{"key":"label","label":"Customer","type":"text"},
                {"key":"phone","label":"Phone","type":"text"},
                {"key":"oldest_days","label":"Oldest (days)","type":"number"},
                {"key":"balance","label":"Owes you","type":"money"}]'::jsonb;
  ELSE
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'date'), '[]'::jsonb),
           jsonb_build_object('orders', count(*),
                              'outstanding', coalesce(sum((x ->> 'outstanding')::numeric), 0))
      INTO v_rows, v_tot
      FROM (
        SELECT jsonb_build_object(
                 'label',       o.order_number,
                 'date',        o.date,
                 'customer',    coalesce(c.company, c.name),
                 'total',       o.total_amount,
                 'outstanding', b.outstanding,
                 -- The account's OWN day, never the server's and never the
                 -- reader's: an account in Mumbai and a server in UTC disagree
                 -- about what day it is for five and a half hours out of
                 -- twenty-four, and a debt one day old must not read as two.
                 'days',        ((now() AT TIME ZONE public.account_timezone(o.account_id))::date - o.date),
                 -- The four buckets a collections conversation is had in.
                 'bucket', CASE
                   WHEN ((now() AT TIME ZONE public.account_timezone(o.account_id))::date - o.date) <= 30 THEN '0-30'
                   WHEN ((now() AT TIME ZONE public.account_timezone(o.account_id))::date - o.date) <= 60 THEN '31-60'
                   WHEN ((now() AT TIME ZONE public.account_timezone(o.account_id))::date - o.date) <= 90 THEN '61-90'
                   ELSE '90+' END
               ) AS x
          FROM public.orders o
          JOIN public.order_outstanding_balances b ON b.order_id = o.id
          LEFT JOIN public.contacts c ON c.id = o.contact_id
         WHERE o.contact_id = any(v_ids)
           AND o.contact_id IS DISTINCT FROM v_me
           AND b.outstanding > 0
           AND (v_cust IS NULL OR coalesce(c.company, c.name, '') ILIKE '%' || v_cust || '%')
      ) s;

    v_cols := '[{"key":"label","label":"Order","type":"text"},
                {"key":"date","label":"Date","type":"date"},
                {"key":"customer","label":"Customer","type":"text"},
                {"key":"days","label":"Days","type":"number"},
                {"key":"bucket","label":"Age","type":"text"},
                {"key":"total","label":"Order total","type":"money"},
                {"key":"outstanding","label":"Still owed","type":"money"}]'::jsonb;
  END IF;

  RETURN jsonb_build_object('columns', v_cols, 'rows', coalesce(v_rows, '[]'::jsonb),
                            'totals', coalesce(v_tot, '{}'::jsonb), 'group_by', v_g);
END;
$fn$;

ALTER FUNCTION public.portal_report_outstanding(text, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_report_outstanding(text, jsonb)
  TO authenticated, service_role;
