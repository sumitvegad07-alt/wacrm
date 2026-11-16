-- ============================================================
-- 2026-11-16 — a filter on every column, and who booked / collected it.
-- Plan 6 §0 and §1.
--
-- Two things are being pinned here and they pull in opposite directions:
--
--   * a filter must NARROW — both the rows and the `total` under them, or the
--     pager offers page 4 of a list that has one page;
--   * a filter must never WIDEN. Every scenario that filters is paired with
--     one that checks the tree still holds: another distributor's shop and
--     another tenant stay invisible no matter what is typed into a box.
--
-- Reuses the tree and the orders from 70_portal_visibility.sql:
--   ORD_P1  DIST_A1 buys from the company   1000  Pending   10 days old
--   ORD_S1  STK_A1 buys from DIST_A1         500  Approved   5 days old
--   ORD_S2  DLR_A1 buys VIA THE PORTAL       250  Pending    1 day old
--   ORD_X1  DLR_A2 (under DIST_A2)           900             invisible
--   ORD_B1  tenant B                         700             invisible
--
-- 74 replaces the payments, so nothing here counts payments globally.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''
\set PORTAL_U_A1 '''00000000-0000-0000-0000-00000000a001'''

\set DIST_A1 '''cc000000-0000-0000-0000-0000000000a1'''
\set STK_A1  '''cc000000-0000-0000-0000-0000000000a3'''
\set DLR_A1  '''cc000000-0000-0000-0000-0000000000a4'''

\set ORD_P1  '''ee000000-0000-0000-0000-0000000000e1'''
\set ORD_S1  '''ee000000-0000-0000-0000-0000000000e2'''
\set ORD_S2  '''ee000000-0000-0000-0000-0000000000e3'''

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- ── The baseline every "did not widen" scenario is measured against ──
SELECT qa('F0 the unfiltered list is the three orders inside the tree',
  (public.portal_orders('all') ->> 'total')::int = 3,
  'saw ' || (public.portal_orders('all') ->> 'total'));

