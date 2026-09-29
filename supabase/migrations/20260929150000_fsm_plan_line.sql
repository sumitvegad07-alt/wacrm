-- ============================================================
-- 20260929150000_fsm_plan_line.sql
-- OZZO FSM Phase 1: plan backstop only.
-- Spec: docs/engineering/specifications/ozzo-fsm-phase-1-2-assets-and-jobs.md
--
-- account_has_line must recognise the 'fsm' line. This replaces the body first
-- created in 20260907092613 (plan_entitlement_db_backstop); every existing case
-- is reproduced verbatim; the only changes are the three FSM plans and the else branch. FSM plans
-- include WFA, exactly as SFA does. Legacy / unknown / null plans keep their
-- existing access (see below). Mirrors wacrm-web/src/lib/plans/catalog.ts PLAN_LINES.
--
-- The original definition is NOT in supabase/migrations/; it lives in
-- tools/migration/01-schema.sql (line ~244) and in the 20260907092613
-- plan_entitlement_db_backstop migration recorded in tools/migration/05-migrations.sql.
-- language/volatility/security and `set search_path to ''` are kept verbatim
-- ('' is the stricter setting; the body is fully schema-qualified).
--
-- Legacy / unknown / null plans keep full access to crm/wfa/sfa but NOT fsm:
-- that line was invented after those tenants signed up, so it was never part of
-- their "full access" and must not switch FSM on for them.
--
-- Idempotent (CREATE OR REPLACE). Additive: no existing plan changes behaviour.
-- ============================================================

create or replace function public.account_has_line(p_account_id uuid, p_line text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case a.subscription_plan
    when 'CRM'     then (p_line = 'crm')
    when 'WFA'     then (p_line = 'wfa')
    when 'CRM_WFA' then (p_line in ('crm','wfa'))
    when 'SFA'     then (p_line in ('wfa','sfa'))
    when 'CRM_SFA' then (p_line in ('crm','wfa','sfa'))
    when 'FSM'     then (p_line in ('wfa','fsm'))
    when 'CRM_FSM' then (p_line in ('crm','wfa','fsm'))
    when 'SFA_FSM' then (p_line in ('wfa','sfa','fsm'))
    else (p_line <> 'fsm')  -- legacy / unknown / null => full access EXCEPT fsm (matches catalog.ts planLines)
  end
  from public.accounts a
  where a.id = p_account_id;
$$;

comment on function public.account_has_line(uuid, text) is
  'True if the account''s subscription plan grants the given product line (crm|wfa|sfa|fsm). Legacy/unknown plans => true, except fsm. Mirrors wacrm-web catalog.ts PLAN_LINES. Used as an RLS ceiling on line-specific INSERTs.';

grant execute on function public.account_has_line(uuid, text) to authenticated, anon;
