-- ============================================================
-- 100_account_customer_id.sql
-- Unique Auto-Generated Customer ID for Accounts
-- ============================================================

-- 1. Add customer_id column to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS customer_id TEXT UNIQUE;

-- 2. Create sequence for sequential Customer IDs starting at 1001
CREATE SEQUENCE IF NOT EXISTS account_customer_id_seq START WITH 1001;

-- 3. Function to generate formatted Customer ID (e.g. CUST-1001)
CREATE OR REPLACE FUNCTION generate_customer_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'CUST-' || lpad(nextval('account_customer_id_seq')::text, 4, '0');
END;
$$;

-- 4. Set DEFAULT on customer_id column
ALTER TABLE accounts ALTER COLUMN customer_id SET DEFAULT generate_customer_id();

-- 5. Backfill existing accounts that lack a customer_id
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM accounts WHERE customer_id IS NULL ORDER BY created_at ASC LOOP
    UPDATE accounts 
    SET customer_id = 'CUST-' || lpad(nextval('account_customer_id_seq')::text, 4, '0') 
    WHERE id = r.id;
  END LOOP;
END $$;

-- 6. Update handle_new_user trigger to include customer_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_industry TEXT;
  v_account_id UUID;
  v_cust_id TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_industry := NEW.raw_user_meta_data->>'industry';
  v_cust_id := generate_customer_id();

  INSERT INTO public.accounts (name, owner_user_id, industry, customer_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id, v_industry, v_cust_id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
