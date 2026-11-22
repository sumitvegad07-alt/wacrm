-- ============================================================
-- 2026-11-22 — Leads brought into line with the CRM (20261122120000).
--
-- The one rule in that migration that WIDENS access is the new
-- partner_leads_select: a collaborator can read a lead they do not own.
-- Widening is the direction that leaks, so most of this file is about it —
-- a collaborator reads it, a stranger still does not, and a collaborator
-- still cannot edit or delete it.
--
-- The rest covers the company mirror, the dropped columns, the timeline and
-- the convert function.
--
-- Establishes its own state and cleans up after itself.
--
-- ---------------------------------------------------------------------
-- WHEN qa_refused IS THE RIGHT TOOL, AND WHEN IT LIES
-- ---------------------------------------------------------------------
-- qa_refused() runs a statement and passes if it RAISES. That makes it
-- right for a trigger or a constraint, which really do raise:
--     the reporting-loop guard, the built-in-role guard, a CHECK, a unique
--     index, a foreign key.
--
-- It is WRONG for row-level security on UPDATE or DELETE. RLS filters rows;
-- it does not raise. A statement that matches no row completes quietly, so
-- qa_refused reports "refused" whether the policy exists or not — it passes
-- against a table with RLS switched off entirely.
--
-- For those, run the statement plainly and then assert the row did not
-- change, read back as postgres with RESET ROLE. This was got wrong three
-- times in a row across files 81 and 82 before it was written down here.
--
-- INSERT is the exception: an INSERT that violates a WITH CHECK does raise,
-- so qa_refused is right for it — as long as the row's values are literals
-- and not a sub-SELECT that RLS can empty first.
-- ============================================================
\set ON_ERROR_STOP on

\set OWNER  '''c0000000-0000-0000-0000-00000000000a'''
\set FRIEND '''c0000000-0000-0000-0000-00000000000b'''
\set OUTSID '''c0000000-0000-0000-0000-00000000000c'''

RESET ROLE;

DELETE FROM public.partner_module_activities WHERE message LIKE 'QA3 %';
DELETE FROM public.partner_customers WHERE business_name LIKE 'QA3 %';
DELETE FROM public.partner_leads     WHERE name LIKE 'QA3 %';
DELETE FROM public.partner_employees WHERE email LIKE '%@parity.test';
DELETE FROM auth.users WHERE email LIKE '%@parity.test';

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:OWNER,  'owner@parity.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:FRIEND, 'friend@parity.test', '{"skip_account_provision":"true"}'::jsonb),
  (:OUTSID, 'out@parity.test',    '{"skip_account_provision":"true"}'::jsonb);

-- All three are Sales Executives: scope 'own'. That is the point — without
-- the collaborator clause, the friend could not see the owner's lead at all.
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :OWNER, 'QA3 Owner', 'owner@parity.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :FRIEND, 'QA3 Friend', 'friend@parity.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :OUTSID, 'QA3 Outsider', 'out@parity.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';

INSERT INTO public.partner_leads (name, phone, city, status, owner_id, collaborator_ids)
SELECT 'QA3 Shared Lead', '9111100001', 'Rajkot', 'New', o.id, array[f.id]
  FROM public.partner_employees o, public.partner_employees f
 WHERE o.email = 'owner@parity.test' AND f.email = 'friend@parity.test';

INSERT INTO public.partner_leads (name, phone, city, status, owner_id)
SELECT 'QA3 Private Lead', '9111100002', 'Rajkot', 'New', o.id
  FROM public.partner_employees o WHERE o.email = 'owner@parity.test';

SELECT id AS shared_id FROM public.partner_leads WHERE name = 'QA3 Shared Lead' \gset

