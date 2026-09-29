-- FSM Phase 1 verification (checks 1-8; Task 4 appends 9-17).
-- Run against a Supabase BRANCH, never production. There is no DB test harness in
-- this repo, so this checked-in script with stated expected results is the
-- verification artefact.
--
-- Usage (psql):  \set acct '<test account uuid>'   then run each block.
-- Use an account whose asset_seq is still 0 so the counter checks start at 1.
-- Migration under test: supabase/migrations/20260929151000_fsm_asset_masters.sql
--
-- NOTE: get_next_asset_number returns a bare bigint and takes no prefix. Prefix
-- formatting (PREFIX-000123, empty-prefix fallback to AST) lives in Task 4's
-- customer_assets_defaults() trigger and is verified in Task 4's checks.

-- 1. Counter is sequential. Expect 1, then 2 (two result sets, type bigint).
SELECT public.get_next_asset_number(:'acct');
SELECT public.get_next_asset_number(:'acct');

-- 2. Counter state persisted in account_sequences. Expect asset_seq = 2, job_seq = 0.
SELECT asset_seq, job_seq FROM public.account_sequences WHERE account_id = :'acct';

-- 3. Counter columns exist and default to 0. Expect 2 rows:
--      asset_seq | bigint | NO | 0
--      job_seq   | bigint | NO | 0
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'account_sequences'
   AND column_name IN ('asset_seq','job_seq')
 ORDER BY column_name;

-- 4. Seeded types. Expect count = 8, bool_and = true.
--    Names: Water Purifier, Air Conditioner, Elevator, CCTV Camera,
--           UPS / Inverter, Generator, Pump / Motor, Other.
SELECT count(*), bool_and(is_seed_data) FROM public.asset_types WHERE account_id = :'acct';

-- 5. Duplicate type name (case-insensitive) is rejected.
--    Expect: ERROR 23505 unique_violation on asset_types_uniq_name_per_account.
INSERT INTO public.asset_types (account_id, name) VALUES (:'acct', 'water purifier');

-- 6. Name reusable after archive. Expect: UPDATE 1, then INSERT 0 1, no error.
UPDATE public.asset_types SET deleted_at = now()
 WHERE account_id = :'acct' AND lower(name) = 'other';
INSERT INTO public.asset_types (account_id, name) VALUES (:'acct', 'Other');

-- 7. No bare auth.uid() in this migration's policies. Expect 0 rows.
--    (Also covers customer_assets once Task 4 has been applied.)
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('asset_types','customer_assets')
   AND ( (qual       LIKE '%auth.uid()%' AND qual       NOT ILIKE '%select auth.uid()%')
      OR (with_check LIKE '%auth.uid()%' AND with_check NOT ILIKE '%select auth.uid()%') );

-- 8. Idempotency. Re-apply 20260929151000_fsm_asset_masters.sql a second time.
--    Expect: no error, and nothing changes:
--      - check 2 still shows asset_seq = 2 (counter untouched);
--      - SELECT count(*) FROM public.asset_types WHERE account_id = :'acct'
--        returns the same number as before the re-apply (9 if check 6 ran: 8 seeded
--        + the re-created 'Other'; the archived 'Other' is not re-seeded because the
--        helper skips any account that already has asset_types rows, archived or not).
