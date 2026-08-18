-- Drop profiles.plain_password. Applied to production 2026-08-18.
--
-- The column was added on 2026-08-05 by 20260805164316_add_version_to_devices.sql
-- — a migration about device versions, which is why a plaintext-credential column
-- slipped in unnoticed. It was never wired up:
--
--   * 0 of 17 rows populated (verified before dropping)
--   * no write path in wacrm-web or wacrm-mobile
--   * no read path in either repo
--   * no function, trigger or view referenced it
--   * the 2026-08-14 incident snapshot recorded it as null for every row
--
-- So this was a dead column, not a live credential store: nothing needed to be
-- migrated or re-hashed, and no password recovery flow depended on it. Password
-- reset already goes through Supabase Auth (auth.admin.updateUserById in
-- /api/team/employees, and the /forgot-password flow).

alter table public.profiles drop column if exists plain_password;
