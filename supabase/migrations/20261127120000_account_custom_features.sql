-- ============================================================
-- Per-client custom features — accounts.custom_features.
--
-- WHY. A client asks for something we will not give every tenant: an extra
-- screen, an extra report, a different rule. The answer must never be a second
-- app, a second portal, a side-loaded APK or a branch of the code — on iOS
-- there is no way to hand a paying client an app outside the App Store, and a
-- second build is a second review and a second bug for every release, forever.
-- So the behaviour ships in the same build, OFF for everyone, and this column
-- says who it is ON for.
--
-- The catalogue of keys lives in CODE (src/lib/plans/custom-features.ts),
-- because a switch with no code behind it does nothing. Only the GRANT is data,
-- because who holds it changes without a deploy. That is the whole point.
--
-- NOT module_settings: a tenant admin may toggle those themselves. NOT a plan
-- line: a plan is sold to everyone. This is the same shape as addon_lines
-- (text[], granted only by OZZO), and for the same reason.
--
-- ── The five questions (docs/engineering/WORKING-AGREEMENT.md) ──
--
-- 1. A SECOND FOREIGN KEY between two tables?
--    No. No foreign key at all: one text[] column on accounts. Nothing can
--    repeat what accounts.parent_contact_id did to orders -> contacts.
--
-- 2. Does a touched column appear in a .select() string (BOTH repos grepped)?
--    The column is NEW, so no existing select string changes meaning. Added
--    deliberately in two places: ACCOUNT_COLUMNS_LATEST (web, a LADDER that
--    steps down one rung per migration so a database without this column keeps
--    addon_lines and does not lose the live DMS), and the mobile entitlement
--    read, which falls back to its old column list on 42703. The superadmin
--    route's select("*") picks it up with no change.
--
-- 3. A new trigger, policy or constraint on a written table?
--    Yes — guard_account_commercial_columns() (20261107150000) is extended to
--    cover this column, so a tenant admin cannot grant themselves a feature
--    they were never sold. Exercised by supabase/tests/88_custom_features.sql.
--    No new POLICY: reading your own account row is already allowed, and a
--    client seeing the list of what OZZO switched on for them is fine.
--    No CHECK constraint: a CHECK may not contain a subquery and array_to_string
--    is only STABLE, so key shape is validated in the trigger instead — where it
--    also catches a hand-typed key pasted into the SQL editor.
--
-- 4. Can an existing row fail the new rule?
--    No. The column is NOT NULL DEFAULT '{}', so every existing account gets an
--    empty array, and the trigger only fires on a row whose value CHANGES.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing. '{}' means every custom gate reads false, which is exactly what
--    every screen does today. There is no custom feature in the catalogue yet,
--    so this migration changes no behaviour for anybody — it only makes the
--    next one possible without a second app.
-- ============================================================

-- ── The column ───────────────────────────────────────────────
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS custom_features text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.accounts.custom_features IS
  'Per-client feature keys granted by OZZO only. Catalogue: src/lib/plans/custom-features.ts. Granted from /admin/companies/[id]; the guard trigger refuses this column from a tenant session.';

-- ── The guard ────────────────────────────────────────────────
-- Replaces 20261107150000's function, adding custom_features to the commercial
-- set and validating key shape. Everything else is unchanged and the comments
-- there still explain why current_setting('role') is the only usable test.
CREATE OR REPLACE FUNCTION public.guard_account_commercial_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  bad_key text;
BEGIN
  -- Cheapest test first: nothing commercial changed, nothing to guard. Keeps
  -- the role check and is_superadmin() off every ordinary tenant save (name,
  -- settings, module_settings).
  IF NOT (   NEW.subscription_plan       IS DISTINCT FROM OLD.subscription_plan
          OR NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
          OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
          OR NEW.addon_lines             IS DISTINCT FROM OLD.addon_lines
          OR NEW.portal_seats_limit      IS DISTINCT FROM OLD.portal_seats_limit
          OR NEW.user_count              IS DISTINCT FROM OLD.user_count
          OR NEW.addons                  IS DISTINCT FROM OLD.addons
          OR NEW.custom_features         IS DISTINCT FROM OLD.custom_features) THEN
    RETURN NEW;
  END IF;

  -- Key shape, for EVERY writer including the service role and the SQL editor.
  -- A key is an identifier the code matches exactly; a stray space, capital or
  -- empty string grants nothing and is invisible on the screen, so it is
  -- refused at the door rather than stored and wondered about later.
  IF NEW.custom_features IS DISTINCT FROM OLD.custom_features
     AND NEW.custom_features IS NOT NULL THEN
    SELECT k INTO bad_key
      FROM unnest(NEW.custom_features) AS k
     WHERE k IS NULL OR k !~ '^[a-z][a-z0-9_]*$'
     LIMIT 1;
    IF bad_key IS NOT NULL OR array_position(NEW.custom_features, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'Not a custom feature key: %. Keys are lower_snake_case, from src/lib/plans/custom-features.ts.',
        coalesce(bad_key, '(null)')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Not an end-user API role: service role, SQL editor, migrations, DBA.
  IF coalesce(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A platform superadmin signed in with an ordinary user session.
  IF to_regprocedure('public.is_superadmin()') IS NOT NULL
     AND public.is_superadmin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Your plan, add-ons and login allowance are set by OZZO. Please contact us to change them.'
    USING ERRCODE = 'insufficient_privilege';
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_account_commercial_columns() OWNER TO postgres;

-- The trigger itself is unchanged (BEFORE UPDATE, FOR EACH ROW) but is
-- recreated so this file can be applied to a database that somehow lost it.
DROP TRIGGER IF EXISTS trg_guard_account_commercial_columns ON public.accounts;
CREATE TRIGGER trg_guard_account_commercial_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_commercial_columns();

-- ── Asking the question in SQL ───────────────────────────────
-- For a future RLS policy or definer function that has to honour a per-client
-- feature. Mirrors account_has_line(). SECURITY DEFINER so a policy on another
-- table can call it without granting the caller a read of accounts, and STABLE
-- so it is evaluated once per statement rather than once per row.
CREATE OR REPLACE FUNCTION public.account_has_custom_feature(p_account_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select coalesce(
           (select p_key = any(a.custom_features)
              from public.accounts a
             where a.id = p_account_id),
           false);
$$;

ALTER FUNCTION public.account_has_custom_feature(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.account_has_custom_feature(uuid, text)
  TO authenticated, service_role;

-- ── The DMS portal's own read ────────────────────────────────
-- The distributor portal (dms.ozzo.co.in) holds SELECT on no table and speaks
-- only to portal_* functions, so it cannot read accounts even for its own
-- tenant. This hands it the list for the account it is signed in to.
--
-- A NEW function rather than another key inside portal_me(): portal_me is on
-- the path of every portal screen, and replacing a live function to add a
-- field it nobody needs yet is a risk with no return. Called only by a screen
-- that actually has a custom feature to honour.
CREATE OR REPLACE FUNCTION public.portal_custom_features()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select coalesce(a.custom_features, '{}'::text[])
    from public.portal_caller() pc
    join public.accounts a on a.id = pc.account_id;
$$;

ALTER FUNCTION public.portal_custom_features() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_custom_features() TO authenticated, service_role;

-- ROLLBACK (nothing in the product reads this column yet, so it is safe):
--   DROP FUNCTION IF EXISTS public.portal_custom_features();
--   DROP FUNCTION IF EXISTS public.account_has_custom_feature(uuid, text);
--   ALTER TABLE public.accounts DROP COLUMN IF EXISTS custom_features;
--   -- then re-apply 20261107150000 to restore the previous guard body.
