-- ============================================================
-- 2026-11-20 — Partner Portal foundation (20261120120000).
--
-- Exercises the three things that migration added which cannot be seen by
-- reading it: who partner_has_right() grants, whose ids partner_scope_ids()
-- returns, and whether the two triggers and five policies actually bite.
--
-- The shape built below:
--
--   Founder (Super Admin, scope all) ──── reports to nobody
--     Manager (Sales Manager, scope team)
--       Exec 1 (Sales Executive, scope own)
--         Teleca (Telecaller, scope own)        ← depth 2 under Manager
--       Exec 2 (Sales Executive, scope own)
--   Gone   (Sales Executive, status inactive)   ← not in the tree
--   Outsid (an auth user with NO employee row)
--
-- This file establishes its own state explicitly and inherits nothing: the
-- README's hardest lesson is that assuming a previous file's end state is how
-- five scenarios fail for reasons that have nothing to do with the code.
-- ============================================================
\set ON_ERROR_STOP on

\set FOUNDER '''e0000000-0000-0000-0000-00000000000f'''
\set MANAGER '''e0000000-0000-0000-0000-00000000000b'''
\set EXEC1   '''e0000000-0000-0000-0000-000000000001'''
\set EXEC2   '''e0000000-0000-0000-0000-000000000002'''
\set TELECA  '''e0000000-0000-0000-0000-000000000003'''
\set GONE    '''e0000000-0000-0000-0000-000000000004'''
\set OUTSID  '''e0000000-0000-0000-0000-000000000005'''
\set WILDCRD '''e0000000-0000-0000-0000-000000000006'''

-- ── A known starting point ───────────────────────────────────
-- Runs as postgres, which is superuser and therefore bypasses RLS. Every
-- scenario that tests a policy does SET ROLE authenticated first.
RESET ROLE;

DELETE FROM public.partner_employees WHERE email LIKE '%@ozzo.test';
DELETE FROM public.partner_roles WHERE is_system = false AND name NOT IN
  ('Sales Manager', 'Sales Executive', 'Telecaller');
DELETE FROM auth.users WHERE id::text LIKE 'e0000000-%';

-- raw_user_meta_data carries skip_account_provision, exactly as the portal's
-- app/api/employees/route.ts does. auth.users has an AFTER INSERT trigger
-- (on_auth_user_created -> handle_new_user) which otherwise provisions a whole
-- tenant per user: an accounts row, a Customer ID, a plan and a PROFILES row.
--
-- Two reasons this matters here rather than being a tidiness detail:
--   1. A partner employee with a profiles row is the one thing this design
--      forbids, so the test must create people the way the app does or it is
--      testing a shape that will never exist.
--   2. Those eight accounts rows are shared state for every file after this
--      one, and they made the clean-up below fail on accounts_owner_user_id_fkey.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:FOUNDER, 'founder@ozzo.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:MANAGER, 'manager@ozzo.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:EXEC1,   'exec1@ozzo.test',    '{"skip_account_provision":"true"}'::jsonb),
  (:EXEC2,   'exec2@ozzo.test',    '{"skip_account_provision":"true"}'::jsonb),
  (:TELECA,  'teleca@ozzo.test',   '{"skip_account_provision":"true"}'::jsonb),
  (:GONE,    'gone@ozzo.test',     '{"skip_account_provision":"true"}'::jsonb),
  (:OUTSID,  'outsider@ozzo.test', '{"skip_account_provision":"true"}'::jsonb),
  (:WILDCRD, 'wildcard@ozzo.test', '{"skip_account_provision":"true"}'::jsonb);

-- A role granting a VERB WILDCARD, which no seeded role uses. The SQL resolves
-- split_part(key,'_',1) || '_*', so 'view_*' must grant 'view_invoices'.
INSERT INTO public.partner_roles (name, description, permissions, data_scope)
VALUES ('QA Viewer', 'every view right, nothing else', '{"view_*": true}'::jsonb, 'own');

