-- D - what an assigned AREA covers, in both modes.
--
-- 2026-11-03 made coverage walk upward so a customer tagged only to a City was
-- visible to a rep assigned an Area inside it. 2026-11-08 the founder reported
-- the other side of that: "if i assign one area which has 4 customers ... mobile
-- user must see only 4 customers". 20261108120000 therefore makes the upward
-- walk a per-account setting, DEFAULT OFF.
--
-- So this scenario asserts BOTH: strict by default, permissive when the account
-- turns it on. Sibling areas stay invisible in either mode.
\set ON_ERROR_STOP off
-- Only this file's own labels. 'D5%' used to be in here and silently deleted
-- the D5/D5b/D5c results recorded by 20_mapping_codes_territory.sql.
DELETE FROM qa_results WHERE scenario LIKE 'D1%' OR scenario LIKE 'D3%'
   OR scenario LIKE 'D4%' OR scenario LIKE 'T%';

DELETE FROM employee_area_assignments WHERE employee_id='aaaa1111-0000-0000-0000-000000000002';
DELETE FROM contacts WHERE id IN ('c0000000-0000-0000-0000-000000000ff1','c0000000-0000-0000-0000-000000000ff2','c0000000-0000-0000-0000-000000000ff3');
-- Any other customer still pointing at this tenant's territories would hold the
-- DELETE below on contacts_territory_id_fkey, which is how a re-run used to die
-- before it had asserted anything.
UPDATE contacts SET territory_id = NULL
 WHERE account_id='aaaa0000-0000-0000-0000-000000000001' AND territory_id IS NOT NULL;
DELETE FROM territories WHERE account_id='aaaa0000-0000-0000-0000-000000000001';

-- Country > State > City > Area, plus a sibling Area.
INSERT INTO territories(id,account_id,name,level,parent_id) VALUES
 ('70000000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','India',1,NULL),
 ('70000000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001','Gujarat',2,'70000000-0000-0000-0000-000000000001'),
 ('70000000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000001','Rajkot',3,'70000000-0000-0000-0000-000000000002'),
 ('70000000-0000-0000-0000-000000000004','aaaa0000-0000-0000-0000-000000000001','University Road',4,'70000000-0000-0000-0000-000000000003'),
 ('70000000-0000-0000-0000-000000000005','aaaa0000-0000-0000-0000-000000000001','Kalawad Road',4,'70000000-0000-0000-0000-000000000003');

-- Agent A is assigned ONE area: University Road.
INSERT INTO employee_area_assignments(id,account_id,employee_id,territory_id,assigned_at)
VALUES (gen_random_uuid(),'aaaa0000-0000-0000-0000-000000000001','aaaa1111-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000004',now());

-- Three customers: one on the city above, one in his area, one in the sibling area.
-- hierarchy_level is set because an earlier scenario turns order hierarchy on
-- for this tenant, and enforce_contact_hierarchy_level then refuses a customer
-- without one. Without it these three inserts fail and the RLS assertions below
-- pass vacuously, asserting nothing about customers that are not there.
INSERT INTO contacts(id,account_id,user_id,name,company,phone,territory_id,employee_id,hierarchy_level) VALUES
 ('c0000000-0000-0000-0000-000000000ff1','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','CityOnly','Tagged To City Only','5000000001','70000000-0000-0000-0000-000000000003',NULL,3),
 ('c0000000-0000-0000-0000-000000000ff2','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','InArea','In His Area','5000000002','70000000-0000-0000-0000-000000000004',NULL,3),
 ('c0000000-0000-0000-0000-000000000ff3','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Sibling','In The Sibling Area','5000000003','70000000-0000-0000-0000-000000000005',NULL,3);

-- ---- MODE 1: default. No territory_settings key on the account. ----
UPDATE accounts SET settings = coalesce(settings,'{}'::jsonb) - 'territory_settings'
 WHERE id='aaaa0000-0000-0000-0000-000000000001';

