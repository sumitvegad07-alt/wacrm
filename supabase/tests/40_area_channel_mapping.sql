-- ============================================================
-- Secondary Sales — mapping the channel BY AREA (20261104130000).
--
-- Reload 00_fixture.sql before this file. It switches tenant A to
-- hierarchy_enabled + mapping mode 'area', so it must run after 10/20/30.
--
-- The shape under test:
--
--   India (1) ───────────────── channel row level 1 → A  (Super Stockist)
--     Gujarat (2) ............. B lives here           (Stockist, level 2)
--       Ahmedabad (3) ──────── channel row level 2 → B
--         150 Feet Ring Rd (4) ─ channel row level 3 → C
--         SG Highway (4) ...... C2 lives here           (Distributor, level 3)
--
-- so a Dealer on 150 Feet Ring Road is supplied by C, C is supplied by B, and
-- B is supplied by A — the founder's "hierarchy should follow the channel".
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT '''aaaa0000-0000-0000-0000-000000000001'''
\set ACCTB '''bbbb0000-0000-0000-0000-000000000002'''
\set ADMIN '''11110000-0000-0000-0000-000000000001'''
\set AGENT '''11110000-0000-0000-0000-000000000002'''

-- ── Tenant A: secondary sales on, four levels, mapped by area ──
UPDATE accounts SET settings = settings
  || jsonb_build_object('order_settings', jsonb_build_object(
       'hierarchy_enabled', true,
       'levels', jsonb_build_array(
         jsonb_build_object('position',1,'name','Super Stockist'),
         jsonb_build_object('position',2,'name','Stockist'),
         jsonb_build_object('position',3,'name','Distributor'),
         jsonb_build_object('position',4,'name','Dealer'))))
  || jsonb_build_object('extra_settings',
       (settings->'extra_settings') || jsonb_build_object('customer_mapping_mode','area'))
 WHERE id = :ACCT;

SELECT qa('E0 mapping mode reads as area',
  customer_mapping_mode(:ACCT) = 'area', 'mode=' || customer_mapping_mode(:ACCT));

-- ── The geography ─────────────────────────────────────────────
-- Hung off the India → Gujarat tree that 30_territory_coverage_rls.sql already
-- builds for this tenant, rather than a second one: territories_uniq_name_per_parent
-- rejects a second root "India", and a sibling city also keeps Rajkot's areas in
-- play as rows that must NOT be touched by this account's channel.
INSERT INTO territories(id, account_id, parent_id, level, name) VALUES
 ('71000000-0000-0000-0000-000000000003', :ACCT, '70000000-0000-0000-0000-000000000002', 3, 'Ahmedabad'),
 ('71000000-0000-0000-0000-000000000004', :ACCT, '71000000-0000-0000-0000-000000000003', 4, '150 Feet Ring Road'),
 ('71000000-0000-0000-0000-000000000005', :ACCT, '71000000-0000-0000-0000-000000000003', 4, 'SG Highway'),
 ('71000000-0000-0000-0000-000000000009', :ACCTB, NULL,                                  1, 'Other Tenant Country');

-- ── The channel ───────────────────────────────────────────────
-- Every one carries a level, because 076 refuses a level-less insert once
-- hierarchy is on — which is the point of asking for levels before mapping.
INSERT INTO contacts(id, account_id, user_id, name, company, phone, hierarchy_level, territory_id) VALUES
 ('c1000000-0000-0000-0000-00000000000a', :ACCT, :ADMIN, 'Mr SS',   'Super Stockist A', '1100000001', 1, '70000000-0000-0000-0000-000000000001'),
 ('c1000000-0000-0000-0000-00000000000b', :ACCT, :ADMIN, 'Mr ST',   'Stockist B',       '1100000002', 2, '70000000-0000-0000-0000-000000000002'),
 ('c1000000-0000-0000-0000-00000000000c', :ACCT, :ADMIN, 'Mr DI',   'Distributor C',    '1100000003', 3, '71000000-0000-0000-0000-000000000003'),
 ('c1000000-0000-0000-0000-00000000000f', :ACCT, :ADMIN, 'Mr DI2',  'Distributor C2',   '1100000004', 3, '71000000-0000-0000-0000-000000000005'),
 ('c1000000-0000-0000-0000-00000000000d', :ACCT, :ADMIN, 'Mr DL',   'Dealer D',         '1100000005', 4, '71000000-0000-0000-0000-000000000004'),
 ('c1000000-0000-0000-0000-00000000000e', :ACCT, :ADMIN, 'Mr DL2',  'Dealer D2',        '1100000006', 4, '71000000-0000-0000-0000-000000000005'),
 ('c1000000-0000-0000-0000-000000000011', :ACCT, :ADMIN, 'Mr DLC',  'Dealer E city only','1100000007', 4, '71000000-0000-0000-0000-000000000003'),
 ('c1000000-0000-0000-0000-000000000012', :ACCT, :ADMIN, 'Mr DLN',  'Dealer F no area', '1100000008', 4, NULL),
 ('c1000000-0000-0000-0000-0000000000b3', :ACCTB, '22220000-0000-0000-0000-000000000001', 'Mr OTD', 'Other Tenant Dist', '2100000001', 3, NULL);

