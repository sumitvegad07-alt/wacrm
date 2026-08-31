-- Signup plan from link
-- ---------------------------------------------------------------------------
-- Makes the account a new signup lands on depend on the plan encoded in the
-- signup link (?plan=CRM|WFA|CRM_WFA|SFA|CRM_SFA), rather than every signup
-- silently taking the CRM column default.
--
-- The signup page carries the plan into raw_user_meta_data.plan; this trigger
-- validates it, stores it on accounts.subscription_plan, and seeds
-- accounts.module_settings with that plan's default modules.
--
-- The line map and default-module rules below are a hand-mirror of
-- src/lib/plans/catalog.ts (PLAN_LINES, MODULE_LINE, DEFAULT_OFF,
-- defaultModuleSettings). Keep the two in sync: if catalog.ts changes which
-- lines a plan turns on or which modules ship on by default, update this too.
-- After the account exists, the app's own clampModuleSettings (server + client)
-- keeps enforcing the plan ceiling, so a stale value here can never over-grant.
--
-- An unknown / missing / tampered plan value falls back to CRM — the documented
-- default for a new signup. Existing accounts are untouched.

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
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_company_name := COALESCE(NEW.raw_user_meta_data->>'company_name', v_full_name);

  -- Parse sales_users as integer, ignore if null or invalid
  BEGIN
    v_sales_users := (NEW.raw_user_meta_data->>'sales_users')::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    v_sales_users := NULL;
  END;

  v_phone := NEW.raw_user_meta_data->>'phone';
  v_cust_id := generate_customer_id();

  -- Plan from the signup link. Validate against the 5 sellable plans; anything
  -- else (missing, legacy, tampered) falls back to CRM.
  v_plan := UPPER(COALESCE(NEW.raw_user_meta_data->>'plan', ''));
  IF v_plan NOT IN ('CRM', 'WFA', 'CRM_WFA', 'SFA', 'CRM_SFA') THEN
    v_plan := 'CRM';
  END IF;

  -- Product lines each plan turns on (mirror of PLAN_LINES). SFA includes WFA.
  v_crm := v_plan IN ('CRM', 'CRM_WFA', 'CRM_SFA');
  v_wfa := v_plan IN ('WFA', 'CRM_WFA', 'SFA', 'CRM_SFA');
  v_sfa := v_plan IN ('SFA', 'CRM_SFA');

  -- Default module_settings (mirror of defaultModuleSettings): every module
  -- whose line is on ships ON, except the DEFAULT_OFF opt-ins — route,
  -- reporting_hierarchy, scheme, stock — which ship OFF even when their line
  -- is on. The tenant admin can still switch those on later.
  v_modules := jsonb_build_object(
    'whatsapp',            v_crm,   -- CRM line
    'quotation',           v_crm,   -- CRM line
    'expense',             v_wfa,   -- WFA line
    'territory',           v_wfa,   -- WFA line
    'route',               false,   -- WFA line, DEFAULT_OFF
    'reporting_hierarchy', false,   -- WFA line, DEFAULT_OFF
    'dispatch',            v_sfa,   -- SFA line
    'pending_dispatch',    v_sfa,   -- SFA line
    'payment',             v_sfa,   -- SFA line
    'scheme',              false,   -- SFA line, DEFAULT_OFF
    'stock',               false    -- SFA line, DEFAULT_OFF
  );

  INSERT INTO public.accounts (
    name, owner_user_id, industry, customer_id, sales_users,
    subscription_plan, module_settings
  )
  VALUES (
    COALESCE(NULLIF(v_company_name, ''), NEW.email, 'My account'),
    NEW.id, 'General', v_cust_id, v_sales_users,
    v_plan, v_modules
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
