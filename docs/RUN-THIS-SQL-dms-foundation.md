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
CREATE OR REPLACE FUNCTION public.enforce_portal_seat_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  -- Only a row turning access ON is interesting. Revoking, and every ordinary
  -- customer edit, costs nothing.
  IF NEW.portal_access IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.portal_access IS TRUE
     AND OLD.portal_access_revoked_at IS NULL THEN
    RETURN NEW;   -- already held a seat; not a new one
  END IF;

  IF NOT account_has_line(NEW.account_id, 'dms') THEN
    RAISE EXCEPTION 'This account does not have the DMS. Portal access cannot be given.';
  END IF;

  SELECT portal_seats_limit INTO v_limit
    FROM accounts WHERE id = NEW.account_id;
  v_used := portal_seats_used(NEW.account_id);

  IF v_used >= COALESCE(v_limit, 0) THEN
    RAISE EXCEPTION 'All % portal logins are in use. Remove access from another customer, or buy more.',
      COALESCE(v_limit, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_portal_seat_cap ON public.contacts;
CREATE TRIGGER trg_enforce_portal_seat_cap
  BEFORE INSERT OR UPDATE OF portal_access ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_portal_seat_cap();
```
