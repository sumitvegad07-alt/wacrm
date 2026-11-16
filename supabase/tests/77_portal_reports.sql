-- ============================================================
-- 2026-11-16 — the four reports a distributor runs. Plan 6 §3.
--
-- The rule every scenario here is written to: A REPORT'S FIGURE IS CHECKED BY
-- COMPUTING IT A SECOND WAY, from the base tables, and comparing. A report
-- asserted against a hard-coded number only proves the number has not changed;
-- one asserted against its own arithmetic proves it is right.
--
-- THE TRAP THIS FILE WAS WRITTEN WRONG FOR THE FIRST TIME, 2026-11-16:
-- **the second computation cannot be done while impersonating the portal
-- user.** RLS hides `orders`, `order_items`, `payments` and
-- `order_dispatches` from a portal login — it reaches them ONLY through the
-- definer functions. A base-table query run as that role returns no rows, so
-- `report_total = recomputed_total` quietly became `x = NULL` (fails) or
-- `0 = 0` (passes, having measured nothing). Seven scenarios here were one or
-- the other.
--
-- So: every expected figure is computed AS THE ADMIN and captured with
-- `\gset`, and only then is the report read as the distributor. The tree is
-- walked explicitly rather than borrowed from `portal_visible_contact_ids()`,
-- which answers nothing for an admin — and walking it is the more honest
-- second opinion anyway.
--
-- `coalesce` guards every captured value: psql UNSETS a \gset variable whose
-- value is NULL, and the next line then dies of "syntax error at or near :".
--
-- Runs LAST, after 76. It writes nothing except the one order it closes,
-- because "Sales" means a CLOSED order and nothing in the fixture is closed.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''
\set PORTAL_U_A1 '''00000000-0000-0000-0000-00000000a001'''
\set PORTAL_U_A2 '''00000000-0000-0000-0000-00000000a002'''

\set DIST_A1 '''cc000000-0000-0000-0000-0000000000a1'''
\set STK_A1  '''cc000000-0000-0000-0000-0000000000a3'''

