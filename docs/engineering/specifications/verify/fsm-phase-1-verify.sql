-- FSM Phase 1 verification (checks 1-11 cover Task 3; checks 12-36 cover Task 4).
-- Run against a Supabase BRANCH, never production. There is no DB test harness in
-- this repo, so this checked-in script with stated expected results is the
-- verification artefact.
--
-- Migrations under test:
--   supabase/migrations/20260929151000_fsm_asset_masters.sql   (checks 1-11)
--   supabase/migrations/20260929152000_fsm_customer_assets.sql (checks 12-36)
--
-- Setup (psql):
--   \set acct '<test account uuid>'
--   \set outsider '<uuid of a signed-up user who is NOT a member of :acct>'
--   \set viewer   '<uuid of a member of :acct whose role is viewer>'   (optional, check 5)
--   \set agent    '<uuid of a member of :acct whose role is agent or above>' (optional, check 5)
--
-- Extra setup for checks 12-36 (customer_assets):
--   \set contact         '<contact uuid in :acct WHOSE territory_id IS NOT NULL>'
--   \set second_contact  '<a second contact uuid in :acct>'                   (check 24)
--   \set other_territory '<a territory uuid in :acct that is NOT that contact's territory>'
--   \set nonfsm_acct     '<account on a CRM/WFA/SFA plan, i.e. no fsm line>'   (check 30)
--   \set nonfsm_member   '<owner/admin user uuid of :nonfsm_acct>'             (check 30)
--   \set nonfsm_contact  '<a contact uuid belonging to :nonfsm_acct>'          (check 30)
--   \set foreign_product    '<a product uuid belonging to :nonfsm_acct>'        (check 35)
--   \set foreign_asset_type '<an asset_types uuid belonging to :nonfsm_acct>'   (check 36)
--   \set foreign_territory  '<a territory uuid belonging to :nonfsm_acct>'      (check 36)
--   :agent must be a member whose account_role is exactly 'agent' (NOT owner/admin)
--   for check 29 to prove anything.
--   :acct must be on an FSM plan (FSM | CRM_FSM | SFA_FSM); a legacy plan does NOT
--   grant the fsm line (account_has_line's else branch is false for 'fsm'). Checks
--   29(a), 32(b) and 32(c) depend on this: against a legacy-plan account they would
--   fail with 42501, which is a correct plan-ceiling refusal, NOT a broken INSERT policy.
-- Every check that writes to customer_assets / contacts / accounts / account_sequences
-- is wrapped in BEGIN ... ROLLBACK, so nothing persists and no counter value is burnt.
-- Run 12-36 AFTER 1-11 (check 13 rewinds account_sequences and expects the row that
-- check 1 created).
--
-- To find an account with NO account_sequences row at all (needed by check 1,
-- because rows are created lazily and that is the path check 1 must exercise):
--   SELECT a.id FROM public.accounts a
--   LEFT JOIN public.account_sequences s ON s.account_id = a.id
--   WHERE s.account_id IS NULL LIMIT 1;
-- If every account already has a row, create a throwaway account first.
--
-- Run mode: checks 1-4, 6, 8-10 run as the migration owner / service role
-- (auth.uid() IS NULL, so the membership guard is bypassed). Check 5 needs a role
-- switch and CANNOT run as the migration owner. Checks that raise an error ON PURPOSE:
-- 5(a) and 5(b) (both 42501), 7 (23505), and in the customer_assets set 19-24,
-- 28, 29(b), 30, 31, 32(a), 32(d)-(f), 33(a), 33(d), 34-36 (23505 / 23514 / 23503 / 42501 / 22023). Under psql -v ON_ERROR_STOP=1
-- the first of these aborts the whole run, and for the BEGIN-wrapped ones it does so
-- BEFORE their ROLLBACK (the open transaction is then discarded when the session
-- ends). So run them one at a time, or with ON_ERROR_STOP off, in which case each
-- failing block's trailing ROLLBACK is what clears the aborted transaction.
--
-- NOTE: get_next_asset_number returns a bare bigint and takes no prefix. Prefix
-- formatting (PREFIX-000123, empty-prefix fallback to AST) lives in Task 4's
-- customer_assets_defaults() trigger and is verified in Task 4's checks.

-- 1. Counter is sequential AND the lazy upsert works for an account with no
--    account_sequences row. Precondition: :acct has no row (see setup query above).
--    Expect 1, then 2 (two result sets, type bigint).
SELECT public.get_next_asset_number(:'acct');
SELECT public.get_next_asset_number(:'acct');

-- 2. Counter state persisted in account_sequences (the row now exists).
--    Expect asset_seq = 2, job_seq = 0.
SELECT asset_seq, job_seq FROM public.account_sequences WHERE account_id = :'acct';

-- 3. Counter columns exist and default to 0. Expect 2 rows:
--      asset_seq | bigint | NO | 0
--      job_seq   | bigint | NO | 0
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'account_sequences'
   AND column_name IN ('asset_seq','job_seq')
 ORDER BY column_name;

-- 4. Function grants (has_function_privilege can be evaluated by any role, so this
--    one runs as the owner). Expect exactly:
--      anon = false, authenticated = true, service_role = true
SELECT has_function_privilege('anon',          'public.get_next_asset_number(uuid)', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.get_next_asset_number(uuid)', 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  'public.get_next_asset_number(uuid)', 'EXECUTE') AS service_role;

-- 5. Membership guard. NEEDS A ROLE SWITCH: cannot run as the migration owner, whose
--    auth.uid() is NULL and bypasses the guard. Each block is its own transaction and
--    rolls back, so no counter value is consumed.
--    (a) non-member  -> Expect: ERROR 42501 "Not a member of this account".
--    (b) viewer      -> Expect: ERROR 42501 (guard requires agent-or-above).
--    (c) agent/above -> Expect: returns 3 (next value after check 2), then ROLLBACK.
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'outsider', 'role', 'authenticated')::text, true);
  SELECT public.get_next_asset_number(:'acct');       -- (a)
