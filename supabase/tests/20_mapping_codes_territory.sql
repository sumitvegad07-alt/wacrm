-- Modules B (Customer mapping), C (Automatic codes), D (Territory coverage)
\set ON_ERROR_STOP off
DELETE FROM qa_results WHERE scenario ~ '^[BCD]';
SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000001', false);  -- Admin A

-- ═══ B. Customer mapping ═══════════════════════════════════
SELECT qa_refused('B3 a customer cannot supply itself',
  $$UPDATE contacts SET parent_id='c0000000-0000-0000-0000-000000000001' WHERE id='c0000000-0000-0000-0000-000000000001'$$);

SELECT qa_refused('B4 a supplier from another tenant is refused',
  $$UPDATE contacts SET parent_id='c0000000-0000-0000-0000-0000000000b1' WHERE id='c0000000-0000-0000-0000-000000000001'$$);

-- B7: with levels OFF the hierarchy rule cannot apply, so any customer is legal.
SELECT qa_allowed('B7 with Customer Level off, any customer may supply',
  $$UPDATE contacts SET parent_id='c0000000-0000-0000-0000-00000000000e' WHERE id='c0000000-0000-0000-0000-000000000001'$$);

-- B5: loops. C1's supplier is Dealer; now try to make C1 supply Dealer.
SELECT qa_refused('B5 a supply loop (A supplies B supplies A) is refused',
  $$UPDATE contacts SET parent_id='c0000000-0000-0000-0000-000000000001' WHERE id='c0000000-0000-0000-0000-00000000000e'$$);

-- B6: with levels ON a dealer (2) may not supply a distributor (1).
UPDATE contacts SET parent_id=NULL WHERE account_id='aaaa0000-0000-0000-0000-000000000001';
UPDATE accounts SET settings=jsonb_set(settings,'{order_settings,hierarchy_enabled}','true') WHERE id='aaaa0000-0000-0000-0000-000000000001';
SELECT qa_refused('B6 with Customer Level on, a dealer may not supply a distributor',
  $$UPDATE contacts SET parent_id='c0000000-0000-0000-0000-00000000000e' WHERE id='c0000000-0000-0000-0000-00000000000d'$$);
SELECT qa_allowed('B6b with Customer Level on, a distributor may supply a dealer',
  $$UPDATE contacts SET parent_id='c0000000-0000-0000-0000-00000000000d' WHERE id='c0000000-0000-0000-0000-00000000000e'$$);
UPDATE accounts SET settings=jsonb_set(settings,'{order_settings,hierarchy_enabled}','false') WHERE id='aaaa0000-0000-0000-0000-000000000001';

-- B12: an order remembers the supplier it was sold through.
INSERT INTO orders(account_id,user_id,order_number,contact_id,status,date)
VALUES ('aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','ORD-B1',
        'c0000000-0000-0000-0000-00000000000e','Pending','2026-04-01');
SELECT qa('B12 an order stamps parent_contact_id from the customer',
  (SELECT parent_contact_id='c0000000-0000-0000-0000-00000000000d' FROM orders WHERE order_number='ORD-B1'),
  (SELECT 'parent_contact_id='||coalesce(parent_contact_id::text,'null') FROM orders WHERE order_number='ORD-B1'));

