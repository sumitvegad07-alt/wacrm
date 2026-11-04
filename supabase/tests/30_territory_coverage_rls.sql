-- D — the real test of "area is not mandatory": a rep assigned an AREA must see
-- a customer tagged only to the CITY above it, and must NOT see a sibling area.
\set ON_ERROR_STOP off
DELETE FROM qa_results WHERE scenario LIKE 'D1%' OR scenario LIKE 'D4%' OR scenario LIKE 'D3%';

DELETE FROM employee_area_assignments WHERE employee_id='aaaa1111-0000-0000-0000-000000000002';
DELETE FROM contacts WHERE id IN ('c0000000-0000-0000-0000-000000000ff1','c0000000-0000-0000-0000-000000000ff2','c0000000-0000-0000-0000-000000000ff3');
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
INSERT INTO contacts(id,account_id,user_id,name,company,phone,territory_id,employee_id) VALUES
 ('c0000000-0000-0000-0000-000000000ff1','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','CityOnly','Tagged To City Only','5000000001','70000000-0000-0000-0000-000000000003',NULL),
 ('c0000000-0000-0000-0000-000000000ff2','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','InArea','In His Area','5000000002','70000000-0000-0000-0000-000000000004',NULL),
 ('c0000000-0000-0000-0000-000000000ff3','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Sibling','In The Sibling Area','5000000003','70000000-0000-0000-0000-000000000005',NULL);

SELECT qa('D1 coverage walks UP: an area rep covers the city above him',
  ('70000000-0000-0000-0000-000000000003' = ANY(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'))),
  'covered=' || array_length(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'),1)::text);

SELECT qa('D4 coverage excludes the SIBLING area',
  NOT ('70000000-0000-0000-0000-000000000005' = ANY(employee_covered_territory_ids('11110000-0000-0000-0000-000000000002'))), '');

SELECT qa('D3 the CREATE guard stays downward-only (city NOT in the create scope)',
  NOT ('70000000-0000-0000-0000-000000000003' = ANY(employee_area_territory_ids('11110000-0000-0000-0000-000000000002'))),
  'create-scope=' || coalesce(array_length(employee_area_territory_ids('11110000-0000-0000-0000-000000000002'),1),0)::text);

-- The real thing: what the rep's Customers list actually returns, under RLS.
SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000002', false);
SET ROLE authenticated;
SELECT qa('D1b under RLS the rep SEES the customer tagged only to the city',
  EXISTS(SELECT 1 FROM contacts WHERE id='c0000000-0000-0000-0000-000000000ff1'), '');
SELECT qa('D1c under RLS the rep sees the customer in his own area',
  EXISTS(SELECT 1 FROM contacts WHERE id='c0000000-0000-0000-0000-000000000ff2'), '');
SELECT qa('D4b under RLS the rep does NOT see the sibling area''s customer',
  NOT EXISTS(SELECT 1 FROM contacts WHERE id='c0000000-0000-0000-0000-000000000ff3'), '');
RESET ROLE;

SELECT scenario, CASE WHEN pass THEN 'PASS' ELSE '**FAIL**' END AS result, detail
  FROM qa_results WHERE scenario LIKE 'D1%' OR scenario LIKE 'D4%' OR scenario LIKE 'D3%' ORDER BY id;
