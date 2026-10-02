-- ============================================================
-- 20260929153000_fsm_signup_plans.sql
-- OZZO FSM Phase 1: teach handle_new_user() the three FSM plans.
-- Spec: docs/engineering/specifications/ozzo-fsm-phase-1-2-assets-and-jobs.md §3
--
-- WHY THIS EXISTS (it is not in the Phase 1 plan's 13 tasks):
-- Task 1 added FSM / CRM_FSM / SFA_FSM to src/lib/plans/catalog.ts, but the
-- signup path's plan is decided in SQL, by this trigger, from
-- raw_user_meta_data->>'plan' (the /signup?plan=XXX URL). Its allowlist did not
-- include the FSM plans, so an FSM signup link fell through to
-- `v_plan := 'CRM'` and SILENTLY created a CRM account. Two consequences:
--   1. No FSM tenant can be created at all, so none of the Phase 1 screens
--      (Tasks 7-12) can be opened — every /service route is gated on the fsm line.
--   2. At launch, a plan-tagged FSM signup link would sell FSM and provision CRM.
-- The repo already carries this warning: "keep SQL synced with catalog.ts".
--
-- Lines must match PLAN_LINES in catalog.ts exactly. FSM includes WFA, the same
-- way SFA does:
--   FSM      { crm:false, wfa:true,  sfa:false, fsm:true  }
--   CRM_FSM  { crm:true,  wfa:true,  sfa:false, fsm:true  }
--   SFA_FSM  { crm:false, wfa:true,  sfa:true,  fsm:true  }
--
-- The body below is the live function verbatim, with ONLY the plan allowlist,
-- the four line booleans and one module key changed. Nothing else is touched.
--
-- Idempotent: CREATE OR REPLACE. The trigger on auth.users is not redefined.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_full_name TEXT;
  v_company_name TEXT;
  v_sales_users INTEGER;
  v_phone TEXT;
  v_account_id UUID;
  v_cust_id TEXT;
  v_plan TEXT;
  v_crm BOOLEAN;
  v_wfa BOOLEAN;
  v_sfa BOOLEAN;
  v_fsm BOOLEAN;
  v_modules JSONB;
  v_account_name TEXT;
BEGIN
  -- Team-member provisioning: the admin route creates the login and then
  -- inserts the profile against the EXISTING account. Do not mint a new
  -- account/Customer ID here, or it is left orphaned.
  IF COALESCE(NEW.raw_user_meta_data->>'skip_account_provision', '') = 'true'
     OR NEW.raw_user_meta_data ? 'member_of_account' THEN
    RETURN NEW;
  END IF;

  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_company_name := COALESCE(NEW.raw_user_meta_data->>'company_name', v_full_name);

  BEGIN
    v_sales_users := (NEW.raw_user_meta_data->>'sales_users')::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    v_sales_users := NULL;
  END;

  v_phone := NEW.raw_user_meta_data->>'phone';
  v_cust_id := generate_customer_id();
  v_account_name := COALESCE(NULLIF(v_company_name, ''), NEW.email, 'My account');

  v_plan := UPPER(COALESCE(NEW.raw_user_meta_data->>'plan', ''));
  IF v_plan NOT IN ('CRM', 'WFA', 'CRM_WFA', 'SFA', 'CRM_SFA',
                    'FSM', 'CRM_FSM', 'SFA_FSM') THEN
    v_plan := 'CRM';
  END IF;

  v_crm := v_plan IN ('CRM', 'CRM_WFA', 'CRM_SFA', 'CRM_FSM');
  -- FSM includes WFA, exactly as SFA does.
  v_wfa := v_plan IN ('WFA', 'CRM_WFA', 'SFA', 'CRM_SFA',
                      'FSM', 'CRM_FSM', 'SFA_FSM');
  v_sfa := v_plan IN ('SFA', 'CRM_SFA', 'SFA_FSM');
  v_fsm := v_plan IN ('FSM', 'CRM_FSM', 'SFA_FSM');

  -- `service` is deliberately NOT in catalog.ts's DEFAULT_OFF: it is the core of
  -- what an FSM plan sells, not an opt-in extra. Note the web's ModuleSettings
  -- type does not carry `service` yet (Phase 1 Task 12 widens it and adds the
  -- toggle), so normalizeModuleSettings currently drops this key on read. Writing
  -- it now is harmless and means no backfill is needed later.
  v_modules := jsonb_build_object(
    'whatsapp',            v_crm,
    'quotation',           v_crm,
    'expense',             v_wfa,
    'territory',           v_wfa,
    'route',               false,
    'reporting_hierarchy', false,
    'dispatch',            v_sfa,
    'pending_dispatch',    v_sfa,
    'payment',             v_sfa,
    'scheme',              false,
    'stock',               false,
    'service',             v_fsm
  );

  INSERT INTO public.accounts (
    name, owner_user_id, industry, customer_id, sales_users,
    subscription_plan, module_settings,
    default_currency, subscription_status, subscription_expires_at,
    settings
  )
  VALUES (
    v_account_name,
    NEW.id, 'General', v_cust_id, v_sales_users,
    v_plan, v_modules,
    'INR', 'trialing', now() + interval '10 days',
    jsonb_build_object(
      'company_profile', jsonb_build_object(
        'name',                 v_account_name,
        'registered_email',     NEW.email,
        'registered_contact_no', COALESCE(v_phone, ''),
        'contact_person_name',  v_full_name
      )
    )
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role, phone)
  VALUES (
    NEW.id,
    v_full_name,
    NEW.email,
    v_account_id,
    'owner',
    v_phone
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
