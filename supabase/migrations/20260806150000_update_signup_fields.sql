-- Migration 116: Update signup fields
-- Adds sales_users to accounts, phone to profiles
-- Updates handle_new_user to capture these fields and remove industry dependency

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sales_users INTEGER;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;

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

  INSERT INTO public.accounts (name, owner_user_id, industry, customer_id, sales_users)
  VALUES (COALESCE(NULLIF(v_company_name, ''), NEW.email, 'My account'), NEW.id, 'General', v_cust_id, v_sales_users)
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
