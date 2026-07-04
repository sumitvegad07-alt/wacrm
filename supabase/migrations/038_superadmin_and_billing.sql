-- ============================================================
-- 038_superadmin_and_billing.sql
-- ============================================================

-- 1. Add superadmin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false;

-- 2. Add billing & industry fields to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active' CHECK (subscription_status IN ('active', 'expired', 'deactivated', 'trialing'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'Free';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_provisioned BOOLEAN DEFAULT false;

-- 3. Superadmin Helper Function
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_superadmin = true
  );
$$;

ALTER FUNCTION is_superadmin() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_superadmin() TO authenticated, service_role;

-- 4. Update Accounts Policies to allow superadmins
DROP POLICY IF EXISTS accounts_select ON accounts;
DROP POLICY IF EXISTS accounts_update ON accounts;

CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (is_account_member(id) OR is_superadmin());

CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (is_account_member(id, 'admin') OR is_superadmin())
  WITH CHECK (is_account_member(id, 'admin') OR is_superadmin());

-- 5. Modify Signup Trigger to capture industry
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
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_industry := NEW.raw_user_meta_data->>'industry';

  INSERT INTO public.accounts (name, owner_user_id, industry)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id, v_industry)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
