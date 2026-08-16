-- Saving a report has never worked: "insert or update on table saved_reports
-- violates foreign key constraint saved_reports_user_id_fkey".
--
-- The original table (20260811163442_generic_report_engine.sql) declared
--   user_id UUID NOT NULL REFERENCES profiles(id)
-- but every other part of the feature treats user_id as the AUTH user id:
--   * all three RLS policies compare `auth.uid() = user_id`
--   * saveReportConfig() inserts `user_id: user.id` from supabase.auth.getUser()
-- `profiles` has separate `id` (profile PK) and `user_id` (auth uid) columns, so
-- the FK could never be satisfied by a value that also satisfied the policies.
-- The constraint was simply pointed at the wrong table.
--
-- Fix the FK rather than the callers: making user_id a profile id would require
-- rewriting all three policies and would break `auth.uid() = user_id`, which is
-- the correct and cheapest check. No rows exist to migrate — the insert has
-- always failed, so the table is empty.

ALTER TABLE saved_reports DROP CONSTRAINT saved_reports_user_id_fkey;

ALTER TABLE saved_reports
  ADD CONSTRAINT saved_reports_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN saved_reports.user_id IS
  'Auth user id (auth.users.id / auth.uid()), NOT profiles.id — the RLS policies compare it to auth.uid().';