ROLLBACK;
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
  SELECT public.get_next_asset_number(:'acct');       -- (b)
ROLLBACK;
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  SELECT public.get_next_asset_number(:'acct');       -- (c)
ROLLBACK;

-- 6. Seeded types. Expect count = 8, bool_and = true, ONLY for an account that was
--    backfilled by the migration or freshly provisioned after it and has not had any
--    asset type added/changed since. (If you ran check 8, expect 9 and bool_and = false.)
--    Names: Water Purifier, Air Conditioner, Elevator, CCTV Camera,
--           UPS / Inverter, Generator, Pump / Motor, Other.
SELECT count(*), bool_and(is_seed_data) FROM public.asset_types WHERE account_id = :'acct';

-- 7. Duplicate type name (case-insensitive) is rejected.
--    Expect: ERROR 23505 unique_violation on asset_types_uniq_name_per_account.
--    THIS RAISES AN ERROR ON PURPOSE: it aborts a psql run under ON_ERROR_STOP, so
--    run it separately or with ON_ERROR_STOP off.
INSERT INTO public.asset_types (account_id, name) VALUES (:'acct', 'water purifier');

-- 8. Name reusable after archive. Expect: UPDATE 1, then INSERT 0 1, no error.
UPDATE public.asset_types SET deleted_at = now()
 WHERE account_id = :'acct' AND lower(name) = 'other';
INSERT INTO public.asset_types (account_id, name) VALUES (:'acct', 'Other');

-- 9. No bare auth.uid() in this migration's policies. Expect 0 rows.
--    (Also covers customer_assets once Task 4 has been applied.)
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('asset_types','customer_assets')
   AND ( (qual       LIKE '%auth.uid()%' AND qual       NOT ILIKE '%select auth.uid()%')
      OR (with_check LIKE '%auth.uid()%' AND with_check NOT ILIKE '%select auth.uid()%') );

