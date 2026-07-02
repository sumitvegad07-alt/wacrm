-- ============================================================
-- MODULE ACTIVITIES (CHANGELOGS)
-- ============================================================

CREATE TABLE IF NOT EXISTS module_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  module_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL,
  message TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_module_activities_record ON module_activities(module_name, record_id);
CREATE INDEX IF NOT EXISTS idx_module_activities_account ON module_activities(account_id);

ALTER TABLE module_activities ENABLE ROW LEVEL SECURITY;

-- If account_id is null (e.g., tasks which might not have account_id?), 
-- wait, we should always try to set account_id.
-- Let's define policies that allow access if the user is in the account.
DROP POLICY IF EXISTS "Users can view activities in their account" ON public.module_activities;
DROP POLICY IF EXISTS "module_activities_select" ON public.module_activities;
CREATE POLICY "module_activities_select"
  ON public.module_activities FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Users can insert activities in their account" ON public.module_activities;
DROP POLICY IF EXISTS "module_activities_insert" ON public.module_activities;
CREATE POLICY "module_activities_insert"
  ON public.module_activities FOR INSERT
  WITH CHECK (is_account_member(account_id));