-- ── P0 the fixture ───────────────────────────────────────────
SELECT qa('P0 three executives and two leads exist',
  (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@parity.test') = 3
  AND (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA3 %') = 2,
  'employees=' || (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@parity.test'));

-- ── P1 the company mirror ────────────────────────────────────
SELECT qa('P1 company is filled from name without anybody typing it',
  (SELECT company FROM public.partner_leads WHERE name = 'QA3 Shared Lead') = 'QA3 Shared Lead',
  'got ' || coalesce((SELECT company FROM public.partner_leads WHERE name = 'QA3 Shared Lead'), 'NULL'));

UPDATE public.partner_leads SET name = 'QA3 Shared Lead Renamed' WHERE name = 'QA3 Shared Lead';
SELECT qa('P1b renaming the lead renames the company with it',
  (SELECT company FROM public.partner_leads WHERE name = 'QA3 Shared Lead Renamed')
    = 'QA3 Shared Lead Renamed',
  'the trigger must fire on name changes, not only on insert');

UPDATE public.partner_leads SET company = 'Something Else'
 WHERE name = 'QA3 Shared Lead Renamed';
SELECT qa('P1c writing company directly is overruled by the mirror',
  (SELECT company FROM public.partner_leads WHERE name = 'QA3 Shared Lead Renamed')
    = 'QA3 Shared Lead Renamed',
  'company is derived, so a direct write must not win');

UPDATE public.partner_leads SET name = 'QA3 Shared Lead'
 WHERE name = 'QA3 Shared Lead Renamed';

-- ── P2 the three columns the CRM does not have ───────────────
SELECT qa('P2 est_value, expected_close and next_follow_up are gone',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_leads'
      AND column_name IN ('est_value', 'expected_close', 'next_follow_up')) = 0,
  'found ' || (SELECT string_agg(column_name, ', ') FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_leads'
      AND column_name IN ('est_value', 'expected_close', 'next_follow_up')));

SELECT qa('P2b whatsapp and collaborator_ids are there instead',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_leads'
      AND column_name IN ('whatsapp', 'collaborator_ids')) = 2,
  'the CRM has both');

-- ── P3-P6 the collaborator rule, which widens access ─────────
SET ROLE authenticated;

SELECT set_config('test.uid', :FRIEND, false);
SELECT qa('P3 a collaborator can read a lead they do not own',
  (SELECT count(*) FROM public.partner_leads WHERE name = 'QA3 Shared Lead') = 1,
  'this is the whole point of naming somebody on a lead');

SELECT qa('P4 and still cannot read the owner''s OTHER leads',
  (SELECT count(*) FROM public.partner_leads WHERE name = 'QA3 Private Lead') = 0,
  'the clause must widen to one lead, not to the owner''s whole list');

-- NOT qa_refused. See the rule at the top of this file: RLS filters, it does
-- not raise, so this UPDATE matches no row, completes quietly, and would
-- report "refused" with no policy in place at all. P5b is the real check.
UPDATE public.partner_leads SET status = 'Won' WHERE id = :'shared_id';

RESET ROLE;
SELECT qa('P5b proven from outside RLS: the status never moved',
  (SELECT status FROM public.partner_leads WHERE name = 'QA3 Shared Lead') = 'New',
  'an UPDATE that matches no row raises nothing, so this is the real check');
SET ROLE authenticated;

SELECT set_config('test.uid', :OUTSID, false);
SELECT qa('P6 somebody who is neither owner nor collaborator sees nothing',
  (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA3 %') = 0,
  'got ' || (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA3 %'));

-- ── P7 the timeline ──────────────────────────────────────────
SELECT set_config('test.uid', :OWNER, false);
SELECT qa_allowed('P7 a portal member can append to the timeline',
  format($$INSERT INTO public.partner_module_activities
             (user_id, module_name, record_id, action, message)
           VALUES (auth.uid(), 'lead', %L, 'note', 'QA3 timeline entry')$$, :'shared_id'));

SELECT qa('P7b and read it back',
  (SELECT count(*) FROM public.partner_module_activities WHERE message = 'QA3 timeline entry') = 1,
  'got ' || (SELECT count(*) FROM public.partner_module_activities WHERE message = 'QA3 timeline entry'));

SELECT qa_refused('P7c but cannot write one as somebody else',
  format($$INSERT INTO public.partner_module_activities
             (user_id, module_name, record_id, action, message)
           VALUES (%L, 'lead', %L, 'note', 'QA3 forged entry')$$, :'FRIEND', :'shared_id'));

-- ── P8-P10 converting ────────────────────────────────────────
SELECT set_config('test.uid', :OWNER, false);
SELECT qa_allowed('P8 the owner can convert their lead',
  format($$SELECT public.partner_convert_lead_to_customer(%L)$$, :'shared_id'));

RESET ROLE;
SELECT qa('P8b the customer exists, carrying the lead''s details',
  (SELECT count(*) FROM public.partner_customers
    WHERE business_name = 'QA3 Shared Lead' AND source_lead_id::text = :'shared_id') = 1,
  'got ' || (SELECT count(*) FROM public.partner_customers WHERE business_name = 'QA3 Shared Lead'));

SELECT qa('P8c the lead is stamped and marked Won',
  (SELECT converted_customer_id IS NOT NULL AND converted_at IS NOT NULL AND status = 'Won'
     FROM public.partner_leads WHERE name = 'QA3 Shared Lead'),
  'status=' || coalesce((SELECT status FROM public.partner_leads WHERE name = 'QA3 Shared Lead'), 'NULL'));

SELECT qa('P8d and the conversion is on the timeline',
  (SELECT count(*) FROM public.partner_module_activities
    WHERE record_id::text = :'shared_id' AND action = 'converted') = 1,
  'a conversion nobody can see afterwards is a conversion nobody trusts');

SET ROLE authenticated;
SELECT set_config('test.uid', :OWNER, false);
SELECT qa_refused('P9 converting the same lead twice is refused',
  format($$SELECT public.partner_convert_lead_to_customer(%L)$$, :'shared_id'));

SELECT set_config('test.uid', :OUTSID, false);
SELECT qa_refused('P10 somebody who cannot see the lead cannot convert it',
  format($$SELECT public.partner_convert_lead_to_customer(
             (SELECT id FROM public.partner_leads WHERE name = 'QA3 Private Lead'))$$));

RESET ROLE;

-- ── P11 the filter allowlist gained country ──────────────────
SELECT qa_allowed('P11 country is now an allowed filter source',
  $$SELECT public.partner_distinct_values('lead', 'country')$$);

SELECT qa_refused('P11b and an unlisted column is still refused',
  $$SELECT public.partner_distinct_values('lead', 'notes')$$);

-- ── P12 still no pair with two foreign keys ──────────────────
SELECT qa('P12 no pair of partner_ tables has two foreign keys between them',
  NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE contype = 'f'
       AND (conrelid::regclass::text LIKE 'partner\_%'
            OR confrelid::regclass::text LIKE 'partner\_%')
     GROUP BY conrelid, confrelid
    HAVING count(*) > 1),
  'collaborator_ids is an array precisely so it cannot become one');

-- ── Clean up, in dependency order ────────────────────────────
DELETE FROM public.partner_module_activities WHERE message LIKE 'QA3 %';
DELETE FROM public.partner_customers WHERE business_name LIKE 'QA3 %';
DELETE FROM public.partner_leads     WHERE name LIKE 'QA3 %';
DELETE FROM public.partner_employees WHERE email LIKE '%@parity.test';
DELETE FROM public.profiles WHERE user_id IN
  (SELECT id FROM auth.users WHERE email LIKE '%@parity.test');
DELETE FROM public.accounts WHERE owner_user_id IN
  (SELECT id FROM auth.users WHERE email LIKE '%@parity.test');
DELETE FROM auth.users WHERE email LIKE '%@parity.test';
