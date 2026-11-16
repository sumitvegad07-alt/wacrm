-- ============================================================
-- 2026-11-16 — a distributor dispatches their own sales orders. Plan 6 §2.
--
-- The one line everything here is drawn around:
--
--   a distributor ships what their SHOPS ordered from them;
--   the company ships what the DISTRIBUTOR ordered from the company.
--
-- D4 is the scenario that matters most. Letting a distributor mark their own
-- purchase order Dispatched would be signing for a delivery the company has
-- not made, and it moves the primary ledger's status on the company's behalf.
--
-- Reuses the tree and the orders from 70_portal_visibility.sql:
--   ORD_P1  DIST_A1 buys from the company   Pending     <- the caller's OWN
--   ORD_S1  STK_A1 buys from DIST_A1        Approved    <- dispatchable
--   ORD_S2  DLR_A1 buys via the portal      Pending
--   ORD_X1  DLR_A2, under DIST_A2                       <- invisible
--   ORD_B1  tenant B                                    <- invisible
--
-- Dispatch ids this file owns: dd000000-…-0000000000d1 upward.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''
\set PORTAL_U_A1 '''00000000-0000-0000-0000-00000000a001'''
\set PORTAL_U_A2 '''00000000-0000-0000-0000-00000000a002'''

\set DIST_A1 '''cc000000-0000-0000-0000-0000000000a1'''
\set STK_A1  '''cc000000-0000-0000-0000-0000000000a3'''

\set ORD_P1  '''ee000000-0000-0000-0000-0000000000e1'''
\set ORD_S1  '''ee000000-0000-0000-0000-0000000000e2'''
\set ORD_S2  '''ee000000-0000-0000-0000-0000000000e3'''
\set ORD_X1  '''ee000000-0000-0000-0000-0000000000e4'''
\set ORD_B1  '''ee000000-0000-0000-0000-0000000000eb'''

