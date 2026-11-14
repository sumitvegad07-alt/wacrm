-- ============================================================
-- 2026-11-14 — the portal's visibility model, measured.
--
-- Spec §6 says a portal login has "select on nothing". That is NOT achieved by
-- revoking grants: Supabase grants `authenticated` SELECT on every public
-- table, and so does this harness. It is achieved because is_account_member
-- reads `profiles` and a portal customer has no profiles row — so every policy
-- that leans on it returns zero rows.
--
-- Nobody had ever measured that. Section O does, BEFORE any portal_* function
-- exists, so the baseline is honest: a portal login with the whole
-- `authenticated` grant set and no profile must read nothing.
--
-- Section N is the tree every later section reuses:
--
--   Tenant A                              Tenant B
--     DIST_A1  (login PORTAL_U_A1)          DIST_B1 (login PORTAL_U_B1)
--       STK_A1                                (one customer, nothing below)
--         DLR_A1
--     DIST_A2  (login PORTAL_U_A2)   <- the distributor beside A1
--       DLR_A2
--     DLR_ORPHAN  (no parent at all)  <- in nobody's portal, deliberately
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ACCT_B '''bbbb0000-0000-0000-0000-000000000002'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''
\set ADMIN_B '''22220000-0000-0000-0000-000000000001'''

\set PORTAL_U_A1 '''00000000-0000-0000-0000-00000000a001'''
\set PORTAL_U_A2 '''00000000-0000-0000-0000-00000000a002'''
\set PORTAL_U_B1 '''00000000-0000-0000-0000-00000000b001'''

\set DIST_A1    '''cc000000-0000-0000-0000-0000000000a1'''
\set DIST_A2    '''cc000000-0000-0000-0000-0000000000a2'''
\set STK_A1     '''cc000000-0000-0000-0000-0000000000a3'''
\set DLR_A1     '''cc000000-0000-0000-0000-0000000000a4'''
\set DLR_A2     '''cc000000-0000-0000-0000-0000000000a5'''
\set DLR_ORPHAN '''cc000000-0000-0000-0000-0000000000a6'''
\set DIST_B1    '''cc000000-0000-0000-0000-0000000000b1'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

-- ── N: the tree ──────────────────────────────────────────────
-- Order hierarchy stays OFF for both tenants here. Migration 076 refuses ANY
-- update to a level-less customer while it is on — Plan 1's H7 limitation — and
-- a later section switches it on deliberately, only there.
UPDATE public.accounts SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb),
  '{order_settings,hierarchy_enabled}', 'false'::jsonb, true)
 WHERE id IN (:ACCT_A, :ACCT_B);

UPDATE public.accounts SET addon_lines = ARRAY['dms'], portal_seats_limit = 10
 WHERE id IN (:ACCT_A, :ACCT_B);

ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

UPDATE public.contacts SET parent_id = NULL WHERE id IN
  (:DIST_A1, :DIST_A2, :STK_A1, :DLR_A1, :DLR_A2, :DLR_ORPHAN, :DIST_B1);
DELETE FROM public.contacts WHERE id IN
  (:DIST_A1, :DIST_A2, :STK_A1, :DLR_A1, :DLR_A2, :DLR_ORPHAN, :DIST_B1);
DELETE FROM auth.users WHERE id IN (:PORTAL_U_A1, :PORTAL_U_A2, :PORTAL_U_B1);

INSERT INTO auth.users (id, email) VALUES
  (:PORTAL_U_A1, 'dist-a1@portal.test'),
  (:PORTAL_U_A2, 'dist-a2@portal.test'),
  (:PORTAL_U_B1, 'dist-b1@portal.test');

-- Levels are set on every one: a level-less customer cannot be given a login on
-- a tenant running order hierarchy, and a later section needs them levelled.
INSERT INTO public.contacts (id, account_id, user_id, name, company, phone, hierarchy_level) VALUES
  (:DIST_A1,    :ACCT_A, :ADMIN_A, 'Dist A1',  'Distributor A1', '6100000001', 1),
  (:DIST_A2,    :ACCT_A, :ADMIN_A, 'Dist A2',  'Distributor A2', '6100000002', 1),
  (:STK_A1,     :ACCT_A, :ADMIN_A, 'Stk A1',   'Stockist A1',    '6100000003', 2),
  (:DLR_A1,     :ACCT_A, :ADMIN_A, 'Dlr A1',   'Dealer A1',      '6100000004', 3),
  (:DLR_A2,     :ACCT_A, :ADMIN_A, 'Dlr A2',   'Dealer A2',      '6100000005', 3),
  (:DLR_ORPHAN, :ACCT_A, :ADMIN_A, 'Dlr Orph', 'Dealer Orphan',  '6100000006', 3),
  (:DIST_B1,    :ACCT_B, :ADMIN_B, 'Dist B1',  'Distributor B1', '6200000001', 1);

-- parent_id is a separate UPDATE: is_legal_customer_parent runs on the write
-- and needs both rows to exist first.
UPDATE public.contacts SET parent_id = :DIST_A1 WHERE id = :STK_A1;
UPDATE public.contacts SET parent_id = :STK_A1  WHERE id = :DLR_A1;
UPDATE public.contacts SET parent_id = :DIST_A2 WHERE id = :DLR_A2;

-- The logins, written as the SERVICE role: that is the portal-access route's
-- own path and the only path Task 2's column guard allows.
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_user_id = :PORTAL_U_A1, portal_email = 'dist-a1@portal.test',
       portal_access = true, portal_access_set_at = now() WHERE id = :DIST_A1;
UPDATE public.contacts SET portal_user_id = :PORTAL_U_A2, portal_email = 'dist-a2@portal.test',
       portal_access = true, portal_access_set_at = now() WHERE id = :DIST_A2;
