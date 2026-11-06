-- ============================================================
-- 2026-11-05 — many channel holders per area (20261105120000) and the
-- simplified route rights (20261105130000).
--
-- Runs AFTER 40_area_channel_mapping.sql and builds on the shape it leaves:
--
--   India (1) ───────────────── level 1 → Super Stockist A
--     Gujarat (2) ............. Stockist B lives here
--       Ahmedabad (3) ──────── level 2 → B
--         150 Feet Ring Rd (4) ─ level 3 → Distributor C
--         SG Highway (4) ...... Distributor C2 lives here
--
-- The question these scenarios answer is the founder's: what happens when an
-- area holds a SECOND distributor. Before 20261105120000 the insert was simply
-- refused by the primary key. Now it is accepted, and every dealer in that
-- area must fall back to "needs a choice" rather than silently keeping C.
-- ============================================================
\set ON_ERROR_STOP on

\set ACCT '''aaaa0000-0000-0000-0000-000000000001'''
\set ADMIN '''11110000-0000-0000-0000-000000000001'''

\set RING  '''71000000-0000-0000-0000-000000000004'''
\set AHMD  '''71000000-0000-0000-0000-000000000003'''
\set SGH   '''71000000-0000-0000-0000-000000000005'''
\set DIST_C  '''c1000000-0000-0000-0000-00000000000c'''
\set DIST_C2 '''c1000000-0000-0000-0000-00000000000f'''
\set DEALER_D '''c1000000-0000-0000-0000-00000000000d'''
\set STOCKIST_B '''c1000000-0000-0000-0000-00000000000b'''

SELECT set_config('test.uid', :ADMIN, false);

-- ── Establish a known starting point ─────────────────────────
-- This file deliberately does NOT inherit file 40's end state. That file
-- deletes the Ring Road channel row at E13, moves Dealer D between areas
-- twice, changes its level, and finally nulls its parent by hand at E25 — so
-- "the obvious shape from the diagram" is not what is actually in the table by
-- the time this file starts. The first draft of these scenarios assumed it was
-- and five of them failed for that reason alone, which says the dependency is
-- too subtle to rely on rather than that the code was wrong.
--
-- So: put Dealer D back on 150 Feet Ring Road, make C the single Distributor
-- there, and resync. Everything below then tests this migration instead of
-- forty scenarios' worth of accumulated history.
-- FIRST, and easily missed: file 40 ends by switching this account to
-- 'manual' mapping mode for its E35–E37 scenarios. In manual mode
-- contacts_area_parent_sync returns immediately, so every UPDATE below would
-- be a no-op and Dealer D would keep the supplier E35 set by hand. That cost
-- three failing scenarios whose symptom ("parent is the Stockist") pointed at
-- the resolver rather than at the mode.
UPDATE accounts SET settings = jsonb_set(settings, '{extra_settings,customer_mapping_mode}', '"area"')
 WHERE id = :ACCT;

SELECT qa('F0 the account is back in area mapping mode',
  customer_mapping_mode(:ACCT) = 'area', 'mode=' || customer_mapping_mode(:ACCT));

DELETE FROM customer_channel_parents WHERE territory_id = :RING AND hierarchy_level = 3;

UPDATE contacts
   SET territory_id = :RING, hierarchy_level = 4, parent_locked = false
 WHERE id = :DEALER_D;

INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
VALUES (:ACCT, :RING, 3, :DIST_C);

-- ── Baseline: one holder still maps automatically ────────────
-- The single-holder path is the one that must NOT change: every tenant who
-- really does have one distributor per area keeps working exactly as before.
SELECT qa('F1 one distributor in the area still auto-maps the dealer',
  (SELECT parent_id FROM contacts WHERE id = :DEALER_D) = :DIST_C::uuid,
  (SELECT format('mode=%s parent=%s level=%s territory=%s',
                 customer_mapping_mode(:ACCT),
                 coalesce(parent_id::text, 'NULL'),
                 coalesce(hierarchy_level::text, 'NULL'),
                 coalesce(territory_id::text, 'NULL'))
     FROM contacts WHERE id = :DEALER_D));

-- ── The founder's case: a second distributor in one area ─────
-- This INSERT is the entire bug report. Under 20261104130000's
-- PRIMARY KEY (territory_id, hierarchy_level) it raised a duplicate-key error:
-- an area could hold one Distributor and no more.
INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
VALUES (:ACCT, :RING, 3, :DIST_C2);

