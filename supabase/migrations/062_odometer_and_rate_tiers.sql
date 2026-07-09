-- ============================================================
-- 062_odometer_and_rate_tiers.sql
-- Adds odometer capture and designation-based rate tiers
-- ============================================================

-- 1. Update tracking_sessions (Punch In/Out) to store odometer readings
ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS odometer_in_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS odometer_out_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS odometer_in_reading NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS odometer_out_reading NUMERIC(10,1);

-- 2. Add require_odometer setting to accounts
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS require_odometer BOOLEAN DEFAULT false;

-- 3. Add enable_rate_tiers to expense_types
ALTER TABLE expense_types
  ADD COLUMN IF NOT EXISTS enable_rate_tiers BOOLEAN DEFAULT false;

-- 4. Create expense_rate_tiers table
CREATE TABLE IF NOT EXISTS expense_rate_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_type_id UUID NOT NULL REFERENCES expense_types(id) ON DELETE CASCADE,
  -- Match criteria
  designation TEXT,                 
  employee_role_id UUID REFERENCES employee_roles(id) ON DELETE CASCADE,
  -- Rate overrides
  default_amount NUMERIC(12, 2) DEFAULT 0,
  rate_per_km NUMERIC(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Ensure unique overrides per type per role/designation
  CONSTRAINT expense_rate_tiers_designation_key UNIQUE(expense_type_id, designation),
  CONSTRAINT expense_rate_tiers_role_key UNIQUE(expense_type_id, employee_role_id)
);

-- RLS for expense_rate_tiers
ALTER TABLE expense_rate_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_rate_tiers_select ON expense_rate_tiers;
CREATE POLICY expense_rate_tiers_select ON expense_rate_tiers 
  FOR SELECT USING (
    expense_type_id IN (
      SELECT id FROM expense_types WHERE account_id IN (
        SELECT account_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS expense_rate_tiers_all ON expense_rate_tiers;
CREATE POLICY expense_rate_tiers_all ON expense_rate_tiers 
  FOR ALL USING (
    expense_type_id IN (
      SELECT id FROM expense_types WHERE account_id IN (
        SELECT account_id FROM profiles WHERE user_id = auth.uid() AND account_role = 'admin'
      )
    )
  ) WITH CHECK (
    expense_type_id IN (
      SELECT id FROM expense_types WHERE account_id IN (
        SELECT account_id FROM profiles WHERE user_id = auth.uid() AND account_role = 'admin'
      )
    )
  );

-- 5. Create Storage Bucket for Odometer Photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('odometer_photos', 'odometer_photos', false)
ON CONFLICT (id) DO NOTHING;

-- 6. Set up Storage RLS for odometer_photos
CREATE POLICY "Users can upload their own odometer photos" ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'odometer_photos' AND auth.uid() = owner);

CREATE POLICY "Users and admins can view odometer photos" ON storage.objects
FOR SELECT
USING (bucket_id = 'odometer_photos');
