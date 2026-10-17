-- Take the superadmin branch back out of the `accounts` policies.
--
-- Same mistake as `profiles_select`, fixed on 16 Oct by migration
-- 20261016120000. Migration 038 added `OR is_superadmin()` to both
-- `accounts_select` and `accounts_update` so the superadmin panel could read
-- and write every tenant's account from the browser. A row policy cannot tell
-- which screen is asking, so the branch fired inside the ordinary tenant area
-- too, for the one user who holds the flag.
--
-- The read branch was already causing a real fault: the agent health screen
-- read `accounts.settings` with `.limit(1)` and no id filter, on the stated
-- assumption that RLS scoped it to the viewer's own account. For a superadmin
-- it did not, so that screen could apply another tenant's shift times. Fixed
-- in the same commit.
--
-- The write branch is the more dangerous of the two: any tenant screen that
-- updates `accounts` without an explicit id would have written every tenant's
-- row. Every such call site has been checked and all of them filter by id, so
-- nothing was being corrupted — but the ceiling should not have been there.
--
-- The superadmin screens that needed cross-tenant accounts now go through
-- service-role routes behind `requireSuperadmin()`:
--   * /admin            — the company list, via /api/admin/companies
--   * /admin/billing    — via /api/admin/companies?includeDeleted=1
--   * /admin/companies/[id] — via GET /api/admin/accounts/[id]
-- Writes already went through PATCH /api/admin/accounts/[id].
--
-- Tenant members are unaffected: `is_account_member` still grants them their
-- own account, and admins can still update it.

begin;

drop policy if exists accounts_select on public.accounts;
drop policy if exists accounts_update on public.accounts;

create policy accounts_select on public.accounts
  for select
  using (is_account_member(id));

create policy accounts_update on public.accounts
  for update
  using (is_account_member(id, 'admin'))
  with check (is_account_member(id, 'admin'));

commit;

-- Rollback: re-add `or is_superadmin()` to all three clauses above. Only do
-- that together with reverting the four screens, or the leak comes back.