-- 10. Plan ceiling is on the asset_types WRITE policies only. Expect 4 rows:
--       asset_types_delete | true      asset_types_insert | true
--       asset_types_select | false     asset_types_update | true
--     (SELECT is deliberately not plan-gated. The spec's direct-insert refusal test for
--     a non-FSM tenant additionally needs a role switch as a member of a non-fsm
--     account: an INSERT INTO asset_types must fail with 42501 "new row violates
--     row-level security policy".)
SELECT policyname,
       (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%account_has_line%' AS has_plan_ceiling
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'asset_types'
 ORDER BY policyname;

-- 11. MANUAL INSTRUCTION, NOT SQL. Idempotency: re-apply
--     supabase/migrations/20260929151000_fsm_asset_masters.sql a second time.
--     Expect: no error, and nothing changes:
--       - check 2 still shows asset_seq = 2 (counter untouched);
--       - SELECT count(*) FROM public.asset_types WHERE account_id = :'acct'
--         returns the same number as before the re-apply (9 if check 8 ran: 8 seeded
--         + the re-created 'Other'; the archived 'Other' is not re-seeded because the
--         helper skips any account that already has asset_types rows, archived or not).


-- ============================================================
-- Task 4: customer_assets (migration 20260929152000_fsm_customer_assets.sql)
-- ============================================================

-- 12. Asset code auto-assigns as PREFIX-nnnnnn and matches the counter.
--     Expect one row: asset_code like 'AST-000003' (prefix AST unless the account
--     set one), format_ok = true, and code_number equal to seq.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name)
  VALUES (:'acct', :'contact', 'Verify RO Unit');
  SELECT a.asset_code,
         a.asset_code ~ '^[A-Z0-9]+-[0-9]{6,}$' AS format_ok,
         split_part(a.asset_code, '-', 2)::bigint AS code_number,
         (SELECT asset_seq FROM public.account_sequences WHERE account_id = :'acct') AS seq
    FROM public.customer_assets a WHERE a.account_id = :'acct' AND a.name = 'Verify RO Unit';
ROLLBACK;

-- 13. Prefix comes from accounts.settings->'service_settings'->>'asset_code_prefix';
--     blank or missing falls back to AST; numbers past 999999 are not truncated.
--     Expect four rows, ok = true on each: pfx-a starts EQP-, pfx-b and pfx-c start
--     AST-, pfx-d is exactly 'AST-1000000'.
BEGIN;
  UPDATE public.accounts
     SET settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{service_settings}',
                              coalesce(settings->'service_settings','{}'::jsonb)
                              || '{"asset_code_prefix":"EQP"}'::jsonb)
   WHERE id = :'acct';
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'pfx-a');
  UPDATE public.accounts
     SET settings = jsonb_set(settings, '{service_settings,asset_code_prefix}', '"   "'::jsonb)
   WHERE id = :'acct';
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'pfx-b');
  UPDATE public.accounts SET settings = settings - 'service_settings' WHERE id = :'acct';
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'pfx-c');
  UPDATE public.account_sequences SET asset_seq = 999999 WHERE account_id = :'acct';
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'pfx-d');
  SELECT name,
         CASE name
           WHEN 'pfx-a' THEN asset_code LIKE 'EQP-%'
           WHEN 'pfx-b' THEN asset_code LIKE 'AST-%'
           WHEN 'pfx-c' THEN asset_code LIKE 'AST-%'
           WHEN 'pfx-d' THEN asset_code = 'AST-1000000'
         END AS ok,
         asset_code
    FROM public.customer_assets WHERE account_id = :'acct' AND name LIKE 'pfx-%' ORDER BY name;
ROLLBACK;

-- 14. Territory inherited from the contact when the asset has none.
--     Expect contact_has_territory = true AND inherited = true.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name)
  VALUES (:'acct', :'contact', 'Verify RO Unit');
  SELECT c.territory_id IS NOT NULL AS contact_has_territory,
         a.territory_id = c.territory_id AS inherited
    FROM public.customer_assets a JOIN public.contacts c ON c.id = a.contact_id
   WHERE a.name = 'Verify RO Unit' AND a.account_id = :'acct';
ROLLBACK;

-- 15. An EXPLICIT territory is never overwritten: not at insert, and not by an
--     unrelated edit afterwards. Expect: differs_from_contact = true (so the test is
--     meaningful), kept_at_insert = true, then kept_after_edit = true.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name, territory_id)
  VALUES (:'acct', :'contact', 'Verify RO Unit', :'other_territory');
  SELECT (SELECT territory_id FROM public.contacts WHERE id = :'contact') IS DISTINCT FROM :'other_territory'::uuid
           AS differs_from_contact,
         territory_id = :'other_territory' AS kept_at_insert
    FROM public.customer_assets WHERE name = 'Verify RO Unit' AND account_id = :'acct';
  UPDATE public.customer_assets SET notes = 'unrelated edit' WHERE name = 'Verify RO Unit' AND account_id = :'acct';
  SELECT territory_id = :'other_territory' AS kept_after_edit
    FROM public.customer_assets WHERE name = 'Verify RO Unit' AND account_id = :'acct';
