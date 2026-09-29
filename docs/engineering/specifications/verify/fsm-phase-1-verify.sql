-- FSM Phase 1 verification (checks 1-11; Task 4 appends 12 onward).
-- Run against a Supabase BRANCH, never production. There is no DB test harness in
-- this repo, so this checked-in script with stated expected results is the
-- verification artefact.
--
-- Migration under test: supabase/migrations/20260929151000_fsm_asset_masters.sql
--
-- Setup (psql):
--   \set acct '<test account uuid>'
--   \set outsider '<uuid of a signed-up user who is NOT a member of :acct>'
--   \set viewer   '<uuid of a member of :acct whose role is viewer>'   (optional, check 5)
--   \set agent    '<uuid of a member of :acct whose role is agent or above>' (optional, check 5)
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
-- switch and CANNOT run as the migration owner. Check 7 raises an error on purpose:
-- under psql -v ON_ERROR_STOP=1 it aborts the rest of the run, so run it on its
-- own or with ON_ERROR_STOP off.
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
