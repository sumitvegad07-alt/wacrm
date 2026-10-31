-- ============================================================
-- 20261031120000_dashboard_aggregate_rpcs.sql
--
-- The dashboard tiles stop counting rows in JavaScript.
--
-- TWO CONFIRMED DEFECTS, both invisible on a small tenant.
--
-- 1. TOTALS TRUNCATED AT 1,000 ROWS.
--    PostgREST caps an unbounded `.select()` at 1,000 rows and reports
--    nothing — no error, no flag, just fewer rows. Every money tile fetched
--    rows and summed them in JS with no range, so a tenant past 1,000
--    matching rows read an understated figure and had no way to know.
--
--    Measured against account 6ef67591-2423-4f5e-8c08-fa66e33d9bb9 on
--    2026-10-31: 2,126 Closed orders and 1,068 Approved payments. True
--    outstanding 17,188,513.62. What the tile showed: -32,348,000.98.
--    Not merely low — NEGATIVE, because the orders side lost 1,126 rows
--    while the payments side lost only 68, so the subtraction inverted.
--
--    Server-side aggregates are DISABLED on this project
--    (select=total_amount.sum() returns PGRST123), so .sum() is not an
--    option. These RPCs are.
--
-- 2. "TODAY" AND "THIS MONTH" CAME FROM THE BROWSER CLOCK.
--    new Date().setHours(0,0,0,0) is midnight wherever the viewer's laptop
--    happens to be, and mobile sent bare 2026-10-31T00:00:00 strings, which
--    Postgres reads as UTC — so mobile's "today" began at 05:30 IST and its
--    T23:59:59 end spilled 5.5 hours into the next day. Day boundaries are
--    now resolved HERE, from the account's own timezone, so no client clock
--    can move a figure. House rule, already followed by the report engine and
--    the attendance rollup.
--
-- WHY SECURITY INVOKER AND NOT DEFINER.
--    Every function here is INVOKER so the caller's RLS still chooses the
--    rows, which is what the plain .select() calls being replaced did.
--    DEFINER would read the whole account regardless of the viewer: harmless
--    for orders (RLS there is a pure directional check on user_id) but a real
--    widening on payments and contacts, whose RLS ORs the directional path
--    alongside territory and collaborator visibility. A rep would start
--    seeing the company's whole collection figure. These RPCs change HOW the
--    visible rows are added up, never WHICH rows are visible.
--
--    auth.uid() is additionally asserted to belong to the account, so a
--    signed-in caller cannot name another tenant. A trusted backend key
--    (service_role, which bypasses RLS everywhere already) has no auth.uid()
--    and is let through, which is what makes these verifiable from a script.
--
-- WHICH STATUSES COUNT IS NOT REDEFINED HERE.
--    Every function takes its status lists as arguments. The caller reads the
--    account's rule from outstanding-config.ts exactly as it does today, so
--    there is no second copy of the rule to drift. The DB-side equivalents
--    (outstanding_order_statuses()) stay for the report engine's use.
--
-- NO CLIENT BREAKS BEFORE THIS RUNS. Both clients call the RPC, and on
-- "function does not exist" fall back to the old row-fetching path. The
-- dashboards keep showing today's (truncated) numbers until this migration
-- is applied, and the corrected ones immediately after.
-- ============================================================


-- ── 1. The account's own timezone ────────────────────────────
-- Not a column on `accounts` — it lives in the `settings` jsonb, and most
-- accounts have never set it. The fallback is the one already used by
-- src/lib/retention/run.ts, src/lib/mcp/session.ts and the attendance page,
-- so a day boundary computed here lands on the same instant as one computed
-- there. SECURITY DEFINER only so resolving a timezone never depends on
-- whether the caller can SELECT the accounts row.

