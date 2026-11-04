-- QA harness: fixtures for the four modules built 2026-11-03.
\set ON_ERROR_STOP on

DROP TABLE IF EXISTS qa_results;
CREATE TABLE qa_results (
  id serial primary key, scenario text, pass boolean, detail text
);

CREATE OR REPLACE FUNCTION qa(p_scenario text, p_pass boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO qa_results(scenario, pass, detail) VALUES (p_scenario, p_pass, p_detail);
$$;

/** Run `sql` and report whether it was refused. Used for "must be refused" rules. */
CREATE OR REPLACE FUNCTION qa_refused(p_scenario text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  PERFORM qa(p_scenario, false, 'ALLOWED — it should have been refused');
EXCEPTION WHEN OTHERS THEN
  PERFORM qa(p_scenario, true, 'refused: ' || left(SQLERRM, 70));
END $$;

/** Run `sql` and report whether it was ALLOWED. Used for "must work" rules. */
CREATE OR REPLACE FUNCTION qa_allowed(p_scenario text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  PERFORM qa(p_scenario, true, 'allowed');
EXCEPTION WHEN OTHERS THEN
  PERFORM qa(p_scenario, false, 'REFUSED but should have worked: ' || left(SQLERRM, 90));
END $$;

-- ── Clean slate ────────────────────────────────────────────
-- Settings go FIRST, before anything touches contacts. A previous run can leave
-- the tenant with order hierarchy switched on, and migration 076 then refuses
-- every write to a level-less customer — including this file's own clean-up,
-- which aborted the fixture half-loaded and reported itself as unrelated
-- duplicate-key failures three files later.
UPDATE accounts SET settings = '{}'::jsonb
 WHERE id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');

DELETE FROM employee_area_assignments WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
-- territories is deleted AFTER contacts: contacts.territory_id is ON DELETE
-- RESTRICT, so dropping the tree first fails the moment any test has tagged a
-- customer to an area. It used to sit here and reported itself as three
-- unrelated failures in the files that run next, because a half-loaded fixture
-- leaves the previous run's rows behind.
DELETE FROM route_customers WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM route_parent_customers WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM routes WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM orders WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM products WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM customer_channel_parents WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
UPDATE contacts SET parent_id = NULL WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM contacts WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM territories WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM profiles WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM account_sequences WHERE account_id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002');
DELETE FROM profiles WHERE user_id IN ('11110000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000002','22220000-0000-0000-0000-000000000001');
DELETE FROM accounts WHERE id IN ('aaaa0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000002') OR owner_user_id IN ('11110000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000002','22220000-0000-0000-0000-000000000001');
DELETE FROM auth.users WHERE id IN (
 '11110000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000002','22220000-0000-0000-0000-000000000001');

ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

-- Two tenants
INSERT INTO auth.users(id, email) VALUES
 ('11110000-0000-0000-0000-000000000001','admin-a@test.local'),
 ('11110000-0000-0000-0000-000000000002','agent-a@test.local'),
 ('22220000-0000-0000-0000-000000000001','admin-b@test.local');

INSERT INTO accounts(id, name, owner_user_id, settings) VALUES
 ('aaaa0000-0000-0000-0000-000000000001','Tenant A','11110000-0000-0000-0000-000000000001',
  '{"extra_settings":{"buying_status_enabled":true,"customer_mapping_mode":"manual"},
    "order_settings":{"hierarchy_enabled":false},
    "code_settings":{"customer":{"enabled":false,"prefix":"CUST-","digits":4,"next":1},
                     "employee":{"enabled":false,"prefix":"EMP-","digits":4,"next":1},
                     "product":{"enabled":false,"prefix":"SKU-","digits":4,"next":1}}}'::jsonb),
 ('bbbb0000-0000-0000-0000-000000000002','Tenant B','22220000-0000-0000-0000-000000000001',
  '{"extra_settings":{"buying_status_enabled":false,"customer_mapping_mode":"off"}}'::jsonb);

INSERT INTO profiles(id, user_id, full_name, email, account_id, account_role) VALUES
 ('aaaa1111-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Admin A','admin-a@test.local','aaaa0000-0000-0000-0000-000000000001','admin'),
 ('aaaa1111-0000-0000-0000-000000000002','11110000-0000-0000-0000-000000000002','Agent A','agent-a@test.local','aaaa0000-0000-0000-0000-000000000001','agent'),
 ('bbbb1111-0000-0000-0000-000000000001','22220000-0000-0000-0000-000000000001','Admin B','admin-b@test.local','bbbb0000-0000-0000-0000-000000000002','admin');

-- Customers. Levels are set but hierarchy is OFF for tenant A to begin with.
INSERT INTO contacts(id, account_id, user_id, name, company, phone, hierarchy_level) VALUES
 ('c0000000-0000-0000-0000-00000000000d','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Dist','Distributor One','1000000001',1),
 ('c0000000-0000-0000-0000-00000000000e','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Deal','Dealer One','1000000002',2),
 ('c0000000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','C1','Shop One','1000000003',NULL),
 ('c0000000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','C2','Shop Two','1000000004',NULL),
 ('c0000000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','C3','Shop Three','1000000005',NULL),
 ('c0000000-0000-0000-0000-0000000000b1','bbbb0000-0000-0000-0000-000000000002','22220000-0000-0000-0000-000000000001','B1','Other Tenant Shop','2000000001',NULL);

SELECT 'fixtures loaded' AS status;

ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
