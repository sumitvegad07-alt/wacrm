-- ============================================================
-- 2026-11-23 — Customers brought into line with the CRM (20261123120000).
--
-- C8 is the scenario that matters most. The migration renames
-- business_name -> company and contact_person -> name, so that the portal
-- matches the CRM, where a contact's `name` is the PERSON and `company` is
-- the BUSINESS. Converting a lead has to put the business in `company`.
-- Swapping that pair files every converted shop under its shopkeeper, and
-- nothing downstream would notice — no error, no empty screen, just wrong
-- names for ever.
--
-- ---------------------------------------------------------------------
-- WHEN qa_refused IS THE RIGHT TOOL, AND WHEN IT LIES
-- ---------------------------------------------------------------------
-- qa_refused() passes if the statement RAISES. Triggers, CHECKs, unique
-- indexes and foreign keys raise, so it is right for those. Row-level
-- security on UPDATE or DELETE does NOT raise — it filters rows away, so
-- the statement completes quietly and qa_refused reports "refused" even
-- against a table with RLS switched off. For those, run the statement
-- plainly and then assert the row did not change, read back as postgres.
-- Got wrong three times across files 81 and 82 before it was written down.
-- ============================================================
\set ON_ERROR_STOP on

\set OWNER  '''d0000000-0000-0000-0000-00000000000a'''
\set FRIEND '''d0000000-0000-0000-0000-00000000000b'''
\set OUTSID '''d0000000-0000-0000-0000-00000000000c'''

RESET ROLE;

DELETE FROM public.partner_module_activities WHERE message LIKE 'QA4 %';
DELETE FROM public.partner_customers WHERE company LIKE 'QA4 %';
DELETE FROM public.partner_leads     WHERE name LIKE 'QA4 %';
DELETE FROM public.partner_employees WHERE email LIKE '%@cust.test';
DELETE FROM auth.users WHERE email LIKE '%@cust.test';

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:OWNER,  'owner@cust.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:FRIEND, 'friend@cust.test', '{"skip_account_provision":"true"}'::jsonb),
  (:OUTSID, 'out@cust.test',    '{"skip_account_provision":"true"}'::jsonb);

-- All three are Sales Executives (scope 'own'), which is what makes the
-- collaborator clause the only way the friend can see anything.
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :OWNER, 'QA4 Owner', 'owner@cust.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :FRIEND, 'QA4 Friend', 'friend@cust.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :OUTSID, 'QA4 Outsider', 'out@cust.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';

INSERT INTO public.partner_customers (company, name, city, owner_id, collaborator_ids)
SELECT 'QA4 Shared Shop', 'Priya Shah', 'Rajkot', o.id, array[f.id]
  FROM public.partner_employees o, public.partner_employees f
 WHERE o.email = 'owner@cust.test' AND f.email = 'friend@cust.test';

INSERT INTO public.partner_customers (company, name, city, owner_id)
SELECT 'QA4 Private Shop', 'Raj Patel', 'Rajkot', o.id
  FROM public.partner_employees o WHERE o.email = 'owner@cust.test';

SELECT id AS shared_cust FROM public.partner_customers WHERE company = 'QA4 Shared Shop' \gset

-- A lead to convert later. Its NAME is the business; its contact_person is
-- the human. C8 checks which way round they land.
INSERT INTO public.partner_leads (name, contact_person, phone, city, status, owner_id)
SELECT 'QA4 Mehta Traders', 'Nilesh Mehta', '9222200001', 'Surat', 'New', o.id
  FROM public.partner_employees o WHERE o.email = 'owner@cust.test';

