-- ============================================================
-- portal_seats_used: stop it leaking another company's login count.
--
-- The function is SECURITY DEFINER and granted to `authenticated`, and it took
-- the account id as a bare parameter. So any signed-in user of ANY company
-- could call it with another company's id and read how many portal logins that
-- company has. It is only a number, but one company must not see another's.
--
-- Now it returns the real count only to:
--   * the service role, SQL editor, migrations, cron (any role that is not an
--     end-user API role) — same test guard_account_commercial_columns uses;
--   * a platform superadmin;
--   * a member of that account.
-- Anyone else gets 0. It returns 0 instead of raising, so an ordinary screen
-- read never turns into an error.
--
-- Signature, grants and SET search_path are unchanged. The seat-cap trigger
-- calls this from a staff member's session, who is a member of the account, and
-- from the service role, so neither is affected.
-- ============================================================
CREATE OR REPLACE FUNCTION public.portal_seats_used(p_account_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select case
    when coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
      or coalesce(public.is_superadmin(), false)
      or coalesce(public.is_account_member(p_account_id), false)
    then (
      select count(*)::integer
        from public.contacts c
       where c.account_id = p_account_id
         and c.portal_user_id is not null
         and c.portal_access
         and c.portal_access_revoked_at is null
    )
    else 0
  end;
$$;

GRANT EXECUTE ON FUNCTION public.portal_seats_used(uuid) TO authenticated, service_role;