-- ── Text ─────────────────────────────────────────────────────
SELECT qa('F1 a column filter narrows the ROWS and the TOTAL together',
  (public.portal_orders('all', p_filters => '{"customer_name":"Dealer A1"}'::jsonb) ->> 'total')::int = 1
  AND jsonb_array_length(
        public.portal_orders('all', p_filters => '{"customer_name":"Dealer A1"}'::jsonb) -> 'rows') = 1
  AND public.portal_orders('all', p_filters => '{"customer_name":"Dealer A1"}'::jsonb)
        -> 'rows' -> 0 ->> 'id' = trim(both '''' from :'ORD_S2'),
  'a total that does not follow the rows is a pager offering pages that do not exist');

SELECT qa('F1b the match is case-insensitive and partial, like the admin app''s',
  (public.portal_orders('all', p_filters => '{"customer_name":"dealer"}'::jsonb) ->> 'total')::int = 1,
  'a reader types three letters, not the whole business name');

-- ── Multi-select ─────────────────────────────────────────────
SELECT qa('F2 a multi-select matches ANY of the chosen values',
  (public.portal_orders('all', p_filters => '{"status":["Approved"]}'::jsonb) ->> 'total')::int = 1
  AND (public.portal_orders('all', p_filters => '{"status":["Approved","Pending"]}'::jsonb) ->> 'total')::int = 3,
  'one status is ORD_S1; both statuses are all three');

SELECT qa('F3 an EMPTY list means no filter, not "match nothing"',
  (public.portal_orders('all', p_filters => '{"status":[]}'::jsonb) ->> 'total')::int = 3,
  'the reader un-ticked the last box; they did not ask for an empty screen');

SELECT qa('F4 placed_via separates a portal order from a company one',
  (public.portal_orders('all', p_filters => '{"placed_via":["portal"]}'::jsonb) ->> 'total')::int = 1
  AND public.portal_orders('all', p_filters => '{"placed_via":["portal"]}'::jsonb)
        -> 'rows' -> 0 ->> 'id' = trim(both '''' from :'ORD_S2'),
  'ORD_S2 is the one placed through the portal');

-- ── Range ────────────────────────────────────────────────────
SELECT qa('F5 a money range has two independent ends',
  (public.portal_orders('all', p_filters => '{"total_amount_min":"600"}'::jsonb) ->> 'total')::int = 1
  AND (public.portal_orders('all', p_filters => '{"total_amount_max":"300"}'::jsonb) ->> 'total')::int = 1
  AND (public.portal_orders('all', p_filters => '{"total_amount_min":"200","total_amount_max":"600"}'::jsonb)
        ->> 'total')::int = 2,
  'over 600 is ORD_P1; under 300 is ORD_S2; between is S1 and S2');

SELECT qa('F5b a contains-match on an amount would have been wrong',
  (public.portal_orders('all', p_filters => '{"total_amount_min":"1000","total_amount_max":"1000"}'::jsonb)
    ->> 'total')::int = 1,
  'searching 100 must not find 1000 — which is why money is a range and not a text box');

-- ── Dates ────────────────────────────────────────────────────
SELECT qa('F6 a date range filters on the order''s own date',
  (public.portal_orders('all',
     p_filters => jsonb_build_object('date_from', to_char(CURRENT_DATE - 3, 'YYYY-MM-DD')))
    ->> 'total')::int = 1
  AND (public.portal_orders('all',
     p_filters => jsonb_build_object('date_to', to_char(CURRENT_DATE - 4, 'YYYY-MM-DD')))
    ->> 'total')::int = 2,
  'the last 3 days hold ORD_S2 alone; older than 4 days holds P1 and S1');

-- ── What a hand-typed URL may do, which is nothing ───────────
SELECT qa('F7 a key the function does not name is ignored, not an error',
  (public.portal_orders('all', p_filters => '{"employee_code":"EMP-1","salary":"99"}'::jsonb)
    ->> 'total')::int = 3,
  'a stale bookmark must not blank the screen');

SELECT qa('F8 a number that is not a number becomes NO filter, never SQL',
  (public.portal_orders('all',
     p_filters => '{"total_amount_min":"1; drop table public.orders"}'::jsonb) ->> 'total')::int = 3
  AND (public.portal_orders('all', p_filters => '{"total_amount_min":"1e5"}'::jsonb) ->> 'total')::int = 3,
  'nothing in the bag is interpolated; the helper''s regex refuses it first');

-- Asserted as the ADMIN. A portal login cannot SELECT `orders` at all — RLS
-- hides it — so "the table is still there" checked as the portal user would be
-- false whether or not the drop had happened, which is the opposite of a test.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT qa('F8b and the table it named is still there',
  (SELECT count(*) FROM public.orders WHERE id = :ORD_P1) = 1,
  'assert the TABLE, not the absence of an error message');
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('F9 a date that is not a date becomes no filter',
  (public.portal_orders('all', p_filters => '{"date_from":"yesterday"}'::jsonb) ->> 'total')::int = 3
  AND (public.portal_orders('all', p_filters => '{"date_from":"16/11/2026"}'::jsonb) ->> 'total')::int = 3,
  'to_date on a free-text value would abort the whole list');

SELECT qa('F10 p_filters => null is yesterday''s list exactly',
  (public.portal_orders('all', p_filters => NULL) ->> 'total')::int = 3
  AND (public.portal_orders('all', p_filters => '{}'::jsonb) ->> 'total')::int = 3,
  'every new argument defaults, so a caller that passes nothing is unaffected');

-- ── A filter must never widen ────────────────────────────────
SELECT qa('F11 filtering for a shop OUTSIDE the tree finds nothing',
  (public.portal_orders('all', p_filters => '{"customer_name":"Dealer A2"}'::jsonb) ->> 'total')::int = 0
  AND (public.portal_orders('all', p_filters => '{"customer_name":"Distributor B1"}'::jsonb) ->> 'total')::int = 0,
  'spec 15 tests 1 and 2 — the filter runs INSIDE portal_visible_contact_ids(), never beside it');

SELECT qa('F11b and an amount that only the invisible orders carry finds nothing',
  (public.portal_orders('all', p_filters => '{"total_amount_min":"900","total_amount_max":"900"}'::jsonb)
    ->> 'total')::int = 0,
  'ORD_X1 is 900 and belongs to the distributor next door');

-- ── Booked by (Plan 6 §1) ────────────────────────────────────
--
-- This REVERSES spec §17 q4 (2026-11-07, "no employee is ever named to a
-- distributor") on the founder's own instruction of 2026-11-16. The reversal
-- is narrow on purpose: the NAME, because a retailer disputing a quantity
-- means the distributor has to know who wrote it down — and nothing else.
SELECT qa('F12 a company-booked order names the person who booked it',
  (SELECT x ->> 'booked_by_name' FROM jsonb_array_elements(public.portal_orders('all') -> 'rows') x
    WHERE x ->> 'id' = trim(both '''' from :'ORD_S1')) = 'Admin A',
  'orders.salesman_name is already denormalised (20261012100000), so this is a column read');

SELECT qa('F13 an order the distributor placed themselves names THEM, not an employee',
  (SELECT x ->> 'booked_by_name' FROM jsonb_array_elements(public.portal_orders('all') -> 'rows') x
    WHERE x ->> 'id' = trim(both '''' from :'ORD_S2')) = 'Distributor A1',
  'ORD_S2 also carries user_id = Admin A, so this proves the portal contact wins the coalesce');

SELECT qa('F14 Booked by is filterable, which is the point of pairing it with the filter row',
  (public.portal_orders('all', p_filters => '{"booked_by_name":"admin"}'::jsonb) ->> 'total')::int = 2
  AND (public.portal_orders('all', p_filters => '{"booked_by_name":"Distributor A1"}'::jsonb)
        ->> 'total')::int = 1,
  'two orders were booked by Admin A; one by the distributor themselves');

SELECT qa('F15 the NAME, and nothing else about the person',
  public.portal_orders('all')::text NOT LIKE '%user_id%'
  AND public.portal_orders('all')::text NOT LIKE '%@%'
  AND public.portal_orders('all')::text NOT LIKE '%employee_code%'
  AND public.portal_orders('all')::text NOT LIKE '%"role"%'
  AND public.portal_orders('all')::text NOT LIKE '%territory%',
  'asserted against the whole payload text, so a field added later cannot slip in unnoticed');

SELECT qa('F16 the order screen names the booker too',
  public.portal_order_detail(:ORD_S2) ->> 'booked_by_name' = 'Distributor A1'
  AND public.portal_order_detail(:ORD_S1) ->> 'booked_by_name' = 'Admin A'
  AND public.portal_order_detail(:ORD_S1)::text NOT LIKE '%@%',
  'the list and the screen must not disagree about who booked it');

-- ── Collected by ─────────────────────────────────────────────
-- A staff-recorded receipt resolves through profiles. A portal-recorded one
-- carries the SHOP's own rep in payments.user_id (portal_record_payment reads
-- it from contacts.user_id, because a portal login has no profile), so reading
-- user_id alone would name an employee who never touched the money — which is
-- why 'customer' receipts are named from the handover log instead.
SELECT qa('F17 a receipt the company recorded names the employee who took it',
  (SELECT count(*) FROM jsonb_array_elements(public.portal_payments() -> 'rows') x
    WHERE x ->> 'collected_by_name' = 'Admin A') >= 1,
  'payments.user_id -> profiles.full_name, the same resolution the admin app''s own list uses');

SELECT qa('F18 and still nothing else about them',
  public.portal_payments()::text NOT LIKE '%@%'
  AND public.portal_payments()::text NOT LIKE '%user_id%'
  AND public.portal_payments()::text NOT LIKE '%employee_code%',
  'a name is the accountability chain; an email address is not');

SELECT qa('F19 Collected by is filterable',
  (public.portal_payments(p_filters => '{"collected_by_name":"admin a"}'::jsonb) ->> 'total')::int >= 1
  AND (public.portal_payments(p_filters => '{"collected_by_name":"nobody at all"}'::jsonb)
        ->> 'total')::int = 0,
  'and a name nobody has narrows to nothing rather than to everything');

SELECT qa('F20 a payment filter narrows rows and total together',
  (public.portal_payments(p_filters => '{"customer_name":"Stockist A1"}'::jsonb) ->> 'total')::int
    = jsonb_array_length(public.portal_payments(p_filters => '{"customer_name":"Stockist A1"}'::jsonb) -> 'rows'),
  'the same rule as F1, on the other list');

SELECT qa('F21 a payment filter cannot reach another tenant',
  (public.portal_payments(p_filters => '{"customer_name":"Distributor B1"}'::jsonb) ->> 'total')::int = 0,
  'PAY-B-1 belongs to tenant B');

-- ── Customers ────────────────────────────────────────────────
SELECT qa('F22 the customer list filters per column',
  jsonb_array_length(public.portal_customers(p_filters => '{"company":"Stockist"}'::jsonb)) = 1
  AND jsonb_array_length(public.portal_customers(p_filters => '{"name":"Dlr"}'::jsonb)) = 1,
  'company and name are separate boxes, because they are separate columns');

-- The Customer column shows `company || name`, so its filter has to match
-- both, or a shop entered under a person's name is unfindable by the name the
-- reader is looking straight at.
SELECT qa('F22b the Customer column''s own filter matches company OR name',
  jsonb_array_length(public.portal_customers(p_filters => '{"customer_name":"Stockist A1"}'::jsonb)) = 1
  AND jsonb_array_length(public.portal_customers(p_filters => '{"customer_name":"Dlr A1"}'::jsonb)) = 1,
  'Stockist A1 is a company; Dlr A1 is a name — one box must find both');

SELECT qa('F23 and the caller is still excluded from their own customer list',
  public.portal_customers(p_filters => '{"company":"Distributor A1"}'::jsonb) = '[]'::jsonb,
  'a distributor is not their own customer — P4 in 70_portal_visibility');

SELECT qa('F24 an outstanding range works on the customer list',
  jsonb_array_length(public.portal_customers(p_filters => '{"outstanding_balance_min":"-999999"}'::jsonb))
    = jsonb_array_length(public.portal_customers()),
  'a bound below every balance must not drop anybody — a negative balance is a real balance');

-- Asserted as "every row that came back IS a 2", not as a count: a count here
-- would be a hostage to any other scenario file that adds a customer, and
-- would then fail for a reason that has nothing to do with filtering.
SELECT qa('F25 hierarchy_level is an INTEGER and still filters as text',
  (SELECT count(*) FROM jsonb_array_elements(
      public.portal_customers(p_filters => '{"hierarchy_level":["2"]}'::jsonb)) x
    WHERE x ->> 'hierarchy_level' IS DISTINCT FROM '2') = 0
  AND jsonb_array_length(public.portal_customers(p_filters => '{"hierarchy_level":["2"]}'::jsonb)) >= 1
  AND jsonb_array_length(public.portal_customers(p_filters => '{"hierarchy_level":["abc"]}'::jsonb)) = 0,
  'an integer cast on a hand-typed value would abort the whole list instead of matching nothing');

RESET ROLE;
