-- ============================================================
-- 20261003120000_restore_auth_user_created_trigger.sql
--
-- PRODUCTION REPAIR, not a feature. Restores the ONE object the
-- Singapore → Mumbai migration (2026-09-27) left behind.
--
-- WHAT WAS BROKEN
-- `handle_new_user()` exists on Mumbai, but the trigger that calls it does not.
-- With no trigger on auth.users, a signup created a LOGIN and nothing else:
-- no `accounts` row, no `profiles` row, no Customer ID, no plan, no module
-- settings. The user would land in the dashboard shell with no account at all.
--
-- The signup page depends on this trigger by design — src/app/(auth)/signup/page.tsx
-- passes `plan` in `options.data` with the comment "Carried into raw_user_meta_data
-- and read by the handle_new_user trigger". There is no application-side fallback:
-- /api/provision-account seeds masters and roles for an account that ALREADY exists;
-- it does not create the account.
--
-- WHY IT WAS MISSED
-- This is the SECOND instance of one failure mode: the restore carried the `public`
-- schema faithfully and dropped objects living outside it. The first instance was the
-- 45 `storage.objects` RLS policies (restored by 20260929120000). The migration's own
-- verification counted "120 triggers" and matched — but that count was `public`-scoped,
-- so an `auth` trigger could go missing without moving the number.
--
-- A full inventory of every user-defined object outside `public` has now been diffed
-- between the two projects. Mumbai matches Singapore on all of it — 45 storage.objects
-- policies, 2 cron policies, both pg_cron jobs, every storage/realtime/cron trigger —
-- with this trigger the single exception. After this migration the two are identical
-- outside `public`, and nothing else from the move is outstanding.
--
-- BLAST RADIUS WHILE BROKEN
-- The last signup was 2026-09-20; the web cut over to Mumbai on 2026-09-27. So no real
-- signup has hit this and no user was harmed. It would have been hit by the next
-- prospect, and by every tester in the Play Store closed test (a personal developer
-- account requires 12 testers for 14 days, and each of those testers signs up).
--
-- Definition copied verbatim from the Singapore source project
-- (`gxurqwpfvfktmreqmzqb`), read with pg_get_triggerdef:
--   CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION handle_new_user()
--
-- Idempotent: DROP ... IF EXISTS then CREATE. Re-applying is a no-op.
--
-- CHECK AFTER ANY FUTURE RESTORE — a count of `public` objects will not catch this:
--   select n.nspname, c.relname, t.tgname
--     from pg_trigger t
--     join pg_class c on c.oid = t.tgrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where not t.tgisinternal
--      and n.nspname not in ('public','pg_catalog','information_schema');
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