SELECT qa('E1 this channel is unmapped before a single row exists',
  (SELECT count(*) FROM contacts WHERE id::text LIKE 'c1000000%' AND parent_id IS NOT NULL) = 0,
  'mapped=' || (SELECT count(*) FROM contacts WHERE id::text LIKE 'c1000000%' AND parent_id IS NOT NULL)::text);

-- ── Drawing the chain, one row at a time ─────────────────────
INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
VALUES (:ACCT, '70000000-0000-0000-0000-000000000001', 1, 'c1000000-0000-0000-0000-00000000000a');

SELECT qa('E2 a country-level row supplies the Stockist below it (walks up 2 levels)',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000b')
    = 'c1000000-0000-0000-0000-00000000000a',
  'B.parent=' || coalesce((SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000b')::text,'null'));

INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
VALUES (:ACCT, '71000000-0000-0000-0000-000000000003', 2, 'c1000000-0000-0000-0000-00000000000b');

SELECT qa('E3 a city-level row supplies both Distributors under that city',
  (SELECT count(*) FROM contacts
    WHERE id IN ('c1000000-0000-0000-0000-00000000000c','c1000000-0000-0000-0000-00000000000f')
      AND parent_id = 'c1000000-0000-0000-0000-00000000000b') = 2,
  'C=' || coalesce((SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000c')::text,'null')
    || ' C2=' || coalesce((SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000f')::text,'null'));

INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
VALUES (:ACCT, '71000000-0000-0000-0000-000000000004', 3, 'c1000000-0000-0000-0000-00000000000c');

SELECT qa('E4 an area-level row supplies the Dealer in that area',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')
    = 'c1000000-0000-0000-0000-00000000000c', '');

SELECT qa('E5 the top level never gets a supplier',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000a') IS NULL, '');

-- The whole point of walking UP and not DOWN. E sits on the city. The only
-- level-3 row is on an area BELOW the city, so there is no single right answer
-- and E stays unmapped rather than being supplied through a guess.
SELECT qa('E6 a city-only customer is NOT supplied from an area beneath them',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000011') IS NULL,
  'E.parent=' || coalesce((SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000011')::text,'null'));

SELECT qa('E7 a Dealer in a sibling area with no row above them stays unmapped',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000e') IS NULL, '');

SELECT qa('E8 a customer with no area at all stays unmapped',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000012') IS NULL, '');

-- ── Nearest row wins ─────────────────────────────────────────
INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
VALUES (:ACCT, '71000000-0000-0000-0000-000000000003', 3, 'c1000000-0000-0000-0000-00000000000c');

SELECT qa('E9 a city row now reaches the Dealers with nothing nearer',
  (SELECT count(*) FROM contacts
    WHERE id IN ('c1000000-0000-0000-0000-00000000000e','c1000000-0000-0000-0000-000000000011')
      AND parent_id = 'c1000000-0000-0000-0000-00000000000c') = 2, '');

INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
VALUES (:ACCT, '71000000-0000-0000-0000-000000000005', 3, 'c1000000-0000-0000-0000-00000000000f');

SELECT qa('E10 the NEAREST row wins — the area beats the city above it',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000e')
    = 'c1000000-0000-0000-0000-00000000000f',
  'D2.parent=' || coalesce((SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000e')::text,'null'));

SELECT qa('E11 the city customer is untouched by a row on an area below',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000011')
    = 'c1000000-0000-0000-0000-00000000000c', '');

-- ── Changing and removing a row re-parents everyone under it ──
UPDATE customer_channel_parents SET parent_contact_id = 'c1000000-0000-0000-0000-00000000000f'
 WHERE territory_id = '71000000-0000-0000-0000-000000000004' AND hierarchy_level = 3;

SELECT qa('E12 changing who holds a level re-parents the Dealers under it',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')
    = 'c1000000-0000-0000-0000-00000000000f', '');

DELETE FROM customer_channel_parents
 WHERE territory_id = '71000000-0000-0000-0000-000000000004' AND hierarchy_level = 3;

SELECT qa('E13 deleting the area row falls back to the city row above it',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')
    = 'c1000000-0000-0000-0000-00000000000c', '');

-- ── A customer moving, and a customer being promoted ─────────
UPDATE contacts SET territory_id = '71000000-0000-0000-0000-000000000005'
 WHERE id = 'c1000000-0000-0000-0000-00000000000d';

SELECT qa('E14 moving a Dealer to another area changes who supplies them',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')
    = 'c1000000-0000-0000-0000-00000000000f', '');

UPDATE contacts SET hierarchy_level = 3 WHERE id = 'c1000000-0000-0000-0000-00000000000d';

SELECT qa('E15 promoting a Dealer to Distributor moves them up the chain',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')
    = 'c1000000-0000-0000-0000-00000000000b',
  'after promotion D.parent=' || coalesce((SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')::text,'null'));

UPDATE contacts SET hierarchy_level = 4, territory_id = '71000000-0000-0000-0000-000000000004'
 WHERE id = 'c1000000-0000-0000-0000-00000000000d';

-- ── A new customer resolves on the way in ────────────────────
INSERT INTO contacts(id, account_id, user_id, name, company, phone, hierarchy_level, territory_id)
VALUES ('c1000000-0000-0000-0000-000000000013', :ACCT, :ADMIN, 'Mr DLG', 'Dealer G', '1100000009', 4,
        '71000000-0000-0000-0000-000000000005');

SELECT qa('E16 a brand-new Dealer is supplied from the moment they are saved',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000013')
    = 'c1000000-0000-0000-0000-00000000000f', '');

-- ── Overriding one customer by hand ──────────────────────────
UPDATE contacts
   SET parent_id = 'c1000000-0000-0000-0000-00000000000f', parent_locked = true
 WHERE id = 'c1000000-0000-0000-0000-000000000011';

SELECT qa('E17 a hand-set supplier can be locked',
  (SELECT parent_id = 'c1000000-0000-0000-0000-00000000000f' AND parent_locked
     FROM contacts WHERE id='c1000000-0000-0000-0000-000000000011'), '');

UPDATE customer_channel_parents SET parent_contact_id = 'c1000000-0000-0000-0000-00000000000c'
 WHERE territory_id = '71000000-0000-0000-0000-000000000003' AND hierarchy_level = 3;

SELECT qa('E18 a locked customer is NOT re-parented when the area changes hands',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000011')
    = 'c1000000-0000-0000-0000-00000000000f', '');

UPDATE contacts SET parent_locked = false WHERE id = 'c1000000-0000-0000-0000-000000000011';

SELECT qa('E19 unlocking hands the customer back to the area answer',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000011')
    = 'c1000000-0000-0000-0000-00000000000c', '');

-- ── Rows that must be refused ────────────────────────────────
SELECT qa_refused('E20 a supplier at the wrong level is refused', format($$
  INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
  VALUES (%L, '70000000-0000-0000-0000-000000000002', 3, 'c1000000-0000-0000-0000-00000000000d')$$, :ACCT));

SELECT qa_refused('E21 a supplier with no Customer Level is refused', format($$
  INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
  VALUES (%L, '70000000-0000-0000-0000-000000000002', 2, 'c0000000-0000-0000-0000-000000000001')$$, :ACCT));

SELECT qa_refused('E22 an area belonging to another tenant is refused', format($$
  INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
  VALUES (%L, '71000000-0000-0000-0000-000000000009', 1, 'c1000000-0000-0000-0000-00000000000a')$$, :ACCT));

SELECT qa_refused('E23 a supplier belonging to another tenant is refused', format($$
  INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
  VALUES (%L, '70000000-0000-0000-0000-000000000002', 3, 'c1000000-0000-0000-0000-0000000000b3')$$, :ACCT));

SELECT qa_refused('E24 two suppliers for the same level in the same area is refused', format($$
  INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
  VALUES (%L, '71000000-0000-0000-0000-000000000005', 3, 'c1000000-0000-0000-0000-00000000000c')$$, :ACCT));

-- ── An order remembers the supplier it was sold through ──────
INSERT INTO orders(account_id, user_id, order_number, contact_id, status, date)
VALUES (:ACCT, :ADMIN, 'ORD-AREA-1', 'c1000000-0000-0000-0000-00000000000d', 'Pending', '2026-11-04');

SELECT qa('E25 an order snapshots the supplier at the time of the order',
  (SELECT o.parent_contact_id = c.parent_id
     FROM orders o JOIN contacts c ON c.id = o.contact_id
    WHERE o.order_number = 'ORD-AREA-1'),
  'snapshot=' || coalesce((SELECT parent_contact_id::text FROM orders WHERE order_number='ORD-AREA-1'),'null'));

-- Classification is NOT set by a trigger: orders.classification is a plain
-- column defaulting to 'direct', and the value is computed by
-- calculate_order_pricing (077), which create_order calls. So a raw INSERT like
-- the one above always leaves it 'direct' — the rule has to be asked where it
-- actually lives, or the test only measures the column default.
SELECT qa('E26 a Dealer classifies as secondary',
  (calculate_order_pricing(:ACCT, 'c1000000-0000-0000-0000-00000000000d',
     '[]'::jsonb, NULL, now(), NULL) ->> 'classification') = 'secondary',
  'classification=' || (calculate_order_pricing(:ACCT, 'c1000000-0000-0000-0000-00000000000d',
     '[]'::jsonb, NULL, now(), NULL) ->> 'classification'));

SELECT qa('E26b the top level classifies as primary',
  (calculate_order_pricing(:ACCT, 'c1000000-0000-0000-0000-00000000000a',
     '[]'::jsonb, NULL, now(), NULL) ->> 'classification') = 'primary',
  'classification=' || (calculate_order_pricing(:ACCT, 'c1000000-0000-0000-0000-00000000000a',
     '[]'::jsonb, NULL, now(), NULL) ->> 'classification'));

SELECT qa('E26c a level-less customer classifies as direct, not secondary',
  (calculate_order_pricing(:ACCT, 'c0000000-0000-0000-0000-000000000002',
     '[]'::jsonb, NULL, now(), NULL) ->> 'classification') = 'direct', '');

-- ── Re-mapping a whole account ───────────────────────────────
-- Break one customer behind the trigger's back (parent_id is not in its column
-- list, so nothing re-resolves) and make sure the account-wide resync finds it.
UPDATE contacts SET parent_id = NULL WHERE id = 'c1000000-0000-0000-0000-00000000000d';

SELECT set_config('test.uid', :ADMIN, false);
SET ROLE authenticated;

SELECT qa('E27 the dry run reports what WOULD change and changes nothing',
  (resync_account_area_parents(:ACCT, true) ->> 'would_change')::int >= 1
    AND (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d') IS NULL,
  'dry=' || resync_account_area_parents(:ACCT, true)::text);

-- Two statements on purpose: a single statement sees one snapshot, so reading
-- contacts in the same SELECT that calls the resync returns the value from
-- BEFORE the resync wrote it, and the assertion fails for a reason that has
-- nothing to do with the product.
SELECT resync_account_area_parents(:ACCT, false) AS resync_result \gset

SELECT qa('E28 the real run re-maps them',
  (:'resync_result'::jsonb ->> 'changed')::int >= 1
    AND (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')
        = 'c1000000-0000-0000-0000-00000000000c',
  'result=' || :'resync_result');

SELECT qa('E29 setup status counts the customers who are not ready',
  (secondary_sales_setup_status(:ACCT) ->> 'no_level')::int >= 3,
  'status=' || secondary_sales_setup_status(:ACCT)::text);

RESET ROLE;

-- ── Only an admin may draw the channel ───────────────────────
SELECT set_config('test.uid', :AGENT, false);
SET ROLE authenticated;

SELECT qa_refused('E30 a non-admin cannot assign a supplier to an area', format($$
  INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
  VALUES (%L, '70000000-0000-0000-0000-000000000002', 2, 'c1000000-0000-0000-0000-00000000000b')$$, :ACCT));

SELECT qa('E31 a non-admin can still READ the channel',
  (SELECT count(*) FROM customer_channel_parents) > 0, '');

SELECT qa_refused('E32 a non-admin cannot re-map the account',
  format($$ SELECT resync_account_area_parents(%L, false) $$, :ACCT));

RESET ROLE;
SELECT set_config('test.uid', NULL, false);

-- ── The 076 trap: a level-less customer must not break a resync ──
-- Real sequence: a tenant maps by hand, gives a level-less customer a supplier,
-- then switches to area mapping. The resync has to clear that supplier, and
-- that is an UPDATE to a level-less customer on an account with hierarchy ON —
-- exactly what trg_enforce_contact_hierarchy_level refuses without the marker.
UPDATE accounts SET settings = jsonb_set(settings, '{order_settings,hierarchy_enabled}', 'false')
 WHERE id = :ACCT;
UPDATE contacts SET parent_id = 'c1000000-0000-0000-0000-00000000000a'
 WHERE id = 'c0000000-0000-0000-0000-000000000001';
UPDATE accounts SET settings = jsonb_set(settings, '{order_settings,hierarchy_enabled}', 'true')
 WHERE id = :ACCT;

SELECT set_config('test.uid', :ADMIN, false);
SET ROLE authenticated;

SELECT qa_allowed('E33 a resync survives a level-less customer who HAS a supplier',
  format($$ SELECT resync_account_area_parents(%L, false) $$, :ACCT));

SELECT qa('E34 and that customer''s supplier is cleared',
  (SELECT parent_id FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001') IS NULL,
  'parent=' || coalesce((SELECT parent_id FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001')::text,'null'));

RESET ROLE;
SELECT set_config('test.uid', NULL, false);

-- ── Manual mode leaves the column alone ──────────────────────
UPDATE accounts SET settings = jsonb_set(settings, '{extra_settings,customer_mapping_mode}', '"manual"')
 WHERE id = :ACCT;

UPDATE contacts SET parent_id = 'c1000000-0000-0000-0000-00000000000b'
 WHERE id = 'c1000000-0000-0000-0000-00000000000d';
UPDATE contacts SET territory_id = '71000000-0000-0000-0000-000000000005'
 WHERE id = 'c1000000-0000-0000-0000-00000000000d';

SELECT qa('E35 in manual mode moving a customer does NOT overwrite a human''s choice',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')
    = 'c1000000-0000-0000-0000-00000000000b',
  'parent=' || coalesce((SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-00000000000d')::text,'null'));

-- The bug E16 uncovered in 20261103160000, from the user's side: the customer
-- form writes parent_id on INSERT in manual mode, and every such save was
-- refused with "Supply loop" because the validator read a child row that did
-- not exist yet.
SELECT qa_allowed('E36 a NEW customer can be created with a supplier in one save', format($$
  INSERT INTO contacts(id, account_id, user_id, name, company, phone, hierarchy_level, parent_id)
  VALUES ('c1000000-0000-0000-0000-000000000014', %L, %L, 'Mr NEW', 'Dealer H', '1100000010', 4,
          'c1000000-0000-0000-0000-00000000000c')$$, :ACCT, :ADMIN));

SELECT qa('E37 and the supplier they were saved with is the one stored',
  (SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000014')
    = 'c1000000-0000-0000-0000-00000000000c',
  'parent=' || coalesce((SELECT parent_id FROM contacts WHERE id='c1000000-0000-0000-0000-000000000014')::text,'null'));

SELECT qa_refused('E38 a real supply loop is still refused', format($$
  UPDATE contacts SET parent_id = 'c1000000-0000-0000-0000-000000000014'
   WHERE id = 'c1000000-0000-0000-0000-00000000000c' $$));

SELECT scenario, CASE WHEN pass THEN 'PASS' ELSE '**FAIL**' END AS result, detail
  FROM qa_results WHERE scenario LIKE 'E%' ORDER BY id;