-- The people. Managers are set in a second pass so the rows exist first.
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :FOUNDER, 'The Founder', 'founder@ozzo.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Super Admin';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :MANAGER, 'The Manager', 'manager@ozzo.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Manager';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :EXEC1, 'Exec One', 'exec1@ozzo.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :EXEC2, 'Exec Two', 'exec2@ozzo.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :TELECA, 'The Telecaller', 'teleca@ozzo.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Telecaller';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :GONE, 'Long Gone', 'gone@ozzo.test', id, 'inactive'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :WILDCRD, 'Wild Card', 'wildcard@ozzo.test', id, 'active'
  FROM public.partner_roles WHERE name = 'QA Viewer';

UPDATE public.partner_employees SET manager_id =
  (SELECT id FROM public.partner_employees WHERE user_id = :FOUNDER)
  WHERE user_id = :MANAGER;
UPDATE public.partner_employees SET manager_id =
  (SELECT id FROM public.partner_employees WHERE user_id = :MANAGER)
  WHERE user_id IN (:EXEC1, :EXEC2);
UPDATE public.partner_employees SET manager_id =
  (SELECT id FROM public.partner_employees WHERE user_id = :EXEC1)
  WHERE user_id = :TELECA;

-- ── P0 the fixture loaded, or nothing below means anything ──
SELECT qa('P0 seven employees and five roles exist',
  (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@ozzo.test') = 7
  AND (SELECT count(*) FROM public.partner_roles) = 5,
  'employees=' || (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@ozzo.test')
    || ' roles=' || (SELECT count(*) FROM public.partner_roles));

-- ── P1–P5 partner_has_right() ────────────────────────────────
SELECT set_config('test.uid', :FOUNDER, false);
SELECT qa('P1 the wildcard role grants a right nobody ticked',
  public.partner_has_right('view_invoices') AND public.partner_has_right('anything_at_all'),
  'Super Admin holds {"all": true}');

SELECT set_config('test.uid', :MANAGER, false);
SELECT qa('P2 a manager holds what their role lists',
  public.partner_has_right('view_leads') AND public.partner_has_right('assign_leads'),
  'Sales Manager');
SELECT qa('P3 a manager does NOT hold what it omits',
  NOT public.partner_has_right('view_invoices')
  AND NOT public.partner_has_right('view_forecast')
  AND NOT public.partner_has_right('manage_employees'),
  'invoices, forecast and manage_employees start as Super Admin only');

SELECT set_config('test.uid', :WILDCRD, false);
SELECT qa('P4 a verb wildcard grants every right with that verb',
  public.partner_has_right('view_invoices') AND public.partner_has_right('view_leads'),
  '{"view_*": true}');
SELECT qa('P5 a verb wildcard grants no OTHER verb',
  NOT public.partner_has_right('delete_leads')
  AND NOT public.partner_has_right('create_leads'),
  'view_* must not imply delete_*');

-- ── P6–P7 an inactive employee, and a stranger ───────────────
SELECT set_config('test.uid', :GONE, false);
SELECT qa('P6 a deactivated employee holds nothing, whatever their role says',
  NOT public.partner_has_right('view_leads') AND public.partner_me() IS NULL,
  'status=inactive de-authorizes outright');

SELECT set_config('test.uid', :OUTSID, false);
SELECT qa('P7 an auth user with no employee row is not staff',
  NOT public.partner_has_right('view_leads') AND public.partner_me() IS NULL,
  'this is what keeps a CRM user out of the portal');

-- ── P8–P12 partner_scope_ids() ───────────────────────────────
SELECT set_config('test.uid', :FOUNDER, false);
SELECT qa('P8 scope all returns every employee, deactivated ones included',
  (SELECT count(*) FROM public.partner_scope_ids())
    = (SELECT count(*) FROM public.partner_employees),
  'a deactivated person still owns records somebody must see: scope='
    || (SELECT count(*) FROM public.partner_scope_ids())
    || ' table=' || (SELECT count(*) FROM public.partner_employees));

SELECT set_config('test.uid', :MANAGER, false);
SELECT qa('P9 scope team returns the manager and their whole downline',
  (SELECT count(*) FROM public.partner_scope_ids()) = 4,
  'manager + exec1 + exec2 + telecaller(depth 2): got '
    || (SELECT count(*) FROM public.partner_scope_ids()));
SELECT qa('P10 scope team does NOT reach upwards to their own manager',
  NOT EXISTS (
    SELECT 1 FROM public.partner_scope_ids() s
    WHERE s = (SELECT id FROM public.partner_employees WHERE user_id = :FOUNDER)),
  'a manager must not see the founder''s own records');

SELECT set_config('test.uid', :EXEC1, false);
SELECT qa('P11 scope own returns exactly one id, the caller',
  (SELECT count(*) FROM public.partner_scope_ids()) = 1
  AND (SELECT s FROM public.partner_scope_ids() s)
      = (SELECT id FROM public.partner_employees WHERE user_id = :EXEC1),
  'an executive sees only their own work');

SELECT set_config('test.uid', :OUTSID, false);
SELECT qa('P12 a stranger''s scope is empty, not everything',
  (SELECT count(*) FROM public.partner_scope_ids()) = 0,
  'the fail-open version of this would hand the company to anybody signed in');

-- ── P13–P15 the reporting-loop guard ─────────────────────────
RESET ROLE;
SELECT qa_refused('P13 an employee cannot report to themselves',
  $$UPDATE public.partner_employees
      SET manager_id = id
    WHERE email = 'exec1@ozzo.test'$$);

SELECT qa_refused('P14 a longer loop is refused too (founder -> manager -> founder)',
  $$UPDATE public.partner_employees
      SET manager_id = (SELECT id FROM public.partner_employees WHERE email = 'manager@ozzo.test')
    WHERE email = 'founder@ozzo.test'$$);

SELECT qa_allowed('P15 a legitimate manager change still works',
  $$UPDATE public.partner_employees
      SET manager_id = (SELECT id FROM public.partner_employees WHERE email = 'manager@ozzo.test')
    WHERE email = 'teleca@ozzo.test'$$);

-- Put the telecaller back under Exec 1 so the tree matches the diagram again.
UPDATE public.partner_employees SET manager_id =
  (SELECT id FROM public.partner_employees WHERE email = 'exec1@ozzo.test')
  WHERE email = 'teleca@ozzo.test';

-- ── P16–P19 the built-in role is protected ───────────────────
SELECT qa_refused('P16 the built-in role''s rights cannot be emptied',
  $$UPDATE public.partner_roles SET permissions = '{}'::jsonb WHERE name = 'Super Admin'$$);

SELECT qa_refused('P17 the built-in role''s scope cannot be narrowed',
  $$UPDATE public.partner_roles SET data_scope = 'own' WHERE name = 'Super Admin'$$);

SELECT qa_refused('P18 the built-in role cannot be deleted',
  $$DELETE FROM public.partner_roles WHERE name = 'Super Admin'$$);

SELECT qa_allowed('P19 an ordinary role can still be edited',
  $$UPDATE public.partner_roles SET description = 'edited by QA' WHERE name = 'Telecaller'$$);

-- ── P20 a role in use cannot be deleted ──────────────────────
SELECT qa_refused('P20 deleting a role somebody holds is refused, not silently nulled',
  $$DELETE FROM public.partner_roles WHERE name = 'Sales Executive'$$);

-- ── P21–P26 RLS, as real users ───────────────────────────────
SET ROLE authenticated;

SELECT set_config('test.uid', :EXEC1, false);
SELECT qa('P21 an executive can read their own row',
  (SELECT count(*) FROM public.partner_employees WHERE email = 'exec1@ozzo.test') = 1,
  'the self policy is what lets the app boot for somebody with no view_employees');
SELECT qa('P22 an executive cannot read a colleague''s row',
  (SELECT count(*) FROM public.partner_employees WHERE email = 'exec2@ozzo.test') = 0,
  'no view_employees, and out of scope besides');

SELECT set_config('test.uid', :TELECA, false);
SELECT qa('P23 a telecaller with no view_employees still sees only themselves',
  (SELECT count(*) FROM public.partner_employees) = 1,
  'got ' || (SELECT count(*) FROM public.partner_employees));

SELECT set_config('test.uid', :MANAGER, false);
SELECT qa('P24 a manager reads their downline but not upwards',
  (SELECT count(*) FROM public.partner_employees) = 4
  AND (SELECT count(*) FROM public.partner_employees WHERE email = 'founder@ozzo.test') = 0,
  'got ' || (SELECT count(*) FROM public.partner_employees));

SELECT set_config('test.uid', :OUTSID, false);
SELECT qa('P25 a stranger reads no employee at all',
  (SELECT count(*) FROM public.partner_employees) = 0,
  'got ' || (SELECT count(*) FROM public.partner_employees));

SELECT set_config('test.uid', :EXEC1, false);
SELECT qa_refused('P26 an executive cannot create a role for themselves',
  $$INSERT INTO public.partner_roles (name, permissions, data_scope)
    VALUES ('Self Promotion', '{"all": true}'::jsonb, 'all')$$);

SELECT set_config('test.uid', :FOUNDER, false);
SELECT qa_allowed('P27 the founder can create a role',
  $$INSERT INTO public.partner_roles (name, permissions, data_scope)
    VALUES ('QA Created', '{"view_leads": true}'::jsonb, 'own')$$);

RESET ROLE;

-- ── P27b no partner employee ever gets a profiles row ────────
-- The whole identity argument for this portal. If the auth trigger provisions
-- one, an OZZO salesperson turns up in a tenant's employee dropdown.
SELECT qa('P27b creating partner staff provisions no profile and no account',
  (SELECT count(*) FROM public.profiles p
     JOIN auth.users u ON u.id = p.user_id
    WHERE u.email LIKE '%@ozzo.test') = 0
  AND (SELECT count(*) FROM public.accounts a
     JOIN auth.users u ON u.id = a.owner_user_id
    WHERE u.email LIKE '%@ozzo.test') = 0,
  'profiles=' || (SELECT count(*) FROM public.profiles p
     JOIN auth.users u ON u.id = p.user_id WHERE u.email LIKE '%@ozzo.test')
  || ' accounts=' || (SELECT count(*) FROM public.accounts a
     JOIN auth.users u ON u.id = a.owner_user_id WHERE u.email LIKE '%@ozzo.test'));

-- ── P28 the PostgREST trap ───────────────────────────────────
-- A SECOND foreign key from partner_employees to itself would make every
-- embed of this table ambiguous and return 404 for everything — which is how
-- orders.parent_contact_id broke every order screen for three days. created_by
-- is deliberately a bare uuid, and this is the assertion that keeps it one.
SELECT qa('P28 partner_employees has exactly ONE foreign key to itself',
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.partner_employees'::regclass
      AND confrelid = 'public.partner_employees'::regclass
      AND contype = 'f') = 1,
  'found ' || (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.partner_employees'::regclass
      AND confrelid = 'public.partner_employees'::regclass
      AND contype = 'f'));

-- ── P29 RLS is actually switched on ──────────────────────────
SELECT qa('P29 both tables have RLS enabled and policies on them',
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c
    WHERE c.oid IN ('public.partner_roles'::regclass, 'public.partner_employees'::regclass))
  AND (SELECT count(*) FROM pg_policy p
    WHERE p.polrelid IN ('public.partner_roles'::regclass, 'public.partner_employees'::regclass)) = 5,
  'policies=' || (SELECT count(*) FROM pg_policy p
    WHERE p.polrelid IN ('public.partner_roles'::regclass, 'public.partner_employees'::regclass)));

-- Clean up after ourselves. Employees first: role_id is ON DELETE RESTRICT,
-- so dropping QA Viewer while Wild Card still holds it is refused — which
-- would be reported as an error rather than as the tidy-up it is.
DELETE FROM public.partner_employees WHERE email LIKE '%@ozzo.test';
DELETE FROM public.partner_roles WHERE name IN ('QA Created', 'QA Viewer');
-- profiles and accounts should both be empty for these users (P27b asserts
-- it), but delete in dependency order anyway: if the skip flag ever stops
-- working, the clean-up should still tidy up rather than fail on a foreign key.
DELETE FROM public.profiles WHERE user_id IN
  (SELECT id FROM auth.users WHERE email LIKE '%@ozzo.test');
DELETE FROM public.accounts WHERE owner_user_id IN
  (SELECT id FROM auth.users WHERE email LIKE '%@ozzo.test');
DELETE FROM auth.users WHERE email LIKE '%@ozzo.test';
