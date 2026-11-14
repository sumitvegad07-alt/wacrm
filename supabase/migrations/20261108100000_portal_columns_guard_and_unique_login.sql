-- ============================================================
-- Two holes Plan 1's final review left open, and one wrong sentence.
--
-- 1. ONE LOGIN, ONE CUSTOMER. contacts.portal_user_id had no unique index, so
--    two customers could carry the same login. Plan 2's visibility resolver
--    walks DOWN the customer tree from "the customer this login is", so two
--    roots would merge two unrelated distributors' sub-trees into one view —
--    a leak inside a tenant, caused by an admin mistake rather than an attack.
--
-- 2. THE DISPLAYED LOGIN COULD BE REWRITTEN. contacts_update is a ROW policy,
--    and PostgreSQL row policies cannot restrict COLUMNS. The portal-access
--    API route writes the six portal_* columns with the SERVICE-ROLE key
--    (src/app/api/portal-access/route.ts), so no legitimate end-user write
--    touches them. But a tenant admin could PATCH their own customer through
--    the API and change portal_email, while sign-in still uses the real
--    auth.users address: the customer page would show one login and the
--    distributor would use another, with nothing to explain the difference.
--    The same door let an admin point portal_user_id at any auth user,
--    including another tenant's.
--
-- 3. "All 1 portal logins are in use." The seat trigger's sentence does not
--    bend for a count of one. The TypeScript copies were fixed in 9527d24
--    (src/lib/admin/portal-login-text.ts); this is the database's own.
--
-- WHO IS EXEMPT, AND WHY IT IS SAFE. Identical construction to
-- guard_account_commercial_columns (20261107150000): the guard applies only
-- when current_setting('role') is 'authenticated' or 'anon', which are the only
-- roles a client request can arrive on. Inside a SECURITY DEFINER function
-- current_user is the owner and session_user is `authenticator` for BOTH a user
-- and the service role; the `role` GUC is the only one that discriminates, and
-- SECURITY DEFINER does not change it.
--
-- WHY THE COMPARISON COMES FIRST. contacts is the busiest table in the product,
-- and on 2026-11-04 a guard on it refused an unrelated write and took the order
-- save down with it. Comparing the six columns before anything else means a
-- mistake in the role handling below can only ever affect a write that really
-- changes a portal column — an ordinary name or address edit, the outstanding
-- recalculation, the area-parent sync, the customer-code trigger and the
-- territory denormalisation all return at the first IF.
--
-- If this ever blocks something it should not:
--   DROP TRIGGER trg_guard_contact_portal_columns ON public.contacts;
-- ============================================================

-- ── 1. One login, one customer ───────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS contacts_portal_user_unique_idx
  ON public.contacts (portal_user_id)
  WHERE portal_user_id IS NOT NULL;

-- The plain lookup index from 20261107130000 is now redundant: this unique
-- index serves the same "which customer is this login?" probe. Dropped so the
-- table does not carry two indexes on one column.
DROP INDEX IF EXISTS public.contacts_portal_user_idx;

-- ── 2. The six portal columns are set by the portal-access route only ──
CREATE OR REPLACE FUNCTION public.guard_contact_portal_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  -- Cheapest test first. Nothing about the login changed, so there is nothing
  -- to guard, and every ordinary write to this very busy table leaves here.
  IF TG_OP = 'UPDATE' AND NOT (
         NEW.portal_user_id           IS DISTINCT FROM OLD.portal_user_id
      OR NEW.portal_email             IS DISTINCT FROM OLD.portal_email
      OR NEW.portal_access            IS DISTINCT FROM OLD.portal_access
      OR NEW.portal_access_revoked_at IS DISTINCT FROM OLD.portal_access_revoked_at
      OR NEW.portal_access_set_by     IS DISTINCT FROM OLD.portal_access_set_by
      OR NEW.portal_access_set_at     IS DISTINCT FROM OLD.portal_access_set_at) THEN
    RETURN NEW;
  END IF;

  -- An INSERT that mentions none of them is an ordinary new customer. All six
  -- default to NULL except portal_access, which is NOT NULL DEFAULT false.
  IF TG_OP = 'INSERT'
     AND NEW.portal_user_id IS NULL
     AND NEW.portal_email IS NULL
     AND NEW.portal_access IS NOT TRUE
     AND NEW.portal_access_revoked_at IS NULL
     AND NEW.portal_access_set_by IS NULL
     AND NEW.portal_access_set_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Not an end-user API role: the service role (which is what the
  -- portal-access route uses), the SQL editor, a migration, a DBA.
  IF coalesce(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A platform superadmin signed in as an ordinary user.
  IF to_regprocedure('public.is_superadmin()') IS NOT NULL
     AND public.is_superadmin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Portal logins are changed on the customer page, not directly. Use Provide DMS Access.'
    USING ERRCODE = 'insufficient_privilege';
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_contact_portal_columns() OWNER TO postgres;

-- Named so it sorts AFTER trg_enforce_portal_seat_cap ('e' < 'g'): the seat
-- trigger may clear portal_access_revoked_at itself, and this guard must judge
-- the record as it will actually be written.
DROP TRIGGER IF EXISTS trg_guard_contact_portal_columns ON public.contacts;
CREATE TRIGGER trg_guard_contact_portal_columns
  BEFORE INSERT OR UPDATE OF
    portal_user_id, portal_email, portal_access,
    portal_access_revoked_at, portal_access_set_by, portal_access_set_at
  ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_contact_portal_columns();

-- ── 3. "All 1 portal logins are in use." ─────────────────────
-- Byte-identical to 20261107130000 except the RAISE. Reproduced in full rather
-- than patched, because CREATE OR REPLACE replaces the whole body.
CREATE OR REPLACE FUNCTION public.enforce_portal_seat_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_limit    integer;
  v_used     integer;
  v_was_held boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_was_held := OLD.portal_user_id IS NOT NULL
              AND OLD.portal_access IS TRUE
              AND OLD.portal_access_revoked_at IS NULL
              AND OLD.account_id = NEW.account_id;
  END IF;

  IF NEW.portal_access IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF v_was_held THEN
    IF NEW.portal_access_revoked_at IS NOT NULL THEN
      NEW.portal_access := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT account_has_line(NEW.account_id, 'dms') THEN
    RAISE EXCEPTION 'This account does not have the DMS. Portal access cannot be given.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text, 0));

  SELECT portal_seats_limit INTO v_limit
    FROM accounts WHERE id = NEW.account_id;
  v_used := portal_seats_used(NEW.account_id);

  IF v_used >= COALESCE(v_limit, 0) THEN
    IF COALESCE(v_limit, 0) = 1 THEN
      RAISE EXCEPTION 'The only portal login is in use. Remove access from another customer, or buy more.';
    ELSE
      RAISE EXCEPTION 'All % portal logins are in use. Remove access from another customer, or buy more.',
        COALESCE(v_limit, 0);
    END IF;
  END IF;

  NEW.portal_access_revoked_at := NULL;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_portal_seat_cap() OWNER TO postgres;
