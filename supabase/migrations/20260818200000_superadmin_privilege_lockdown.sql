-- Superadmin privilege lockdown
--
-- Problem (live in production before this migration):
--   `profiles_update` allows a user to update their own row (auth.uid() = user_id),
--   and the `authenticated` role holds column-level UPDATE/INSERT on
--   profiles.is_superadmin, profiles.account_role and profiles.account_id.
--   Nothing else guards those columns. Any signed-in user could therefore run
--     update profiles set is_superadmin = true where user_id = auth.uid()
--   from the browser and gain platform-wide read/write across every account,
--   or move their own profile into another tenant.
--
-- Fix: revoke the column grants so the security columns can only be written by
--   SECURITY DEFINER functions (handle_new_user, redeem_invitation) and by
--   service-role server routes (/api/team/employees). Then add a defence-in-depth
--   trigger so even a future policy mistake cannot escalate privileges.
--
-- Also fixes the superadmin panel, which could not read cross-tenant profiles
--   because `profiles_select` had no is_superadmin() branch.

begin;

-- 1. Remove the ability for end users to write the security columns directly.
--    NOTE: these four REVOKEs are no-ops and are kept only to match what was
--    actually applied to production. `profiles` has table-level UPDATE/INSERT
--    grants, and Postgres will not let a column-level REVOKE carve an exception
--    out of a table-level grant. Fixed in 20260818201000.
revoke update (is_superadmin, account_role, account_id) on public.profiles from authenticated;
revoke update (is_superadmin, account_role, account_id) on public.profiles from anon;
revoke insert (is_superadmin, account_role, account_id) on public.profiles from authenticated;
revoke insert (is_superadmin, account_role, account_id) on public.profiles from anon;

-- 2. Defence in depth: reject privilege changes that do not come from a
--    SECURITY DEFINER path or the service role, regardless of grants.
-- NOTE: deliberately SECURITY INVOKER (the default). Inside a SECURITY DEFINER
-- function `current_user` is the function OWNER, not the caller, so marking this
-- SECURITY DEFINER would make the guard below a permanent no-op. As an invoker
-- trigger, `current_user` is:
--   'authenticated' / 'anon'  -> a direct end-user write, which we block
--   'postgres'                -> reached via handle_new_user / redeem_invitation
--                                (SECURITY DEFINER), which we trust
--   'service_role'            -> a guarded server route, which we trust
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.is_superadmin is true then
        raise exception 'is_superadmin cannot be set directly';
      end if;
    else
      if new.is_superadmin is distinct from old.is_superadmin then
        raise exception 'is_superadmin cannot be changed directly';
      end if;
      if new.account_role is distinct from old.account_role then
        raise exception 'account_role cannot be changed directly';
      end if;
      if new.account_id is distinct from old.account_id then
        raise exception 'account_id cannot be changed directly';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileges on public.profiles;
create trigger trg_guard_profile_privileges
  before insert or update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- 3. Let the superadmin panel actually read every tenant's profiles.
--    Previously `profiles_select` was account-scoped only, so /admin/users and
--    the dashboard user count showed just the superadmin's own company.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using (
    auth.uid() = user_id
    or is_account_member(account_id)
    or is_superadmin()
  );

commit;
