-- ============================================================
-- 2026-11-21 — Partner Portal Phase 2 (20261121120000).
--
-- The question these scenarios answer is the one the whole Leads module
-- rests on: does an executive see only their own leads, and can the
-- database be talked out of it. Everything else here supports that.
--
-- The shape built below:
--
--   Founder (Super Admin, scope all) ──── reports to nobody
--     Manager (Sales Manager, scope team)
--       Exec 1 (Sales Executive, scope own)   2 leads, in Rajkot
--       Exec 2 (Sales Executive, scope own)   2 leads, in Surat
--   and 2 leads owned by the Founder, in Ahmedabad.
--
-- Establishes its own state and inherits nothing from file 80, which
-- deletes its own people on the way out.
-- ============================================================
\set ON_ERROR_STOP on

\set FOUNDER '''f0000000-0000-0000-0000-00000000000f'''
\set MANAGER '''f0000000-0000-0000-0000-00000000000b'''
\set EXEC1   '''f0000000-0000-0000-0000-000000000001'''
\set EXEC2   '''f0000000-0000-0000-0000-000000000002'''

RESET ROLE;

-- ── A known starting point ───────────────────────────────────
DELETE FROM public.partner_tasks     WHERE subject LIKE 'QA2 %';
DELETE FROM public.partner_leads     WHERE name LIKE 'QA2 %';
DELETE FROM public.partner_customers WHERE business_name LIKE 'QA2 %';
DELETE FROM public.partner_table_views WHERE table_key = 'qa2_leads';
DELETE FROM public.partner_employees WHERE email LIKE '%@phase2.test';
DELETE FROM auth.users WHERE email LIKE '%@phase2.test';

-- skip_account_provision, exactly as app/api/employees/route.ts passes it.
-- Without it the AFTER INSERT trigger on auth.users provisions a tenant and a
-- profiles row per person — see 80_partner_rights.sql for the full reasoning.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:FOUNDER, 'f@phase2.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:MANAGER, 'm@phase2.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:EXEC1,   'e1@phase2.test', '{"skip_account_provision":"true"}'::jsonb),
  (:EXEC2,   'e2@phase2.test', '{"skip_account_provision":"true"}'::jsonb);

INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :FOUNDER, 'P2 Founder', 'f@phase2.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Super Admin';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :MANAGER, 'P2 Manager', 'm@phase2.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Manager';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :EXEC1, 'P2 Exec One', 'e1@phase2.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :EXEC2, 'P2 Exec Two', 'e2@phase2.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';

UPDATE public.partner_employees SET manager_id =
  (SELECT id FROM public.partner_employees WHERE email = 'f@phase2.test')
  WHERE email = 'm@phase2.test';
UPDATE public.partner_employees SET manager_id =
  (SELECT id FROM public.partner_employees WHERE email = 'm@phase2.test')
  WHERE email IN ('e1@phase2.test', 'e2@phase2.test');

-- Six leads: two each, in three different cities so the distinct-values
-- scenarios have something to tell apart.
INSERT INTO public.partner_leads (name, company, phone, status, city, owner_id)
SELECT 'QA2 Founder Lead A', 'Alpha Ltd', '9000000001', 'New', 'Ahmedabad', e.id
  FROM public.partner_employees e WHERE e.email = 'f@phase2.test';
INSERT INTO public.partner_leads (name, company, phone, status, city, owner_id)
SELECT 'QA2 Founder Lead B', 'Beta Ltd', '9000000002', 'New', 'Ahmedabad', e.id
  FROM public.partner_employees e WHERE e.email = 'f@phase2.test';
INSERT INTO public.partner_leads (name, company, phone, status, city, owner_id)
SELECT 'QA2 Exec1 Lead A', 'Gamma Ltd', '9000000003', 'New', 'Rajkot', e.id
  FROM public.partner_employees e WHERE e.email = 'e1@phase2.test';
INSERT INTO public.partner_leads (name, company, phone, status, city, owner_id)
SELECT 'QA2 Exec1 Lead B', 'Delta Ltd', '9000000004', 'Contacted', 'Rajkot', e.id
  FROM public.partner_employees e WHERE e.email = 'e1@phase2.test';
INSERT INTO public.partner_leads (name, company, phone, status, city, owner_id)
SELECT 'QA2 Exec2 Lead A', 'Epsilon Ltd', '9000000005', 'New', 'Surat', e.id
  FROM public.partner_employees e WHERE e.email = 'e2@phase2.test';