ROLLBACK;

-- 16. Snapshots are frozen. Expect captured_at_insert = true; then, after renaming
--     the contact and changing its phone and touching the asset: snapshot_unchanged =
--     true, phone_snapshot_unchanged = true AND live_name_changed = true. ALL must
--     hold: a passing snapshot_unchanged with a failing live_name_changed means the
--     test itself did nothing.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name)
  VALUES (:'acct', :'contact', 'Verify RO Unit');
  SELECT a.customer_name_snapshot  IS NOT DISTINCT FROM c.name
     AND a.customer_phone_snapshot IS NOT DISTINCT FROM c.phone AS captured_at_insert
    FROM public.customer_assets a JOIN public.contacts c ON c.id = a.contact_id
   WHERE a.name = 'Verify RO Unit' AND a.account_id = :'acct';
  UPDATE public.contacts SET name = 'RENAMED LTD', phone = '+919999999999' WHERE id = :'contact';
  UPDATE public.customer_assets SET notes = 'touch' WHERE name = 'Verify RO Unit' AND account_id = :'acct';
  SELECT a.customer_name_snapshot  IS DISTINCT FROM 'RENAMED LTD'    AS snapshot_unchanged,
         a.customer_phone_snapshot IS DISTINCT FROM '+919999999999'  AS phone_snapshot_unchanged,
         c.name = 'RENAMED LTD'                                      AS live_name_changed
    FROM public.customer_assets a JOIN public.contacts c ON c.id = a.contact_id
   WHERE a.name = 'Verify RO Unit' AND a.account_id = :'acct';
ROLLBACK;

-- 17. Importer-supplied snapshots win over the contact (coalesce), on INSERT.
--     Expect name_kept = true, phone_kept = true.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name, customer_name_snapshot, customer_phone_snapshot)
  VALUES (:'acct', :'contact', 'Verify RO Unit', 'Old Name Traders', '+910000000001');
  SELECT customer_name_snapshot = 'Old Name Traders' AS name_kept,
         customer_phone_snapshot = '+910000000001'   AS phone_kept
    FROM public.customer_assets WHERE name = 'Verify RO Unit' AND account_id = :'acct';
ROLLBACK;

-- 18. Asset code is never rewritten by an UPDATE. Expect unchanged = true.
BEGIN;
  CREATE TEMP TABLE _v18 ON COMMIT DROP AS
    WITH i AS (INSERT INTO public.customer_assets (account_id, contact_id, name)
               VALUES (:'acct', :'contact', 'Verify RO Unit') RETURNING asset_code)
    SELECT asset_code FROM i;
  UPDATE public.customer_assets SET name = 'Verify RO Unit 2', notes = 'edit'
   WHERE name = 'Verify RO Unit' AND account_id = :'acct';
  SELECT a.asset_code = v.asset_code AS unchanged
    FROM public.customer_assets a, _v18 v WHERE a.name = 'Verify RO Unit 2' AND a.account_id = :'acct';
ROLLBACK;

-- 19. Duplicate serial (case-insensitive) rejected.
--     Expect: first INSERT ok, second ERROR 23505 on customer_assets_uniq_serial.
--     RAISES ON PURPOSE.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name, serial_no)
  VALUES (:'acct', :'contact', 'A', 'SN-1');
  INSERT INTO public.customer_assets (account_id, contact_id, name, serial_no)
  VALUES (:'acct', :'contact', 'B', 'sn-1');
ROLLBACK;

-- 20. asset_code uniqueness is the defence against a REWOUND counter (the
--     account_sequences_update policy lets any member rewind their own counter).
--     Expect: ERROR 23505 on customer_assets_uniq_code at the second insert.
--     RAISES ON PURPOSE.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'first');
  UPDATE public.account_sequences SET asset_seq = asset_seq - 1 WHERE account_id = :'acct';
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'second');
ROLLBACK;

-- 21. Warranty ordering. Expect ERROR 23514 customer_assets_warranty_order_chk.
--     RAISES ON PURPOSE.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name, warranty_start, warranty_end)
  VALUES (:'acct', :'contact', 'C', '2026-01-01', '2025-01-01');
ROLLBACK;

