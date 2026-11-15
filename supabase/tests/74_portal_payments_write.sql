-- ============================================================
-- 2026-11-15 — a distributor records a payment. Plan 5 §1A.
--
-- The line every scenario here is drawn around: a shop paying the distributor
-- is the DISTRIBUTOR's receivable, so he may approve it; the distributor paying
-- the company is the COMPANY's receivable, so he may only record it. And the
-- two are separate ledgers — a shop's receipt must never move what the
-- distributor owes the company (Q16), or the ageing report is wrong.
--
-- Reuses the tree from 70_portal_visibility.sql:
--   Tenant A: DIST_A1 (login PORTAL_U_A1) -> STK_A1 -> DLR_A1
--             DIST_A2 (login PORTAL_U_A2) -> DLR_A2
--   Tenant B: DIST_B1 (login PORTAL_U_B1)
--
-- Payment ids this file owns: ff000000-…-00000000aa01 upward.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''
\set PORTAL_U_A1 '''00000000-0000-0000-0000-00000000a001'''
\set PORTAL_U_A2 '''00000000-0000-0000-0000-00000000a002'''

\set DIST_A1 '''cc000000-0000-0000-0000-0000000000a1'''
\set DIST_A2 '''cc000000-0000-0000-0000-0000000000a2'''
\set STK_A1  '''cc000000-0000-0000-0000-0000000000a3'''
\set DLR_A2  '''cc000000-0000-0000-0000-0000000000a5'''
\set DIST_B1 '''cc000000-0000-0000-0000-0000000000b1'''

\set PAY_1 '''ff000000-0000-0000-0000-00000000aa01'''
\set PAY_2 '''ff000000-0000-0000-0000-00000000aa02'''
\set PAY_3 '''ff000000-0000-0000-0000-00000000aa03'''
\set PAY_4 '''ff000000-0000-0000-0000-00000000aa04'''
\set PAY_5 '''ff000000-0000-0000-0000-00000000aa05'''
\set PAY_6 '''ff000000-0000-0000-0000-00000000aa06'''
\set PAY_7 '''ff000000-0000-0000-0000-00000000aa07'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

DELETE FROM public.payment_handovers WHERE payment_id IN
  (:PAY_1,:PAY_2,:PAY_3,:PAY_4,:PAY_5,:PAY_6,:PAY_7);
DELETE FROM public.payments WHERE id IN
  (:PAY_1,:PAY_2,:PAY_3,:PAY_4,:PAY_5,:PAY_6,:PAY_7);

SELECT qa('Q0 an existing distributor collects directly until somebody says otherwise',
  (SELECT portal_collection_route FROM public.contacts WHERE id = :DIST_A1) = 'direct',
  'the column defaults, so no tenant changes behaviour by having it added');

-- ── Q15: the seventh portal column is guarded like the other six ──
SET ROLE authenticated;
SELECT qa_refused('Q15 an API role cannot set the collection route directly',
  $$ UPDATE public.contacts SET portal_collection_route = 'salesman'
      WHERE id = 'cc000000-0000-0000-0000-0000000000a1' $$);
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

SELECT qa('Q15b and it really did not move',
  (SELECT portal_collection_route FROM public.contacts WHERE id = :DIST_A1) = 'direct',
  'assert the ROW, not the error');

-- The admin route (service_role, as the portal-access page uses) may.
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_collection_route = 'both' WHERE id = :DIST_A1;
RESET ROLE;
SELECT qa('Q15c the portal-access route may, which is the whole point of the guard',
  (SELECT portal_collection_route FROM public.contacts WHERE id = :DIST_A1) = 'both');

-- ── Q16 baseline: what the distributor owes the company, before anything ──
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT (public.portal_outstanding() ->> 'mine')::numeric AS mine_before \gset q16_

-- ── Q1: a receipt from one of his own shops ──────────────────
SELECT public.portal_record_payment(
  :PAY_1::uuid, :STK_A1::uuid, 1500, 'Cash', NULL, 'REF-1', 'collected at the shop'
) AS r \gset q1_

RESET ROLE;
SELECT qa('Q1 a distributor records a receipt from one of his own shops',
  (:'q1_r'::jsonb ->> 'payment_id') = trim(both '''' from :'PAY_1')
  AND (:'q1_r'::jsonb ->> 'status') = 'Pending',
  'saw ' || :'q1_r');

SELECT qa('Q1b it is marked as having come from the customer side, not the office',
  (SELECT source FROM public.payments WHERE id = :PAY_1) = 'customer');

SELECT qa('Q1c the receipt number came from the company''s own series',
  (SELECT payment_number FROM public.payments WHERE id = :PAY_1) IS NOT NULL
  AND (SELECT payment_number FROM public.payments WHERE id = :PAY_1) <> '',
  'a second generator is how an account ends up with two receipt series');

