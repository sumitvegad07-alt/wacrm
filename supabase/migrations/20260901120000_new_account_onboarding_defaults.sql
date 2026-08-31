-- New-account onboarding defaults
-- ---------------------------------------------------------------------------
-- Extends handle_new_user so a fresh signup lands with the right defaults:
--   • subscription_plan + module_settings from the ?plan= link (unchanged from
--     20260831120000; carried forward here so this is the whole function).
--   • default_currency = 'INR'  (was the 'USD' column default).
--   • A 10-day trial: subscription_status = 'trialing',
--     subscription_expires_at = now() + 10 days. Expiry is already enforced in
--     the dashboard shell (Subscription Expired screen), so this is a real hard
--     stop — only a superadmin extends it via the billing screen.
--   • settings.company_profile prefilled from the signup fields, so the Company
--     Profile screen shows the registered contact number, email and name the
--     user typed at signup (previously the phone never reached it).
--
-- New default_currency column default flipped to 'INR' for new accounts. Existing
-- accounts are left untouched.

ALTER TABLE public.accounts ALTER COLUMN default_currency SET DEFAULT 'INR';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_modules JSONB;
  v_account_name TEXT;
BEGIN
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

  -- Plan from the signup link. Validate; anything else falls back to CRM.
  v_plan := UPPER(COALESCE(NEW.raw_user_meta_data->>'plan', ''));
  IF v_plan NOT IN ('CRM', 'WFA', 'CRM_WFA', 'SFA', 'CRM_SFA') THEN
    v_plan := 'CRM';
  END IF;

  -- Product lines (mirror of PLAN_LINES). SFA includes WFA.
  v_crm := v_plan IN ('CRM', 'CRM_WFA', 'CRM_SFA');
  v_wfa := v_plan IN ('WFA', 'CRM_WFA', 'SFA', 'CRM_SFA');
  v_sfa := v_plan IN ('SFA', 'CRM_SFA');

  -- Default module_settings (mirror of defaultModuleSettings): line on = module on,
  -- except DEFAULT_OFF opt-ins (route, reporting_hierarchy, scheme, stock).
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
    'stock',               false
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
    -- Prefill the Company Profile from the signup fields. The Company Profile
    -- screen reads settings.company_profile, so the registered contact number,
    -- email and name the user typed at signup show up there immediately.
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
$$;