-- 22. Installation date more than one day in the future. Expect the first insert
--     (tomorrow) to succeed and the second (day after) to fail with ERROR 23514
--     customer_assets_install_date_chk. RAISES ON PURPOSE.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name, installation_date)
  VALUES (:'acct', :'contact', 'ok-tomorrow', current_date + 1);
  INSERT INTO public.customer_assets (account_id, contact_id, name, installation_date)
  VALUES (:'acct', :'contact', 'too-far', current_date + 2);
ROLLBACK;

-- 23. Blank name, and blank asset_code. RAISES ON PURPOSE.
--     (a) blank name on INSERT   -> Expect ERROR 23514 customer_assets_name_not_blank.
--     (b) blank asset_code on UPDATE of a LIVE row -> Expect ERROR 22023
--         "asset_code is immutable (cannot change AST-... to  )". NOT 23514: BEFORE
--         triggers run before CHECK constraints, and trigger block 5 refuses the change
--         first. customer_assets_code_not_blank is unreachable for INSERT (block 1
--         replaces a null or whitespace code) and for live rows (block 5), so this
--         block does NOT exercise it. It is deliberate belt-and-braces against a future
--         path that bypasses the trigger.
--     (c) blank asset_code on UPDATE of an ARCHIVED row -> Expect ERROR 23514
--         customer_assets_code_not_blank. This is the one live path to the constraint:
--         archived rows are exempt from immutability (see check 33(c)) but not from it.
BEGIN;                                                                    -- (a)
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', '   ');
ROLLBACK;
BEGIN;                                                                    -- (b)
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'blank-code-test');
  UPDATE public.customer_assets SET asset_code = ' ' WHERE name = 'blank-code-test' AND account_id = :'acct';
ROLLBACK;
BEGIN;                                                                    -- (c)
  INSERT INTO public.customer_assets (account_id, contact_id, name, deleted_at)
  VALUES (:'acct', :'contact', 'blank-code-archived', now());
  UPDATE public.customer_assets SET asset_code = ' ' WHERE name = 'blank-code-archived' AND account_id = :'acct';
ROLLBACK;

-- 24. A contact that owns assets cannot be hard-deleted (ON DELETE RESTRICT).
--     Expect ERROR 23503. RAISES ON PURPOSE. Uses :second_contact so the main
--     fixture contact is not the row being deleted.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'second_contact', 'owned');
  DELETE FROM public.contacts WHERE id = :'second_contact';
ROLLBACK;

-- 25. Every FK on customer_assets has a covering index that is NOT partial and
--     whose LEADING column is the FK column. A partial index cannot serve the FK
--     (ON DELETE scans soft-deleted rows too). Expect 0 rows from the first query
--     and fk_count = 6 from the second (a count of 0 rows would also be "clean" if
--     the FKs were missing, hence the second query).
SELECT c.conname FROM pg_constraint c
 WHERE c.contype = 'f' AND c.conrelid = 'public.customer_assets'::regclass
   AND NOT EXISTS (
     SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND i.indpred IS NULL
        AND (i.indkey::smallint[])[0] = c.conkey[1]);
SELECT count(*) AS fk_count FROM pg_constraint
 WHERE contype = 'f' AND conrelid = 'public.customer_assets'::regclass;

-- 26. Plan ceiling on the customer_assets WRITE policies only. Expect 4 rows:
--       customer_assets_delete | true      customer_assets_insert | true
--       customer_assets_select | false     customer_assets_update | true
SELECT policyname,
       (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%account_has_line%' AS has_plan_ceiling
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'customer_assets'
 ORDER BY policyname;

-- 27. INSERT policy is PERMISSION-based, not admin-only (spec 4.12 point 1).
--     Expect one row: uses_has_permission = true, names_create_key = true,
--     admin_only = false.
SELECT with_check LIKE '%has_permission%'         AS uses_has_permission,
       with_check LIKE '%create_service_assets%'  AS names_create_key,
       with_check LIKE '%''admin''%'              AS admin_only
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'customer_assets' AND policyname = 'customer_assets_insert';

-- 28. Cross-tenant isolation. NEEDS A ROLE SWITCH. THREE STEPS, because every other
--     check here rolls back and there must be a COMMITTED asset for the outsider's
--     count to mean anything.
--     (i)   as the owner, COMMIT one fixture asset (explicit code, so no counter value
--           is burnt);
--     (ii)  as :outsider (a member of a DIFFERENT account): Expect count = 0, then
--           ERROR 42501 "new row violates row-level security policy for table
--           customer_assets". RAISES ON PURPOSE. The insert supplies an explicit
--           asset_code so trigger block 1 is skipped: without it, block 1's call to
--           get_next_asset_number() raises 42501 "Not a member of this account" FIRST
--           (BEFORE triggers run before the RLS WITH CHECK), the SQLSTATE would still
--           match, and the policy would never be exercised;
--     (iii) as the owner, remove the fixture.
INSERT INTO public.customer_assets (account_id, contact_id, name, asset_code)
VALUES (:'acct', :'contact', 'xt-fixture', 'VERIFYFX-000001');            -- (i) autocommits
BEGIN;                                                                    -- (ii)
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'outsider', 'role', 'authenticated')::text, true);
  SELECT count(*) FROM public.customer_assets WHERE account_id = :'acct';
  INSERT INTO public.customer_assets (account_id, contact_id, name, asset_code)
  VALUES (:'acct', :'contact', 'Intruder', 'VERIFYFX-000002');
