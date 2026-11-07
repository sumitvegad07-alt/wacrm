# Run this SQL — DMS add-on line and seat allowance

This adds two new fields to every account. One lists extra products bought on
top of the plan. The other says how many customer logins were bought. It starts
at 0. Nobody gets the DMS until you switch it on for that account. Old plans do
not get it free. The file is safe to run twice.

Open Supabase → SQL Editor → paste the SQL below, Run.

Source file: `supabase/migrations/20261107120000_dms_addon_line_and_seats.sql`

```sql
-- ============================================================
-- DMS as an ADD-ON line, plus the seat allowance.
--
-- WHY NOT A PLAN CODE. account_has_line ends with
--   else (p_line is distinct from 'fsm')
-- so an unknown or legacy subscription_plan is granted every line except FSM.
-- Account 001001 is a legacy Enterprise plan. Had 'dms' been an ordinary line,
-- every existing tenant would have been given the DMS free on the day this ran.
-- FSM is already carved out of that fallback for exactly this reason.
--
-- It also keeps the eight sellable plan codes at eight: "CRM + SFA + DMS" is a
-- plan plus an add-on, not a ninth code.
--
-- Mirrors wacrm-web src/lib/plans/catalog.ts ADDON_LINES.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS addon_lines        text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS portal_seats_limit integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.accounts.addon_lines IS
  'Separately sold product lines, granted per account by the superadmin only. '
  'Currently just dms. NEVER derived from subscription_plan.';
COMMENT ON COLUMN public.accounts.portal_seats_limit IS
  'How many customer portal logins this account has bought. 0 = not bought.';

-- Only ever an add-on we actually sell.
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_addon_lines_known;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_addon_lines_known
  CHECK (addon_lines <@ ARRAY['dms']::text[]);

-- ── account_has_line: dms answered from addon_lines, and ONLY from there ──
CREATE OR REPLACE FUNCTION public.account_has_line(p_account_id uuid, p_line text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select case
    when p_line = 'dms' then ('dms' = any(a.addon_lines))
    else case a.subscription_plan
      when 'CRM'     then (p_line = 'crm')
      when 'WFA'     then (p_line = 'wfa')
      when 'CRM_WFA' then (p_line in ('crm','wfa'))
      when 'SFA'     then (p_line in ('wfa','sfa'))
      when 'CRM_SFA' then (p_line in ('crm','wfa','sfa'))
      when 'FSM'     then (p_line in ('wfa','fsm'))
      when 'CRM_FSM' then (p_line in ('crm','wfa','fsm'))
      when 'SFA_FSM' then (p_line in ('wfa','sfa','fsm'))
      -- legacy / unknown / null => full access EXCEPT fsm. 'dms' never reaches
      -- here, so the add-on cannot be inherited by a legacy plan.
      else (p_line is distinct from 'fsm')
    end
  end
  from public.accounts a
  where a.id = p_account_id;
$$;

COMMENT ON FUNCTION public.account_has_line(uuid, text) IS
  'True if the account has the given product line. crm|wfa|sfa|fsm come from '
  'subscription_plan (legacy/unknown => all but fsm). dms comes ONLY from '
  'addon_lines and is never inherited. Mirrors catalog.ts.';

GRANT EXECUTE ON FUNCTION public.account_has_line(uuid, text) TO authenticated, anon;
```

---

# Run this SQL second — customer logins and the seat limit

Run this after the first one. It lets a customer have a login to the DMS. The
login is kept on the customer, not in the staff list, so no staff screen or
report changes. It also stops anyone giving out more logins than were bought,
and stops any login on an account that has no DMS. This is checked in the
database itself, so the form cannot be skipped. One limit to know: if an
account has customer levels switched on, a customer with no level cannot be
given a login until you set their level. Nothing changes for any account until
you switch the DMS on for it. The file is safe to run twice.

Open Supabase → SQL Editor → paste the SQL below, Run.

Source file: `supabase/migrations/20261107130000_portal_identity_and_seats.sql`

