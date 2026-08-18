# Rollback — superadmin privilege lockdown (20260818200000)

Applied 2026-08-18 to close two independent privilege-escalation paths:

1. **SQL/RLS** — `authenticated` held column UPDATE/INSERT on
   `profiles.is_superadmin`, `account_role`, `account_id`, and `profiles_update`
   permits a user to write their own row. Any signed-in user could self-promote
   to platform superadmin.
2. **Service-role API** — `/api/team/employees` had no auth check on POST or
   PATCH and used the service-role key, so an unauthenticated request could set
   `is_superadmin`, change `account_role`, or reset any user's password.

The migration closes (1). The code change in the same deployment closes (2).
**Do not roll back one without the other.**

## What the migration changed

- Revoked column UPDATE/INSERT on the three security columns from
  `authenticated` and `anon`.
- Added `guard_profile_privileges()` + `trg_guard_profile_privileges` on
  `profiles` as defence in depth. Deliberately SECURITY INVOKER — inside a
  SECURITY DEFINER function `current_user` is the owner, which would make the
  guard a no-op.
- Replaced `profiles_select` to add an `is_superadmin()` branch, so the
  superadmin panel can read across tenants. Before this, `/admin/users` showed
  only the superadmin's own company (1 row instead of 17).

Nothing was dropped and no data was written. The migration is reversible.

## Rollback SQL

```sql
begin;

drop trigger if exists trg_guard_profile_privileges on public.profiles;
drop function if exists public.guard_profile_privileges();

grant update (is_superadmin, account_role, account_id) on public.profiles to authenticated;
grant insert (is_superadmin, account_role, account_id) on public.profiles to authenticated;
grant update (is_superadmin, account_role, account_id) on public.profiles to anon;
grant insert (is_superadmin, account_role, account_id) on public.profiles to anon;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using (auth.uid() = user_id or is_account_member(account_id));

commit;
```

**Running this restores the vulnerability.** Only use it if the lockdown breaks a
production flow, and re-apply a corrected version immediately afterwards.

## Legitimate write paths verified before applying

All role assignment already runs privileged, so the revoke breaks nothing:

| Path | Mechanism | Affected? |
|---|---|---|
| Signup | `handle_new_user()` trigger, SECURITY DEFINER | No |
| Invite redemption | `redeem_invitation()` RPC, SECURITY DEFINER | No |
| Employee create/update | `/api/team/employees`, service-role key | No |
| Employee edit modal | direct client update | Was **already** failing against `profiles_update`; now routed through the guarded API |
| Superadmin toggle | direct client update | Moved to `/api/admin/users` PATCH |