UPDATE public.contacts SET portal_user_id = :PORTAL_U_B1, portal_email = 'dist-b1@portal.test',
       portal_access = true, portal_access_set_at = now() WHERE id = :DIST_B1;
RESET ROLE;

ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

SELECT qa('N1 the portal fixture loaded',
  (SELECT count(*) FROM public.contacts WHERE id IN
     (:DIST_A1,:DIST_A2,:STK_A1,:DLR_A1,:DLR_A2,:DLR_ORPHAN,:DIST_B1)) = 7,
  'expected 7 customers in the portal fixture');

SELECT qa('N2 three logins exist and not one of them is a profile',
  (SELECT count(*) FROM public.contacts WHERE portal_user_id IN
     (:PORTAL_U_A1,:PORTAL_U_A2,:PORTAL_U_B1)) = 3
  AND (SELECT count(*) FROM public.profiles WHERE user_id IN
     (:PORTAL_U_A1,:PORTAL_U_A2,:PORTAL_U_B1)) = 0,
  'a portal customer must be an auth.users row and NOTHING else');

SELECT qa('N3 the tree is shaped as the comment says',
  (SELECT parent_id FROM public.contacts WHERE id = :STK_A1) = :DIST_A1::uuid
  AND (SELECT parent_id FROM public.contacts WHERE id = :DLR_A1) = :STK_A1::uuid
  AND (SELECT parent_id FROM public.contacts WHERE id = :DLR_A2) = :DIST_A2::uuid
  AND (SELECT parent_id FROM public.contacts WHERE id = :DLR_ORPHAN) IS NULL,
  'every later section reads this shape');

-- ── O: with the full `authenticated` grant set and no profile, read nothing ──
-- This is the baseline the whole design rests on. If any of these returns a
-- row, the model is broken and the fix is not a new function — it is the policy
-- that leaked.
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('O0 the grant really is there, so O1-O8 measure POLICIES not privileges',
  has_table_privilege('authenticated', 'public.contacts', 'SELECT')
  AND has_table_privilege('authenticated', 'public.orders', 'SELECT'),
  'if the grant were missing, O1-O8 would pass without proving anything');

SELECT qa('O1 a portal login reads no customers at all',
  (SELECT count(*) FROM public.contacts) = 0,
  'saw ' || (SELECT count(*) FROM public.contacts)::text || ' contacts; expected 0');

SELECT qa('O2 ... no orders',
  (SELECT count(*) FROM public.orders) = 0,
  'saw ' || (SELECT count(*) FROM public.orders)::text);

SELECT qa('O3 ... no payments',
  (SELECT count(*) FROM public.payments) = 0,
  'saw ' || (SELECT count(*) FROM public.payments)::text);

SELECT qa('O4 ... no products',
  (SELECT count(*) FROM public.products) = 0,
  'saw ' || (SELECT count(*) FROM public.products)::text);

SELECT qa('O5 ... no accounts',
  (SELECT count(*) FROM public.accounts) = 0,
  'saw ' || (SELECT count(*) FROM public.accounts)::text);

SELECT qa('O6 ... no profiles, so no employee of any company',
  (SELECT count(*) FROM public.profiles) = 0,
  'saw ' || (SELECT count(*) FROM public.profiles)::text);

SELECT qa('O7 ... no announcements',
  (SELECT count(*) FROM public.tenant_announcements) = 0,
  'saw ' || (SELECT count(*) FROM public.tenant_announcements)::text);

SELECT qa('O8 ... not even its own customer row',
  (SELECT count(*) FROM public.contacts WHERE id = :DIST_A1) = 0,
  'the portal reads its own record through portal_me(), never from the table');

SELECT qa_refused('O9 a portal login cannot insert a customer',
  'INSERT INTO public.contacts (account_id, user_id, name, phone) VALUES ('
  || quote_literal(:ACCT_A) || ', ' || quote_literal(:PORTAL_U_A1)
  || ', ''Portal wrote this'', ''6199999999'')');

-- O10: a portal login cannot CHANGE its own customer row.
--
-- Deliberately not a qa_refused. An UPDATE whose WHERE matches no row visible
-- to the caller touches zero rows and raises nothing, so "was it refused?" is
-- the wrong question and reports ALLOWED for a write that did nothing. The
-- question that matters is whether the row moved, so the statement runs here
-- and the row is read back below as a role that can actually see it.
DO $o10$ BEGIN
  UPDATE public.contacts SET name = 'Renamed by the portal' WHERE id = 'cc000000-0000-0000-0000-0000000000a1';
EXCEPTION WHEN OTHERS THEN NULL;
END $o10$;

RESET ROLE;
SELECT qa('O10 a portal login cannot change its own customer row',
  (SELECT name FROM public.contacts WHERE id = :DIST_A1) = 'Dist A1',
  'name is now ' || coalesce((SELECT name FROM public.contacts WHERE id = :DIST_A1), 'NULL')
  || ' — a portal login must not be able to rename itself');

SELECT qa('O10b and the same write as an INSERT left nothing behind either',
  NOT EXISTS (SELECT 1 FROM public.contacts WHERE name = 'Portal wrote this'),
  'O9 reported refused; this proves nothing was written anyway');

RESET ROLE;

-- ── P: the resolver ──────────────────────────────────────────
-- Deleting the account check inside the recursion must make P7 fail.
-- Deleting the portal_access / revoked_at conditions must make P8/P9 fail.
-- Deleting the caller-exclusion in portal_customers must make P4 fail.
-- Deleting the account_has_line test in portal_caller must make P10 fail.

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('P1 a distributor sees itself plus its whole sub-tree',
  (SELECT count(*) FROM unnest(public.portal_visible_contact_ids())) = 3,
  'DIST_A1 + STK_A1 + DLR_A1 = 3, saw '
  || (SELECT count(*) FROM unnest(public.portal_visible_contact_ids()))::text);