```sql
-- ============================================================
-- Portal identity on the CUSTOMER, and a seat cap the form cannot talk its
-- way past.
--
-- A PORTAL CUSTOMER IS NOT A PROFILE. profiles is the employee table in all
-- but name (account_role, employee_role_id, web_access), and 107 web files
-- plus 56 database functions read it. Putting a distributor there means all
-- 163 sites must start asking "employee, or customer with a login?", and the
-- first one missed puts a distributor in a headcount or an incentive run.
-- So a portal customer is an auth.users row and nothing else, pointed at from
-- here. Zero existing queries change.
--
--
-- KNOWN LIMITATION (observed on the test cluster, see task-3-report.md):
-- migration 076's trg_enforce_contact_hierarchy_level refuses ANY update to a
-- customer with no hierarchy_level while order hierarchy is on. Granting portal
-- access is such an update, so on an FMCG tenant a level-less customer cannot
-- be given a login until a level is set. 076 is deliberately not weakened here.
--
-- handle_new_user needs NO change: it already returns immediately when the
-- metadata carries skip_account_provision='true', and on that path inserts no
-- profiles row either.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS portal_user_id           uuid        NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS portal_email             text        NULL,
  ADD COLUMN IF NOT EXISTS portal_access            boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_access_revoked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS portal_access_set_by     uuid        NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS portal_access_set_at     timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_portal_email_idx
  ON public.contacts (account_id, lower(portal_email))
  WHERE portal_email IS NOT NULL;

-- Answers "which customer is this login?" in one index hit. Plan 2's resolver
-- runs this lookup on every portal request.
CREATE INDEX IF NOT EXISTS contacts_portal_user_idx
  ON public.contacts (portal_user_id)
  WHERE portal_user_id IS NOT NULL;

-- ── Seats ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_seats_used(p_account_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select count(*)::integer
    from public.contacts c
   where c.account_id = p_account_id
     and c.portal_user_id is not null
     and c.portal_access
     and c.portal_access_revoked_at is null;
$$;

GRANT EXECUTE ON FUNCTION public.portal_seats_used(uuid) TO authenticated, service_role;

-- Enforced here and not only in the API route, because a cap that lives in a
-- form is a suggestion. This is what someone calling PostgREST directly hits.
--
-- A seat is "held" exactly when portal_user_id is set, portal_access is true
-- and portal_access_revoked_at is null: the same test portal_seats_used counts.
-- This trigger keeps every write consistent with that test, so the count cannot
-- drift no matter which column a writer touches:
--   * turning a seat ON (including re-granting a revoked one) passes the
--     add-on check and the cap, then clears portal_access_revoked_at, so the
--     seat is counted;
--   * stamping revoked_at on a held seat also switches portal_access off, so
--     a row never reads "access on" while not being counted;
--   * the grants are serialised per account, so two at once cannot both take
--     the last seat.
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

  -- Revoking, and every ordinary customer edit, costs nothing.
  IF NEW.portal_access IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF v_was_held THEN
    -- Already held a seat; not a new one. Leave every column as the writer
    -- set it, except that a revoked_at stamp means "revoked".
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
    RAISE EXCEPTION 'All % portal logins are in use. Remove access from another customer, or buy more.',
      COALESCE(v_limit, 0);
  END IF;

  -- A new (or re-granted) seat must be counted. Done only after every check
  -- has passed, so a refused grant changes nothing.
  NEW.portal_access_revoked_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_portal_seat_cap ON public.contacts;
CREATE TRIGGER trg_enforce_portal_seat_cap
  BEFORE INSERT OR UPDATE OF portal_access, portal_access_revoked_at, portal_user_id, account_id
  ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_seat_cap();
```

---

# Run this SQL third — mark orders placed through the portal

Run this after the second one. It adds one new box to each order. The box says
which customer placed the order through the portal. Staff orders leave it empty.
If that customer is later deleted, the order stays and the box goes empty again.
It starts empty for every order, so nothing changes for old orders. The file is
safe to run twice.

Open Supabase → SQL Editor → paste the SQL below, Run.

Source file: `supabase/migrations/20261107140000_order_placed_via_portal.sql`

