-- ============================================================
-- 2026-11-25/26 — the founder's review, points 5 and 9.
--
--   20261125120000_partner_convert_retires_lead.sql
--   20261126120000_partner_territories.sql
--
-- V1–V6 cover the conversion. V1 is the one he reported: a converted lead
-- has to leave the Leads list, and the Leads list shows
-- `record_status = 'active'`. Before the migration this scenario FAILS —
-- the old function set converted_customer_id, converted_at and status and
-- left record_status alone.
--
-- V3 is the one nobody asks for and everybody notices later: the calls and
-- follow-ups planned while the business was a lead have to end up on the
-- customer. Before the migration they stayed on a lead that no list shows.
--
-- V6 is the silent one. The convert function is SECURITY INVOKER, so its
-- `UPDATE partner_leads` was filtered by partner_leads_update, which needs
-- `edit_leads`. A role with `convert_leads` and no `edit_leads` created the
-- customer, updated nothing and returned success — a customer with no lead
-- marked converted, and a lead that could be converted again tomorrow. No
-- error, no log. That is why the bookkeeping moved into a definer function.
--
-- T1–T8 cover the territories.
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
--
-- THIS FILE ESTABLISHES ITS OWN STARTING STATE, including deleting its own
-- rows first. Files inherit each other's end state and it is never the
-- obvious one — 40_area_channel_mapping leaves the account in 'manual'
-- mapping mode, which cost 50_* three scenarios pointing at the resolver.
--
-- ---------------------------------------------------------------------
-- `SET LOCAL` DOES NOT WORK HERE. USE `SET ROLE` + set_config(..., false).
-- ---------------------------------------------------------------------
-- psql runs each statement in its own transaction unless you open one, and
-- SET LOCAL lasts exactly as long as the transaction it is in — so a
-- `SET LOCAL ROLE authenticated` on one line is already reverted by the
-- next. The first draft of this file used it, and the failure was not an
-- error: the scenarios ran as `postgres`, which BYPASSES RLS and has no
-- `test.uid`, so T7 reported that a Sales Executive could add a territory
-- (nothing was enforcing the policy) and T8 reported that a Super Admin
-- could not copy the tree (there was no caller for partner_has_right to
-- look up). Two failures pointing at the migration, caused by the test.
-- Every other partner test file uses `SET ROLE` with
-- `set_config('test.uid', <uuid>, false)`, and so does this one now.
-- ============================================================
\set ON_ERROR_STOP on

\set BOSS   '''e0000000-0000-0000-0000-00000000000a'''
\set REP    '''e0000000-0000-0000-0000-00000000000b'''
\set NOEDIT '''e0000000-0000-0000-0000-00000000000c'''

RESET ROLE;

-- ── our own clean slate ──────────────────────────────────────
-- partner_tasks first: it points at both leads and customers with
-- ON DELETE CASCADE, so deleting the parents would take the activities with
-- them and V3 would pass for the wrong reason.
DELETE FROM public.partner_task_assignees
 WHERE task_id IN (SELECT id FROM public.partner_tasks WHERE description LIKE 'QA5 %');
DELETE FROM public.partner_tasks     WHERE description LIKE 'QA5 %';
DELETE FROM public.partner_module_activities WHERE message LIKE 'QA5 %';
DELETE FROM public.partner_customers WHERE company LIKE 'QA5 %';
DELETE FROM public.partner_leads     WHERE name LIKE 'QA5 %';
DELETE FROM public.partner_employees WHERE email LIKE '%@conv.test';
DELETE FROM auth.users               WHERE email LIKE '%@conv.test';
DELETE FROM public.partner_roles     WHERE name = 'QA5 Converter';

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:BOSS,   'boss@conv.test',   '{"skip_account_provision":"true"}'::jsonb),
  (:REP,    'rep@conv.test',    '{"skip_account_provision":"true"}'::jsonb),
  (:NOEDIT, 'noedit@conv.test', '{"skip_account_provision":"true"}'::jsonb);

-- A role that may convert and may NOT edit. This is the shape V6 is about,
-- and it is a role the Roles screen can produce today by ticking one box.
INSERT INTO public.partner_roles (name, description, permissions, data_scope, is_system)
VALUES ('QA5 Converter', 'Convert but not edit',
        '{"view_leads":"true","convert_leads":"true","create_customers":"true","view_customers":"true","view_activities":"true"}'::jsonb,
        'own', false);

INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :BOSS, 'QA5 Boss', 'boss@conv.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Super Admin';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :REP, 'QA5 Rep', 'rep@conv.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Executive';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :NOEDIT, 'QA5 NoEdit', 'noedit@conv.test', id, 'active'
  FROM public.partner_roles WHERE name = 'QA5 Converter';

