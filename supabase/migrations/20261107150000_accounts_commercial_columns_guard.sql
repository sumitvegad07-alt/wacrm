-- ============================================================
-- A tenant admin must not be able to sell themselves a plan.
--
-- THE HOLE. accounts_update (20261017120000_accounts_tenant_scope.sql) is
--   using (is_account_member(id,'admin')) with check (is_account_member(id,'admin'))
-- That is a ROW rule. PostgreSQL row policies cannot restrict COLUMNS, and
-- nothing else guarded these ones: no trigger, no REVOKE, no column GRANT. So
-- any tenant admin could PATCH their own accounts row through the API and set
-- subscription_plan, subscription_status, subscription_expires_at, addon_lines
-- or portal_seats_limit to anything: upgrade themselves, or extend their own
-- expiry date. This predates the DMS. The DMS only added two more columns
-- (addon_lines, portal_seats_limit) to the same open door.
--
-- THE GUARD. A BEFORE UPDATE trigger that refuses a change to those five
-- columns when the write comes from an end-user API role.
--
-- WHO IS EXEMPT, AND HOW WE KNOW. The superadmin panel writes through the
-- service-role key. RLS does not apply to the service role, but triggers still
-- fire for it, so it has to be recognised here. Inside a SECURITY DEFINER
-- function:
--   current_user  = the function owner (postgres)      -> useless
--   session_user  = the login (authenticator for BOTH
--                   the user and the service role)     -> cannot tell them apart
--   current_setting('role', true) = the role PostgREST switched to
--                   ('authenticated', 'anon', 'service_role'; 'none' or
--                   'postgres' for a direct connection) -> the only one that works
-- So the guard applies ONLY when that setting is 'authenticated' or 'anon'.
-- Everything else (service role, the SQL editor, migrations, a DBA) passes.
-- A pg_cron job would run as postgres and also pass; none writes these columns.
--
-- INSERT is not touched (BEFORE UPDATE only), so handle_new_user, which INSERTs
-- the account row at signup, is unaffected. module_settings, name and settings
-- are deliberately NOT guarded: a tenant admin toggles their own modules and
-- the server already clamps them to the plan.
--
-- If this ever blocks something it should not:
--   DROP TRIGGER trg_guard_account_commercial_columns ON public.accounts;
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_account_commercial_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  -- Not an end-user API role: service role, SQL editor, migrations, DBA.
  IF coalesce(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A platform superadmin signed in with an ordinary user session.
  IF to_regprocedure('public.is_superadmin()') IS NOT NULL
     AND public.is_superadmin() THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_plan       IS DISTINCT FROM OLD.subscription_plan
  OR NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
  OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
  OR NEW.addon_lines             IS DISTINCT FROM OLD.addon_lines
  OR NEW.portal_seats_limit      IS DISTINCT FROM OLD.portal_seats_limit
  THEN
    RAISE EXCEPTION 'Your plan, add-ons and login allowance are set by OZZO. Please contact us to change them.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_account_commercial_columns ON public.accounts;
CREATE TRIGGER trg_guard_account_commercial_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_commercial_columns();