SELECT qa('Q1d the owner is the rep who owns that shop, so it stays in their lists',
  (SELECT user_id FROM public.payments WHERE id = :PAY_1)
  = (SELECT user_id FROM public.contacts WHERE id = :STK_A1));

SELECT qa('Q13 the direct route logs one hop: shop -> distributor',
  (SELECT count(*) FROM public.payment_handovers WHERE payment_id = :PAY_1) = 1
  AND (SELECT from_party || '->' || to_party FROM public.payment_handovers
        WHERE payment_id = :PAY_1) = 'shop->distributor');

-- ── Q16: the two ledgers are separate ────────────────────────
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('Q16 a shop''s receipt does not touch what the distributor owes the company',
  (public.portal_outstanding() ->> 'mine')::numeric = :'q16_mine_before'::numeric,
  'one pipeline would have moved it, and the ageing report would be wrong');

-- ── Q13b: the salesman route logs two hops ───────────────────
SELECT public.portal_record_payment(
  :PAY_2::uuid, :STK_A1::uuid, 500, 'Cash', NULL, NULL, NULL, true
) AS r \gset q13_

RESET ROLE;
SELECT qa('Q13b the salesman route logs shop -> salesman -> distributor',
  (SELECT count(*) FROM public.payment_handovers WHERE payment_id = :PAY_2) = 2
  -- max(...) FILTER, not a bare scalar sub-query: if both hops were numbered
  -- the same the sub-query would raise "more than one row" and ABORT the file
  -- at this line, hiding the nineteen scenarios after it. A rule should fail
  -- loudly in its own row, not take the suite down with it.
  AND (SELECT max(from_party || '->' || to_party) FILTER (WHERE seq = 1)
         FROM public.payment_handovers WHERE payment_id = :PAY_2) = 'shop->salesman'
  AND (SELECT max(from_party || '->' || to_party) FILTER (WHERE seq = 2)
         FROM public.payment_handovers WHERE payment_id = :PAY_2) = 'salesman->distributor'
  AND (SELECT count(*) FROM public.payment_handovers
        WHERE payment_id = :PAY_2 AND seq = 1) = 1,
  'the hops are numbered, because two written in one statement share now() to '
  'the microsecond and the log read backwards');

-- ── Q2/Q3: not his customers ─────────────────────────────────
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa_refused('Q2 not for another distributor''s shop',
  $$ SELECT public.portal_record_payment(
       'ff000000-0000-0000-0000-00000000aa03'::uuid,
       'cc000000-0000-0000-0000-0000000000a5'::uuid, 100) $$);

SELECT qa_refused('Q3 nor for another tenant''s customer',
  $$ SELECT public.portal_record_payment(
       'ff000000-0000-0000-0000-00000000aa03'::uuid,
       'cc000000-0000-0000-0000-0000000000b1'::uuid, 100) $$);

RESET ROLE;
SELECT qa('Q3b and neither attempt wrote a row',
  NOT EXISTS (SELECT 1 FROM public.payments WHERE id = :PAY_3));

-- ── Q4/Q5/Q12: the trigger's own rules still apply to him ────
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa_refused('Q4 a receipt cannot be dated in the future',
  $$ SELECT public.portal_record_payment(
       'ff000000-0000-0000-0000-00000000aa03'::uuid,
       'cc000000-0000-0000-0000-0000000000a3'::uuid, 100, 'Cash',
       (CURRENT_DATE + 2)) $$);

SELECT qa_refused('Q5 nor backdated past the account''s limit',
  $$ SELECT public.portal_record_payment(
       'ff000000-0000-0000-0000-00000000aa03'::uuid,
       'cc000000-0000-0000-0000-0000000000a3'::uuid, 100, 'Cash',
       (CURRENT_DATE - 400)) $$);

SELECT qa_refused('Q12 and an amount of nothing is not a receipt',
  $$ SELECT public.portal_record_payment(
       'ff000000-0000-0000-0000-00000000aa03'::uuid,
       'cc000000-0000-0000-0000-0000000000a3'::uuid, 0) $$);

-- ── Q6: he may approve his own shop's receipt ────────────────
SELECT qa('Q6 a distributor approves a receipt from his own shop',
  public.portal_set_payment_status(:PAY_1::uuid, 'Approved') = true);

RESET ROLE;
SELECT qa('Q6b and it moved',
  (SELECT status FROM public.payments WHERE id = :PAY_1) = 'Approved');

-- ── Q7: but not his own dues to the company ──────────────────
SELECT set_config('test.uid', :ADMIN_A, false);
INSERT INTO public.payments (id, account_id, user_id, contact_id, payment_number, amount,
                             payment_type, payment_date, status)