\set ORD_S1  '''ee000000-0000-0000-0000-0000000000e2'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

-- ── The second opinion, computed by somebody who can see the tables ──
--
-- DIST_A1's tree MINUS DIST_A1 themselves: their customers' orders are their
-- sales; their own order on the company is not.
CREATE OR REPLACE VIEW qa_below_dist_a1 AS
  WITH RECURSIVE t AS (
    SELECT id FROM public.contacts WHERE id = 'cc000000-0000-0000-0000-0000000000a1'
    UNION ALL
    SELECT c.id FROM public.contacts c JOIN t ON c.parent_id = t.id
  )
  SELECT id FROM t WHERE id <> 'cc000000-0000-0000-0000-0000000000a1';

SELECT coalesce(count(*), 0) AS exp_orders,
       coalesce(sum(o.total_amount), 0) AS exp_amount
  FROM public.orders o
 WHERE o.contact_id IN (SELECT id FROM qa_below_dist_a1) \gset

SELECT coalesce(sum(di.quantity), 0) AS exp_dispatched
  FROM public.dispatch_items di
  JOIN public.order_dispatches d ON d.id = di.dispatch_id
  JOIN public.orders o ON o.id = d.order_id
 WHERE o.contact_id IN (SELECT id FROM qa_below_dist_a1) \gset

SELECT coalesce(sum(p.amount), 0) AS exp_paid,
       coalesce(sum(p.amount) FILTER (WHERE p.status = 'Approved'), 0) AS exp_approved
  FROM public.payments p
 WHERE p.contact_id IN (SELECT id FROM qa_below_dist_a1) \gset

SELECT coalesce((SELECT o.total_amount FROM public.orders o WHERE o.id = :ORD_S1), 0)
         AS s1_total,
       coalesce((SELECT sum(oi.quantity) FROM public.order_items oi
                  WHERE oi.order_id = :ORD_S1), 0) AS s1_qty,
       coalesce(to_char((SELECT max(d.dispatched_at) FROM public.order_dispatches d
                          WHERE d.order_id = :ORD_S1), 'YYYY-MM-DD'), '') AS s1_sold_on \gset

SELECT qa('R0 the second opinion found something to compare against',
  :exp_orders > 0 AND :exp_amount > 0 AND :'s1_sold_on' <> '',
  'a check computed from an empty query passes while measuring nothing — '
  'that is the fault this whole file was rewritten for');

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- ── Order report ─────────────────────────────────────────────
SELECT qa('R1 the Order report''s totals match the orders themselves',
  (public.portal_report_orders(NULL, NULL, 'customer') -> 'totals' ->> 'orders')::int
    = :exp_orders
  AND (public.portal_report_orders(NULL, NULL, 'customer') -> 'totals' ->> 'amount')::numeric
    = :exp_amount,
  'computed a second way by walking the tree, not asserted against a number');

SELECT qa('R2 the caller''s OWN purchase order is not in their sales figures',
  public.portal_report_orders(NULL, NULL, 'customer')::text NOT LIKE '%Distributor A1%',
  'ORD_P1 is what THEY bought from the company; it is not one of their sales');

SELECT qa('R3 the rows add up to the total',
  (SELECT coalesce(sum((x ->> 'orders')::int), 0)
     FROM jsonb_array_elements(public.portal_report_orders(NULL, NULL, 'customer') -> 'rows') x)
    = (public.portal_report_orders(NULL, NULL, 'customer') -> 'totals' ->> 'orders')::int,
  'a footer that disagrees with the column above it is the one thing a report must never do');

SELECT qa('R4 dispatched agrees with the dispatch tables',
  (public.portal_report_orders(NULL, NULL, 'day') -> 'totals' ->> 'dispatched')::numeric
    = :exp_dispatched
  AND :exp_dispatched > 0,
  '76 sent 2 of ORD_S1; this is the same figure arrived at from the other side');

SELECT qa('R5 grouping by status is the same orders in different heaps',
  (SELECT coalesce(sum((x ->> 'orders')::int), 0)
     FROM jsonb_array_elements(public.portal_report_orders(NULL, NULL, 'status') -> 'rows') x)
    = (public.portal_report_orders(NULL, NULL, 'day') -> 'totals' ->> 'orders')::int,
  'the grouping must not change the population');

SELECT qa_refused('R6 a grouping the report does not have is refused, not guessed',
  $$ SELECT public.portal_report_orders(NULL, NULL, 'salesman') $$);

-- ── Sales report ─────────────────────────────────────────────
-- A sale is a CLOSED order, dated by its last dispatch. Nothing is closed yet,
-- so the figure is zero — which is the definition working, not a gap.
SELECT qa('R7 Sales is empty while nothing has been finished',
  (public.portal_report_sales(NULL, NULL, 'day') -> 'totals' ->> 'orders')::int = 0,
  'ORD_S1 is Part Dispatch after 76 — a part-sent order is not a sale yet');

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT set_config('app.order_status_system', '1', true);
-- Taken to Closed directly: what is under test here is the REPORT, not the
-- status machine, which 089 and 10_buying_status already cover.
UPDATE public.orders SET status = 'Closed' WHERE id = :ORD_S1;
SELECT set_config('app.order_status_system', '', true);

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('R8 a finished order is a sale, at its FULL value',
  (public.portal_report_sales(NULL, NULL, 'day') -> 'totals' ->> 'orders')::int = 1
  AND (public.portal_report_sales(NULL, NULL, 'day') -> 'totals' ->> 'amount')::numeric
      = :s1_total,
  'a part-dispatched order contributes nothing until it completes, then all of it — '
  'the admin app''s own rule, so the two reports reconcile');

SELECT qa('R9 and it is dated by the DISPATCH, not by the order date',
  (public.portal_report_sales(NULL, NULL, 'day') -> 'rows' -> 0 ->> 'label') = :'s1_sold_on',
  'ORD_S1 is five days old and went out today — Sales must say today');

SELECT qa('R10 a window that excludes the dispatch date excludes the sale',
  (public.portal_report_sales(:'s1_sold_on'::date - 30, :'s1_sold_on'::date - 1, 'day')
    -> 'totals' ->> 'orders')::int = 0
  AND (public.portal_report_sales(:'s1_sold_on'::date - 30, :'s1_sold_on'::date, 'day')
    -> 'totals' ->> 'orders')::int = 1,
  'proves R9''s date is the one the FILTER uses, not just the one it prints');

SELECT qa('R11 by product, the quantity is the order''s own lines',
  (SELECT coalesce(sum((x ->> 'quantity')::numeric), 0)
     FROM jsonb_array_elements(public.portal_report_sales(NULL, NULL, 'product') -> 'rows') x)
    = :s1_qty,
  'grouping by product changes the grain to the line; the quantity must still be the order''s');

-- R3 checked a footer against its column for ONE grouping. The grouping that
-- actually gets this wrong is BY PRODUCT, where the grain moves from the order
-- to the order line — an order-level total under item-level rows.
SELECT qa('R11b every grouping''s footer equals the column above it',
  (SELECT bool_and(ok) FROM (
     SELECT (SELECT coalesce(sum((x ->> 'amount')::numeric), 0)
               FROM jsonb_array_elements(public.portal_report_sales(NULL, NULL, g) -> 'rows') x)
            = (public.portal_report_sales(NULL, NULL, g) -> 'totals' ->> 'amount')::numeric AS ok
       FROM unnest(ARRAY['day','month','customer','product']) g) t),
  'the product tab is the one that was wrong: item-level rows, order-level total');

SELECT qa('R11c and the Order report''s footers too',
  (SELECT coalesce(sum((x ->> 'amount')::numeric), 0)
     FROM jsonb_array_elements(public.portal_report_orders(NULL, NULL, 'product') -> 'rows') x)
    = (public.portal_report_orders(NULL, NULL, 'product') -> 'totals' ->> 'amount')::numeric
  AND (SELECT coalesce(sum((x ->> 'amount')::numeric), 0)
         FROM jsonb_array_elements(public.portal_report_orders(NULL, NULL, 'customer') -> 'rows') x)
      = (public.portal_report_orders(NULL, NULL, 'customer') -> 'totals' ->> 'amount')::numeric,
  'an order with two products appears twice in the product rows, so its COUNT cannot match — '
  'the amount must');

-- ── Collection report ────────────────────────────────────────
SELECT qa('R12 Collection counts what their SHOPS paid them, and not their own dues',
  (public.portal_report_collection(NULL, NULL, 'customer') -> 'totals' ->> 'amount')::numeric
    = :exp_paid
  AND public.portal_report_collection(NULL, NULL, 'customer')::text NOT LIKE '%Distributor A1%',
  'the two ledgers stay apart — a shop''s money never reduces what the distributor owes upward');

SELECT qa('R13 Approved is reported apart from the total claimed',
  (public.portal_report_collection(NULL, NULL, 'day') -> 'totals' ->> 'approved')::numeric
    = :exp_approved,
  'a collection report showing one total would be read as money in hand and be money claimed');

SELECT qa('R14 grouping by collector names the person, and nothing else about them',
  public.portal_report_collection(NULL, NULL, 'collected_by')::text NOT LIKE '%@%'
  AND public.portal_report_collection(NULL, NULL, 'collected_by')::text NOT LIKE '%user_id%',
  'the same narrow reversal of spec 17 q4 as the Collected by column');

-- ── Outstanding report ───────────────────────────────────────
SELECT qa('R15 every outstanding row carries its age and a bucket',
  (SELECT bool_and((x ->> 'days') IS NOT NULL
                   AND (x ->> 'bucket') IN ('0-30','31-60','61-90','90+'))
     FROM jsonb_array_elements(public.portal_report_outstanding('order') -> 'rows') x)
    IS NOT FALSE,
  'a collections list without an age is a list of names');

SELECT qa('R16 both groupings answer',
  public.portal_report_outstanding('customer') -> 'totals' ->> 'balance' IS NOT NULL
  AND public.portal_report_outstanding('order') -> 'totals' ->> 'outstanding' IS NOT NULL,
  'R17 is what pins the scope');

SELECT qa('R17 the caller''s own balance is not in their receivables',
  public.portal_report_outstanding('customer')::text NOT LIKE '%Distributor A1%',
  'what THEY owe the company is not something their shops owe them');

SELECT qa_refused('R18 an unknown grouping is refused here too',
  $$ SELECT public.portal_report_outstanding('area') $$);

-- ── Nothing crosses the tree ─────────────────────────────────
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A2, false);
SET ROLE authenticated;

SELECT qa('R19 the distributor next door sees none of these figures',
  (public.portal_report_orders(NULL, NULL, 'customer') -> 'totals' ->> 'amount')::numeric
    <> :exp_amount
  AND public.portal_report_orders(NULL, NULL, 'customer')::text NOT LIKE '%Stockist A1%'
  AND public.portal_report_sales(NULL, NULL, 'day')::text NOT LIKE '%Stockist A1%'
  AND public.portal_report_collection(NULL, NULL, 'customer')::text NOT LIKE '%Stockist A1%'
  AND public.portal_report_outstanding('customer')::text NOT LIKE '%Stockist A1%',
  'spec 15 test 2 — every report is scoped on its own first line, not by the screen');

RESET ROLE;
DROP VIEW IF EXISTS qa_below_dist_a1;