ROLLBACK;
DELETE FROM public.customer_assets WHERE asset_code LIKE 'VERIFYFX-%';    -- (iii)

-- 29. Permission-based INSERT. NEEDS A ROLE SWITCH and :agent = a plain 'agent'
--     (not owner/admin, who pass has_permission unconditionally). :acct must be on an
--     FSM plan (see setup); a legacy plan does NOT grant the fsm line.
--     (a) With create_service_assets granted to the agent's role: expect INSERT 0 1.
--     (b) Without it, separate transaction: expect ERROR 42501. RAISES ON PURPOSE.
--     create_service_assets is not registered in the permission catalogue until Task 5;
--     has_permission() reads employee_roles.permissions directly, so this works anyway.
BEGIN;
  UPDATE public.employee_roles er
     SET permissions = coalesce(er.permissions, '{}'::jsonb) || '{"create_service_assets": true}'::jsonb
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  INSERT INTO public.customer_assets (account_id, contact_id, name)
  VALUES (:'acct', :'contact', 'agent-created');                -- (a)
ROLLBACK;
BEGIN;
  UPDATE public.employee_roles er
     SET permissions = coalesce(er.permissions, '{}'::jsonb) - 'create_service_assets'
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  INSERT INTO public.customer_assets (account_id, contact_id, name)
  VALUES (:'acct', :'contact', 'agent-denied');                 -- (b)
ROLLBACK;

-- 30. Plan ceiling refuses a write in a tenant without the fsm line. NEEDS A ROLE
--     SWITCH: :nonfsm_member is an owner/admin of :nonfsm_acct, so role and permission
--     are satisfied and ONLY the plan ceiling can refuse. :nonfsm_contact is a contact
--     belonging to :nonfsm_acct.
--     Expect ERROR 42501 "new row violates row-level security policy for table
--     customer_assets" (the member passes get_next_asset_number's guard, so the plan
--     ceiling is what refuses). RAISES ON PURPOSE.
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'nonfsm_member', 'role', 'authenticated')::text, true);
  INSERT INTO public.customer_assets (account_id, contact_id, name)
  VALUES (:'nonfsm_acct', :'nonfsm_contact', 'no-fsm-line');
ROLLBACK;

-- 31. A viewer cannot write (agent-or-above floor). NEEDS A ROLE SWITCH as :viewer.
--     Expect ERROR 42501 "new row violates row-level security policy for table
--     customer_assets". RAISES ON PURPOSE. The insert supplies an explicit asset_code so
--     trigger block 1 is skipped; without it, get_next_asset_number()'s membership guard
--     raises 42501 "Not a member of this account" first and the RLS policy is never
--     the thing observed.
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
  INSERT INTO public.customer_assets (account_id, contact_id, name, asset_code)
  VALUES (:'acct', :'contact', 'viewer-denied', 'VERIFYFX-000003');
ROLLBACK;