VALUES (:PAY_4, :ACCT_A, :ADMIN_A, :DIST_A1, 'PAY-OWN-1', 95, 'Cash', CURRENT_DATE, 'Pending');

SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa_refused('Q7 he cannot approve what HE owes the company',
  $$ SELECT public.portal_set_payment_status(
       'ff000000-0000-0000-0000-00000000aa04'::uuid, 'Approved') $$);

RESET ROLE;
SELECT qa('Q7b and that row is untouched',
  (SELECT status FROM public.payments WHERE id = :PAY_4) = 'Pending',
  'approving his own dues would be marking his own homework');

-- ── Q8/Q9: the transition table and the reason rule hold ─────
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa_refused('Q8 Approved cannot go back to Pending, for him either',
  $$ SELECT public.portal_set_payment_status(
       'ff000000-0000-0000-0000-00000000aa01'::uuid, 'Pending') $$);

SELECT qa_refused('Q9 a cancellation still needs a reason',
  $$ SELECT public.portal_set_payment_status(
       'ff000000-0000-0000-0000-00000000aa01'::uuid, 'Cancelled', '   ') $$);

-- ── Q14: he may reject a salesman's receipt, with the reason ──
SELECT qa('Q14 he rejects the one his salesman brought in',
  public.portal_set_payment_status(:PAY_2::uuid, 'Rejected', 'Cheque bounced') = true);

RESET ROLE;
SELECT qa('Q14b the reason is on the payment',
  (SELECT rejection_reason FROM public.payments WHERE id = :PAY_2) = 'Cheque bounced');

SELECT qa('Q14c and the log says the money went back',
  EXISTS (SELECT 1 FROM public.payment_handovers
           WHERE payment_id = :PAY_2 AND outcome = 'rejected'
             AND reason = 'Cheque bounced' AND to_party = 'salesman'));

-- ── Q10: the flag does not survive the function ──────────────
-- If it leaked, the very next statement in the same transaction could approve
-- anything. This is the rule that makes the whole approach safe.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
-- set_config(..., true) is TRANSACTION-local, so asking in a later statement
-- proves nothing - autocommit has already ended the transaction and any flag
-- with it. The question has to be asked inside ONE transaction, which is also
-- how PostgREST runs a request: if the flag survived the function, everything
-- after it in that request would carry the permission.
RESET ROLE;
BEGIN;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET LOCAL ROLE authenticated;
SELECT public.portal_record_payment(
  :PAY_6::uuid, :STK_A1::uuid, 250) AS r \gset q10_
SELECT public.portal_payment_write_allowed() AS leaked \gset q10f_
ROLLBACK;

SELECT qa('Q10 the write flag is off again before the function returns',
  :'q10f_leaked' = 'f',
  'asked in the SAME transaction as the write - a flag left on is a '
  'permission left on for everything after it');

SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- Asked as "did the ROW move?", not "was it refused?". A portal login is not
-- an account member, so RLS matches no row, and an UPDATE that touches nothing
-- raises nothing and reports ALLOWED. Plan 2 learned this exact lesson in
-- O10/U3 and this file walked into it anyway.
UPDATE public.payments SET status = 'Approved'
 WHERE id = 'ff000000-0000-0000-0000-00000000aa04';
RESET ROLE;
SELECT qa('Q10b so a bare UPDATE from the portal login moves nothing',
  (SELECT status FROM public.payments WHERE id = :PAY_4) = 'Pending',
  'RLS gives it no row, and no row is not an error - assert the ROW');
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- ── Q11: a revoked login ─────────────────────────────────────
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_access = false, portal_access_revoked_at = now()
 WHERE id = :DIST_A1;
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa_refused('Q11 a revoked login records nothing',
  $$ SELECT public.portal_record_payment(
       'ff000000-0000-0000-0000-00000000aa05'::uuid,
       'cc000000-0000-0000-0000-0000000000a3'::uuid, 100) $$);

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_access = true, portal_access_revoked_at = NULL,
       portal_collection_route = 'direct'
 WHERE id = :DIST_A1;
RESET ROLE;

-- ── Put the tenant back ──────────────────────────────────────
SELECT set_config('test.uid', :ADMIN_A, false);
DELETE FROM public.payment_handovers WHERE payment_id IN
  (:PAY_1,:PAY_2,:PAY_3,:PAY_4,:PAY_5,:PAY_6,:PAY_7);
DELETE FROM public.payments WHERE id IN
  (:PAY_1,:PAY_2,:PAY_3,:PAY_4,:PAY_5,:PAY_6,:PAY_7);
