-- Take the superadmin branch back out of `profiles_select`.
--
-- Migration 20260818200000 added `OR is_superadmin()` so the superadmin panel
-- could list users across companies straight from the browser. A row policy
-- cannot tell which screen is asking, so the same branch fired inside the
-- ordinary tenant admin area: the platform founder, signed in to his own
-- company, saw every other tenant's staff — in Team > Employees and in every
-- owner / assignee / collaborator picker that loads people.
--
-- `profiles` was the only tenant table carrying that branch, so no other
-- module's data was exposed.
--
-- The three superadmin screens that needed cross-tenant profiles now go
-- through /api/admin/users, which runs under the service role behind
-- `requireSuperadmin()`:
--   * /admin/users           — already did (since 20260818200000)
--   * /admin                 — the total-users tile, via ?count=1
--   * /admin/companies/[id]  — the member list, via ?accountId=
--
-- Everything else that reads `profiles` from the browser reads its own row
-- (`eq("user_id", …)`), which the first branch below still allows.

begin;

drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select
  using (
    (select auth.uid()) = user_id
    or is_account_member(account_id)
  );

commit;

-- Rollback: re-add `or is_superadmin()` to the using() clause above. Only do
-- that together with reverting the three screens, or the leak comes back.
