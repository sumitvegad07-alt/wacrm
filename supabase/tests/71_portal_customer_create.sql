-- ============================================================
-- 2026-11-15 — a distributor adds their own shop. Plan 4 Task 1.
--
-- Reuses the tree 70_portal_visibility.sql builds, because the thing being
-- measured is exactly that tree: a shop added by DIST_A1 must appear under
-- DIST_A1 and nowhere else, and must be invisible to DIST_A2 and to tenant B.
--
--   Tenant A                              Tenant B
--     DIST_A1  (login PORTAL_U_A1)          DIST_B1 (login PORTAL_U_B1)
--       STK_A1 -> DLR_A1
--     DIST_A2  (login PORTAL_U_A2)
--       DLR_A2
--
-- The phone numbers this file creates live in the 6400000xxx block. Plan 2
-- learned the hard way that reusing another file's numbers makes
-- idx_contacts_account_phone_normalized refuse the fixture and report it as a
-- failure of the feature under test.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT_A '''aaaa0000-0000-0000-0000-000000000001'''
\set ACCT_B '''bbbb0000-0000-0000-0000-000000000002'''
\set ADMIN_A '''11110000-0000-0000-0000-000000000001'''

\set PORTAL_U_A1 '''00000000-0000-0000-0000-00000000a001'''
\set PORTAL_U_A2 '''00000000-0000-0000-0000-00000000a002'''
\set PORTAL_U_B1 '''00000000-0000-0000-0000-00000000b001'''

\set DIST_A1 '''cc000000-0000-0000-0000-0000000000a1'''
\set DIST_A2 '''cc000000-0000-0000-0000-0000000000a2'''
\set DLR_A2  '''cc000000-0000-0000-0000-0000000000a5'''

RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);

-- Clean anything a previous run left, by the phone block this file owns.
--
-- The orders go first. contacts is referenced TWICE from orders — contact_id and
-- parent_contact_id, the pair whose arrival broke every order screen on
-- 2026-11-06 — and parent_contact_id is NOT ON DELETE SET NULL, so a single
-- order anywhere in the suite that names one of these shops as its parent makes
-- this delete fail and the file abort before its first scenario.
DELETE FROM public.order_items WHERE order_id IN (
  SELECT o.id FROM public.orders o JOIN public.contacts c
    ON c.id IN (o.contact_id, o.parent_contact_id)
   WHERE c.phone LIKE '64000000%');
DELETE FROM public.orders WHERE id IN (
  SELECT o.id FROM public.orders o JOIN public.contacts c
    ON c.id IN (o.contact_id, o.parent_contact_id)
   WHERE c.phone LIKE '64000000%');
DELETE FROM public.contacts WHERE phone LIKE '64000000%';

-- The setting starts OFF for both tenants. V1 depends on it.
UPDATE public.accounts
   SET settings = COALESCE(settings, '{}'::jsonb)
       || jsonb_build_object('dms_settings',
            COALESCE(settings->'dms_settings', '{}'::jsonb)
            || jsonb_build_object('allow_customer_create', false))
 WHERE id IN (:ACCT_A, :ACCT_B);

SELECT qa('V0 the tree from 70 is still here, so V1-V14 measure something',
  (SELECT count(*) FROM public.contacts WHERE id IN (:DIST_A1, :DIST_A2, :DLR_A2)) = 3
  AND (SELECT portal_user_id FROM public.contacts WHERE id = :DIST_A1) = :PORTAL_U_A1::uuid,
  '70_portal_visibility must run before this file');

-- ── The setting is off ───────────────────────────────────────
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('V1 create is refused while the company has not switched it on',
  public.portal_create_customer('Shop One', 'Shop One Ltd', '6400000001') IS NULL,
  'the default must be no');

SELECT qa('V1b and portal_can_create_customer says so',
  public.portal_can_create_customer() = false);