CREATE OR REPLACE FUNCTION public.account_timezone(p_account_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT COALESCE(
           NULLIF(btrim(COALESCE((SELECT a.settings->>'timezone'
                                    FROM accounts a
                                   WHERE a.id = p_account_id), '')), ''),
           'Asia/Kolkata');
$fn$;

COMMENT ON FUNCTION public.account_timezone(uuid) IS
  'IANA zone from accounts.settings.timezone, falling back to Asia/Kolkata. The single source for an account-local day boundary in SQL.';

GRANT EXECUTE ON FUNCTION public.account_timezone(uuid) TO authenticated, service_role;


-- Midnight, account-local, as a real instant.
--
-- `now() AT TIME ZONE tz` drops to the account's wall clock; date_trunc cuts
-- that to local midnight; `AT TIME ZONE tz` puts it back on the timeline. The
-- three-argument date_trunc would be shorter but only exists from PG16.
--
-- The upper bound of a day is ALWAYS the next day's start, never 23:59:59 —
-- comparing against the last second silently drops anything inside it.
CREATE OR REPLACE FUNCTION public.account_day_start(
  p_account_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE sql STABLE
AS $fn$
  SELECT (date_trunc('day', p_at AT TIME ZONE public.account_timezone(p_account_id))
          AT TIME ZONE public.account_timezone(p_account_id));
$fn$;

CREATE OR REPLACE FUNCTION public.account_month_start(
  p_account_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE sql STABLE
AS $fn$
  SELECT (date_trunc('month', p_at AT TIME ZONE public.account_timezone(p_account_id))
          AT TIME ZONE public.account_timezone(p_account_id));
$fn$;

-- A calendar date, as the account means it. account_date_start(acc,'2026-10-31')
-- is the instant 31 October began for that account — which is what the mobile
-- app was getting wrong by appending T00:00:00 and letting Postgres call it UTC.
CREATE OR REPLACE FUNCTION public.account_date_start(
  p_account_id uuid,
  p_date date
)
RETURNS timestamptz
LANGUAGE sql STABLE
AS $fn$
  SELECT (p_date::timestamp AT TIME ZONE public.account_timezone(p_account_id));
$fn$;

COMMENT ON FUNCTION public.account_day_start(uuid, timestamptz) IS
  'The instant the account current day began. Use with a < account_day_start(...) + 1 day upper bound, never 23:59:59.';

GRANT EXECUTE ON FUNCTION public.account_day_start(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_month_start(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_date_start(uuid, date) TO authenticated, service_role;


-- ── 2. The tenant guard ──────────────────────────────────────
-- Raised, not returned as zero, so a wiring mistake is loud instead of
-- looking like a quiet business day.
CREATE OR REPLACE FUNCTION public.assert_dashboard_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE
AS $fn$
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account id is required' USING ERRCODE = '22023';
  END IF;
  -- A JWT caller must belong to the account. A trusted backend key has no
  -- auth.uid() and already bypasses RLS everywhere, so there is nothing here
  -- for it to be stopped from doing.
  IF auth.uid() IS NOT NULL AND NOT public.is_account_member(p_account_id) THEN
    RAISE EXCEPTION 'not a member of account %', p_account_id USING ERRCODE = '42501';
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.assert_dashboard_account(uuid) TO authenticated, service_role;


-- ── 3. Orders: the Sales section tiles ───────────────────────
-- Replaces loadSalesMetrics' two unbounded selects.
--
-- `p_user_ids` carries the viewer's DataScope — the visible set resolved by
-- walking profiles.manager_id (see src/hooks/use-data-scope.ts). NULL means
-- unrestricted, which is what the hook reports for an owner/admin or an
-- account with Reporting Hierarchy switched off. These are AUTH user ids,
-- matching orders.user_id; profiles.id is a different id space in this schema
-- and mixing the two returns nothing at all, silently.
--
-- An empty array is treated as "match nothing", exactly as the hook's
-- sentinel-uuid filter does — never as "match everything".
CREATE OR REPLACE FUNCTION public.dashboard_sales_metrics(
  p_account_id uuid,
  p_value_statuses text[],
  p_pending_dispatch_statuses text[],
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
DECLARE
  v_day_start timestamptz;
  v_month_start timestamptz;
  v_today_count bigint := 0;
  v_today_value numeric := 0;
  v_month_value numeric := 0;
  v_pending bigint := 0;
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  v_day_start   := public.account_day_start(p_account_id);
  v_month_start := public.account_month_start(p_account_id);

  SELECT COUNT(*), COALESCE(SUM(COALESCE(o.total_amount, 0)), 0)
    INTO v_today_count, v_today_value
    FROM orders o
   WHERE o.account_id = p_account_id
     AND o.created_at >= v_day_start
     AND o.status = ANY (p_value_statuses)
     AND (p_user_ids IS NULL OR o.user_id = ANY (p_user_ids));

  SELECT COALESCE(SUM(COALESCE(o.total_amount, 0)), 0)
    INTO v_month_value
    FROM orders o
   WHERE o.account_id = p_account_id
     AND o.created_at >= v_month_start
     AND o.status = ANY (p_value_statuses)
     AND (p_user_ids IS NULL OR o.user_id = ANY (p_user_ids));

  SELECT COUNT(*)
    INTO v_pending
    FROM orders o
   WHERE o.account_id = p_account_id
     AND o.status = ANY (p_pending_dispatch_statuses)
     AND (p_user_ids IS NULL OR o.user_id = ANY (p_user_ids));

  RETURN jsonb_build_object(
    'orders_today_count',     v_today_count,
    'orders_today_value',     v_today_value,
    'orders_month_value',     v_month_value,
    'pending_dispatch_count', v_pending,
    'day_start',              v_day_start,
    'month_start',            v_month_start,
    'timezone',               public.account_timezone(p_account_id)
  );
END;
$fn$;

COMMENT ON FUNCTION public.dashboard_sales_metrics(uuid, text[], text[], uuid[]) IS
  'Orders Today / Sales This Month / Pending Dispatch, summed in the DB with the day boundary taken from the account timezone. p_user_ids is the viewer DataScope on orders.user_id; NULL = unrestricted.';

GRANT EXECUTE ON FUNCTION public.dashboard_sales_metrics(uuid, text[], text[], uuid[]) TO authenticated, service_role;


-- ── 4. Payments: collection totals ───────────────────────────
-- One call for all three figures the two collection widgets need. The
-- previous month is bounded on BOTH sides.
CREATE OR REPLACE FUNCTION public.dashboard_collection_totals(
  p_account_id uuid,
  p_statuses text[]
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
DECLARE
  v_day_start timestamptz;
  v_month_start timestamptz;
  v_prev_month_start timestamptz;
  v_today numeric := 0;
  v_current numeric := 0;
  v_previous numeric := 0;
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  v_day_start        := public.account_day_start(p_account_id);
  v_month_start      := public.account_month_start(p_account_id);
  v_prev_month_start := public.account_month_start(p_account_id, v_month_start - interval '1 day');

  -- An approver may verify a different figure than the rep collected; the
  -- verified figure wins once present, and NULL means "not yet verified",
  -- not zero. Same rule as customer_outstanding().
  SELECT COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) INTO v_today
    FROM payments p
   WHERE p.account_id = p_account_id
     AND p.status = ANY (p_statuses)
     AND p.created_at >= v_day_start;

  SELECT COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) INTO v_current
    FROM payments p
   WHERE p.account_id = p_account_id
     AND p.status = ANY (p_statuses)
     AND p.created_at >= v_month_start;

  SELECT COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) INTO v_previous
    FROM payments p
   WHERE p.account_id = p_account_id
     AND p.status = ANY (p_statuses)
     AND p.created_at >= v_prev_month_start
     AND p.created_at <  v_month_start;

  RETURN jsonb_build_object(
    'today',          v_today,
    'month_current',  v_current,
    'month_previous', v_previous,
    'day_start',      v_day_start,
    'month_start',    v_month_start,
    'timezone',       public.account_timezone(p_account_id)
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_collection_totals(uuid, text[]) TO authenticated, service_role;


-- Collection split by payment type.
--
-- NOTE — THIS CHART HAS NEVER RENDERED. fetchCollectionByPaymentType selected
-- `payment_mode`, and there is no such column: the real one is
-- payments.payment_type. PostgREST answered 400 ("column payments.payment_mode
-- does not exist"), the caller read `data` as undefined and mapped an empty
-- array, so the widget drew an empty chart for every tenant instead of raising.
-- Confirmed against prod 2026-10-31.
DROP FUNCTION IF EXISTS public.dashboard_collection_by_type(uuid, text[]);
CREATE FUNCTION public.dashboard_collection_by_type(
  p_account_id uuid,
  p_statuses text[]
)
RETURNS TABLE (name text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  RETURN QUERY
  SELECT COALESCE(NULLIF(btrim(p.payment_type), ''), 'Other')::text AS name,
         COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0)    AS amount
    FROM payments p
   WHERE p.account_id = p_account_id
     AND p.status = ANY (p_statuses)
   GROUP BY 1
   ORDER BY 2 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_collection_by_type(uuid, text[]) TO authenticated, service_role;


-- Collection by collector. The name is joined here rather than fetched in a
-- second round trip, and `profiles` is read under the caller's RLS like
-- everything else. payments.user_id is an AUTH user id, so it joins
-- profiles.user_id — NOT profiles.id.
DROP FUNCTION IF EXISTS public.dashboard_collection_by_user(uuid, text[]);
CREATE FUNCTION public.dashboard_collection_by_user(
  p_account_id uuid,
  p_statuses text[]
)
RETURNS TABLE (user_id uuid, name text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  RETURN QUERY
  SELECT p.user_id,
         COALESCE(NULLIF(btrim(MAX(pr.full_name)), ''),
                  CASE WHEN p.user_id IS NULL THEN 'Unknown' ELSE 'Unknown User' END)::text AS name,
         COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) AS amount
    FROM payments p
    LEFT JOIN profiles pr ON pr.user_id = p.user_id
   WHERE p.account_id = p_account_id
     AND p.status = ANY (p_statuses)
   GROUP BY p.user_id
   ORDER BY 3 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_collection_by_user(uuid, text[]) TO authenticated, service_role;


-- ── 5. Outstanding ───────────────────────────────────────────
-- orders + opening balances - payments, under the account's own rule. The old
-- version selected EVERY order, EVERY payment and EVERY contact of the
-- account with no range at all: the single worst-affected figure, and the one
-- that went negative.
CREATE OR REPLACE FUNCTION public.dashboard_total_outstanding(
  p_account_id uuid,
  p_order_statuses text[],
  p_payment_statuses text[]
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
DECLARE
  v_orders numeric := 0;
  v_payments numeric := 0;
  v_opening numeric := 0;
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  SELECT COALESCE(SUM(COALESCE(o.total_amount, 0)), 0) INTO v_orders
    FROM orders o
   WHERE o.account_id = p_account_id AND o.status = ANY (p_order_statuses);

  SELECT COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) INTO v_payments
    FROM payments p
   WHERE p.account_id = p_account_id AND p.status = ANY (p_payment_statuses);

  SELECT COALESCE(SUM(COALESCE(c.opening_balance, 0)), 0) INTO v_opening
    FROM contacts c
   WHERE c.account_id = p_account_id;

  RETURN jsonb_build_object(
    'outstanding',    v_orders - v_payments + v_opening,
    'total_orders',   v_orders,
    'total_payments', v_payments,
    'total_opening',  v_opening
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_total_outstanding(uuid, text[], text[]) TO authenticated, service_role;


-- Payments waiting on an approver for longer than p_days.
--
-- The count is now exact and separate from the list. Before, the count WAS
-- the list's length, so an account with more than 1,000 stale payments
-- reported exactly 1,000 — and the browser parsed every one of them to show a
-- handful. `p_days` is elapsed days, deliberately not a calendar boundary:
-- "pending for three days" is a duration, not a date.
CREATE OR REPLACE FUNCTION public.dashboard_pending_approval_aging(
  p_account_id uuid,
  p_days integer DEFAULT 3,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
DECLARE
  v_cutoff timestamptz;
  v_count bigint := 0;
  v_rows jsonb;
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  v_cutoff := now() - make_interval(days => GREATEST(COALESCE(p_days, 3), 0));

  SELECT COUNT(*) INTO v_count
    FROM payments p
   WHERE p.account_id = p_account_id
     AND p.status = 'Pending'
     AND p.created_at < v_cutoff;

  SELECT COALESCE(jsonb_agg(s.r ORDER BY s.created_at), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT p.created_at,
             jsonb_build_object(
               'id',             p.id,
               'payment_number', p.payment_number,
               'amount',         p.amount,
               'created_at',     p.created_at,
               'customer',       COALESCE(NULLIF(btrim(c.name), ''), 'Unknown'),
               'days_pending',   FLOOR(EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400)::int
             ) AS r
        FROM payments p
        LEFT JOIN contacts c ON c.id = p.contact_id
       WHERE p.account_id = p_account_id
         AND p.status = 'Pending'
         AND p.created_at < v_cutoff
       ORDER BY p.created_at ASC
       LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    ) s;

  RETURN jsonb_build_object('count', v_count, 'payments', v_rows);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_pending_approval_aging(uuid, integer, integer) TO authenticated, service_role;


-- ── 6. Overdue customers ─────────────────────────────────────
-- A faithful set-based port of the loop that was running in the browser, and
-- of is_customer_overdue() which already implements the same rule in SQL:
-- a customer's payments settle their opening balance first, then their orders
-- oldest-first; any order left uncovered and older than credit_days makes the
-- customer overdue.
--
-- An order is uncovered exactly when `paid < opening + cumulative_total`
-- through that order — which is the running total below, so the whole account
-- is one pass instead of a per-customer loop (the shape that cancelled on
-- statement timeout when the per-order report tried it; see
-- 20261019120000_summary_report_modules.sql).
--
-- `, o.id` is added to the ordering the JS used (created_at alone) only to
-- make ties deterministic. It cannot move a figure: tied orders share a
-- created_at, so they share a days-old too.
--
-- The outstanding shown is the customer's whole balance
-- (opening + counted orders - counted payments), independent of the
-- allocation — identical to customer_outstanding() and to what the browser
-- computed. credit_days of 0 or NULL is "no credit terms", never "due today".
DROP FUNCTION IF EXISTS public.dashboard_overdue_customers(uuid, text[], text[], integer);
CREATE FUNCTION public.dashboard_overdue_customers(
  p_account_id uuid,
  p_order_statuses text[],
  p_payment_statuses text[],
  p_limit integer DEFAULT 200
)
RETURNS TABLE (id uuid, name text, outstanding numeric, days_overdue integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  RETURN QUERY
  WITH eligible AS (
    SELECT c.id, c.name, c.credit_days, COALESCE(c.opening_balance, 0) AS opening
      FROM contacts c
     WHERE c.account_id = p_account_id
       AND c.credit_days IS NOT NULL
       AND c.credit_days > 0
  ),
  paid AS (
    SELECT p.contact_id, COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) AS received
      FROM payments p
     WHERE p.account_id = p_account_id
       AND p.status = ANY (p_payment_statuses)
     GROUP BY p.contact_id
  ),
  queue AS (
    SELECT o.contact_id,
           o.created_at,
           SUM(COALESCE(o.total_amount, 0)) OVER (
             PARTITION BY o.contact_id
             ORDER BY o.created_at, o.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS cumulative
      FROM orders o
     WHERE o.account_id = p_account_id
       AND o.status = ANY (p_order_statuses)
  ),
  order_totals AS (
    SELECT o.contact_id, COALESCE(SUM(COALESCE(o.total_amount, 0)), 0) AS ordered
      FROM orders o
     WHERE o.account_id = p_account_id
       AND o.status = ANY (p_order_statuses)
     GROUP BY o.contact_id
  ),
  worst AS (
    -- The largest (days_old - credit_days) among the customer's uncovered
    -- orders, counting only those actually past their terms.
    SELECT e.id,
           MAX(FLOOR(EXTRACT(EPOCH FROM (now() - q.created_at)) / 86400)::int - e.credit_days) AS over_by
      FROM eligible e
      JOIN queue q ON q.contact_id = e.id
      LEFT JOIN paid pd ON pd.contact_id = e.id
     WHERE COALESCE(pd.received, 0) < e.opening + q.cumulative
       AND FLOOR(EXTRACT(EPOCH FROM (now() - q.created_at)) / 86400)::int > e.credit_days
     GROUP BY e.id
  )
  SELECT e.id,
         e.name::text,
         (e.opening + COALESCE(ot.ordered, 0) - COALESCE(pd.received, 0)) AS outstanding,
         w.over_by AS days_overdue
    FROM eligible e
    JOIN worst w ON w.id = e.id
    LEFT JOIN paid pd ON pd.contact_id = e.id
    LEFT JOIN order_totals ot ON ot.contact_id = e.id
   WHERE (e.opening + COALESCE(ot.ordered, 0) - COALESCE(pd.received, 0)) > 0
   ORDER BY w.over_by DESC
   LIMIT GREATEST(COALESCE(p_limit, 200), 1);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_overdue_customers(uuid, text[], text[], integer) TO authenticated, service_role;


-- Customers past their credit limit. opening + counted orders - counted
-- payments against credit_limit. A limit of 0 or NULL is "no limit set", as
-- the browser's `if (!c.credit_limit) return;` also treated it.
DROP FUNCTION IF EXISTS public.dashboard_credit_exceeded_customers(uuid, text[], text[], integer);
CREATE FUNCTION public.dashboard_credit_exceeded_customers(
  p_account_id uuid,
  p_order_statuses text[],
  p_payment_statuses text[],
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  id uuid,
  name text,
  credit_limit numeric,
  outstanding numeric,
  available_credit numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  RETURN QUERY
  WITH eligible AS (
    SELECT c.id, c.name, c.credit_limit, COALESCE(c.opening_balance, 0) AS opening
      FROM contacts c
     WHERE c.account_id = p_account_id
       AND c.credit_limit IS NOT NULL
       AND c.credit_limit <> 0
  ),
  ordered AS (
    SELECT o.contact_id, COALESCE(SUM(COALESCE(o.total_amount, 0)), 0) AS total
      FROM orders o
     WHERE o.account_id = p_account_id AND o.status = ANY (p_order_statuses)
     GROUP BY o.contact_id
  ),
  paid AS (
    SELECT p.contact_id, COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) AS total
      FROM payments p
     WHERE p.account_id = p_account_id AND p.status = ANY (p_payment_statuses)
     GROUP BY p.contact_id
  )
  SELECT e.id,
         e.name::text,
         e.credit_limit,
         (e.opening + COALESCE(o.total, 0) - COALESCE(pd.total, 0)) AS outstanding,
         e.credit_limit - (e.opening + COALESCE(o.total, 0) - COALESCE(pd.total, 0)) AS available_credit
    FROM eligible e
    LEFT JOIN ordered o ON o.contact_id = e.id
    LEFT JOIN paid pd ON pd.contact_id = e.id
   WHERE (e.opening + COALESCE(o.total, 0) - COALESCE(pd.total, 0)) > e.credit_limit
   ORDER BY 4 DESC
   LIMIT GREATEST(COALESCE(p_limit, 200), 1);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_credit_exceeded_customers(uuid, text[], text[], integer) TO authenticated, service_role;


-- ── 7. Mobile trend series ───────────────────────────────────
-- The mobile dashboard folded raw rows into day buckets in JS, which both
-- truncated at 1,000 rows and bucketed by the DEVICE's clock. These return
-- rows ALREADY bucketed by the account's own calendar day, so there is one
-- row per day instead of one per record and the key the app folds on is the
-- account's day, not the phone's.
--
-- p_start / p_end are inclusive CALENDAR dates as the account means them. The
-- upper bound is the day AFTER p_end, so nothing in the final day's last
-- second is dropped and nothing from the next day is pulled in.

DROP FUNCTION IF EXISTS public.dashboard_payment_daily(uuid, date, date, text[]);
CREATE FUNCTION public.dashboard_payment_daily(
  p_account_id uuid,
  p_start date,
  p_end date,
  p_statuses text[]
)
RETURNS TABLE (day date, amount numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
DECLARE
  v_tz text;
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);
  v_tz := public.account_timezone(p_account_id);

  RETURN QUERY
  SELECT (p.created_at AT TIME ZONE v_tz)::date AS day,
         COALESCE(SUM(COALESCE(p.verified_amount, p.amount)), 0) AS amount
    FROM payments p
   WHERE p.account_id = p_account_id
     AND p.status = ANY (p_statuses)
     AND p.created_at >= public.account_date_start(p_account_id, p_start)
     AND p.created_at <  public.account_date_start(p_account_id, (p_end + 1))
   GROUP BY 1
   ORDER BY 1;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_payment_daily(uuid, date, date, text[]) TO authenticated, service_role;


DROP FUNCTION IF EXISTS public.dashboard_orders_by_status(uuid, date, date);
CREATE FUNCTION public.dashboard_orders_by_status(
  p_account_id uuid,
  p_start date,
  p_end date
)
RETURNS TABLE (status text, order_count bigint, order_value numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  RETURN QUERY
  SELECT o.status::text,
         COUNT(*) AS order_count,
         COALESCE(SUM(COALESCE(o.total_amount, 0)), 0) AS order_value
    FROM orders o
   WHERE o.account_id = p_account_id
     AND o.created_at >= public.account_date_start(p_account_id, p_start)
     AND o.created_at <  public.account_date_start(p_account_id, (p_end + 1))
   GROUP BY o.status
   ORDER BY 2 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_orders_by_status(uuid, date, date) TO authenticated, service_role;


DROP FUNCTION IF EXISTS public.dashboard_contacts_daily(uuid, date, date);
CREATE FUNCTION public.dashboard_contacts_daily(
  p_account_id uuid,
  p_start date,
  p_end date
)
RETURNS TABLE (day date, contact_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
DECLARE
  v_tz text;
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);
  v_tz := public.account_timezone(p_account_id);

  RETURN QUERY
  SELECT (c.created_at AT TIME ZONE v_tz)::date AS day,
         COUNT(*) AS contact_count
    FROM contacts c
   WHERE c.account_id = p_account_id
     AND c.created_at >= public.account_date_start(p_account_id, p_start)
     AND c.created_at <  public.account_date_start(p_account_id, (p_end + 1))
   GROUP BY 1
   ORDER BY 1;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_contacts_daily(uuid, date, date) TO authenticated, service_role;


-- Open deals per pipeline stage. Counted in the DB so a pipeline with more
-- than 1,000 open deals stops losing the overflow from the funnel chart.
DROP FUNCTION IF EXISTS public.dashboard_open_deals_by_stage(uuid);
CREATE FUNCTION public.dashboard_open_deals_by_stage(p_account_id uuid)
RETURNS TABLE (stage_id uuid, deal_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER
AS $fn$
BEGIN
  PERFORM public.assert_dashboard_account(p_account_id);

  RETURN QUERY
  SELECT d.stage_id, COUNT(*) AS deal_count
    FROM deals d
   WHERE d.account_id = p_account_id
     AND d.status = 'open'
     AND d.stage_id IS NOT NULL
   GROUP BY d.stage_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dashboard_open_deals_by_stage(uuid) TO authenticated, service_role;
