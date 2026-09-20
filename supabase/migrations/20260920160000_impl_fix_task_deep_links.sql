-- Fix broken/mis-targeted Getting Started task deep-links (wfa_v1 template).
-- The template + its tasks are GLOBAL (no account_id), so this one UPDATE fixes
-- every tenant. Targeted by step_key + label so it's idempotent and precise.
DO $$
DECLARE
  tpl uuid;
BEGIN
  SELECT id INTO tpl FROM impl_templates
   WHERE template_key = 'wfa_v1' AND is_active = true
   ORDER BY version DESC LIMIT 1;
  IF tpl IS NULL THEN RETURN; END IF;

  -- See live data: /location-tracking has no root page (404) → the Overview page.
  UPDATE impl_step_tasks t SET deep_link = '/location-tracking/overview'
    FROM impl_steps s
   WHERE t.step_id = s.id AND s.template_id = tpl
     AND s.step_key = 'see_live_data' AND t.deep_link = '/location-tracking';

  -- Add employees: /team redirects to /team/roles → point straight at Employees.
  UPDATE impl_step_tasks t SET deep_link = '/team/employees'
    FROM impl_steps s
   WHERE t.step_id = s.id AND s.template_id = tpl
     AND s.step_key = 'employee_creation' AND t.label = 'Add employees' AND t.deep_link = '/team';

  -- Assign areas: /field-staff is a live monitor, not the assignment screen. Area
  -- (and route) assignment is on each employee's detail page, reached from the list.
  UPDATE impl_step_tasks t SET deep_link = '/team/employees'
    FROM impl_steps s
   WHERE t.step_id = s.id AND s.template_id = tpl
     AND s.step_key = 'employee_creation' AND t.label = 'Assign areas to employees' AND t.deep_link = '/field-staff';

  -- Create roles: /team → /team/roles (explicit, not via the redirect).
  UPDATE impl_step_tasks t SET deep_link = '/team/roles'
    FROM impl_steps s
   WHERE t.step_id = s.id AND s.template_id = tpl
     AND s.step_key = 'role_creation' AND t.label = 'Create roles' AND t.deep_link = '/team';
END $$;
