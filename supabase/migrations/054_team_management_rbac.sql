-- ============================================================
-- 054_team_management_rbac.sql
-- Introduces dynamic Employee Roles (Business Roles) while keeping 
-- account_role (System Roles) for RLS. Augments profiles into 
-- Employees, and adds Mobile Device Security.
-- ============================================================

-- 1. Create employee_roles table (Business Roles)
CREATE TABLE IF NOT EXISTS employee_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_roles_account ON employee_roles(account_id);

ALTER TABLE employee_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_roles_select ON employee_roles FOR SELECT USING (is_account_member(account_id));
CREATE POLICY employee_roles_modify ON employee_roles FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

-- 2. Augment profiles table to act as Employees (combines System Role and Business Role)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS employee_code TEXT,
  ADD COLUMN IF NOT EXISTS mobile TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS designation TEXT,
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_role_id UUID REFERENCES employee_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  ADD COLUMN IF NOT EXISTS web_access BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mobile_access BOOLEAN NOT NULL DEFAULT true;

-- 3. Create employee_devices table for Mobile Security
CREATE TABLE IF NOT EXISTS employee_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT,
  device_model TEXT,
  os TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'inactive')),
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(profile_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_devices_profile ON employee_devices(profile_id);

ALTER TABLE employee_devices ENABLE ROW LEVEL SECURITY;

-- Agents can view their own devices to see if they are active/pending.
CREATE POLICY employee_devices_select ON employee_devices FOR SELECT USING (
  profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid() LIMIT 1) OR 
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = employee_devices.profile_id AND is_account_member(p.account_id, 'admin'))
);

-- Agents can insert their own device (it goes to pending if another is active).
CREATE POLICY employee_devices_insert ON employee_devices FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid() LIMIT 1) OR
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = employee_devices.profile_id AND is_account_member(p.account_id, 'admin'))
);

-- Only Admins can approve (update) devices or force logout (inactive).
CREATE POLICY employee_devices_update ON employee_devices FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = employee_devices.profile_id AND is_account_member(p.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = employee_devices.profile_id AND is_account_member(p.account_id, 'admin'))
);

CREATE POLICY employee_devices_delete ON employee_devices FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = employee_devices.profile_id AND is_account_member(p.account_id, 'admin'))
);

-- Backfill trigger: When updating employee_roles, update updated_at.
DROP TRIGGER IF EXISTS set_updated_at_employee_roles ON employee_roles;
CREATE TRIGGER set_updated_at_employee_roles BEFORE UPDATE ON employee_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_employee_devices ON employee_devices;
CREATE TRIGGER set_updated_at_employee_devices BEFORE UPDATE ON employee_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Backfill default Business Roles for existing accounts
DO $$
DECLARE
  acc RECORD;
  admin_role_id UUID;
  agent_role_id UUID;
BEGIN
  FOR acc IN SELECT id FROM accounts LOOP
    -- Avoid duplicate roles if re-running
    IF NOT EXISTS (SELECT 1 FROM employee_roles WHERE account_id = acc.id AND name = 'Admin') THEN
      -- Create Admin Role (All Access)
      INSERT INTO employee_roles (account_id, name, description, permissions)
      VALUES (acc.id, 'Admin', 'Full administrative access', '{"all": true}'::jsonb)
      RETURNING id INTO admin_role_id;
      
      UPDATE profiles SET employee_role_id = admin_role_id WHERE account_id = acc.id AND account_role IN ('owner', 'admin') AND employee_role_id IS NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM employee_roles WHERE account_id = acc.id AND name = 'Field Agent') THEN
      -- Create Field Agent Role (Limited Access)
      INSERT INTO employee_roles (account_id, name, description, permissions)
      VALUES (acc.id, 'Field Agent', 'Default field staff access', '{"location_tracking": {"view": true}, "leads": {"view": true, "add": true, "edit": true, "scope": "own"}}'::jsonb)
      RETURNING id INTO agent_role_id;

      UPDATE profiles SET employee_role_id = agent_role_id WHERE account_id = acc.id AND account_role = 'agent' AND employee_role_id IS NULL;
    END IF;
  END LOOP;
END $$;