SELECT qa('P2 and the three are exactly the right three',
  public.portal_visible_contact_ids() @> ARRAY[:DIST_A1::uuid, :STK_A1::uuid, :DLR_A1::uuid]
  AND NOT (public.portal_visible_contact_ids() && ARRAY[:DIST_A2::uuid, :DLR_A2::uuid, :DLR_ORPHAN::uuid, :DIST_B1::uuid]),
  'spec 15 test 2: nothing of the distributor beside them');

SELECT qa('P3 portal_me returns their own record',
  public.portal_me() ->> 'contact_id' = trim(both '''' from :'DIST_A1')
  AND public.portal_me() ->> 'company' = 'Distributor A1',
  'saw ' || coalesce(public.portal_me() ->> 'company', 'NULL'));

SELECT qa('P3b portal_me reads the timezone through account_timezone(), not by hand',
  public.portal_me() ->> 'timezone' = public.account_timezone(:ACCT_A),
  'the plan drafted settings->company_profile->>timezone, a path that does not exist; '
  || 'saw ' || coalesce(public.portal_me() ->> 'timezone', 'NULL'));

SELECT qa('P4 My Customers excludes the distributor itself',
  jsonb_array_length(public.portal_customers()) = 2
  AND public.portal_customers()::text NOT LIKE '%Distributor A1%',
  'expected STK_A1 and DLR_A1 only, saw '
  || jsonb_array_length(public.portal_customers())::text);

SELECT qa('P5 another customer''s login ADDRESS is never returned',
  public.portal_customers()::text NOT LIKE '%@portal.test%',
  'only a has_portal_login boolean may cross into the portal');

-- The stockist in the middle: spec 15 test 3. Give STK_A1 a login of its own.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000a003';
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000a003','stk-a1@portal.test');
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_user_id = '00000000-0000-0000-0000-00000000a003',
       portal_email = 'stk-a1@portal.test', portal_access = true WHERE id = :STK_A1;
RESET ROLE;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000a003', false);
SET ROLE authenticated;
SELECT qa('P6 a stockist sees its own slice and NOTHING above it',
  (SELECT count(*) FROM unnest(public.portal_visible_contact_ids())) = 2
  AND public.portal_visible_contact_ids() @> ARRAY[:STK_A1::uuid, :DLR_A1::uuid]
  AND NOT (public.portal_visible_contact_ids() && ARRAY[:DIST_A1::uuid]),
  'spec 15 test 3: the tree walks DOWN only');

-- P7: the tenant boundary inside the recursion. Force a cross-tenant parent_id
-- past is_legal_customer_parent, as the service role, exactly the corruption
-- the account check exists for. Production carries drift this folder does not.
-- trg_enforce_customer_parent refuses a cross-account parent for EVERY role,
-- the service role included — so the drift this scenario simulates can only be
-- produced by going around that trigger, which is what drift is. Switched off
-- for one statement, as the table owner, and switched straight back on.
RESET ROLE;
ALTER TABLE public.contacts DISABLE TRIGGER trg_enforce_customer_parent;
UPDATE public.contacts SET parent_id = :STK_A1 WHERE id = :DIST_B1;
ALTER TABLE public.contacts ENABLE TRIGGER trg_enforce_customer_parent;
SELECT qa('P7a precondition: the corrupt cross-tenant parent_id really is in place',
  (SELECT parent_id FROM public.contacts WHERE id = :DIST_B1) = :STK_A1::uuid,
  'without this, P7 would pass because nothing was corrupted');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000a003', false);
SET ROLE authenticated;
SELECT qa('P7 a corrupted parent_id cannot pull another TENANT''s customer in',
  NOT (public.portal_visible_contact_ids() && ARRAY[:DIST_B1::uuid]),
  'this is why c.account_id = t.account_id sits INSIDE the recursion');
RESET ROLE;
ALTER TABLE public.contacts DISABLE TRIGGER trg_enforce_customer_parent;
UPDATE public.contacts SET parent_id = NULL WHERE id = :DIST_B1;
ALTER TABLE public.contacts ENABLE TRIGGER trg_enforce_customer_parent;

-- P8/P9: spec 15 test 4 — a revoked login reads nothing, and its seat is free.
--
-- The seat count is asserted as a DIFFERENCE, not as an absolute. This tenant
-- is also 60_dms_foundation's tenant, and that file leaves DIST_C holding a
-- login, so "2" was wrong here and would have been wrong again the next time
-- any file gave this account a login. What P9 means is "one seat came back".
SELECT set_config('test.uid', :ADMIN_A, false);
DROP TABLE IF EXISTS p_snap;
CREATE TEMP TABLE p_snap(k text PRIMARY KEY, n integer);
INSERT INTO p_snap VALUES ('before_revoke', public.portal_seats_used(:ACCT_A));
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_access = false, portal_access_revoked_at = now()
 WHERE id = :STK_A1;
RESET ROLE;
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000a003', false);
SET ROLE authenticated;
SELECT qa('P8 a revoked login resolves to nothing at all',
  public.portal_visible_contact_ids() = '{}'::uuid[]
  AND public.portal_me() IS NULL
  AND public.portal_customers() = '[]'::jsonb,
  'the walk starts at auth.uid(), so revoking ends access on the NEXT request');
RESET ROLE;
SELECT qa('P9 and the seat went back to the pool',
  public.portal_seats_used(:ACCT_A) = (SELECT n FROM p_snap WHERE k = 'before_revoke') - 1
  AND NOT (SELECT portal_access FROM public.contacts WHERE id = :STK_A1),
  'before=' || (SELECT n FROM p_snap WHERE k = 'before_revoke')::text
  || ' after=' || public.portal_seats_used(:ACCT_A)::text
  || ' (exactly one seat must come back, and it must be STK_A1''s)');

-- P10: spec 15 test 7 — take the add-on away and every login stops at once,
-- with nothing deleted. This is also spec 12's last row.
SELECT set_config('test.uid', :ADMIN_A, false);
UPDATE public.accounts SET addon_lines = '{}' WHERE id = :ACCT_A;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('P10 removing the add-on stops every portal login immediately',
  public.portal_me() IS NULL AND public.portal_visible_contact_ids() = '{}'::uuid[],
  'spec 12: nothing is deleted, but nothing is readable either');
RESET ROLE;
SELECT qa('P11 and nothing was deleted',
  (SELECT portal_user_id FROM public.contacts WHERE id = :DIST_A1) = :PORTAL_U_A1::uuid,
  'the link survives so the add-on can be restored');
UPDATE public.accounts SET addon_lines = ARRAY['dms'] WHERE id = :ACCT_A;

-- Restore STK_A1 to no login, so later sections see the documented tree.
SET LOCAL ROLE service_role;
UPDATE public.contacts SET portal_user_id = NULL, portal_email = NULL,
       portal_access = false, portal_access_revoked_at = NULL WHERE id = :STK_A1;
RESET ROLE;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000a003';

-- ── S: the belt-and-braces guards ────────────────────────────
-- Deleting `where t.depth < 20` must make S1 hang or blow up rather than pass.

-- S1: a deliberate cycle, forced in as the service role past
-- is_legal_customer_parent. DIST_A1 -> STK_A1 -> DLR_A1 -> DIST_A1.
-- A cycle is exactly what is_legal_customer_parent refuses ("X would end up
-- being supplied through themselves"), so it can only be planted with that
-- trigger off. depth < 20 is the belt for the day that guard is rebuilt wrong
-- again — it has been rebuilt once already (20261104130000).
RESET ROLE;
ALTER TABLE public.contacts DISABLE TRIGGER trg_enforce_customer_parent;
UPDATE public.contacts SET parent_id = :DLR_A1 WHERE id = :DIST_A1;
ALTER TABLE public.contacts ENABLE TRIGGER trg_enforce_customer_parent;
SELECT qa('S1a precondition: the cycle really is in place',
  (SELECT parent_id FROM public.contacts WHERE id = :DIST_A1) = :DLR_A1::uuid,
  'without this, S1 would pass because there was no cycle to survive');
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('S1 a cycle in parent_id terminates and returns each id once',
  (SELECT count(*) FROM unnest(public.portal_visible_contact_ids())) = 3,
  'depth < 20 caps the walk and array_agg(distinct) de-duplicates it; saw '
  || (SELECT count(*) FROM unnest(public.portal_visible_contact_ids()))::text);
RESET ROLE;
ALTER TABLE public.contacts DISABLE TRIGGER trg_enforce_customer_parent;
UPDATE public.contacts SET parent_id = NULL WHERE id = :DIST_A1;
ALTER TABLE public.contacts ENABLE TRIGGER trg_enforce_customer_parent;

-- S2: the unmapped dealer is in nobody's portal. Not an error, just absent.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('S2 an unmapped dealer appears in NO portal',
  NOT (public.portal_visible_contact_ids() && ARRAY[:DLR_ORPHAN::uuid]),
  'an area with several holders leaves a dealer unmapped until an admin picks one');
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A2, false);
SET ROLE authenticated;
SELECT qa('S2b ... including the distributor beside them',
  NOT (public.portal_visible_contact_ids() && ARRAY[:DLR_ORPHAN::uuid]),
  'DIST_A2 must not see it either');

-- S3: an EMPLOYEE calling a portal function gets nothing. The portal functions
-- are definer, so this is the only thing stopping an ordinary staff member
-- reading through them as if they were a distributor.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SET ROLE authenticated;
SELECT qa('S3 an employee of the same company resolves to nothing',
  public.portal_visible_contact_ids() = '{}'::uuid[] AND public.portal_me() IS NULL,
  'an employee has no portal_user_id, so portal_caller() returns no row');

-- S4: an employee of the OTHER tenant, likewise.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_B, false);
SET ROLE authenticated;
SELECT qa('S4 an employee of another company resolves to nothing either',
  public.portal_visible_contact_ids() = '{}'::uuid[],
  'spec 15 test 1');

-- S5: anon — nobody signed in at all.
RESET ROLE;
SELECT set_config('test.uid', '', false);
SET ROLE anon;
SELECT qa('S5 a visitor who is not signed in resolves to nothing',
  public.portal_visible_contact_ids() = '{}'::uuid[],
  'auth.uid() is null, so the walk has no root');
RESET ROLE;

-- S6: the H7 limitation, restated here so Plan 2 cannot lose it. With order
-- hierarchy ON, migration 076 refuses any update to a level-less customer, so
-- that customer cannot be given a login. This contradicts founder decision 3
-- ("any customer at any level may have a login") and is in spec 17. The
-- scenario is written to PASS while refused and to FAIL the day it becomes
-- possible, so the limitation cannot vanish quietly.
-- THE ORDER OF THESE FIVE STATEMENTS IS THE WHOLE DIFFICULTY, and getting it
-- wrong aborted this file twice. Migration 076 refuses EVERY update to a
-- level-less customer while hierarchy is on — including the update that nulls
-- the level, and including the update that would put it back. So:
--   1. null the level while hierarchy is still OFF,
--   2. switch hierarchy ON,
--   3. try to give that customer a login — this is the scenario,
--   4. switch hierarchy OFF again,
--   5. only then restore the level.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
UPDATE public.contacts SET hierarchy_level = NULL WHERE id = :DLR_ORPHAN;
UPDATE public.accounts SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb),
  '{order_settings,hierarchy_enabled}', 'true'::jsonb, true) WHERE id = :ACCT_A;

SELECT qa('S6a precondition: hierarchy is on and that customer has no level',
  COALESCE((SELECT (settings->'order_settings'->>'hierarchy_enabled')::boolean
              FROM public.accounts WHERE id = :ACCT_A), false)
  AND (SELECT hierarchy_level FROM public.contacts WHERE id = :DLR_ORPHAN) IS NULL,
  'without both of these S6 would be refused by something else, or not at all');

SELECT qa_refused('S6 a customer with no Customer Level cannot be given a login (migration 076)',
  'UPDATE public.contacts SET portal_email = ''orph@abc.com'', portal_access = true'
  || ' WHERE id = ' || quote_literal(:DLR_ORPHAN));

UPDATE public.accounts SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb),
  '{order_settings,hierarchy_enabled}', 'false'::jsonb, true) WHERE id = :ACCT_A;
UPDATE public.contacts SET hierarchy_level = 3 WHERE id = :DLR_ORPHAN;
SELECT qa('S6b the fixture is handed on intact: hierarchy off, the orphan levelled again',
  COALESCE((SELECT (settings->'order_settings'->>'hierarchy_enabled')::boolean
              FROM public.accounts WHERE id = :ACCT_A), false) = false
  AND (SELECT hierarchy_level FROM public.contacts WHERE id = :DLR_ORPHAN) = 3,
  'section T and every later file read this state');

-- ── T: orders, payments and outstanding ──────────────────────
-- Needs rows of its own: 00_fixture deletes every order and product for both
-- tenants and seeds none.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

-- A uuid is hexadecimal: the plan drafted these ids ending p1/s1/s2/x1, which
-- psql refuses outright ("invalid input syntax for type uuid"), and the file
-- aborted at the first order insert. e1..e4 and eb carry the same meaning.
\set PROD_A  '''dd000000-0000-0000-0000-0000000000a1'''
\set PROD_B  '''dd000000-0000-0000-0000-0000000000b1'''
\set ORD_P1  '''ee000000-0000-0000-0000-0000000000e1'''
\set ORD_S1  '''ee000000-0000-0000-0000-0000000000e2'''
\set ORD_S2  '''ee000000-0000-0000-0000-0000000000e3'''
\set ORD_X1  '''ee000000-0000-0000-0000-0000000000e4'''
\set ORD_B1  '''ee000000-0000-0000-0000-0000000000eb'''
\set PAY_1   '''ff000000-0000-0000-0000-000000000001'''
\set PAY_2   '''ff000000-0000-0000-0000-000000000002'''
\set PAY_B   '''ff000000-0000-0000-0000-00000000000b'''

DELETE FROM public.order_items WHERE order_id IN (:ORD_P1,:ORD_S1,:ORD_S2,:ORD_X1,:ORD_B1);
DELETE FROM public.orders   WHERE id IN (:ORD_P1,:ORD_S1,:ORD_S2,:ORD_X1,:ORD_B1);
DELETE FROM public.payments WHERE id IN (:PAY_1,:PAY_2,:PAY_B);
DELETE FROM public.products WHERE id IN (:PROD_A,:PROD_B);

INSERT INTO public.products (id, account_id, user_id, name, sku, price, active) VALUES
  (:PROD_A, :ACCT_A, :ADMIN_A, 'Portal Product A', 'PP-A', 100, true),
  (:PROD_B, :ACCT_B, :ADMIN_B, 'Portal Product B', 'PP-B', 100, true);

-- ORD_P1  DIST_A1 buys from the company  -> the caller's PURCHASE
-- ORD_S1  STK_A1 buys from DIST_A1       -> the caller's SALES
-- ORD_S2  DLR_A1 buys, placed VIA THE PORTAL
-- ORD_X1  DLR_A2 buys (under DIST_A2)    -> must be invisible to DIST_A1
-- ORD_B1  DIST_B1, the other tenant      -> must be invisible to everyone in A
INSERT INTO public.orders (id, account_id, user_id, contact_id, date, sub_total, tax_total,
                           total_amount, status, classification, pricing_status,
                           placed_by_portal_contact_id) VALUES
  (:ORD_P1, :ACCT_A, :ADMIN_A, :DIST_A1, CURRENT_DATE - 10, 1000, 0, 1000, 'Pending',   'primary',   'confirmed', NULL),
  (:ORD_S1, :ACCT_A, :ADMIN_A, :STK_A1,  CURRENT_DATE - 5,   500, 0,  500, 'Approved',  'secondary', 'confirmed', NULL),
  (:ORD_S2, :ACCT_A, :ADMIN_A, :DLR_A1,  CURRENT_DATE - 1,   250, 0,  250, 'Pending',   'secondary', 'confirmed', :DIST_A1),
  (:ORD_X1, :ACCT_A, :ADMIN_A, :DLR_A2,  CURRENT_DATE - 2,   900, 0,  900, 'Pending',   'secondary', 'confirmed', NULL),
  (:ORD_B1, :ACCT_B, :ADMIN_B, :DIST_B1, CURRENT_DATE - 3,   700, 0,  700, 'Pending',   'primary',   'confirmed', NULL);

INSERT INTO public.order_items (order_id, product_id, product_name, unit, quantity, price,
                                tax_rate, tax_amount, sub_total, total, position) VALUES
  (:ORD_P1, :PROD_A, 'Portal Product A', 'pcs', 10, 100, 0, 0, 1000, 1000, 1),
  (:ORD_S1, :PROD_A, 'Portal Product A', 'pcs',  5, 100, 0, 0,  500,  500, 1),
  (:ORD_S2, :PROD_A, 'Portal Product A', 'pcs',  2, 100, 0, 0,  200,  200, 1),
  (:ORD_S2, :PROD_A, 'Portal Product A', 'pcs',  1,  50, 0, 0,   50,   50, 2),
  (:ORD_X1, :PROD_A, 'Portal Product A', 'pcs',  9, 100, 0, 0,  900,  900, 1),
  (:ORD_B1, :PROD_B, 'Portal Product B', 'pcs',  7, 100, 0, 0,  700,  700, 1);

-- All three are seeded 'Pending', which is the state a receipt is really
-- created in. The draft seeded two as 'Approved' and the file aborted:
-- enforce_payment_status_transition (20260814170000) refuses an INSERT that
-- arrives already Approved unless the caller holds approve_payments, and the
-- fixture's admin does not. Nothing in section T depends on the status being
-- Approved — T11b asserts only that whatever the status is, the portal is told
-- it, which is the point (a rejected receipt must not be hidden).
INSERT INTO public.payments (id, account_id, user_id, contact_id, payment_number, amount,
                             payment_type, payment_date, status) VALUES
  (:PAY_1, :ACCT_A, :ADMIN_A, :DIST_A1, 'PAY-A-1', 400, 'Cash', CURRENT_DATE - 4, 'Pending'),
  (:PAY_2, :ACCT_A, :ADMIN_A, :STK_A1,  'PAY-A-2', 150, 'Cash', CURRENT_DATE - 2, 'Pending'),
  (:PAY_B, :ACCT_B, :ADMIN_B, :DIST_B1, 'PAY-B-1', 300, 'Cash', CURRENT_DATE - 2, 'Pending');

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('T1 purchase orders are the distributor''s own, and only those',
  (public.portal_orders('purchase') ->> 'total')::int = 1
  AND public.portal_orders('purchase') -> 'rows' -> 0 ->> 'id' = trim(both '''' from :'ORD_P1'),
  'saw total ' || (public.portal_orders('purchase') ->> 'total'));

SELECT qa('T2 sales orders are their customers'', newest first',
  (public.portal_orders('sales') ->> 'total')::int = 2
  AND public.portal_orders('sales') -> 'rows' -> 0 ->> 'id' = trim(both '''' from :'ORD_S2'),
  'ORD_S2 is 1 day old and ORD_S1 is 5; newest must lead');

SELECT qa('T3 the distributor beside them is invisible',
  public.portal_orders('all')::text NOT LIKE '%' || trim(both '''' from :'ORD_X1') || '%',
  'spec 15 test 2 — DLR_A2 sits under DIST_A2');

SELECT qa('T4 the other TENANT is invisible',
  public.portal_orders('all')::text NOT LIKE '%' || trim(both '''' from :'ORD_B1') || '%'
  AND public.portal_payments()::text NOT LIKE '%PAY-B-1%',
  'spec 15 test 1');

SELECT qa('T5 placed_via distinguishes a portal order from a company one',
  (SELECT x ->> 'placed_via' FROM jsonb_array_elements(public.portal_orders('sales') -> 'rows') x
    WHERE x ->> 'id' = trim(both '''' from :'ORD_S2')) = 'portal'
  AND (SELECT x ->> 'placed_via' FROM jsonb_array_elements(public.portal_orders('sales') -> 'rows') x
    WHERE x ->> 'id' = trim(both '''' from :'ORD_S1')) = 'company',
  'the column exists so a portal order is never a blank salesman');

SELECT qa('T6 NO salesman is returned anywhere',
  public.portal_orders('all')::text NOT LIKE '%salesman%'
  AND public.portal_orders('all')::text NOT LIKE '%user_id%'
  AND coalesce(public.portal_order_detail(:ORD_S1)::text, '') NOT LIKE '%salesman%',
  'spec 17 q4 is assumed NO: an outsider is not told an employee''s name');

SELECT qa('T7 an order detail inside the tree opens, with its lines',
  public.portal_order_detail(:ORD_S2) ->> 'order_number' IS NOT NULL
  AND jsonb_array_length(public.portal_order_detail(:ORD_S2) -> 'lines') = 2,
  'ORD_S2 has two lines');

SELECT qa('T8 an order OUTSIDE the tree returns null, not an error',
  public.portal_order_detail(:ORD_X1) IS NULL
  AND public.portal_order_detail(:ORD_B1) IS NULL,
  'guessing an order id must reveal nothing, and must not look different from a typo');

-- T9: the plan's draft expected 2 here. Computed from the fixture instead, as
-- the plan itself asks: inside DIST_A1's tree the orders are ORD_P1 (10 days),
-- ORD_S1 (5 days) and ORD_S2 (1 day). A window of the last 3 days holds ORD_S2
-- alone, so the honest number is 1. ORD_X1 (2 days) is excluded by the tree,
-- not by the date — which is what the draft's 2 was counting.
SELECT qa('T9 a date range filters, and the count agrees with the rows',
  (public.portal_orders('all', CURRENT_DATE - 3, CURRENT_DATE) ->> 'total')::int = 1
  AND jsonb_array_length(public.portal_orders('all', CURRENT_DATE - 3, CURRENT_DATE) -> 'rows') = 1
  AND public.portal_orders('all', CURRENT_DATE - 3, CURRENT_DATE) -> 'rows' -> 0 ->> 'id'
      = trim(both '''' from :'ORD_S2'),
  'saw total ' || (public.portal_orders('all', CURRENT_DATE - 3, CURRENT_DATE) ->> 'total'));

SELECT qa('T9b and a window that reaches back far enough holds all three',
  (public.portal_orders('all', CURRENT_DATE - 30, CURRENT_DATE) ->> 'total')::int = 3,
  'proves T9''s 1 is the date filter working, not the tree refusing everything');

SELECT qa('T10 outstanding splits mine from my customers''',
  (public.portal_outstanding() ->> 'mine') IS NOT NULL
  AND jsonb_array_length(public.portal_outstanding() -> 'customers') = 2,
  'two customers below DIST_A1');

SELECT qa('T11 payments are theirs and their customers'', read only',
  (public.portal_payments() ->> 'total')::int = 2
  AND public.portal_payments()::text LIKE '%PAY-A-1%'
  AND public.portal_payments()::text LIKE '%PAY-A-2%',
  'founder decision 6: view only');

SELECT qa('T11b a receipt carries its status into the portal',
  (SELECT x ->> 'status' FROM jsonb_array_elements(public.portal_payments() -> 'rows') x
    WHERE x ->> 'payment_number' = 'PAY-A-1') = 'Pending',
  'a distributor who paid and was rejected has to be able to see that, so the '
  || 'status is returned rather than the row being hidden');

SELECT qa_refused('T12 a portal login cannot insert a payment',
  'INSERT INTO public.payments (account_id, user_id, contact_id, payment_number, amount,'
  || ' payment_type, payment_date) VALUES (' || quote_literal(:ACCT_A) || ', '
  || quote_literal(:PORTAL_U_A1) || ', ' || quote_literal(:DIST_A1)
  || ', ''PAY-HACK'', 1, ''Cash'', CURRENT_DATE)');

-- The distributor beside them, from the other side: the mirror of T3.
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A2, false);
SET ROLE authenticated;
SELECT qa('T13 the neighbouring distributor sees ITS order and not the first one''s',
  public.portal_orders('all')::text LIKE '%' || trim(both '''' from :'ORD_X1') || '%'
  AND public.portal_orders('all')::text NOT LIKE '%' || trim(both '''' from :'ORD_P1') || '%',
  'both directions of spec 15 test 2');

-- An employee, and the other tenant's employee, through the same functions.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_B, false);
SET ROLE authenticated;
SELECT qa('T14 another company''s admin reads nothing through the portal functions',
  (public.portal_orders('all') ->> 'total')::int = 0
  AND (public.portal_payments() ->> 'total')::int = 0
  AND public.portal_outstanding() IS NULL,
  'spec 15 test 1, through the definer functions this time');
RESET ROLE;

-- ── U: the policy sweep's four findings ──────────────────────
--
-- Section O proved the seven tables the portal touches are closed. It did not
-- prove the other ~120 are, so Plan 2 Task 3 Step 4 asks for the whole list of
-- policies that never test membership. Ten came back. Five were
-- report_registry_* (engine metadata, no account_id column), one was
-- ozzo_docs_select (is_published = true, public on purpose), and these four
-- were FOR ALL TO public USING (true) on tables that hold tenant data:
--
--   customer_visit_custom_values, lead_visit_custom_values,
--   dispatch_custom_values, user_custom_values
--
-- 20261114140000 scopes them by is_account_member(account_id). Every scenario
-- below FAILS without that migration — measured, not assumed: before it, a
-- portal customer of tenant A read tenant B's row, inserted into tenant B and
-- updated tenant B's row, and an anonymous visitor read it too.
--
-- U5 and U6 are the non-regression half, and they matter as much: all four
-- tables are written by the live web app (employee form, dispatch form, visits
-- screen) and two by the mobile app's offline queue. If scoping broke those
-- writes, custom fields would silently stop saving.

\set CF_ACCT_B '''bbbb0000-0000-0000-0000-000000000002'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

-- One row of TENANT B's data in each of the four tables, written as the owner
-- the way a migration or the service role would. visit_id, dispatch_id and
-- user_id carry no foreign key, and custom_field_id is nullable, so these need
-- no other fixture.
DELETE FROM public.user_custom_values           WHERE value LIKE 'U-section%';
DELETE FROM public.customer_visit_custom_values WHERE value LIKE 'U-section%';
DELETE FROM public.lead_visit_custom_values     WHERE value LIKE 'U-section%';
DELETE FROM public.dispatch_custom_values       WHERE value LIKE 'U-section%';

INSERT INTO public.user_custom_values (account_id, user_id, custom_field_id, value)
VALUES (:CF_ACCT_B, '22220000-0000-0000-0000-000000000001', NULL, 'U-section tenant B employee value');
INSERT INTO public.customer_visit_custom_values (account_id, visit_id, custom_field_id, value)
VALUES (:CF_ACCT_B, '99990000-0000-0000-0000-0000000000b1', NULL, 'U-section tenant B visit value');
INSERT INTO public.lead_visit_custom_values (account_id, visit_id, custom_field_id, value)
VALUES (:CF_ACCT_B, '99990000-0000-0000-0000-0000000000b2', NULL, 'U-section tenant B lead visit value');
INSERT INTO public.dispatch_custom_values (account_id, dispatch_id, custom_field_id, value)
VALUES (:CF_ACCT_B, '99990000-0000-0000-0000-0000000000b3', NULL, 'U-section tenant B dispatch value');

SELECT qa('U0 precondition: there IS a row of tenant B data in each of the four tables',
  (SELECT count(*) FROM public.user_custom_values           WHERE value LIKE 'U-section%') = 1
  AND (SELECT count(*) FROM public.customer_visit_custom_values WHERE value LIKE 'U-section%') = 1
  AND (SELECT count(*) FROM public.lead_visit_custom_values     WHERE value LIKE 'U-section%') = 1
  AND (SELECT count(*) FROM public.dispatch_custom_values       WHERE value LIKE 'U-section%') = 1,
  'with no rows seeded, U1-U3 would pass on an empty table and prove nothing — '
  'which is exactly why the hole survived until a sweep looked for it');

-- U1: the portal customer of tenant A. No profiles row, no membership of
-- anything, and before the fix it read all four.
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;
SELECT qa('U1 a portal customer of tenant A reads NONE of tenant B''s custom values',
  (SELECT count(*) FROM public.user_custom_values) = 0
  AND (SELECT count(*) FROM public.customer_visit_custom_values) = 0
  AND (SELECT count(*) FROM public.lead_visit_custom_values) = 0
  AND (SELECT count(*) FROM public.dispatch_custom_values) = 0,
  'saw ' || (SELECT count(*) FROM public.user_custom_values)::text || '/'
  || (SELECT count(*) FROM public.customer_visit_custom_values)::text || '/'
  || (SELECT count(*) FROM public.lead_visit_custom_values)::text || '/'
  || (SELECT count(*) FROM public.dispatch_custom_values)::text
  || ' rows; every one must be 0');

-- U2: and cannot write into another tenant either. Before the fix this INSERT
-- succeeded.
SELECT qa_refused('U2 a portal customer of tenant A cannot insert into tenant B',
  'INSERT INTO public.user_custom_values (account_id, user_id, custom_field_id, value) VALUES ('
  || quote_literal(:CF_ACCT_B) || ', ''22220000-0000-0000-0000-000000000001'', NULL, ''U-section written by an outsider'')');

-- U3: an UPDATE is asked the O10 way — not "was it refused", which is ALLOWED
-- for a statement that matches no visible row, but "did the row move".
DO $u3$ BEGIN
  UPDATE public.user_custom_values SET value = 'U-section overwritten by an outsider'
   WHERE value = 'U-section tenant B employee value';
EXCEPTION WHEN OTHERS THEN NULL;
END $u3$;

-- U4: a visitor who is not signed in at all. The anon key is in the browser
-- bundle, so this is the case that made the hole public rather than merely
-- cross-tenant.
RESET ROLE;
SELECT set_config('test.uid', '', false);
SET ROLE anon;
SELECT qa('U4 a visitor who is not signed in reads none of them either',
  (SELECT count(*) FROM public.user_custom_values) = 0
  AND (SELECT count(*) FROM public.customer_visit_custom_values) = 0
  AND (SELECT count(*) FROM public.lead_visit_custom_values) = 0
  AND (SELECT count(*) FROM public.dispatch_custom_values) = 0,
  'the anon key ships in the browser bundle, so "readable by anon" means '
  'readable by anyone at all');

RESET ROLE;
SELECT qa('U3 and the outsider''s UPDATE did not change tenant B''s row',
  (SELECT count(*) FROM public.user_custom_values
    WHERE value = 'U-section tenant B employee value') = 1
  AND NOT EXISTS (SELECT 1 FROM public.user_custom_values
    WHERE value LIKE '%overwritten by an outsider%'
       OR value LIKE '%written by an outsider%'),
  'the row must read exactly as tenant B left it');

-- U5: THE NON-REGRESSION. Tenant B's own admin must still read and write its
-- own rows, or the employee form, the dispatch form, the visits screen and the
-- mobile offline queue all stop saving custom fields.
SELECT set_config('test.uid', :ADMIN_B, false);
SET ROLE authenticated;
SELECT qa('U5 tenant B''s own admin still reads its own custom values',
  (SELECT count(*) FROM public.user_custom_values WHERE value LIKE 'U-section%') = 1
  AND (SELECT count(*) FROM public.customer_visit_custom_values WHERE value LIKE 'U-section%') = 1
  AND (SELECT count(*) FROM public.lead_visit_custom_values WHERE value LIKE 'U-section%') = 1
  AND (SELECT count(*) FROM public.dispatch_custom_values WHERE value LIKE 'U-section%') = 1,
  'scoping must not take a tenant''s own data away from it');

SELECT qa_allowed('U6 and can still write them, exactly as the forms do',
  'INSERT INTO public.user_custom_values (account_id, user_id, custom_field_id, value) VALUES ('
  || quote_literal(:CF_ACCT_B) || ', ''22220000-0000-0000-0000-000000000001'', NULL, ''U-section written by its own admin'')');

SELECT qa_allowed('U6b and can update its own row',
  'UPDATE public.user_custom_values SET value = ''U-section tenant B employee value'''
  || ' WHERE value = ''U-section tenant B employee value''');

-- U7: an employee of the OTHER tenant is refused too — this is not only about
-- portal logins. Before the fix, every tenant could read every other tenant's
-- custom field values.
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SET ROLE authenticated;
SELECT qa('U7 tenant A''s admin reads none of tenant B''s custom values',
  (SELECT count(*) FROM public.user_custom_values) = 0
  AND (SELECT count(*) FROM public.dispatch_custom_values) = 0,
  'saw ' || (SELECT count(*) FROM public.user_custom_values)::text
  || ' employee values of another company');

RESET ROLE;
DELETE FROM public.user_custom_values           WHERE value LIKE 'U-section%';
DELETE FROM public.customer_visit_custom_values WHERE value LIKE 'U-section%';
DELETE FROM public.lead_visit_custom_values     WHERE value LIKE 'U-section%';
DELETE FROM public.dispatch_custom_values       WHERE value LIKE 'U-section%';