-- ── C0 the fixture ───────────────────────────────────────────
SELECT qa('C0 three executives, two customers and one lead exist',
  (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@cust.test') = 3
  AND (SELECT count(*) FROM public.partner_customers WHERE company LIKE 'QA4 %') = 2
  AND (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA4 %') = 1,
  'customers=' || (SELECT count(*) FROM public.partner_customers WHERE company LIKE 'QA4 %'));

-- ── C1 the rename itself ─────────────────────────────────────
SELECT qa('C1 the columns are company and name, not business_name and contact_person',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_customers'
      AND column_name IN ('company', 'name')) = 2
  AND (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_customers'
      AND column_name IN ('business_name', 'contact_person')) = 0,
  'still present: ' || coalesce((SELECT string_agg(column_name, ', ')
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_customers'
      AND column_name IN ('business_name', 'contact_person')), 'none'));

SELECT qa('C1b partner_leads.contact_person is untouched',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_leads'
      AND column_name = 'contact_person') = 1,
  'leads name the person separately; only customers were renamed');

-- ── C2-C5 who can read what ──────────────────────────────────
SET ROLE authenticated;

SELECT set_config('test.uid', :OWNER, false);
SELECT qa('C2 the owner reads both of their customers',
  (SELECT count(*) FROM public.partner_customers WHERE company LIKE 'QA4 %') = 2,
  'got ' || (SELECT count(*) FROM public.partner_customers WHERE company LIKE 'QA4 %'));

SELECT set_config('test.uid', :FRIEND, false);
SELECT qa('C3 a collaborator reads the customer they are named on',
  (SELECT count(*) FROM public.partner_customers WHERE company = 'QA4 Shared Shop') = 1,
  'this is the point of naming somebody on a customer');

SELECT qa('C4 and not the owner''s other customers',
  (SELECT count(*) FROM public.partner_customers WHERE company = 'QA4 Private Shop') = 0,
  'the clause must widen to one customer, not to the owner''s whole list');

-- NOT qa_refused: RLS filters, it does not raise. See the rule at the top.
UPDATE public.partner_customers SET city = 'Baroda' WHERE company = 'QA4 Shared Shop';

RESET ROLE;
SELECT qa('C5 a collaborator cannot edit it — the city never moved',
  (SELECT city FROM public.partner_customers WHERE company = 'QA4 Shared Shop') = 'Rajkot',
  'city is ' || coalesce((SELECT city FROM public.partner_customers
                           WHERE company = 'QA4 Shared Shop'), 'NULL'));
SET ROLE authenticated;

SELECT set_config('test.uid', :OUTSID, false);
SELECT qa('C6 somebody who is neither owner nor collaborator sees none of them',
  (SELECT count(*) FROM public.partner_customers WHERE company LIKE 'QA4 %') = 0,
  'got ' || (SELECT count(*) FROM public.partner_customers WHERE company LIKE 'QA4 %'));

RESET ROLE;

-- ── C7 the constraints ───────────────────────────────────────
SELECT qa_refused('C7 a customer with no business name is refused',
  $$INSERT INTO public.partner_customers (company, owner_id)
    SELECT NULL, e.id FROM public.partner_employees e WHERE e.email = 'owner@cust.test'$$);

SELECT qa_allowed('C7b a customer with no contact person is fine',
  $$INSERT INTO public.partner_customers (company, owner_id)
    SELECT 'QA4 Nameless Shop', e.id FROM public.partner_employees e
     WHERE e.email = 'owner@cust.test'$$);

-- ── C8 THE ONE THAT MATTERS: converting, the right way round ─
SET ROLE authenticated;
SELECT set_config('test.uid', :OWNER, false);
SELECT qa_allowed('C8 the owner can convert their lead',
  $$SELECT public.partner_convert_lead_to_customer(
      (SELECT id FROM public.partner_leads WHERE name = 'QA4 Mehta Traders'))$$);

