-- Line-composed journeys: tag each step/milestone with the product line it
-- belongs to. The loader shows a step when line='core' OR the account's plan
-- grants that line. NULL line = always-applicable (deploy-safe: code shipped
-- before this migration behaves exactly like today).
ALTER TABLE impl_steps ADD COLUMN IF NOT EXISTS line text;
ALTER TABLE impl_milestones ADD COLUMN IF NOT EXISTS line text;

DO $$
DECLARE tpl uuid;
BEGIN
  SELECT id INTO tpl FROM impl_templates
   WHERE template_key = 'wfa_v1' AND is_active = true
   ORDER BY version DESC LIMIT 1;
  IF tpl IS NULL THEN RETURN; END IF;

  -- Shared across every plan.
  UPDATE impl_steps SET line = 'core'
   WHERE template_id = tpl AND step_key IN ('customer_creation','role_creation','employee_creation');
  -- Field-force specific.
  UPDATE impl_steps SET line = 'wfa'
   WHERE template_id = tpl AND step_key IN ('territory_setup','assignment_method','mobile_login','first_activity','see_live_data');

  UPDATE impl_milestones SET line = 'core' WHERE template_id = tpl AND milestone_key = 'm1_team_ready';
  UPDATE impl_milestones SET line = 'wfa'  WHERE template_id = tpl AND milestone_key IN ('m2_first_user','m3_tracking','m4_live');
END $$;