-- B8 / B9: beat mode.
UPDATE accounts SET settings=jsonb_set(settings,'{extra_settings,customer_mapping_mode}','"beat"') WHERE id='aaaa0000-0000-0000-0000-000000000001';
UPDATE contacts SET parent_id=NULL WHERE account_id='aaaa0000-0000-0000-0000-000000000001';
INSERT INTO routes(id,account_id,name) VALUES ('d0000000-0000-0000-0000-00000000000a','aaaa0000-0000-0000-0000-000000000001','Beat One');
INSERT INTO route_parent_customers(account_id,route_id,parent_id)
VALUES ('aaaa0000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000d');
-- A permanent stop and a one-time stop on the same beat.
INSERT INTO route_customers(account_id,route_id,contact_id,sequence)
VALUES ('aaaa0000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001',1);
INSERT INTO route_customers(account_id,route_id,contact_id,sequence,one_time_date)
VALUES ('aaaa0000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002',2,'2026-04-05');
SELECT qa('B8 a permanent stop takes the beat''s supplier',
  (SELECT parent_id='c0000000-0000-0000-0000-00000000000d' FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001'),
  (SELECT 'parent_id='||coalesce(parent_id::text,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001'));
SELECT qa('B9 a one-time stop does NOT change the supplier',
  (SELECT parent_id IS NULL FROM contacts WHERE id='c0000000-0000-0000-0000-000000000002'),
  (SELECT 'parent_id='||coalesce(parent_id::text,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-000000000002'));

-- B11: the dry run counts what the write would change.
UPDATE contacts SET parent_id=NULL WHERE id='c0000000-0000-0000-0000-000000000001';
SELECT qa('B11 the re-map dry run counts the rows it would change',
  ((resync_account_beat_parents('aaaa0000-0000-0000-0000-000000000001', true)->>'would_change')::int = 1),
  'would_change=' || (resync_account_beat_parents('aaaa0000-0000-0000-0000-000000000001', true)->>'would_change'));
SELECT qa('B11b the dry run wrote nothing',
  (SELECT parent_id IS NULL FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001'), '');
SELECT resync_account_beat_parents('aaaa0000-0000-0000-0000-000000000001', false);
SELECT qa('B11c the real re-map writes the supplier',
  (SELECT parent_id='c0000000-0000-0000-0000-00000000000d' FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001'), '');

-- B15: customer_suppliers is scoped to the caller's account.
SELECT qa('B15 customer_suppliers returns only this tenant''s suppliers',
  (SELECT count(*)=1 AND bool_and(id='c0000000-0000-0000-0000-00000000000d')
     FROM customer_suppliers('aaaa0000-0000-0000-0000-000000000001')),
  (SELECT 'rows='||count(*) FROM customer_suppliers('aaaa0000-0000-0000-0000-000000000001')));

UPDATE accounts SET settings=jsonb_set(settings,'{extra_settings,customer_mapping_mode}','"manual"') WHERE id='aaaa0000-0000-0000-0000-000000000001';

-- ═══ C. Automatic codes ════════════════════════════════════
-- C1: rule off, no code minted.
INSERT INTO contacts(id,account_id,user_id,name,company,phone)
VALUES ('c0000000-0000-0000-0000-0000000000c1','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','NoCode','No Code Co','3000000001');
SELECT qa('C1 with the rule off no code is minted',
  (SELECT customer_code IS NULL FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c1'),
  (SELECT 'code='||coalesce(customer_code,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c1'));

UPDATE accounts SET settings=jsonb_set(settings,'{code_settings,customer,enabled}','true') WHERE id='aaaa0000-0000-0000-0000-000000000001';

-- C3: minted when the box is left empty.
INSERT INTO contacts(id,account_id,user_id,name,company,phone)
VALUES ('c0000000-0000-0000-0000-0000000000c2','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Auto1','Auto One','3000000002');
SELECT qa('C3 a blank code box is filled in',
  (SELECT customer_code='CUST-0001' FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c2'),
  (SELECT 'code='||coalesce(customer_code,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c2'));

-- C4: a typed code is kept and does not consume the sequence.
INSERT INTO contacts(id,account_id,user_id,name,company,phone,customer_code)
VALUES ('c0000000-0000-0000-0000-0000000000c3','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Mine','My Code Co','3000000003','MY-OWN-1');
INSERT INTO contacts(id,account_id,user_id,name,company,phone)
VALUES ('c0000000-0000-0000-0000-0000000000c4','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Auto2','Auto Two','3000000004');
SELECT qa('C4 a typed code is kept, and the sequence is not consumed by it',
  (SELECT (SELECT customer_code FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c3')='MY-OWN-1'
      AND (SELECT customer_code FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c4')='CUST-0002'),
  (SELECT 'typed='||(SELECT customer_code FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c3')
       ||' next='||(SELECT customer_code FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c4')));

-- C5: past the digit width the code grows, it must not truncate.
UPDATE account_sequences SET customer_code_seq = 9999 WHERE account_id='aaaa0000-0000-0000-0000-000000000001';
INSERT INTO contacts(id,account_id,user_id,name,company,phone)
VALUES ('c0000000-0000-0000-0000-0000000000c5','aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Big','Big Co','3000000005');
SELECT qa('C5 the code grows past its digit width instead of truncating',
  (SELECT customer_code='CUST-10000' FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c5'),
  (SELECT 'code='||coalesce(customer_code,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000c5'));

-- C11: a second tenant's sequence is independent.
UPDATE accounts SET settings = jsonb_set(coalesce(settings,'{}'::jsonb),'{code_settings}',
  '{"customer":{"enabled":true,"prefix":"CUST-","digits":4,"next":1}}') WHERE id='bbbb0000-0000-0000-0000-000000000002';
INSERT INTO contacts(id,account_id,user_id,name,company,phone)
VALUES ('c0000000-0000-0000-0000-0000000000b2','bbbb0000-0000-0000-0000-000000000002','22220000-0000-0000-0000-000000000001','BAuto','B Auto','4000000001');
SELECT qa('C11 each tenant has its own sequence',
  (SELECT customer_code='CUST-0001' FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000b2'),
  (SELECT 'tenantB code='||coalesce(customer_code,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-0000000000b2'));

-- C8: the backfill gives the oldest record the lowest number.
UPDATE account_sequences SET customer_code_seq = 0 WHERE account_id='aaaa0000-0000-0000-0000-000000000001';
SELECT qa('C8 the backfill dry run counts the blanks',
  ((backfill_generated_codes('aaaa0000-0000-0000-0000-000000000001','customer',true)->>'pending')::int > 0),
  'pending=' || (backfill_generated_codes('aaaa0000-0000-0000-0000-000000000001','customer',true)->>'pending'));

-- C9 removed: profiles.account_id is NOT NULL in this schema, so a profile
-- without an account cannot exist. The guard in the migration is harmless
-- defensive code for a path the constraint forbids.

-- ═══ D. Territory coverage ═════════════════════════════════
SELECT qa('D2 employee_area_territory_ids is still downward-only (not widened)',
  (SELECT pg_get_functiondef(p.oid) NOT ILIKE '%ancestor%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='employee_area_territory_ids' LIMIT 1), '');

SELECT qa('D5 contacts_select still has the collaborator_ids branch',
  (SELECT pg_get_expr(polqual, polrelid) ILIKE '%collaborator_ids%'
     FROM pg_policy WHERE polname='contacts_select' LIMIT 1), '');
SELECT qa('D5b contacts_select still has the direct employee_id branch',
  (SELECT pg_get_expr(polqual, polrelid) ILIKE '%employee_id%'
     FROM pg_policy WHERE polname='contacts_select' LIMIT 1), '');
SELECT qa('D5c contacts_select uses the both-directions coverage function',
  (SELECT pg_get_expr(polqual, polrelid) ILIKE '%covered_territory%'
     FROM pg_policy WHERE polname='contacts_select' LIMIT 1), '');

SELECT scenario, CASE WHEN pass THEN 'PASS' ELSE '**FAIL**' END AS result, detail
  FROM qa_results WHERE scenario ~ '^[BCD]' ORDER BY id;