RESET ROLE;
SELECT qa('C8b the BUSINESS lands in company and the PERSON in name',
  (SELECT company FROM public.partner_customers WHERE source_lead_id IS NOT NULL
     AND company = 'QA4 Mehta Traders') = 'QA4 Mehta Traders'
  AND (SELECT name FROM public.partner_customers
        WHERE company = 'QA4 Mehta Traders') = 'Nilesh Mehta',
  'company=' || coalesce((SELECT company FROM public.partner_customers
                           WHERE source_lead_id IS NOT NULL
                             AND company LIKE 'QA4 %' LIMIT 1), 'NULL')
    || ' name=' || coalesce((SELECT name FROM public.partner_customers
                              WHERE source_lead_id IS NOT NULL
                                AND company LIKE 'QA4 %' LIMIT 1), 'NULL'));

SELECT qa('C8c the whole address and both numbers came across',
  (SELECT city = 'Surat' AND phone = '9222200001'
     FROM public.partner_customers WHERE company = 'QA4 Mehta Traders'),
  'a conversion that loses the phone number makes the customer useless');

SELECT qa('C8d both timelines record it',
  (SELECT count(*) FROM public.partner_module_activities
    WHERE module_name = 'lead' AND action = 'converted'
      AND message LIKE '%QA4 Mehta Traders%') = 1
  AND (SELECT count(*) FROM public.partner_module_activities
    WHERE module_name = 'customer' AND action = 'created'
      AND message LIKE '%QA4 Mehta Traders%') = 1,
  'the lead says where it went and the customer says where it came from');

SET ROLE authenticated;
SELECT set_config('test.uid', :OWNER, false);
SELECT qa_refused('C9 converting the same lead twice is refused',
  $$SELECT public.partner_convert_lead_to_customer(
      (SELECT id FROM public.partner_leads WHERE name = 'QA4 Mehta Traders'))$$);

-- ── C10-C11 the filter values ────────────────────────────────
SELECT set_config('test.uid', :OUTSID, false);
SELECT qa('C10 customer filter values respect scope',
  (SELECT count(*) FROM public.partner_distinct_values('customer', 'city')) = 0,
  'an outsider owns no customers, so their city list must be empty; got '
    || (SELECT count(*) FROM public.partner_distinct_values('customer', 'city')));

SELECT set_config('test.uid', :OWNER, false);
SELECT qa('C10b and the owner sees their own cities',
  (SELECT count(*) FROM public.partner_distinct_values('customer', 'city')) >= 1,
  'got ' || (SELECT count(*) FROM public.partner_distinct_values('customer', 'city')));

SELECT qa_refused('C11 an unlisted customer column is refused',
  $$SELECT public.partner_distinct_values('customer', 'notes')$$);

SELECT qa_allowed('C11b and lead filters still work',
  $$SELECT public.partner_distinct_values('lead', 'country')$$);

RESET ROLE;

-- ── C12 still no pair with two foreign keys ──────────────────
SELECT qa('C12 no pair of partner_ tables has two foreign keys between them',
  NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE contype = 'f'
       AND (conrelid::regclass::text LIKE 'partner\_%'
            OR confrelid::regclass::text LIKE 'partner\_%')
     GROUP BY conrelid, confrelid
    HAVING count(*) > 1),
  'collaborator_ids is an array precisely so it cannot become one');

-- ── Clean up, in dependency order ────────────────────────────
DELETE FROM public.partner_module_activities WHERE message LIKE '%QA4 %';
UPDATE public.partner_leads SET converted_customer_id = NULL WHERE name LIKE 'QA4 %';
DELETE FROM public.partner_customers WHERE company LIKE 'QA4 %';
DELETE FROM public.partner_leads     WHERE name LIKE 'QA4 %';
DELETE FROM public.partner_employees WHERE email LIKE '%@cust.test';
DELETE FROM public.profiles WHERE user_id IN
  (SELECT id FROM auth.users WHERE email LIKE '%@cust.test');
DELETE FROM public.accounts WHERE owner_user_id IN
  (SELECT id FROM auth.users WHERE email LIKE '%@cust.test');
DELETE FROM auth.users WHERE email LIKE '%@cust.test';
