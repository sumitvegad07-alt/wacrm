-- Alter tenant_announcements to support multiple employees and roles
ALTER TABLE public.tenant_announcements
DROP COLUMN IF EXISTS send_to_sales_app,
DROP COLUMN IF EXISTS employee_id,
DROP COLUMN IF EXISTS employee_role_id,
ADD COLUMN IF NOT EXISTS employee_ids UUID[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS employee_role_ids UUID[] DEFAULT '{}';

-- Re-create the index for performance (using GIN for array columns)
CREATE INDEX IF NOT EXISTS idx_tenant_announcements_employee_ids ON public.tenant_announcements USING GIN (employee_ids);
CREATE INDEX IF NOT EXISTS idx_tenant_announcements_role_ids ON public.tenant_announcements USING GIN (employee_role_ids);

-- Update RLS to enforce targeting rules for viewing
DROP POLICY IF EXISTS "Members can view tenant announcements" ON public.tenant_announcements;

CREATE POLICY "Members can view targeted announcements"
  ON public.tenant_announcements
  FOR SELECT
  USING (
    is_account_member(account_id) 
    AND (
      -- If both arrays are empty, it's visible to everyone in the account
      (cardinality(employee_ids) = 0 AND cardinality(employee_role_ids) = 0)
      OR
      -- Or if the current user's profile ID is in the employee_ids array
      (SELECT id FROM profiles WHERE user_id = auth.uid() AND account_id = tenant_announcements.account_id) = ANY(employee_ids)
      OR
      -- Or if the current user's role ID is in the employee_role_ids array
      (SELECT employee_role_id FROM profiles WHERE user_id = auth.uid() AND account_id = tenant_announcements.account_id) = ANY(employee_role_ids)
    )
  );
