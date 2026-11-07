# Run this SQL — DMS add-on line and seat allowance

This adds two things to every account. One is a list of extra products that were
bought on top of the plan. The other is a number: how many customer portal
logins were bought. Both start empty, so nobody gets the DMS by accident. It
also teaches the plan check about the DMS. The DMS can only switch on when you
grant it to one account yourself. Old plans do not get it free. No account
changes behaviour until you grant it. The file is safe to run twice.

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