-- ── Switch it on for tenant A only ───────────────────────────
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
-- jsonb_set CANNOT CREATE A MISSING INTERMEDIATE KEY. Its create_if_missing
-- flag makes the LAST step of the path, not the object above it, so
-- jsonb_set(settings, '{dms_settings,allow_customer_create}', ...) on a tenant
-- whose settings have no dms_settings block returns the settings UNCHANGED —
-- and 00_fixture sets settings to '{}'. The first version of this file did
-- that, the setting therefore stayed off, portal_create_customer answered NULL,
-- \gset UNSET the variable (psql unsets rather than blanks a NULL), and the
-- file aborted three scenarios in with "syntax error at or near :". Build the
-- object with || instead, which creates what is missing.
UPDATE public.accounts
   SET settings = COALESCE(settings, '{}'::jsonb)
       || jsonb_build_object('dms_settings',
            COALESCE(settings->'dms_settings', '{}'::jsonb)
            || jsonb_build_object('allow_customer_create', true))
 WHERE id = :ACCT_A;

SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

-- coalesce to the nil uuid rather than letting a NULL through: psql UNSETS a
-- variable whose value is NULL, every later :'v_new_id' then stays an
-- unsubstituted colon, and the file dies of a syntax error instead of
-- reporting twenty-one honest failures. With the nil uuid V2 fails, says so,
-- and the rest of the file still runs.
SELECT coalesce(public.portal_create_customer(
  'Shop One', 'Shop One Ltd', '6400000001', '12 Market Road', 'Rajkot', '24aaaaa0000a1z5'
), '00000000-0000-0000-0000-000000000000'::uuid) AS new_id \gset v_

SELECT qa('V2 with the setting on, a shop is created',
  :'v_new_id' <> '00000000-0000-0000-0000-000000000000',
  'portal_create_customer returned nothing');

RESET ROLE;

SELECT qa('V3 it is filed under the CALLER, which was never a parameter',
  (SELECT parent_id FROM public.contacts WHERE id = :'v_new_id'::uuid) = :DIST_A1::uuid,
  'parent_id must be the distributor who called');

-- The account is in AREA mapping mode here (40_area_channel_mapping leaves it
-- that way), which is the mode where trg_area_parent_sync owns parent_id and
-- would resolve a brand-new shop's parent to NULL. Without parent_locked the
-- shop belongs to nobody and its own distributor cannot see it, which is how V3
-- first failed.
SELECT qa('V3b and the area-mapping trigger did not take it away again',
  (SELECT parent_locked FROM public.contacts WHERE id = :'v_new_id'::uuid)
  AND public.customer_mapping_mode(:ACCT_A) = 'area',
  'mode is ' || public.customer_mapping_mode(:ACCT_A));

SELECT qa('V4 it belongs to the caller''s account',
  (SELECT account_id FROM public.contacts WHERE id = :'v_new_id'::uuid) = :ACCT_A::uuid);

-- The two levers that carry money. Territory is deliberately NOT asserted
-- here: a BEFORE-write trigger fills it in from the city, which is the right
-- thing to happen and is the company's rule running, not the distributor
-- choosing. What matters is that the distributor cannot pick either of these.
SELECT qa('V5 neither money lever was set by the distributor',
  (SELECT credit_limit IS NULL OR credit_limit = 0 FROM public.contacts WHERE id = :'v_new_id'::uuid)
  AND (SELECT price_list_id IS NULL FROM public.contacts WHERE id = :'v_new_id'::uuid),
  'credit limit and price list stay the company''s');

SELECT qa('V5b the owner is inherited from the parent, so the company''s own rep still sees it',
  (SELECT user_id FROM public.contacts WHERE id = :'v_new_id'::uuid)
  = (SELECT user_id FROM public.contacts WHERE id = :DIST_A1),
  'a shop nobody owns disappears from the rep responsible for that beat');

SELECT qa('V5c the level sits one below the distributor',
  (SELECT hierarchy_level FROM public.contacts WHERE id = :'v_new_id'::uuid)
  = (SELECT hierarchy_level + 1 FROM public.contacts WHERE id = :DIST_A1),
  'enforce_customer_parent needs the parent strictly above');

SELECT qa('V9 it is marked as having come from the portal',
  (SELECT created_via FROM public.contacts WHERE id = :'v_new_id'::uuid) = 'portal');