-- 32. Archive / restore is enforced at the database (trigger block 4), not only in
--     the UI. NEEDS A ROLE SWITCH for (a), (b) and (d); :agent must be a plain 'agent'.
--     The agent is granted edit_service_assets so the RLS UPDATE policy passes and ONLY
--     the archive guard can refuse. All grants happen before the role switch.
--     (a) edit right only, set deleted_at      -> Expect ERROR 42501. RAISES ON PURPOSE.
--     (b) edit + delete right, archive then restore -> Expect UPDATE 1, UPDATE 1.
--     (c) owner / service role (auth.uid() NULL) archives -> Expect UPDATE 1 (bypass).
--     (d) asset archived, agent with edit right only tries to RESTORE
--                                              -> Expect ERROR 42501. RAISES ON PURPOSE.
BEGIN;                                                                    -- (a)
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'arch-a');
  UPDATE public.employee_roles er
     SET permissions = (coalesce(er.permissions,'{}'::jsonb) || '{"edit_service_assets": true}'::jsonb) - 'delete_service_assets'
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  UPDATE public.customer_assets SET deleted_at = now() WHERE name = 'arch-a' AND account_id = :'acct';
ROLLBACK;
BEGIN;                                                                    -- (b)
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'arch-b');
  UPDATE public.employee_roles er
     SET permissions = coalesce(er.permissions,'{}'::jsonb)
                       || '{"edit_service_assets": true, "delete_service_assets": true}'::jsonb
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  UPDATE public.customer_assets SET deleted_at = now()  WHERE name = 'arch-b' AND account_id = :'acct';
  UPDATE public.customer_assets SET deleted_at = NULL   WHERE name = 'arch-b' AND account_id = :'acct';
ROLLBACK;
BEGIN;                                                                    -- (c)
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'arch-c');
  UPDATE public.customer_assets SET deleted_at = now() WHERE name = 'arch-c' AND account_id = :'acct';
ROLLBACK;
BEGIN;                                                                    -- (d)
  INSERT INTO public.customer_assets (account_id, contact_id, name, deleted_at)
  VALUES (:'acct', :'contact', 'arch-d', now());
  UPDATE public.employee_roles er
     SET permissions = (coalesce(er.permissions,'{}'::jsonb) || '{"edit_service_assets": true}'::jsonb) - 'delete_service_assets'
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  UPDATE public.customer_assets SET deleted_at = NULL WHERE name = 'arch-d' AND account_id = :'acct';
ROLLBACK;

-- 32 (continued). Two more archive-guard paths. Same setup and role switch as above.
--     (e) an agent with edit right only rewrites deleted_at of an ALREADY-ARCHIVED row to
--         a different timestamp (falsifying the archive date) -> Expect ERROR 42501.
--         (The guard compares the timestamp, not just null-ness.) RAISES ON PURPOSE.
--     (f) an agent with create_service_assets only INSERTs an asset that is already
--         archived (deleted_at NOT NULL) -> Expect ERROR 42501. RAISES ON PURPOSE.
BEGIN;                                                                    -- (e)
  INSERT INTO public.customer_assets (account_id, contact_id, name, deleted_at)
  VALUES (:'acct', :'contact', 'arch-e', now() - interval '3 days');
  UPDATE public.employee_roles er
     SET permissions = (coalesce(er.permissions,'{}'::jsonb) || '{"edit_service_assets": true}'::jsonb) - 'delete_service_assets'
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  UPDATE public.customer_assets SET deleted_at = now() WHERE name = 'arch-e' AND account_id = :'acct';
ROLLBACK;
BEGIN;                                                                    -- (f)
  UPDATE public.employee_roles er
     SET permissions = (coalesce(er.permissions,'{}'::jsonb) || '{"create_service_assets": true}'::jsonb) - 'delete_service_assets'
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  INSERT INTO public.customer_assets (account_id, contact_id, name, deleted_at)
  VALUES (:'acct', :'contact', 'arch-f', now());
ROLLBACK;

-- 33. asset_code is immutable after insert - for LIVE assets (trigger block 5).
--     (b) re-writing the SAME value (a no-op edit) -> Expect UPDATE 1, no error.
--     (a) changing a LIVE row's code to another value -> Expect ERROR 22023
--         "asset_code is immutable (cannot change AST-... to AST-ZZZ)". RAISES ON PURPOSE.
--     (c) ARCHIVED rows are exempt: re-coding an archived asset, then restoring it ->
--         Expect UPDATE 1, UPDATE 1, no error. This is the way out of the restore
--         collision: asset_seq rewound via PostgREST, a live asset took the archived
--         asset's (now free) code, and restoring it would fail 23505. Run as the owner
--         (auth.uid() NULL, so the archive guard is bypassed and only block 5 is tested).
--     (d) that restore collision itself -> Expect ERROR 23505 customer_assets_uniq_code
--         when restoring WITHOUT re-coding. RAISES ON PURPOSE.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'immut');
  UPDATE public.customer_assets SET asset_code = asset_code WHERE name = 'immut' AND account_id = :'acct';   -- (b)
  UPDATE public.customer_assets SET asset_code = 'AST-ZZZ'  WHERE name = 'immut' AND account_id = :'acct';   -- (a)