SELECT id AS rep_id    FROM public.partner_employees WHERE email = 'rep@conv.test'    \gset
SELECT id AS noedit_id FROM public.partner_employees WHERE email = 'noedit@conv.test' \gset

-- The lead the rep will convert, with an open call and a note on it.
INSERT INTO public.partner_leads (name, contact_person, phone, city, state, status, owner_id, record_status)
VALUES ('QA5 Mehta Traders', 'Nilesh Mehta', '9222500001', 'Surat', 'Gujarat', 'New', :'rep_id', 'active');
SELECT id AS lead_id FROM public.partner_leads WHERE name = 'QA5 Mehta Traders' \gset

INSERT INTO public.partner_tasks (activity_type, description, due_date, priority, status, lead_id, created_by)
VALUES ('Call', 'QA5 ring him back about the quote', current_date + 2, 'High', 'Pending', :'lead_id', :'rep_id'),
       ('Note', 'QA5 wants delivery before Diwali',  NULL,              'Medium', 'Pending', :'lead_id', :'rep_id');

-- Something on the lead's timeline, so V4 can check it was carried over.
INSERT INTO public.partner_module_activities (user_id, module_name, record_id, action, message)
VALUES (:BOSS, 'lead', :'lead_id', 'status_changed', 'QA5 Status: New → Contacted');

-- A second lead for the no-edit role to convert in V6.
INSERT INTO public.partner_leads (name, contact_person, phone, city, status, owner_id, record_status)
VALUES ('QA5 Silent Shop', 'Asha Rao', '9222500002', 'Rajkot', 'New', :'noedit_id', 'active');
SELECT id AS silent_id FROM public.partner_leads WHERE name = 'QA5 Silent Shop' \gset