-- ── The duplicate guard is the database''s, not this file''s ──
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa_refused('V6 a second shop on the same phone number is refused',
  $$ SELECT public.portal_create_customer('Shop One Again', NULL, '6400000001') $$);

SELECT qa_refused('V6b a shop with no phone number is refused',
  $$ SELECT public.portal_create_customer('No Phone Shop', NULL, '') $$);

SELECT qa_refused('V6c ... and one with no name',
  $$ SELECT public.portal_create_customer('', NULL, '6400000009') $$);

-- ── It appears straight away, and only to its own distributor ──
-- portal_customers() answers ONE jsonb array, not a table: the draft wrote
-- `FROM public.portal_customers() WHERE id = …`, which is "column id does not
-- exist" and aborted the file here. Walk the array.
SELECT qa('V10 the new shop is in the caller''s own customer list at once',
  EXISTS (SELECT 1 FROM jsonb_array_elements(public.portal_customers()) c
           WHERE (c->>'id')::uuid = :'v_new_id'::uuid));

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A2, false);
SET ROLE authenticated;

SELECT qa('V10b the distributor beside them cannot see it',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.portal_customers()) c
               WHERE (c->>'id')::uuid = :'v_new_id'::uuid),
  'a new shop must obey the same tree as every other row');

RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_B1, false);
SET ROLE authenticated;

SELECT qa('V8 the other tenant has the add-on but still sees nothing of it',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.portal_customers()) c
               WHERE (c->>'id')::uuid = :'v_new_id'::uuid));

SELECT qa('V8b and tenant B cannot create while ITS setting is off',
  public.portal_create_customer('B Shop', NULL, '6400000002') IS NULL,
  'the setting is per account, not global');

-- ── Somebody with no portal row at all ───────────────────────
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
SET ROLE authenticated;

SELECT qa('V7 an employee who found the function gets nothing from it',
  public.portal_create_customer('Employee Shop', NULL, '6400000003') IS NULL,
  'portal_caller() is null for anybody with a profiles row');

-- ── Editing ──────────────────────────────────────────────────
RESET ROLE;
SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('V11 a distributor corrects a shop they added themselves',
  public.portal_update_my_customer(:'v_new_id'::uuid, 'Shop One', 'Shop One Ltd',
                                   '6400000001', '15 Market Road', 'Rajkot', NULL) = true);

RESET ROLE;
SELECT qa('V11b and the correction landed',
  (SELECT address FROM public.contacts WHERE id = :'v_new_id'::uuid) = '15 Market Road');

SELECT set_config('test.uid', :PORTAL_U_A1, false);
SET ROLE authenticated;

SELECT qa('V12 but NOT a customer the company created',
  public.portal_update_my_customer(:DLR_A2::uuid, 'Renamed By Outsider', NULL, '6400000004') = false,
  'created_via must be portal AND the parent must be the caller');

SELECT qa('V13 nor one belonging to the distributor beside them',
  public.portal_update_my_customer(:DIST_A2::uuid, 'Renamed Rival', NULL, '6400000005') = false);

RESET ROLE;
SELECT qa('V12b and neither row was touched',
  (SELECT name FROM public.contacts WHERE id = :DLR_A2) <> 'Renamed By Outsider'
  AND (SELECT name FROM public.contacts WHERE id = :DIST_A2) <> 'Renamed Rival',
  'an UPDATE that matches no row changes nothing and raises nothing - assert the ROW');

SELECT qa('V14 there is no delete path at all',
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'portal_%delete%customer%'),
  'deleting a customer stays the company''s');

-- ── Put the setting back, so a later file starts where it expects ──
RESET ROLE;
SELECT set_config('test.uid', :ADMIN_A, false);
UPDATE public.accounts
   SET settings = COALESCE(settings, '{}'::jsonb)
       || jsonb_build_object('dms_settings',
            COALESCE(settings->'dms_settings', '{}'::jsonb)
            || jsonb_build_object('allow_customer_create', false))
 WHERE id IN (:ACCT_A, :ACCT_B);