SELECT qa('F2 an area may now hold a SECOND distributor',
  (SELECT count(*) FROM customer_channel_parents
    WHERE territory_id = :RING AND hierarchy_level = 3) = 2,
  'holders=' || (SELECT count(*) FROM customer_channel_parents
                  WHERE territory_id = :RING AND hierarchy_level = 3)::text);

-- The fan-out trigger re-resolves every dealer under that area. Two holders
-- means no automatic answer, so D must become unmapped — NOT silently left
-- pointing at C, and NOT guessed as C2.
SELECT qa('F3 two holders leave the dealer unmapped rather than guessed',
  (SELECT parent_id FROM contacts WHERE id = :DEALER_D) IS NULL,
  'parent=' || coalesce((SELECT parent_id FROM contacts WHERE id = :DEALER_D)::text, 'NULL'));

-- ── The short list the Mapping screen offers ─────────────────
SELECT qa('F4 both distributors are offered as candidates',
  (SELECT count(*) FROM channel_parent_candidates(:ACCT, :RING, 4)) = 2,
  'candidates=' || (SELECT count(*) FROM channel_parent_candidates(:ACCT, :RING, 4))::text);

SELECT qa('F5 the candidates are exactly C and C2',
  (SELECT array_agg(contact_id ORDER BY contact_id)
     FROM channel_parent_candidates(:ACCT, :RING, 4))
  = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[:DIST_C::uuid, :DIST_C2::uuid]) x),
  'got=' || coalesce((SELECT array_agg(contact_id ORDER BY contact_id)
                        FROM channel_parent_candidates(:ACCT, :RING, 4))::text, 'NULL'));

-- ── Ambiguity must NOT fall back up the tree ─────────────────
-- Ahmedabad holds a level-2 row (Stockist B). A dealer is level 4, so it asks
-- for level 3 — the ambiguous pair on the road below. The resolver must stop
-- there and not climb to the city looking for a level-3 answer it would be
-- happier with.
SELECT qa('F6 ambiguity stops the walk instead of climbing to the city',
  resolve_channel_parent(:ACCT, :RING, 4, :DEALER_D) IS NULL,
  'resolved=' || coalesce(resolve_channel_parent(:ACCT, :RING, 4, :DEALER_D)::text, 'NULL'));

-- The level ABOVE the ambiguity is unaffected: Distributor C still resolves to
-- Stockist B via Ahmedabad, because level 2 has only one holder.
SELECT qa('F7 an unambiguous level above the ambiguity still maps',
  resolve_channel_parent(:ACCT, :AHMD, 3, :DIST_C) = :STOCKIST_B::uuid,
  'resolved=' || coalesce(resolve_channel_parent(:ACCT, :AHMD, 3, :DIST_C)::text, 'NULL'));

-- ── "Needs a choice" is counted separately ───────────────────
SELECT qa('F8 the dealer is reported as needing a choice',
  (secondary_sales_setup_status(:ACCT) ->> 'needs_choice')::int >= 1,
  'status=' || secondary_sales_setup_status(:ACCT)::text);

-- ── Picking one is locking it ────────────────────────────────
-- The admin answers the question. parent_locked is what makes the answer
-- survive the next resync, and it already existed for the hand-override case.
UPDATE contacts SET parent_id = :DIST_C2, parent_locked = true WHERE id = :DEALER_D;

SELECT qa('F9 a hand-picked supplier is accepted',
  (SELECT parent_id FROM contacts WHERE id = :DEALER_D) = :DIST_C2::uuid,
  'parent=' || coalesce((SELECT parent_id FROM contacts WHERE id = :DEALER_D)::text, 'NULL'));

SELECT resync_account_area_parents(:ACCT, false);

SELECT qa('F10 a full resync does not overwrite the hand-picked supplier',
  (SELECT parent_id FROM contacts WHERE id = :DEALER_D) = :DIST_C2::uuid,
  'parent=' || coalesce((SELECT parent_id FROM contacts WHERE id = :DEALER_D)::text, 'NULL'));

SELECT qa('F11 the answered dealer no longer needs a choice',
  (SELECT count(*) FROM contacts
    WHERE id = :DEALER_D AND parent_id IS NULL) = 0,
  'still unmapped');

