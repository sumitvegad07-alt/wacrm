-- FSM Phase 1 verification (checks 1-11 cover Task 3; checks 12-36 cover Task 4;
-- checks 37-45 cover Task 11, the asset import, and have their own setup block at the end).
-- There is no DB test harness in this repo, so this checked-in script with stated
-- expected results is the verification artefact. Prefer a Supabase BRANCH.
--
-- SAFETY GUARANTEE: every check is either read-only or runs inside a BEGIN ... ROLLBACK,
-- so the script leaves no data behind and is safe to run against production, with
-- exactly ONE exception, named here rather than hidden:
--   * Check 28 COMMITS one fixture asset (code VERIFYFX-000001) because an isolation check
--     against an empty table proves nothing. It is removed by the scoped DELETE that
--     immediately follows it, which MUST be run even if the check aborts.
-- Two other items are not "script writes" and are flagged so they are not mistaken for
-- one: check 11 and the final MANUAL INSTRUCTION ask the operator to RE-APPLY a migration
-- (idempotent DDL, run by hand, outside this script).
-- Rolled-back writes still hold row locks until the ROLLBACK, and a transaction that
-- ABORTS mid-way under ON_ERROR_STOP is discarded when the session ends (see Run mode).
-- No check leaves an account_sequences row behind for an account that had none: check 1
-- rolls its counter upsert back, and check 28's fixture supplies an explicit asset_code so
-- the trigger never calls get_next_asset_number.
--
-- Migrations under test:
--   supabase/migrations/20260929151000_fsm_asset_masters.sql   (checks 1-11)
--   supabase/migrations/20260929152000_fsm_customer_assets.sql (checks 12-36)
--   supabase/migrations/20260929155000_fsm_import_customer_assets.sql (checks 37-45)
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
--   29(a), 32(a), 32(b), 32(d), 32(e) and 32(f) depend on this (they run as a non-admin
--   agent, through RLS). Against a legacy-plan account the plan ceiling refuses them
--   instead: 29(a) fails with 42501; 32(b) and the UPDATEs in 32(a), (d), (e) report
--   UPDATE 0 (an RLS USING filter hides the row, it does not raise), so the expected
--   42501 never appears; and 32(f), an INSERT, raises 42501 from the plan ceiling and
--   FALSELY PASSES. 32(c) runs as the owner and does not depend on the plan.
-- Every check that writes to customer_assets / contacts / accounts / account_sequences
-- is wrapped in BEGIN ... ROLLBACK, so nothing persists and no counter value is burnt
-- (the one exception is check 28's committed fixture: see SAFETY GUARANTEE above).
-- Checks 1-11 leave no state behind, so 12-36 do not depend on 1-11 having run (check 13
-- creates and rolls back its own account_sequences row).
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
--    Runs in a transaction that ROLLS BACK, so the values it prints are NOT consumed and
--    no account_sequences row is left behind.
--    Expect 1, then 2 (two result sets, type bigint). If the account already has a row
--    with asset_seq = N, expect N+1, then N+2.
-- 2. Counter state persisted in account_sequences (the row exists WITHIN the
--    transaction, so it is read before the ROLLBACK). Expect asset_seq = 2, job_seq = 0
--    (N+2 and the row's current job_seq if the account already had a row).
BEGIN;
  SELECT public.get_next_asset_number(:'acct');                                          -- 1
  SELECT public.get_next_asset_number(:'acct');                                          -- 1
  SELECT asset_seq, job_seq FROM public.account_sequences WHERE account_id = :'acct';    -- 2
ROLLBACK;
-- 1/2 (after). The rollback left the counter untouched. Expect 0 rows if the account had
--    no account_sequences row before (the precondition), otherwise the row's original
--    asset_seq (N).
SELECT asset_seq FROM public.account_sequences WHERE account_id = :'acct';

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
--    (c) agent/above -> Expect: returns asset_seq + 1 (1 if the account has no
--                       account_sequences row), then ROLLBACK. Checks 1-2 rolled back, so
--                       the counter is where it was before the script started.
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
--    asset type added/changed since. (Check 8 rolls back, so it does not change this.)
--    Names: Water Purifier, Air Conditioner, Elevator, CCTV Camera,
--           UPS / Inverter, Generator, Pump / Motor, Other.
SELECT count(*), bool_and(is_seed_data) FROM public.asset_types WHERE account_id = :'acct';

-- 7. Duplicate type name (case-insensitive) is rejected.
--    Expect: ERROR 23505 unique_violation on asset_types_uniq_name_per_account.
--    THIS RAISES AN ERROR ON PURPOSE: it aborts a psql run under ON_ERROR_STOP, so
--    run it separately or with ON_ERROR_STOP off. Wrapped in a transaction that rolls
--    back so that, if the unique index were missing, the duplicate would not persist.
BEGIN;
  INSERT INTO public.asset_types (account_id, name) VALUES (:'acct', 'water purifier');
ROLLBACK;

-- 8. Name reusable after archive. Expect: UPDATE 1, then INSERT 0 1, no error, then the
--    SELECT returns two 'Other' rows: one archived (is_live = false), one live (true).
--    The whole block ROLLS BACK, so the tenant's real 'Other' type is NOT left archived
--    and no duplicate remains.
BEGIN;
  UPDATE public.asset_types SET deleted_at = now()
   WHERE account_id = :'acct' AND lower(name) = 'other';
  INSERT INTO public.asset_types (account_id, name) VALUES (:'acct', 'Other');
  SELECT name, deleted_at IS NULL AS is_live FROM public.asset_types
   WHERE account_id = :'acct' AND lower(name) = 'other' ORDER BY is_live;
ROLLBACK;

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
--     (This is the one item that changes anything, and it is the migration re-running,
--     not a script statement; do it on a branch if you want zero production writes.)
--     Expect: no error, and nothing changes:
--       - the counter is untouched: SELECT asset_seq FROM public.account_sequences
--         WHERE account_id = :'acct' returns what it did before the re-apply;
--       - SELECT count(*) FROM public.asset_types WHERE account_id = :'acct' returns the
--         same number as before (8 for an untouched account: check 8 rolls back, so it no
--         longer adds a ninth row; an account that already has any asset_types row, archived
--         or not, is never re-seeded by the helper).


-- ============================================================
-- Task 4: customer_assets (migration 20260929152000_fsm_customer_assets.sql)
-- ============================================================

-- 12. Asset code auto-assigns as PREFIX-nnnnnn and matches the counter.
--     Expect one row: asset_code like 'AST-000001' (the account's next number; prefix AST
--     unless the account set one), format_ok = true, and code_number equal to seq.
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
  INSERT INTO public.account_sequences (account_id, asset_seq) VALUES (:'acct', 999999)
    ON CONFLICT (account_id) DO UPDATE SET asset_seq = 999999;   -- upsert: the row may not exist yet
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

-- 28. Cross-tenant isolation.
--     IF THIS RUN ABORTS after step (i) (e.g. under ON_ERROR_STOP at the outsider insert),
--     the committed fixture 'VERIFYFX-000001' is left behind: delete it before re-running,
--     or the re-run fails 23505 on that code:
--       DELETE FROM public.customer_assets WHERE account_id = :'acct' AND asset_code = 'VERIFYFX-000001';
--     NEEDS A ROLE SWITCH. THREE STEPS, because every other
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
--     (iii) as the owner, remove the fixture. The DELETE carries account_id = :'acct':
--           this script is run by hand against production, so no write outside a
--           BEGIN ... ROLLBACK may be unscoped.
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
-- >>> (iii) CLEANUP: RUN THIS STATEMENT EVEN IF THE CHECK ABOVE ABORTED. It removes the one
-- >>> committed row this script creates: asset_code 'VERIFYFX-000001' (no other row is
-- >>> touched). Scoped to :acct on purpose.
DELETE FROM public.customer_assets
 WHERE account_id = :'acct' AND asset_code = 'VERIFYFX-000001';

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
--         Expect UPDATE 1 (a single statement: re-code and restore together), no error.
--         This is the way out of the restore
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


-- ============================================================================
-- TASK 11: ASSET IMPORT (checks 37-45)
-- Migration: supabase/migrations/20260929155000_fsm_import_customer_assets.sql
-- Sample files for the click-through: fsm-asset-import-sample.csv and fsm-asset-import-customers.csv
-- (both in this directory).
--
-- SAFETY: checks 37-39 and 43 are read-only. Checks 40-42 are each ONE BEGIN ... ROLLBACK
-- transaction that inserts its own fixtures (contacts VFY-IMP-1/-2, product VFY-IMP-PROD,
-- asset VFY-EXIST, an import job), runs the import, and rolls everything back. Nothing is
-- committed by this section. Fixture phone numbers are +999000000001 and +999000000002:
-- if a real customer in :acct already has one of those numbers the INSERT fails 23505 and
-- the transaction aborts harmlessly; pick other digits and re-run.
--
-- Extra setup for checks 40-42 (in addition to the setup above):
--   \set importer '<user_id (auth uid) of an OWNER or ADMIN member of :acct>'
--   :acct must be on an FSM plan and have asset types seeded (it does once Task 3 is applied).
--   :contact (setup above) must have a non-null territory_id: check 40 uses it to prove
--   territory inheritance.
--   Checks 42(a) and 42(b) reuse :agent (a PLAIN agent, not owner/admin) and 42(c) reuses
--   :nonfsm_acct / :nonfsm_member.
-- Rolled-back writes burn nothing: the asset counter increments are rolled back with them.
-- psql: checks 40 uses \gset, so run this section with psql, not a SQL console that lacks it.
-- ============================================================================

-- 37. BEFORE APPLYING THE MIGRATION: confirm the live function is the one the migration was
--     built on. The migration was rebuilt from the pg_dump in tools/migration/01-schema.sql
--     (2026-09-27), NOT from supabase/migrations/20260823140000, because the live function
--     carries later changes (customer_code matching; optional phone/name rules on Customers,
--     Products, Leads and Tasks imports) that the repo file does not. The migration aborts
--     with a clear message if these markers are missing; run this first so you know why.
--     Expect ONE row, all five columns = true (before AND after applying).
--     The markers are coarse, so ALSO diff the live body against the dump before you apply:
--     save the output of
--       SELECT pg_get_functiondef('public.import_commit(uuid,jsonb,boolean)'::regprocedure);
--     and compare it with lines 2925-3228 of tools/migration/01-schema.sql. Expect differences
--     ONLY in the formatting of the CREATE line. Any other difference means the live function
--     changed after 27 Sep: STOP and tell the developer so the migration can be rebased.
WITH d AS (SELECT pg_get_functiondef('public.import_commit(uuid,jsonb,boolean)'::regprocedure) AS def)
SELECT position('Row needs a phone number, a name, or a customer code' IN def) > 0 AS contacts_rules,
       position('Row needs a product name or product code'              IN def) > 0 AS products_rules,
       position('Row needs a lead name or a phone/WhatsApp number'      IN def) > 0 AS leads_rules,
       position('Row needs a task title or description'                 IN def) > 0 AS tasks_rules,
       position('Opening stock is required'                             IN def) > 0 AS stock_branch
  FROM d;

-- 38. AFTER APPLYING: both functions carry the new branch, are SECURITY INVOKER (RLS still
--     applies to every write) and pin their search_path; the date helper is not callable by anon.
--     Expect three rows:
--       import_commit             | has_assets_branch = true  | security_definer = false | search_path = true
--       import_parse_service_date | has_assets_branch = false | security_definer = false | search_path = true
--       import_undo               | has_assets_branch = true  | security_definer = false | search_path = true
--     (the helper never mentions customer_assets, so false is correct for it)
--     and a second result: anon = false, authenticated = true.
SELECT p.proname,
       position('customer_assets' IN pg_get_functiondef(p.oid)) > 0 AS has_assets_branch,
       p.prosecdef                                                  AS security_definer,
       coalesce(p.proconfig::text LIKE '%search_path%', false)      AS search_path
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('import_commit','import_undo','import_parse_service_date')
 ORDER BY p.proname;
SELECT has_function_privilege('anon',          'public.import_parse_service_date(text)', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.import_parse_service_date(text)', 'EXECUTE') AS authenticated;

-- 39. The server date reader accepts exactly what src/lib/import/dates.ts accepts.
--     (a) Expect: 2024-03-15 | 2024-03-15 | 2024-03-15 | 2026-02-01 | 2024-04-03 | NULL
SELECT public.import_parse_service_date('15-03-2024')  AS dmy_dash,
       public.import_parse_service_date('15/03/2024')  AS dmy_slash,
       public.import_parse_service_date('2024-03-15')  AS iso,
       public.import_parse_service_date('1-2-2026')    AS single_digits,
       public.import_parse_service_date('03/04/2024')  AS day_first_not_month_first,
       public.import_parse_service_date('   ')         AS blank_is_null;
--     (b) A two-digit year is REFUSED, never guessed. Expect ERROR 22007 "unrecognised date: 01-02-26".
--         RAISES ON PURPOSE.
SELECT public.import_parse_service_date('01-02-26');
--     (c) An impossible calendar date. Expect ERROR 22008 (date field value out of range). RAISES ON PURPOSE.
SELECT public.import_parse_service_date('31-02-2026');

-- 40. END TO END through import_commit and import_undo, as the importer, in ONE transaction that
--     ROLLS BACK. Nine rows: three good, six rejected, each with a named reason; then an undo.
--     Row numbers in "errors" are 1-BASED WITHIN THE CHUNK (the client adds the chunk offset),
--     and here the chunk is the nine rows below, so the first row is 1.
--
--     (a) Expect from the import_commit result (jsonb):
--       imported 3, failed 6, skipped 0, updated 0 and these errors, in order:
--         row 3  customer_not_found: no active customer matches "Nobody Known Ltd" ...
--         row 4  duplicate_serial: serial number "VFY-SN-1" is already used by asset <code of row 1's asset>
--         row 5  duplicate_serial: serial number "VFY-EXIST" is already used by asset <code of the fixture asset>
--         row 6  warranty_end_before_start: Warranty End 09-01-2025 is earlier than Warranty Start 10-01-2025
--         row 7  invalid_date: Installation Date "01-02-26" is not a real date ...
--         row 8  product_not_found: no product matches "VFY-NO-SUCH" by product code or name
--       skipped = 0 is the point: NOTHING is dropped silently.
--     (b) VFY-SN-1: no_territory = true (its contact has none). VFY-SN-2: inherited = true (the file's
--         bogus "territory", "asset_code" and "customer_name_snapshot" keys were all ignored). VFY-SN-7:
--         inherited = true as well. code_ok = true on all three. The snapshots are the CONTACT's values
--         (Verify Import One/Two, +999000000001/2). creator_ok = true (created_by is the importer's
--         profiles.id, not the auth user id).
--     (c) contacts_unchanged, products_unchanged, types_unchanged, territories_unchanged: all true
--         (the import created no customer, product, asset type or territory).
--     (d) import_jobs: status completed | imported_rows 3 | failed_rows 6 | skipped_rows 0 |
--         undoable true | errors 6.
--     (e) import_undo: {"removed": 3, "blocked": 0, "asset_types_removed": 0}. Afterwards
--         imported_left = 0 and fixture_still_there = 1: an undo removes exactly what the job made.
BEGIN;
  INSERT INTO public.contacts (user_id, account_id, phone, name, customer_code)
  VALUES (:'importer', :'acct', '+999000000001', 'Verify Import One', 'VFY-IMP-1');
  INSERT INTO public.contacts (user_id, account_id, phone, name, customer_code, territory_id)
  VALUES (:'importer', :'acct', '+999000000002', 'Verify Import Two', 'VFY-IMP-2',
          (SELECT territory_id FROM public.contacts WHERE id = :'contact'));
  INSERT INTO public.products (user_id, account_id, name, sku)
  VALUES (:'importer', :'acct', 'Verify Import Product', 'VFY-IMP-PROD');
  INSERT INTO public.customer_assets (account_id, contact_id, name, serial_no)
  VALUES (:'acct', (SELECT id FROM public.contacts WHERE account_id = :'acct' AND customer_code = 'VFY-IMP-1'),
          'Verify existing asset', 'VFY-EXIST');
  INSERT INTO public.import_jobs (id, account_id, user_id, module, target_table, file_name)
  VALUES ('7e57f0f0-0000-4000-8000-0000000000a1', :'acct', :'importer', 'customer_assets', 'customer_assets', 'verify-check-40.csv');
  SELECT count(*) AS c0 FROM public.contacts     WHERE account_id = :'acct' \gset
  SELECT count(*) AS p0 FROM public.products     WHERE account_id = :'acct' \gset
  SELECT count(*) AS t0 FROM public.asset_types  WHERE account_id = :'acct' \gset
  SELECT count(*) AS r0 FROM public.territories  WHERE account_id = :'acct' \gset
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'importer', 'role', 'authenticated')::text, true);
  SELECT jsonb_pretty(public.import_commit('7e57f0f0-0000-4000-8000-0000000000a1', $rows$[
    {"__row":2,"customer":"VFY-IMP-1","name":"vfy ok by code","serial_no":"VFY-SN-1","installation_date":"15-03-2024"},
    {"__row":3,"customer":"+999000000002","name":"vfy ok by phone","serial_no":"VFY-SN-2","installation_date":"15/03/2024",
       "territory":"IGNORED","asset_code":"FORGED","customer_name_snapshot":"Forged Name"},
    {"__row":4,"customer":"Nobody Known Ltd","name":"vfy unknown customer","serial_no":"VFY-SN-3"},
    {"__row":5,"customer":"VFY-IMP-1","name":"vfy dup of row 1","serial_no":"VFY-SN-1"},
    {"__row":6,"customer":"VFY-IMP-1","name":"vfy dup of existing","serial_no":"VFY-EXIST"},
    {"__row":7,"customer":"VFY-IMP-1","name":"vfy bad warranty","serial_no":"VFY-SN-4","warranty_start":"10-01-2025","warranty_end":"09-01-2025"},
    {"__row":8,"customer":"VFY-IMP-1","name":"vfy two-digit year","serial_no":"VFY-SN-5","installation_date":"01-02-26"},
    {"__row":9,"customer":"VFY-IMP-1","name":"vfy unknown product","serial_no":"VFY-SN-6","product":"VFY-NO-SUCH"},
    {"__row":10,"customer":"VFY-IMP-2","name":"vfy ok with product","serial_no":"VFY-SN-7","product":"VFY-IMP-PROD"}
  ]$rows$::jsonb, true));                                                                    -- (a)
  SELECT a.serial_no,
         (a.territory_id IS NULL)                                                  AS no_territory,
         (a.territory_id = (SELECT territory_id FROM public.contacts WHERE id = :'contact')) AS inherited,
         (a.asset_code ~ '^[A-Z0-9]+-[0-9]{6,}$' AND a.asset_code <> 'FORGED')     AS code_ok,
         a.customer_name_snapshot, a.customer_phone_snapshot,
         (a.created_by = (SELECT id FROM public.profiles WHERE user_id = :'importer' AND account_id = :'acct')) AS creator_ok
    FROM public.customer_assets a
   WHERE a.account_id = :'acct' AND a.serial_no IN ('VFY-SN-1','VFY-SN-2','VFY-SN-7')
   ORDER BY a.serial_no;                                                                       -- (b)
  SELECT (SELECT count(*) FROM public.contacts    WHERE account_id = :'acct') = :c0 AS contacts_unchanged,
         (SELECT count(*) FROM public.products    WHERE account_id = :'acct') = :p0 AS products_unchanged,
         (SELECT count(*) FROM public.asset_types WHERE account_id = :'acct') = :t0 AS types_unchanged,
         (SELECT count(*) FROM public.territories WHERE account_id = :'acct') = :r0 AS territories_unchanged; -- (c)
  SELECT status, imported_rows, failed_rows, skipped_rows, undoable, jsonb_array_length(error_sample) AS errors
    FROM public.import_jobs WHERE id = '7e57f0f0-0000-4000-8000-0000000000a1';                -- (d)
  SELECT public.import_undo('7e57f0f0-0000-4000-8000-0000000000a1');                          -- (e)
  SELECT (SELECT count(*) FROM public.customer_assets WHERE account_id = :'acct' AND serial_no LIKE 'VFY-SN-%') AS imported_left,
         (SELECT count(*) FROM public.customer_assets WHERE account_id = :'acct' AND serial_no = 'VFY-EXIST')   AS fixture_still_there;
ROLLBACK;
-- 40 (after). Nothing persisted. Expect 0.
SELECT count(*) FROM public.customer_assets WHERE account_id = :'acct' AND serial_no LIKE 'VFY-%';

-- 41. "Create missing asset types" is OFF unless the rows carry opt_create_asset_types, and an
--     undo removes the types that job created. One transaction, ROLLED BACK.
--     Expect:
--       (a) import_commit with the option absent: failed 1, imported 0, message
--           asset_type_not_found: asset type "Vfy Brand New Type" does not exist (tick ...)
--       (b) type_exists_after_a = 0   (nothing was created)
--       (c) import_commit with opt_create_asset_types = "true" on two rows whose type differs only
--           in letter case: imported 2, failed 0
--       (d) types_named = 1   (created ONCE, reused case-insensitively)
--       (e) import_undo: removed 2, asset_types_removed 1
--       (f) types_named_after_undo = 0
BEGIN;
  INSERT INTO public.contacts (user_id, account_id, phone, name, customer_code)
  VALUES (:'importer', :'acct', '+999000000001', 'Verify Import One', 'VFY-IMP-1');
  INSERT INTO public.import_jobs (id, account_id, user_id, module, target_table, file_name)
  VALUES ('7e57f0f0-0000-4000-8000-0000000000a2', :'acct', :'importer', 'customer_assets', 'customer_assets', 'verify-check-41.csv');
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', :'importer', 'role', 'authenticated')::text, true);
  SELECT public.import_commit('7e57f0f0-0000-4000-8000-0000000000a2',
    '[{"customer":"VFY-IMP-1","name":"vfy type off","asset_type":"Vfy Brand New Type"}]'::jsonb, false);   -- (a)
  SELECT count(*) AS type_exists_after_a FROM public.asset_types
   WHERE account_id = :'acct' AND lower(name) = 'vfy brand new type';                                      -- (b)
  SELECT public.import_commit('7e57f0f0-0000-4000-8000-0000000000a2', $rows$[
    {"customer":"VFY-IMP-1","name":"vfy type on 1","asset_type":"Vfy Brand New Type","opt_create_asset_types":"true"},
    {"customer":"VFY-IMP-1","name":"vfy type on 2","asset_type":"vfy brand new type","opt_create_asset_types":"true"}
  ]$rows$::jsonb, true);                                                                                   -- (c)
  SELECT count(*) AS types_named FROM public.asset_types
   WHERE account_id = :'acct' AND lower(name) = 'vfy brand new type';                                      -- (d)
  SELECT public.import_undo('7e57f0f0-0000-4000-8000-0000000000a2');                                       -- (e)
  SELECT count(*) AS types_named_after_undo FROM public.asset_types
   WHERE account_id = :'acct' AND lower(name) = 'vfy brand new type';                                      -- (f)
ROLLBACK;

-- 42. Refusals are ONE clear error, up front, with nothing written (not an RLS failure per row that
--     would abort the chunk). Each block is its own transaction and RAISES ON PURPOSE; the job row is
--     inserted as the owner BEFORE the role switch.
--     (a) A plain agent holding import_data and create_service_assets but NOT import_service_assets.
--         Expect ERROR 42501 "You do not have permission to import assets".
--     (b) The same agent holding import_service_assets but NOT create_service_assets.
--         Expect ERROR 42501 "You do not have permission to create assets".
--     (c) An owner/admin of an account WITHOUT the fsm line.
--         Expect ERROR 42501 "Your plan does not include Service Assets".
BEGIN;
  UPDATE public.employee_roles er
     SET permissions = (coalesce(er.permissions, '{}'::jsonb) - 'import_service_assets')
                       || '{"import_data": true, "create_service_assets": true}'::jsonb
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  INSERT INTO public.import_jobs (id, account_id, user_id, module, target_table, file_name)
  VALUES ('7e57f0f0-0000-4000-8000-0000000000a3', :'acct', :'agent', 'customer_assets', 'customer_assets', 'verify-check-42a.csv');
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  SELECT public.import_commit('7e57f0f0-0000-4000-8000-0000000000a3',
    '[{"customer":"x","name":"x"}]'::jsonb, true);                                                         -- (a)
ROLLBACK;
BEGIN;
  UPDATE public.employee_roles er
     SET permissions = (coalesce(er.permissions, '{}'::jsonb) - 'create_service_assets')
                       || '{"import_data": true, "import_service_assets": true}'::jsonb
    FROM public.profiles p
   WHERE p.employee_role_id = er.id AND p.user_id = :'agent' AND p.account_id = :'acct';
  INSERT INTO public.import_jobs (id, account_id, user_id, module, target_table, file_name)
  VALUES ('7e57f0f0-0000-4000-8000-0000000000a4', :'acct', :'agent', 'customer_assets', 'customer_assets', 'verify-check-42b.csv');
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', json_build_object('sub', :'agent', 'role', 'authenticated')::text, true);
  SELECT public.import_commit('7e57f0f0-0000-4000-8000-0000000000a4',
    '[{"customer":"x","name":"x"}]'::jsonb, true);                                                         -- (b)
ROLLBACK;
BEGIN;
  INSERT INTO public.import_jobs (id, account_id, user_id, module, target_table, file_name)
  VALUES ('7e57f0f0-0000-4000-8000-0000000000a5', :'nonfsm_acct', :'nonfsm_member', 'customer_assets', 'customer_assets', 'verify-check-42c.csv');
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', json_build_object('sub', :'nonfsm_member', 'role', 'authenticated')::text, true);
  SELECT public.import_commit('7e57f0f0-0000-4000-8000-0000000000a5',
    '[{"customer":"x","name":"x"}]'::jsonb, true);                                                         -- (c)
ROLLBACK;

-- 43. STATIC: the per-row exception handling. The outer handler gained exactly one clause
--     (foreign_key_violation) and its unique_violation clause is UNCHANGED, so every other import
--     target still skips a duplicate silently. Expect ONE row, all three = true.
--     The foreign_key_violation clause cannot be reached by a real file today (every reference is
--     resolved before the INSERT, and the asset branch has its own nested handler); it exists so a
--     race, or any later import target, fails ONE row instead of aborting a chunk of 500.
WITH d AS (SELECT pg_get_functiondef('public.import_commit(uuid,jsonb,boolean)'::regprocedure) AS def)
SELECT position('WHEN foreign_key_violation THEN' IN def) > 0                                   AS outer_fk_clause,
       position('WHEN unique_violation THEN v_skipped := v_skipped + 1;' IN def) > 0            AS outer_unique_still_silent_skip,
       (length(def) - length(replace(def, 'WHEN unique_violation THEN', '')))
         / length('WHEN unique_violation THEN') = 2                                            AS outer_plus_assets_handlers_only
  FROM d;

-- 44. MANUAL, END TO END, IN THE UI (the founder's click-through: steps 79-97 in task-11-report.md, which continues the script of task-9-report.md and task-10-report.md).
--     Create the five customers from fsm-asset-import-customers.csv (Import > Customers), give
--     "Asset Import Test 3" a Territory, create the product AIT-PROD-1 and one asset for AIT-01 with
--     serial AIT-EXISTING-1, then import fsm-asset-import-sample.csv (Import > Service Assets).
--     Expect: 15 imported; 4 failed with these reasons and 1 invalid in the preview:
--       customer_not_found / duplicate_serial (naming the existing asset's code) /
--       warranty_end_before_start / product_not_found, and the "01-02-26" row invalid before any write.
--     The asset "Cassette AC" (the row that has a Territory value in the file) sits in "Asset Import
--     Test 3"'s territory, NOT in "Gujarat". Undo removes exactly 15; no customer, product, asset type
--     or territory was created. Confirm with this scoped read-only query (replace the account):
--       SELECT count(*) FROM public.customer_assets WHERE account_id = :'acct' AND serial_no LIKE 'AIT-SN-%';
--     -> 15 after the import, 0 after the undo.

-- 45. MANUAL INSTRUCTION, NOT SQL. Idempotency of Task 11: re-apply
--     supabase/migrations/20260929155000_fsm_import_customer_assets.sql a second time.
--     Expect: no error and no change (CREATE OR REPLACE; the guard still passes because the markers
--     it looks for are still in the new body). Then re-run check 37 (all true) and check 38.