SELECT qa('D1 DEFAULT: an area rep does NOT cover the city above him',
  NOT ('70000000-0000-0000-0000-000000000003' = ANY(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'))),
  'covered=' || coalesce(array_length(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'),1),0)::text);

SELECT qa('D1a DEFAULT: he still covers his own assigned area',
  ('70000000-0000-0000-0000-000000000004' = ANY(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'))), '');

SELECT qa('D4 coverage excludes the SIBLING area',
  NOT ('70000000-0000-0000-0000-000000000005' = ANY(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'))), '');

SELECT qa('D3 the CREATE guard stays downward-only (city NOT in the create scope)',
  NOT ('70000000-0000-0000-0000-000000000003' = ANY(employee_area_territory_ids('11110000-0000-0000-0000-000000000002'))),
  'create-scope=' || coalesce(array_length(employee_area_territory_ids('11110000-0000-0000-0000-000000000002'),1),0)::text);

-- The real thing: what the rep's Customers list actually returns, under RLS.
SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000002', false);
SET ROLE authenticated;
SELECT qa('D1b DEFAULT: under RLS the rep does NOT see the city-only customer',
  NOT EXISTS(SELECT 1 FROM contacts WHERE id='c0000000-0000-0000-0000-000000000ff1'), '');
SELECT qa('D1c DEFAULT: under RLS the rep sees the customer in his own area',
  EXISTS(SELECT 1 FROM contacts WHERE id='c0000000-0000-0000-0000-000000000ff2'), '');
SELECT qa('D4b DEFAULT: under RLS the rep does NOT see the sibling area''s customer',
  NOT EXISTS(SELECT 1 FROM contacts WHERE id='c0000000-0000-0000-0000-000000000ff3'), '');
RESET ROLE;

-- ---- MODE 2: the account turns upward coverage back on. ----
UPDATE accounts
   SET settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{territory_settings}',
                            '{"area_covers_parents": true}'::jsonb, true)
 WHERE id='aaaa0000-0000-0000-0000-000000000001';

SELECT qa('T1 SETTING ON: the area rep covers the city above him again',
  ('70000000-0000-0000-0000-000000000003' = ANY(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'))), '');
SELECT qa('T2 SETTING ON: the sibling area is STILL not covered',
  NOT ('70000000-0000-0000-0000-000000000005' = ANY(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'))), '');

SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000002', false);
SET ROLE authenticated;
SELECT qa('T3 SETTING ON: under RLS the rep sees the city-only customer',
  EXISTS(SELECT 1 FROM contacts WHERE id='c0000000-0000-0000-0000-000000000ff1'), '');
SELECT qa('T4 SETTING ON: under RLS the sibling area customer stays hidden',
  NOT EXISTS(SELECT 1 FROM contacts WHERE id='c0000000-0000-0000-0000-000000000ff3'), '');
RESET ROLE;

-- ---- D7: saving the Territories panel must not wipe the setting. ----
-- territory_update_settings used to write territory_settings with
-- jsonb_build_object, i.e. REPLACE the whole object, so renaming a level would
-- have silently reset area_covers_parents to the default. All five levels are
-- passed enabled so nothing is archived by this call.
SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
SELECT territory_update_settings(
  'aaaa0000-0000-0000-0000-000000000001',
  '[{"position":1,"name":"Country","enabled":true},
    {"position":2,"name":"State","enabled":true},
    {"position":3,"name":"City","enabled":true},
    {"position":4,"name":"Area","enabled":true},
    {"position":5,"name":"Sub Area","enabled":true}]'::jsonb,
  'area_wise', true);
RESET ROLE;

SELECT qa('T5 an unrelated territory-settings save keeps area_covers_parents',
  (SELECT settings->'territory_settings'->>'area_covers_parents' = 'true'
     FROM accounts WHERE id='aaaa0000-0000-0000-0000-000000000001'),
  coalesce((SELECT settings->>'territory_settings' FROM accounts
             WHERE id='aaaa0000-0000-0000-0000-000000000001'), 'null'));

-- Leave the account as a fresh tenant would be, so later scenarios are not
-- reading a setting this one turned on.
UPDATE accounts SET settings = coalesce(settings,'{}'::jsonb) - 'territory_settings'
 WHERE id='aaaa0000-0000-0000-0000-000000000001';

SELECT scenario, CASE WHEN pass THEN 'PASS' ELSE '**FAIL**' END AS result, detail
  FROM qa_results WHERE scenario LIKE 'D1%' OR scenario LIKE 'D3%'
   OR scenario LIKE 'D4%' OR scenario LIKE 'T%' ORDER BY id;