-- ── The same holder twice in one area is still refused ───────
SELECT qa_refused('F12 the same distributor cannot be listed twice in one area',
  format('INSERT INTO customer_channel_parents(account_id, territory_id, hierarchy_level, parent_contact_id)
          VALUES (%L, %L, 3, %L)', :ACCT, :RING, :DIST_C2));

-- ── Removing the second holder makes it automatic again ──────
DELETE FROM customer_channel_parents
 WHERE territory_id = :RING AND hierarchy_level = 3 AND parent_contact_id = :DIST_C2;

UPDATE contacts SET parent_locked = false WHERE id = :DEALER_D;
SELECT resync_account_area_parents(:ACCT, false);

SELECT qa('F13 back to one holder, the dealer auto-maps again',
  (SELECT parent_id FROM contacts WHERE id = :DEALER_D) = :DIST_C::uuid,
  'parent=' || coalesce((SELECT parent_id FROM contacts WHERE id = :DEALER_D)::text, 'NULL'));

-- ============================================================
-- Route rights — 20261105130000
-- ============================================================

-- ── The alias map ────────────────────────────────────────────
SELECT qa('G1 reordering customers is covered by edit_routes',
  route_permission_alias('reorder_route_customers') = 'edit_routes',
  coalesce(route_permission_alias('reorder_route_customers'), 'NULL'));

SELECT qa('G2 archiving is covered by delete_routes',
  route_permission_alias('archive_routes') = 'delete_routes',
  coalesce(route_permission_alias('archive_routes'), 'NULL'));

SELECT qa('G3 cloning is covered by add_routes',
  route_permission_alias('clone_routes') = 'add_routes',
  coalesce(route_permission_alias('clone_routes'), 'NULL'));

SELECT qa('G4 skipping a stop is covered by modify_route_sequence',
  route_permission_alias('skip_route_stop') = 'modify_route_sequence',
  coalesce(route_permission_alias('skip_route_stop'), 'NULL'));

-- A non-route key must map to NULL, or has_permission would start matching
-- `permissions ->> NULL` against something unintended.
SELECT qa('G5 a key that was never a route key maps to nothing',
  route_permission_alias('delete_contacts') IS NULL,
  coalesce(route_permission_alias('delete_contacts'), 'NULL'));

SELECT qa('G6 the surviving keys are not themselves aliases',
  route_permission_alias('edit_routes') IS NULL
    AND route_permission_alias('view_routes') IS NULL
    AND route_permission_alias('execute_route') IS NULL,
  'a survivor resolves to something else');

-- ── has_permission honours the alias ─────────────────────────
-- A role holding ONLY the new simple right must satisfy the old granular key
-- that migrations 110/111 still check inside the RPCs.
INSERT INTO employee_roles(id, account_id, name, permissions, status) VALUES
 ('e5000000-0000-0000-0000-000000000001', :ACCT, 'Route Editor (new keys only)',
  '{"view_routes": true, "edit_routes": true}'::jsonb, 'active'),
 ('e5000000-0000-0000-0000-000000000002', :ACCT, 'Route Viewer',
  '{"view_routes": true}'::jsonb, 'active');

-- A non-admin profile, because owner/admin short-circuit every key.
--
-- ON CONFLICT (user_id), and it is load-bearing: inserting into auth.users
-- fires handle_new_user, which creates a profile row of its own. A plain
-- INSERT then dies on profiles_user_id_key — and because this file sets
-- ON_ERROR_STOP, that killed every scenario below it while the suite still
-- reported "all scenarios passed", just fewer of them. DO UPDATE is what
-- actually attaches the employee_role the G-scenarios are about.
INSERT INTO auth.users(id, email) VALUES
 ('39990000-0000-0000-0000-000000000099', 'routeeditor@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles(id, account_id, user_id, full_name, email, account_role, employee_role_id, status)
VALUES ('f5000000-0000-0000-0000-000000000001', :ACCT,
        '39990000-0000-0000-0000-000000000099', 'Route Editor User',
        'routeeditor@test.local', 'agent',
        'e5000000-0000-0000-0000-000000000001', 'active')
ON CONFLICT (user_id) DO UPDATE
  SET account_id       = EXCLUDED.account_id,
      account_role     = EXCLUDED.account_role,
      employee_role_id = EXCLUDED.employee_role_id,
      status           = 'active';

SELECT qa('G7 edit_routes satisfies the RPC''s add_route_customers check',
  has_permission('39990000-0000-0000-0000-000000000099', :ACCT, 'add_route_customers'),
  'refused');

SELECT qa('G8 edit_routes satisfies reorder_route_customers too',
  has_permission('39990000-0000-0000-0000-000000000099', :ACCT, 'reorder_route_customers'),
  'refused');

SELECT qa('G9 edit_routes does NOT grant approving a route',
  NOT has_permission('39990000-0000-0000-0000-000000000099', :ACCT, 'approve_routes'),
  'approve leaked through the alias map');

SELECT qa('G10 edit_routes does NOT grant archiving (that is delete)',
  NOT has_permission('39990000-0000-0000-0000-000000000099', :ACCT, 'archive_routes'),
  'archive leaked through the alias map');

SELECT qa('G11 an unrelated right is still refused',
  NOT has_permission('39990000-0000-0000-0000-000000000099', :ACCT, 'delete_contacts'),
  'delete_contacts leaked');

-- ── The backfill ─────────────────────────────────────────────
-- The migration already ran against the roles that existed then. This proves
-- the rule it applied, on a role shaped like the ones it upgraded: holding a
-- retired key must come out holding the survivor.
INSERT INTO employee_roles(id, account_id, name, permissions, status) VALUES
 ('e5000000-0000-0000-0000-000000000003', :ACCT, 'Legacy Supervisor',
  '{"view_routes": true, "reorder_route_customers": true, "archive_routes": true}'::jsonb,
  'active');

-- Must stay character-for-character equivalent to §3 of the migration. The
-- Legacy Supervisor above deliberately holds TWO retired keys with DIFFERENT
-- survivors, because that is the case the first draft got wrong: grouping by
-- (role, survivor) lets UPDATE ... FROM match several source rows to one
-- target, and PostgreSQL then applies only one of them.
UPDATE employee_roles er
   SET permissions = er.permissions || need.additions
  FROM (
    SELECT r.id AS role_id,
           jsonb_object_agg(route_permission_alias(k.key), true) AS additions
      FROM employee_roles r, jsonb_each_text(r.permissions) AS k(key, val)
     WHERE k.val = 'true'
       AND route_permission_alias(k.key) IS NOT NULL
       AND coalesce((r.permissions ->> 'all')::boolean, false) = false
     GROUP BY r.id
  ) AS need
 WHERE er.id = need.role_id
   AND NOT (er.permissions @> need.additions);

SELECT qa('G12 backfill gives a legacy reorder role edit_routes',
  (SELECT (permissions ->> 'edit_routes')::boolean
     FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000003'),
  (SELECT permissions::text FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000003'));

SELECT qa('G13 backfill gives a legacy archive role delete_routes',
  (SELECT (permissions ->> 'delete_routes')::boolean
     FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000003'),
  (SELECT permissions::text FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000003'));

-- The pair that proves the UPDATE ... FROM fix: TWO retired keys, TWO
-- different survivors, both of which must land. Before the fix this role came
-- out with delete_routes and no edit_routes.
SELECT qa('G13b backfill applies BOTH survivors, not just one',
  (SELECT (permissions ->> 'edit_routes')::boolean
      AND (permissions ->> 'delete_routes')::boolean
     FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000003'),
  (SELECT permissions::text FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000003'));

SELECT qa('G14 backfill does NOT invent rights the role never had',
  coalesce((SELECT (permissions ->> 'approve_routes')::boolean
              FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000003'), false) = false,
  (SELECT permissions::text FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000003'));

SELECT qa('G15 a role with no route keys is left alone',
  (SELECT permissions FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000002')
    = '{"view_routes": true}'::jsonb,
  (SELECT permissions::text FROM employee_roles WHERE id = 'e5000000-0000-0000-0000-000000000002'));

-- ── The two new field rules default ON ───────────────────────
-- §4 of the migration ran before this file inserted its roles, so this checks
-- the rule against the roles the migration actually saw: the fixture's own.
SELECT qa('H1 existing roles were given the check-out selfie rule',
  (SELECT count(*) FROM employee_roles
    WHERE account_id = :ACCT
      AND coalesce((permissions ->> 'all')::boolean, false) = false
      AND id::text NOT LIKE 'e5000000%'
      AND (permissions ->> 'visit_checkout_selfie_required') IS DISTINCT FROM 'true') = 0,
  'some role is missing the rule');

SELECT qa('H2 existing roles were given the visit feedback rule',
  (SELECT count(*) FROM employee_roles
    WHERE account_id = :ACCT
      AND coalesce((permissions ->> 'all')::boolean, false) = false
      AND id::text NOT LIKE 'e5000000%'
      AND (permissions ->> 'visit_feedback_required') IS DISTINCT FROM 'true') = 0,
  'some role is missing the rule');

SELECT qa('H3 an all-access role was left untouched by the backfill',
  (SELECT count(*) FROM employee_roles
    WHERE (permissions ->> 'all')::boolean = true
      AND permissions ? 'visit_feedback_required') = 0,
  'an all-access role was given explicit keys');