-- ── V0 the fixture ───────────────────────────────────────────
SELECT qa('V0 two leads, two activities and one timeline entry exist',
  (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA5 %') = 2
  AND (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %') = 2
  AND (SELECT count(*) FROM public.partner_module_activities WHERE message LIKE 'QA5 %') = 1,
  'leads=' || (SELECT count(*) FROM public.partner_leads WHERE name LIKE 'QA5 %')
  || ' tasks=' || (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %'));

-- ── the conversion, as the rep who owns the lead ─────────────
SET ROLE authenticated;
SELECT set_config('test.uid', :REP, false);

SELECT qa_allowed('V-pre the owner can convert their own lead',
  $$SELECT public.partner_convert_lead_to_customer(
      (SELECT id FROM public.partner_leads WHERE name = 'QA5 Mehta Traders'))$$);

RESET ROLE;
SELECT set_config('test.uid', '', false);

SELECT id AS cust_id FROM public.partner_customers WHERE company = 'QA5 Mehta Traders' \gset

-- ── V1 THE ONE HE REPORTED ───────────────────────────────────
-- "that lead should be remove from lead's database once it is saved in
-- customer database". The Leads list defaults to record_status = active, so
-- this single column is what takes it out of the pipeline.
SELECT qa('V1 the converted lead is now Inactive, so it leaves the Leads list',
  (SELECT record_status FROM public.partner_leads WHERE id = :'lead_id') = 'inactive',
  'record_status=' || coalesce((SELECT record_status FROM public.partner_leads WHERE id = :'lead_id'), 'null'));

SELECT qa('V2 it is still marked converted and pointed at its customer',
  (SELECT converted_customer_id FROM public.partner_leads WHERE id = :'lead_id') = :'cust_id'
  AND (SELECT converted_at FROM public.partner_leads WHERE id = :'lead_id') IS NOT NULL,
  'converted_customer_id=' || coalesce((SELECT converted_customer_id::text FROM public.partner_leads WHERE id = :'lead_id'), 'null'));

-- ── V3 the open work moved ───────────────────────────────────
SELECT qa('V3 both activities moved to the customer and carry no lead_id',
  (SELECT count(*) FROM public.partner_tasks
    WHERE description LIKE 'QA5 %' AND customer_id = :'cust_id' AND lead_id IS NULL) = 2,
  'on customer=' || (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %' AND customer_id = :'cust_id')
  || ' still on lead=' || (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %' AND lead_id IS NOT NULL));

-- ── V4 the history came across, and the lead kept its own ────
SELECT qa('V4 the lead''s timeline entry is now on the customer too',
  EXISTS (SELECT 1 FROM public.partner_module_activities
           WHERE module_name = 'customer' AND record_id = :'cust_id'
             AND message = 'QA5 Status: New → Contacted')
  AND EXISTS (SELECT 1 FROM public.partner_module_activities
               WHERE module_name = 'lead' AND record_id = :'lead_id'
                 AND message = 'QA5 Status: New → Contacted'),
  'customer copies=' || (SELECT count(*) FROM public.partner_module_activities
                          WHERE module_name = 'customer' AND record_id = :'cust_id'));

SELECT qa('V4b the business landed in company and the person in name',
  (SELECT company FROM public.partner_customers WHERE id = :'cust_id') = 'QA5 Mehta Traders'
  AND (SELECT name FROM public.partner_customers WHERE id = :'cust_id') = 'Nilesh Mehta',
  'company=' || coalesce((SELECT company FROM public.partner_customers WHERE id = :'cust_id'), 'null')
  || ' name=' || coalesce((SELECT name FROM public.partner_customers WHERE id = :'cust_id'), 'null'));

-- ── V5 the definer helper refuses a pair that is not a conversion ──
-- Its ONLY authorisation is that the customer says it came from that lead.
-- Anyone can call it; on any other pair it must raise rather than move
-- somebody else's activities.
SET ROLE authenticated;
SELECT set_config('test.uid', :REP, false);

SELECT qa_refused('V5 finish_conversion refuses a customer that did not come from that lead',
  $$SELECT public.partner_finish_conversion(
      (SELECT id FROM public.partner_leads WHERE name = 'QA5 Silent Shop'),
      (SELECT id FROM public.partner_customers WHERE company = 'QA5 Mehta Traders'))$$);

RESET ROLE;
SELECT set_config('test.uid', '', false);

-- ── V6 THE SILENT ONE: convert without edit_leads ────────────
SET ROLE authenticated;
SELECT set_config('test.uid', :NOEDIT, false);

SELECT qa_allowed('V6 a role with convert_leads but no edit_leads can still convert',
  $$SELECT public.partner_convert_lead_to_customer(
      (SELECT id FROM public.partner_leads WHERE name = 'QA5 Silent Shop'))$$);

RESET ROLE;
SELECT set_config('test.uid', '', false);

SELECT qa('V6b and the lead really was retired, not silently left behind',
  (SELECT record_status FROM public.partner_leads WHERE id = :'silent_id') = 'inactive'
  AND (SELECT converted_customer_id FROM public.partner_leads WHERE id = :'silent_id') IS NOT NULL,
  'record_status=' || coalesce((SELECT record_status FROM public.partner_leads WHERE id = :'silent_id'), 'null')
  || ' converted=' || coalesce((SELECT converted_customer_id::text FROM public.partner_leads WHERE id = :'silent_id'), 'null'));

-- ── V9 one customer per lead, enforced by the index not a lock ──
-- This is what replaced `SELECT ... FOR UPDATE`, which RLS turned into an
-- edit_leads requirement and which broke V6 on the first run. Inserting a
-- second customer against a lead that already has one must be refused even
-- though the convert function is not involved.
SELECT qa_refused('V9 a second customer cannot be created against one lead',
  format($$INSERT INTO public.partner_customers (company, owner_id, source_lead_id)
           VALUES ('QA5 Duplicate Shop', %L, %L)$$, :'rep_id', :'lead_id'));

-- qa_refused passes if the statement raises FOR ANY REASON, including a NOT
-- NULL column this insert forgot. So assert the thing itself: exactly one
-- customer still points at that lead, and the duplicate is not there.
SELECT qa('V9b and only one customer still points at that lead',
  (SELECT count(*) FROM public.partner_customers WHERE source_lead_id = :'lead_id') = 1
  AND NOT EXISTS (SELECT 1 FROM public.partner_customers WHERE company = 'QA5 Duplicate Shop'),
  'customers for that lead=' || (SELECT count(*) FROM public.partner_customers WHERE source_lead_id = :'lead_id'));

-- And the control: the same insert against a lead with NO customer is fine,
-- so the index is stopping duplicates rather than stopping everything.
SELECT qa_allowed('V9c a customer CAN be created against a lead that has none',
  format($$INSERT INTO public.partner_customers (company, owner_id, source_lead_id)
           VALUES ('QA5 Control Shop', %L, NULL)$$, :'rep_id'));

-- As the rep who owns it, so the guard is what refuses this and not RLS.
SET ROLE authenticated;
SELECT set_config('test.uid', :REP, false);

SELECT qa_refused('V7 converting the same lead twice is refused',
  $$SELECT public.partner_convert_lead_to_customer(
      (SELECT id FROM public.partner_leads WHERE name = 'QA5 Mehta Traders'))$$);

-- And a lead that is not theirs at all is indistinguishable from one that
-- does not exist, which is the point of reading it on the caller's session.
SELECT qa_refused('V8 a rep cannot convert a lead that is not in their scope',
  $$SELECT public.partner_convert_lead_to_customer(
      (SELECT id FROM public.partner_leads WHERE name = 'QA5 Silent Shop'))$$);

RESET ROLE;
SELECT set_config('test.uid', '', false);

-- ============================================================
-- TERRITORIES
-- ============================================================

RESET ROLE;
DELETE FROM public.partner_territories WHERE name LIKE 'QA5 %' OR is_seed_data;

SELECT qa('T1 partner_territories exists with the CRM''s shape',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_territories'
      AND column_name IN ('parent_id','level','name','code','status','is_seed_data')) = 6,
  'columns=' || (SELECT count(*) FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'partner_territories'));

-- ── T2 the depth guard ───────────────────────────────────────
INSERT INTO public.partner_territories (level, name, is_seed_data)
VALUES (1, 'QA5 Bharat', false);
SELECT id AS country_id FROM public.partner_territories WHERE name = 'QA5 Bharat' \gset

SELECT qa_refused('T2 a root that is not level 1 is refused',
  $$INSERT INTO public.partner_territories (level, name) VALUES (3, 'QA5 Orphan City')$$);

SELECT qa_refused('T3 a level 4 Area cannot sit directly under a level 1 Country',
  format($$INSERT INTO public.partner_territories (parent_id, level, name) VALUES (%L, 4, 'QA5 Skipped Area')$$, :'country_id'));

SELECT qa_allowed('T4 a level 2 State under that Country is fine',
  format($$INSERT INTO public.partner_territories (parent_id, level, name) VALUES (%L, 2, 'QA5 Gujarat')$$, :'country_id'));

SELECT id AS state_id FROM public.partner_territories WHERE name = 'QA5 Gujarat' \gset

SELECT qa_refused('T5 two Countries called the same thing are refused',
  $$INSERT INTO public.partner_territories (level, name) VALUES (1, 'qa5 bharat')$$);

-- Same name under DIFFERENT parents is allowed — "Rajkot" the city and
-- "Rajkot" the area are different rows, and that is the whole reason the
-- unique index is per-parent rather than global.
INSERT INTO public.partner_territories (parent_id, level, name)
VALUES (:'state_id', 3, 'QA5 Rajkot');
SELECT id AS city_id FROM public.partner_territories WHERE name = 'QA5 Rajkot' \gset

SELECT qa_allowed('T6 the same name under a different parent is allowed',
  format($$INSERT INTO public.partner_territories (parent_id, level, name) VALUES (%L, 4, 'QA5 Rajkot')$$, :'city_id'));

-- ── T7 who may write ─────────────────────────────────────────
-- A Sales Executive has no manage_masters, so the INSERT must be refused.
-- RLS on INSERT DOES raise (the WITH CHECK fails), so qa_refused is right
-- here — unlike UPDATE and DELETE. See the note at the top.
SET ROLE authenticated;
SELECT set_config('test.uid', :REP, false);

SELECT qa_refused('T7 a Sales Executive cannot add a territory',
  $$INSERT INTO public.partner_territories (level, name) VALUES (1, 'QA5 Sneaky')$$);

SELECT qa('T7b but they can READ the tree, because every address form needs it',
  (SELECT count(*) FROM public.partner_territories WHERE name LIKE 'QA5 %') >= 4,
  'visible=' || (SELECT count(*) FROM public.partner_territories WHERE name LIKE 'QA5 %'));

-- ── T8 the copy from the CRM ─────────────────────────────────
-- The boss is a Super Admin, so they hold manage_masters. The fixture's own
-- accounts carry a territory tree by this point (files 30 and 40 build one),
-- which is what there is to copy.
SELECT set_config('test.uid', :BOSS, false);

SELECT qa_allowed('T8 a Super Admin can copy the CRM''s territories across',
  $$SELECT public.partner_territory_copy_from_crm()$$);

RESET ROLE;
SELECT set_config('test.uid', '', false);

SELECT qa('T8b something was actually copied, and marked as seed data',
  (SELECT count(*) FROM public.partner_territories WHERE is_seed_data) > 0,
  'copied=' || (SELECT count(*) FROM public.partner_territories WHERE is_seed_data));

SELECT qa('T8c every copied child sits one level under its parent',
  NOT EXISTS (
    SELECT 1 FROM public.partner_territories c
      JOIN public.partner_territories p ON p.id = c.parent_id
     WHERE c.level <> p.level + 1),
  'bad pairs=' || (SELECT count(*) FROM public.partner_territories c
                     JOIN public.partner_territories p ON p.id = c.parent_id
                    WHERE c.level <> p.level + 1));

SET ROLE authenticated;
SELECT set_config('test.uid', :BOSS, false);

SELECT qa('T9 copying twice is a no-op rather than a second tree',
  (public.partner_territory_copy_from_crm() ->> 'skipped') = 'true',
  'second run=' || (public.partner_territory_copy_from_crm())::text);

SELECT set_config('test.uid', :REP, false);

SELECT qa_refused('T10 a Sales Executive cannot run the copy',
  $$SELECT public.partner_territory_copy_from_crm()$$);

RESET ROLE;
SELECT set_config('test.uid', '', false);