```sql
-- ============================================================
-- Where a portal order came from.
--
-- The Orders list resolves the salesman by looking orders.user_id up in
-- profiles IN THE BROWSER. A portal customer has no profiles row, so without
-- this column a portal order shows a blank salesman — not broken, just
-- mysterious, and mysterious is how a number stops being trusted.
--
-- Written by portal_place_order in Plan 3. Read by the Orders list now.
--
-- ON DELETE SET NULL: an order must outlive the customer who placed it. The
-- sibling column orders.contact_id already does this (068_orders_module.sql).
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS placed_by_portal_contact_id uuid NULL
    REFERENCES public.contacts(id) ON DELETE SET NULL;

-- ADD COLUMN IF NOT EXISTS does not change an existing column, so a re-run (or
-- a database that already has the first version of this file) keeps the old
-- NO ACTION constraint. Drop whatever foreign key sits on this column, found by
-- lookup rather than by guessing its generated name, then re-add it by name.
-- Re-running the file drops and re-adds the same constraint, so it ends in the
-- same state.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.orders'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.contacts'::regclass
       AND c.conkey = ARRAY(
             SELECT a.attnum FROM pg_attribute a
              WHERE a.attrelid = 'public.orders'::regclass
                AND a.attname = 'placed_by_portal_contact_id')
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_placed_by_portal_contact_id_fkey
    FOREIGN KEY (placed_by_portal_contact_id)
    REFERENCES public.contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.placed_by_portal_contact_id IS
  'The customer who placed this order through the DMS portal. NULL means a '
  'member of staff placed it. Drives the "Placed via" column. If the customer '
  'is deleted, the order survives and this goes back to NULL (ON DELETE SET NULL).';

-- The account-scoped index serves the Orders list. It leads with account_id, so
-- it cannot serve a lookup on this column alone, which is what a contact
-- delete needs to find referencing orders. This index serves that path.
CREATE INDEX IF NOT EXISTS orders_placed_by_portal_idx
  ON public.orders (account_id, placed_by_portal_contact_id)
  WHERE placed_by_portal_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_placed_by_portal_contact_fk_idx
  ON public.orders (placed_by_portal_contact_id)
  WHERE placed_by_portal_contact_id IS NOT NULL;
```

---

# Run this SQL fourth — stop customers editing their own plan

Run this after the third one. It closes a hole that is live today. Right now an
admin at any customer company can change their own plan, add-ons, login
allowance, number of paid users and expiry date. They only need to send one
request to the database. This SQL adds a small lock (called a "trigger") on the
accounts table. The lock refuses those changes. The customer sees: "Your plan,
add-ons and login allowance are set by OZZO. Please contact us to change them."

Your own admin panel is not affected. The panel saves with a private key that
only the server holds (the "service key"). The lock lets that key through. You
can still change any plan, status, expiry date or seats from your panel.
Customers can still rename their company and switch their own modules on and
off. Signing up a new company is not affected.

After you run this, test it. Open your admin panel and change one company's
expiry date. If it saves, this is working. If it does not, switch the lock off
with this one line, then tell me:

`DROP TRIGGER trg_guard_account_commercial_columns ON public.accounts;`

Open Supabase → SQL Editor → paste the SQL below, Run. The file is safe to run
twice.

Source file: `supabase/migrations/20261107150000_accounts_commercial_columns_guard.sql`

```sql
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
-- columns, plus user_count (the paid user-seat limit the app enforces in code)
-- and addons, from 039_account_addons_and_users.sql, which were open the same way, when the write comes from an end-user API role.
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
  -- Cheapest test first: nothing commercial changed, nothing to guard. This
  -- keeps the role check and the is_superadmin() query off every ordinary
  -- tenant save (name, settings, module_settings), and means a mistake in the
  -- role handling below can only ever affect a write that really changes one
  -- of these columns.
  IF NOT (   NEW.subscription_plan       IS DISTINCT FROM OLD.subscription_plan
          OR NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
          OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
          OR NEW.addon_lines             IS DISTINCT FROM OLD.addon_lines
          OR NEW.portal_seats_limit      IS DISTINCT FROM OLD.portal_seats_limit
          OR NEW.user_count              IS DISTINCT FROM OLD.user_count
          OR NEW.addons                  IS DISTINCT FROM OLD.addons) THEN
    RETURN NEW;
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

DROP TRIGGER IF EXISTS trg_guard_account_commercial_columns ON public.accounts;
CREATE TRIGGER trg_guard_account_commercial_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_commercial_columns();

ALTER FUNCTION public.guard_account_commercial_columns() OWNER TO postgres;
```

---

# Run this SQL fifth — hide one company's portal login count from another

Run this after the fourth one. It stops one company's staff being able to see another company's portal login count. Before this, any signed-in person could ask for any company's number. Now they get 0 unless they work for that company. Your own screens and the superadmin panel still see the real number. The file is safe to run twice.

Open Supabase → SQL Editor → paste the SQL below, Run.

Source file: `supabase/migrations/20261107160000_portal_seats_used_tenant_guard.sql`

```sql
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
```