\set DSP_1 '''dd000000-0000-0000-0000-0000000000d1'''
\set DSP_2 '''dd000000-0000-0000-0000-0000000000d2'''
\set DSP_3 '''dd000000-0000-0000-0000-0000000000d3'''
\set DSP_4 '''dd000000-0000-0000-0000-0000000000d4'''
\set DSP_5 '''dd000000-0000-0000-0000-0000000000d5'''
\set DSP_6 '''dd000000-0000-0000-0000-0000000000d6'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

DELETE FROM public.dispatch_items WHERE dispatch_id IN (:DSP_1,:DSP_2,:DSP_3,:DSP_4,:DSP_5,:DSP_6);
DELETE FROM public.order_dispatches WHERE id IN (:DSP_1,:DSP_2,:DSP_3,:DSP_4,:DSP_5,:DSP_6);

-- 70 leaves ORD_S1 Approved, which is where a dispatchable order starts. 72
-- and 74 do not touch it; this line makes the starting point explicit rather
-- than inherited, because a scenario that depends on another file's leftovers
-- fails for the wrong reason when that file changes.
SELECT set_config('app.order_status_system', '1', true);
UPDATE public.orders SET status = 'Approved' WHERE id = :ORD_S1;
-- ORD_P1 — the caller's OWN purchase order — is moved to Approved too, and
-- that is the whole point of D4.
--
-- Left Pending, D4 is refused by the STATUS rule before the ownership rule is
-- ever reached, so the scenario passes whether or not the ownership check
-- exists. The mutation check caught exactly that on 2026-11-16: the rule was
-- removed and D4 went on passing. A guard that cannot fail is not a guard.
UPDATE public.orders SET status = 'Approved' WHERE id = :ORD_P1;
SELECT set_config('app.order_status_system', '', true);

-- A REAL line of the caller's OWN purchase order, captured here because the
-- portal login cannot read `order_items` and `portal_dispatch_lines` will not
-- hand it over either — it hides the caller's own purchase order by the same
-- rule D4 is testing. Handing the function a genuine, well-formed request is
-- the only way to make the ownership check the ONLY thing that can refuse it.
SELECT coalesce((SELECT oi.id::text FROM public.order_items oi
                  WHERE oi.order_id = :ORD_P1 ORDER BY oi.position LIMIT 1), '')
         AS p1_item \gset

SELECT qa('D0b the line D4 will send is a real one',
  :'p1_item' <> '',
  'with no line D4 is refused for an empty list and proves nothing');

SELECT qa('D0 both orders start Approved, with 5 ordered and 0 sent on ORD_S1',
  (SELECT status FROM public.orders WHERE id = :ORD_S1) = 'Approved'
  -- If this is not Approved, D4 proves nothing: see the note above.
  AND (SELECT status FROM public.orders WHERE id = :ORD_P1) = 'Approved'
  AND (SELECT sum(quantity) FROM public.order_items WHERE order_id = :ORD_S1) = 5
  AND NOT EXISTS (SELECT 1 FROM public.dispatch_items di
                    JOIN public.order_dispatches d ON d.id = di.dispatch_id
                   WHERE d.order_id = :ORD_S1),
  'the arithmetic every scenario below is measured against');

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- ── D1: the thing he asked for ───────────────────────────────
SELECT qa_allowed('D1 a distributor dispatches part of their own shop''s order',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d1'::uuid,
       'ee000000-0000-0000-0000-0000000000e2'::uuid,
       (SELECT jsonb_agg(jsonb_build_object('order_item_id', x ->> 'order_item_id',
                                      'quantity', 2))
          FROM jsonb_array_elements(
                 public.portal_dispatch_lines('ee000000-0000-0000-0000-0000000000e2'::uuid)) x),
       '{"transport_name":"Blue Dart","lr_no":"LR-9","invoice_no":"INV-7"}'::jsonb) $$);

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT qa('D1b the load was numbered by the account''s own generator',
  (SELECT dispatch_number FROM public.order_dispatches WHERE id = :DSP_1) IS NOT NULL
  AND (SELECT dispatch_number FROM public.order_dispatches WHERE id = :DSP_1) <> '',
  'dispatch_number is left NULL for trg_set_dispatch_number — a second generator is two series');

-- The 089 trigger is what makes the status true, and it is fired by the INSERT
-- into dispatch_items, not by the header. If search_path were '' the trigger's
-- unqualified table names would have died and the status would still read
-- Approved — which is why this is asserted and not assumed.
SELECT qa('D2 two of five sent moves the order to Part Dispatch',
  (SELECT status FROM public.orders WHERE id = :ORD_S1) = 'Part Dispatch',
  'the existing trigger recomputes it; the portal does not set status itself');
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('D3 the remaining quantity is now three',
  (SELECT (public.portal_dispatch_lines(:ORD_S1) -> 0 ->> 'remaining')::numeric) = 3
  AND (SELECT (public.portal_dispatch_lines(:ORD_S1) -> 0 ->> 'shipped')::numeric) = 2,
  'ordered 5, sent 2');

-- ── D4: the line the money draws ─────────────────────────────
SELECT qa_refused('D4 a distributor cannot dispatch their OWN purchase order',
  format($$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d2'::uuid,
       'ee000000-0000-0000-0000-0000000000e1'::uuid,
       jsonb_build_array(jsonb_build_object('order_item_id', %L, 'quantity', 1)),
       '{}'::jsonb) $$, :'p1_item'));

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT qa('D4b and ORD_P1 really did not move',
  (SELECT count(*) FROM public.order_dispatches WHERE order_id = :ORD_P1) = 0,
  'assert the ROW, not the error — a refusal that wrote anyway is the dangerous kind');
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- ── D5: over-shipping ────────────────────────────────────────
SELECT qa_refused('D5 you cannot send more than remains',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d3'::uuid,
       'ee000000-0000-0000-0000-0000000000e2'::uuid,
       (SELECT jsonb_agg(jsonb_build_object('order_item_id', x ->> 'order_item_id',
                                      'quantity', 4))
          FROM jsonb_array_elements(
                 public.portal_dispatch_lines('ee000000-0000-0000-0000-0000000000e2'::uuid)) x),
       '{}'::jsonb) $$);

-- Asserted as the ADMIN, not as the portal user: RLS hides order_dispatches
-- from a portal login, so "nothing was written" would be true for a portal
-- caller even if the row were sitting right there.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT qa('D5b and nothing was written by the attempt',
  NOT EXISTS (SELECT 1 FROM public.order_dispatches WHERE id = :DSP_3)
  AND (SELECT sum(di.quantity) FROM public.dispatch_items di
         JOIN public.order_dispatches d ON d.id = di.dispatch_id
        WHERE d.order_id = :ORD_S1) = 2,
  'the header is inserted before the lines, so a refused line must take the header with it');
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- ── D6: somebody else's order ────────────────────────────────
SELECT qa_refused('D6 the distributor next door''s order is not dispatchable',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d4'::uuid,
       'ee000000-0000-0000-0000-0000000000e4'::uuid,
       '[{"order_item_id":"00000000-0000-0000-0000-000000000000","quantity":1}]'::jsonb,
       '{}'::jsonb) $$);

SELECT qa_refused('D7 and neither is another tenant''s',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d5'::uuid,
       'ee000000-0000-0000-0000-0000000000eb'::uuid,
       '[{"order_item_id":"00000000-0000-0000-0000-000000000000","quantity":1}]'::jsonb,
       '{}'::jsonb) $$);

-- ── D8: an item from a different order ───────────────────────
SELECT qa_refused('D8 an item that is not on this order is refused',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d6'::uuid,
       'ee000000-0000-0000-0000-0000000000e2'::uuid,
       (SELECT jsonb_agg(jsonb_build_object('order_item_id', x ->> 'order_item_id',
                                      'quantity', 1))
          FROM jsonb_array_elements(
                 public.portal_dispatch_lines('ee000000-0000-0000-0000-0000000000e3'::uuid)) x),
       '{}'::jsonb) $$);

-- ── D9: a replay is not a second load ────────────────────────
SELECT qa_allowed('D9 sending the same dispatch id again is a replay',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d1'::uuid,
       'ee000000-0000-0000-0000-0000000000e2'::uuid,
       (SELECT jsonb_agg(jsonb_build_object('order_item_id', x ->> 'order_item_id',
                                      'quantity', 2))
          FROM jsonb_array_elements(
                 public.portal_dispatch_lines('ee000000-0000-0000-0000-0000000000e2'::uuid)) x),
       '{}'::jsonb) $$);

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT qa('D9b and the shop was not sent four',
  (SELECT sum(di.quantity) FROM public.dispatch_items di
     JOIN public.order_dispatches d ON d.id = di.dispatch_id
    WHERE d.order_id = :ORD_S1) = 2
  AND (SELECT count(*) FROM public.order_dispatches WHERE order_id = :ORD_S1) = 1,
  'a double tap on a slow connection is one load, not two');
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- Compared against `portal_dispatch_detail`, not against the table: a portal
-- login cannot SELECT order_dispatches, so reading dispatch_number from it
-- here returns NULL and the comparison is never true — the same RLS trap that
-- quietly broke seven scenarios in 77.
SELECT qa('D9c the replay says so, and gives back the same number',
  (public.portal_create_dispatch(:DSP_1, :ORD_S1, '[]'::jsonb) ->> 'replayed') = 'true'
  AND (public.portal_create_dispatch(:DSP_1, :ORD_S1, '[]'::jsonb) ->> 'dispatch_number')
      = (public.portal_dispatch_detail(:DSP_1) ->> 'dispatch_number')
  AND (public.portal_dispatch_detail(:DSP_1) ->> 'dispatch_number') IS NOT NULL,
  'the replay branch answers before it reads the lines, so an empty list is fine here');

-- ── D10: a future date ───────────────────────────────────────
SELECT qa_refused('D10 a dispatch cannot be dated in the future',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d6'::uuid,
       'ee000000-0000-0000-0000-0000000000e2'::uuid,
       (SELECT jsonb_agg(jsonb_build_object('order_item_id', x ->> 'order_item_id',
                                      'quantity', 1))
          FROM jsonb_array_elements(
                 public.portal_dispatch_lines('ee000000-0000-0000-0000-0000000000e2'::uuid)) x),
       jsonb_build_object('dispatched_at', to_char(CURRENT_DATE + 5, 'YYYY-MM-DD'))) $$);

-- ── D11: an order that is not approved ───────────────────────
SELECT qa_refused('D11 a Pending order is not dispatchable',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d6'::uuid,
       'ee000000-0000-0000-0000-0000000000e3'::uuid,
       (SELECT jsonb_agg(jsonb_build_object('order_item_id', x ->> 'order_item_id',
                                      'quantity', 1))
          FROM jsonb_array_elements(
                 public.portal_dispatch_lines('ee000000-0000-0000-0000-0000000000e3'::uuid)) x),
       '{}'::jsonb) $$);

-- ── D12: a quantity that is not a quantity ───────────────────
SELECT qa_refused('D12 a quantity that is not a number is refused, not cast',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d6'::uuid,
       'ee000000-0000-0000-0000-0000000000e2'::uuid,
       (SELECT jsonb_agg(jsonb_build_object('order_item_id', x ->> 'order_item_id',
                                      'quantity', '2; drop table orders'))
          FROM jsonb_array_elements(
                 public.portal_dispatch_lines('ee000000-0000-0000-0000-0000000000e2'::uuid)) x),
       '{}'::jsonb) $$);

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SELECT qa('D12b and the table it named is still there',
  (SELECT count(*) FROM public.orders WHERE id = :ORD_S1) = 1,
  'assert the TABLE, not the absence of an error message');
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- ── The two lists ────────────────────────────────────────────
-- Asserted by LOOKING FOR the row rather than by counting: 72 places orders in
-- this same tree, so a total here would be a hostage to that file. What must
-- be exact is the arithmetic on the row, and the absence of ORD_P1.
SELECT qa('D13 Pending Dispatch holds the part-sent order and not the caller''s own',
  (SELECT (x ->> 'ordered')::numeric = 5
       AND (x ->> 'delivered')::numeric = 2
       AND (x ->> 'difference')::numeric = 3
     FROM jsonb_array_elements(public.portal_pending_dispatch(p_limit => 500) -> 'rows') x
    WHERE x ->> 'id' = trim(both '''' from :'ORD_S1'))
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.portal_pending_dispatch(p_limit => 500) -> 'rows') x
     WHERE x ->> 'id' = trim(both '''' from :'ORD_P1')),
  'ORD_P1 is the caller''s own purchase order and must never appear here');

SELECT qa('D14 the Dispatch list shows the load, priced from the order''s own lines',
  (public.portal_dispatches() ->> 'total')::int = 1
  AND (public.portal_dispatches() -> 'rows' -> 0 ->> 'quantity')::numeric = 2
  AND (public.portal_dispatches() -> 'rows' -> 0 ->> 'value')::numeric = 200,
  'two at 100 — a dispatch carries no price of its own');

SELECT qa('D15 the Dispatch list filters per column like every other list',
  (public.portal_dispatches(p_filters => '{"transport_name":"blue"}'::jsonb) ->> 'total')::int = 1
  AND (public.portal_dispatches(p_filters => '{"transport_name":"nobody"}'::jsonb) ->> 'total')::int = 0
  AND (public.portal_dispatches(p_filters => '{"invoice_no":"INV-7"}'::jsonb) ->> 'total')::int = 1,
  'the same p_filters bag as the orders and payments lists');

SELECT qa('D16 a load opens, with its lines and its docket',
  public.portal_dispatch_detail(:DSP_1) ->> 'lr_no' = 'LR-9'
  AND jsonb_array_length(public.portal_dispatch_detail(:DSP_1) -> 'lines') = 1
  AND (public.portal_dispatch_detail(:DSP_1) -> 'lines' -> 0 ->> 'quantity')::numeric = 2,
  'the transporter is a company and the docket is a number; no driver is named');

SELECT qa('D17 no person is named on a dispatch',
  public.portal_dispatches()::text NOT LIKE '%@%'
  AND public.portal_dispatch_detail(:DSP_1)::text NOT LIKE '%@%'
  AND public.portal_dispatch_detail(:DSP_1)::text NOT LIKE '%driver%',
  'spec 17 q4 was reversed for who BOOKED and who COLLECTED, and only for those two');

-- ── The distributor next door sees none of it ────────────────
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A2, false);
SET ROLE authenticated;

SELECT qa('D18 the distributor next door sees neither the load nor the order',
  (public.portal_dispatches() ->> 'total')::int = 0
  AND public.portal_dispatch_detail(:DSP_1) IS NULL
  AND public.portal_dispatch_lines(:ORD_S1) = '[]'::jsonb,
  'spec 15 test 2 — DIST_A2''s tree does not contain STK_A1');

SELECT qa_refused('D19 and cannot dispatch it either',
  $$ SELECT public.portal_create_dispatch(
       'dd000000-0000-0000-0000-0000000000d6'::uuid,
       'ee000000-0000-0000-0000-0000000000e2'::uuid,
       '[{"order_item_id":"00000000-0000-0000-0000-000000000000","quantity":1}]'::jsonb,
       '{}'::jsonb) $$);

RESET ROLE;
