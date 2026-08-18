-- Platform-wide announcements from the superadmin panel.
-- Applied to production 2026-08-18.
--
-- The /admin/announcements page shipped as a mockup claiming it needed an
-- `announcements` table. It did not: `tenant_announcements` already exists. It
-- was simply per-tenant — an account admin posting to their own employees —
-- with account_id NOT NULL, so there was no way to express "everyone".
--
-- Chosen representation: account_id IS NULL means platform-wide. The
-- alternative was fanning out one row per account, which would have made an
-- edit or a delete a multi-row operation that can partially fail, and would
-- have grown with the tenant count.

alter table public.tenant_announcements alter column account_id drop not null;

-- Tenant admins manage their own announcements. With account_id NULL,
-- is_account_member(NULL) is false, so the existing manage policy already
-- refuses to let a tenant admin touch a platform announcement.
--
-- Members need an explicit read path for platform announcements, because the
-- existing view policy is account-scoped and NULL fails it.
drop policy if exists "Members can view platform announcements" on public.tenant_announcements;
create policy "Members can view platform announcements" on public.tenant_announcements
  for select
  using (
    account_id is null
    and (expiry_date is null or expiry_date > now())
  );

-- Writes for platform-wide rows come from the guarded superadmin route via the
-- service-role client, which bypasses RLS. No INSERT/UPDATE/DELETE policy is
-- added for account_id IS NULL, so no end user can create one. Verified by
-- attempting the insert as `authenticated`: blocked by RLS.

comment on column public.tenant_announcements.account_id is
  'Owning tenant. NULL means a platform-wide announcement created by a superadmin.';
