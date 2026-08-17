-- ============================================================================
-- 20260817170500_leave_working_days_backfill.sql
--
-- Corrects the working-days backfill shipped in 20260817170000_leave_management.sql.
--
-- The original used jsonb_set(settings, '{tracking_settings,working_days}', …, true).
-- create_missing only creates the FINAL key of the path — it cannot create a
-- missing intermediate object. Accounts whose `settings` had no
-- `tracking_settings` object at all were therefore left unchanged: verified in
-- production immediately after applying, only 2 of 17 accounts had the key.
--
-- Behaviour was never wrong (account_working_days() falls back to Mon–Sat when
-- the key is absent), but the setting would have been invisible and uneditable
-- in Settings for those 15 accounts.
--
-- Idempotent: the WHERE clause skips accounts that already carry the key, so
-- re-running never overwrites an admin's chosen working week.
-- ============================================================================

UPDATE accounts
   SET settings = COALESCE(settings, '{}'::jsonb)
                  || jsonb_build_object(
                       'tracking_settings',
                       COALESCE(settings->'tracking_settings', '{}'::jsonb)
                       || jsonb_build_object('working_days', '[1,2,3,4,5,6]'::jsonb))
 WHERE NOT (COALESCE(settings->'tracking_settings', '{}'::jsonb) ? 'working_days');