INSERT INTO public.partner_leads (name, company, phone, status, city, owner_id)
SELECT 'QA2 Exec2 Lead B', 'Zeta Ltd', '9000000006', 'Quoted', 'Surat', e.id
  FROM public.partner_employees e WHERE e.email = 'e2@phase2.test';

-- ── L0 the fixture loaded, or nothing below means anything ──
SELECT qa('L0 four employees and six leads exist',
  (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@phase2.test') = 4
  AND (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA2 %') = 6,
  'employees=' || (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@phase2.test')
    || ' leads=' || (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA2 %'));

-- ── L1-L3 who can read whose leads ───────────────────────────
SET ROLE authenticated;

SELECT set_config('test.uid', :EXEC1, false);
SELECT qa('L1 an executive reads only their own leads',
  (SELECT count(*) FROM public.partner_leads) = 2
  AND (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA2 Exec1%') = 2,
  'got ' || (SELECT count(*) FROM public.partner_leads));

SELECT set_config('test.uid', :MANAGER, false);
SELECT qa('L2 a manager reads the whole downline, and not upwards',
  (SELECT count(*) FROM public.partner_leads) = 4
  AND (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA2 Founder%') = 0,
  'got ' || (SELECT count(*) FROM public.partner_leads));

SELECT set_config('test.uid', :FOUNDER, false);
SELECT qa('L3 the founder reads every lead',
  (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA2 %') = 6,
  'got ' || (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA2 %'));

-- ── L4-L7 who can write what ─────────────────────────────────
SELECT set_config('test.uid', :EXEC1, false);
-- The owner id is captured as a LITERAL before the role switch, not looked up
-- inside the INSERT. An `INSERT ... SELECT` whose sub-query matches no row
-- inserts nothing and raises nothing, so it would report "refused" without the
-- policy doing any work at all - RLS hides exec2's employee row from exec1,
-- which is a different rule from the one under test.
SELECT id AS exec2_id FROM public.partner_employees WHERE email = 'e2@phase2.test' \gset

SELECT qa_refused('L4 an executive cannot create a lead owned by somebody else',
  format($$INSERT INTO public.partner_leads (name, owner_id)
           VALUES ('QA2 Smuggled', %L)$$, :'exec2_id'));

SELECT qa_allowed('L4b an executive CAN create a lead owned by themselves',
  $$INSERT INTO public.partner_leads (name, owner_id)
    SELECT 'QA2 Exec1 Lead C', e.id FROM public.partner_employees e
     WHERE e.email = 'e1@phase2.test'$$);

SELECT set_config('test.uid', :MANAGER, false);
SELECT qa_allowed('L5 a manager can create a lead owned by someone in their team',
  $$INSERT INTO public.partner_leads (name, owner_id)
    SELECT 'QA2 Assigned By Manager', e.id FROM public.partner_employees e
     WHERE e.email = 'e1@phase2.test'$$);

SELECT set_config('test.uid', :EXEC1, false);
-- NOT qa_refused: an UPDATE that matches no row is not an error, so a refusal
-- test here passes whether or not any policy exists. The only honest check is
-- that the row did not change, read from outside RLS - which is L6c.
UPDATE public.partner_leads SET status = 'Won' WHERE name = 'QA2 Exec2 Lead A';

SELECT qa('L6b exec1 sees only their own leads, now four of them',
  (SELECT count(*) FROM public.partner_leads) = 4,
  'two from the fixture, one from L4b, one assigned by the manager in L5; got '
    || (SELECT count(*) FROM public.partner_leads));

RESET ROLE;
SELECT qa('L6c proven from outside RLS: Exec2 Lead A was never changed',
  (SELECT status FROM public.partner_leads WHERE name = 'QA2 Exec2 Lead A') = 'New',
  'status is ' || coalesce((SELECT status FROM public.partner_leads
                             WHERE name = 'QA2 Exec2 Lead A'), 'NULL'));
SET ROLE authenticated;

SELECT set_config('test.uid', :EXEC1, false);
-- Same trap as L6: a DELETE that matches no row raises nothing. The proof is
-- that the row survives, checked from outside RLS in L7b.
DELETE FROM public.partner_leads WHERE name = 'QA2 Exec1 Lead C';

RESET ROLE;
SELECT qa('L7b and it is still there',
  (SELECT count(*) FROM public.partner_leads WHERE name = 'QA2 Exec1 Lead C') = 1,
  'the Sales Executive role holds no delete_leads, so soft delete is the only route');
SET ROLE authenticated;

-- ── L8-L9 the distinct-values allowlist ──────────────────────
SELECT set_config('test.uid', :EXEC1, false);
SELECT qa('L8 distinct values respect scope',
  (SELECT count(*) FROM public.partner_distinct_values('lead','city')) = 1
  AND (SELECT v FROM public.partner_distinct_values('lead','city') v) = 'Rajkot',
  'an executive must not learn which cities the rest of the company works in; got '
    || coalesce((SELECT string_agg(v, ',') FROM public.partner_distinct_values('lead','city') v), 'none'));

SELECT qa_refused('L9 a column that is not on the allowlist is refused',
  $$SELECT public.partner_distinct_values('lead', 'notes')$$);

-- ── L10 saved views are private ──────────────────────────────
SELECT set_config('test.uid', :EXEC1, false);
INSERT INTO public.partner_table_views (user_id, table_key, name, config)
VALUES (:EXEC1, 'qa2_leads', 'My Rajkot leads', '{"filters":{"city":"Rajkot"}}'::jsonb);

SELECT set_config('test.uid', :EXEC2, false);
SELECT qa('L10 one person cannot read another''s saved view',
  (SELECT count(*) FROM public.partner_table_views WHERE table_key = 'qa2_leads') = 0,
  'got ' || (SELECT count(*) FROM public.partner_table_views WHERE table_key = 'qa2_leads'));

SELECT set_config('test.uid', :EXEC1, false);
SELECT qa('L10b and the owner still can',
  (SELECT count(*) FROM public.partner_table_views WHERE table_key = 'qa2_leads') = 1,
  'got ' || (SELECT count(*) FROM public.partner_table_views WHERE table_key = 'qa2_leads'));

-- ── L12 the masters ──────────────────────────────────────────
SELECT set_config('test.uid', :EXEC1, false);
SELECT qa('L12 every portal member can read the master lists',
  (SELECT count(*) FROM public.partner_lead_statuses) >= 7
  AND (SELECT count(*) FROM public.partner_industries) >= 8,
  'a lead form needs the status list whoever is filling it in');

SELECT qa_refused('L12b but cannot add to them without manage_masters',
  $$INSERT INTO public.partner_lead_statuses (name) VALUES ('QA2 Invented Status')$$);

RESET ROLE;

-- ── L11 the PostgREST trap, for every new pair ───────────────
SELECT qa('L11 no pair of partner_ tables has two foreign keys between them',
  NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE contype = 'f'
       AND (conrelid::regclass::text LIKE 'partner\_%'
            OR confrelid::regclass::text LIKE 'partner\_%')
     GROUP BY conrelid, confrelid
    HAVING count(*) > 1),
  coalesce((SELECT string_agg(conrelid::regclass::text || '->' || confrelid::regclass::text, ', ')
              FROM (SELECT conrelid, confrelid FROM pg_constraint
                     WHERE contype = 'f'
                       AND (conrelid::regclass::text LIKE 'partner\_%'
                            OR confrelid::regclass::text LIKE 'partner\_%')
                     GROUP BY conrelid, confrelid HAVING count(*) > 1) d), 'none'));

-- ── L13 RLS is actually switched on everywhere ───────────────
SELECT qa('L13 all eight new tables have RLS enabled',
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c
    WHERE c.relname IN ('partner_lead_statuses','partner_lead_sources','partner_industries',
                        'partner_leads','partner_customers','partner_tasks',
                        'partner_table_views','partner_record_views')),
  'a table with RLS off is readable by every signed-in user of the whole database');

-- ── Clean up after ourselves, in dependency order ────────────
DELETE FROM public.partner_tasks       WHERE subject LIKE 'QA2 %';
DELETE FROM public.partner_leads       WHERE name LIKE 'QA2 %';
DELETE FROM public.partner_customers   WHERE business_name LIKE 'QA2 %';
DELETE FROM public.partner_table_views WHERE table_key = 'qa2_leads';
DELETE FROM public.partner_employees   WHERE email LIKE '%@phase2.test';
DELETE FROM public.profiles WHERE user_id IN
  (SELECT id FROM auth.users WHERE email LIKE '%@phase2.test');
DELETE FROM public.accounts WHERE owner_user_id IN
  (SELECT id FROM auth.users WHERE email LIKE '%@phase2.test');
DELETE FROM auth.users WHERE email LIKE '%@phase2.test';