ROLLBACK;
BEGIN;                                                                    -- (c)
  INSERT INTO public.customer_assets (account_id, contact_id, name, deleted_at)
  VALUES (:'acct', :'contact', 'immut-archived', now());
  UPDATE public.customer_assets SET asset_code = 'RECODED-000001', deleted_at = NULL
   WHERE name = 'immut-archived' AND account_id = :'acct';
ROLLBACK;
BEGIN;                                                                    -- (d)
  INSERT INTO public.customer_assets (account_id, contact_id, name, asset_code, deleted_at)
  VALUES (:'acct', :'contact', 'immut-old', 'COLLIDE-000001', now());
  INSERT INTO public.customer_assets (account_id, contact_id, name, asset_code)
  VALUES (:'acct', :'contact', 'immut-new', 'COLLIDE-000001');
  UPDATE public.customer_assets SET deleted_at = NULL WHERE name = 'immut-old' AND account_id = :'acct';
ROLLBACK;

-- 34. A contact from another tenant is refused (trigger block 2, tenant integrity).
--     Run as the owner (no role switch): the trigger check is independent of RLS.
--     (a) INSERT with :nonfsm_contact into :acct -> Expect ERROR 23503
--         "contact ... does not exist in account ...". RAISES ON PURPOSE.
--     (b) UPDATE an existing asset's contact_id to :nonfsm_contact -> Expect ERROR 23503.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'nonfsm_contact', 'xt-contact');
ROLLBACK;
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'xt-contact-b');
  UPDATE public.customer_assets SET contact_id = :'nonfsm_contact' WHERE name = 'xt-contact-b' AND account_id = :'acct';
ROLLBACK;

-- 35. A product from another tenant is refused (trigger block 6). :foreign_product
--     belongs to :nonfsm_acct. Expect ERROR 23503 "product_id ... does not exist in
--     account ...". RAISES ON PURPOSE. Also confirm an in-account product is still
--     accepted: run the same INSERT with a product of :acct and expect INSERT 0 1.
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name, product_id)
  VALUES (:'acct', :'contact', 'xt-product', :'foreign_product');
ROLLBACK;

-- 36. Asset type and territory from another tenant, and moving a row between
--     tenants, are refused. Each is its own block. RAISES ON PURPOSE.
--     (a) foreign asset_type_id  -> Expect ERROR 23503 "asset_type_id ... does not exist".
--     (b) foreign territory_id   -> Expect ERROR 23503 "territory_id ... does not exist".
--     (c) UPDATE account_id      -> Expect ERROR 22023 "account_id cannot be changed".
--         The statement also sets territory_id = NULL to prove the ORDER: account_id
--         immutability is the first thing the UPDATE path does, so the error is 22023,
--         NOT a misleading 23503 "contact ... does not exist in account <target>".
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name, asset_type_id)
  VALUES (:'acct', :'contact', 'xt-type', :'foreign_asset_type');
ROLLBACK;
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name, territory_id)
  VALUES (:'acct', :'contact', 'xt-territory', :'foreign_territory');
ROLLBACK;
BEGIN;
  INSERT INTO public.customer_assets (account_id, contact_id, name) VALUES (:'acct', :'contact', 'xt-move');
  UPDATE public.customer_assets SET account_id = :'nonfsm_acct', territory_id = NULL
   WHERE name = 'xt-move' AND account_id = :'acct';
ROLLBACK;

-- MANUAL INSTRUCTION, NOT SQL. Idempotency of Task 4: re-apply
-- supabase/migrations/20260929152000_fsm_customer_assets.sql a second time.
-- Expect: no error, and nothing changes (no new rows, indexes or policies; the trigger
-- and policies are dropped and re-created identically). Then confirm ANALYZE ran:
--   SELECT relname, last_analyze FROM pg_stat_user_tables
--    WHERE relname IN ('customer_assets','asset_types');
