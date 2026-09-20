-- Seed: WFA v1 "Getting Started" template. Idempotent via ON CONFLICT on natural keys.
-- Spec: docs/superpowers/specs/2026-09-20-implementation-center-design.md
DO $$
DECLARE
  tpl uuid;
  s_disc uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid; s8 uuid;
BEGIN
  INSERT INTO impl_templates (product_line, template_key, version, name, display_name, description, estimated_minutes, support_whatsapp_url, is_active)
  VALUES ('wfa','wfa_v1',1,'WFA v1','Getting Started with Field Force',
          'Set up your team, territories and first field activity — no support call needed.',
          25,'https://wa.me/919000000000?text=I%20need%20help%20with%20OZZO%20setup', true)
  ON CONFLICT (template_key, version) DO UPDATE SET display_name=EXCLUDED.display_name
  RETURNING id INTO tpl;

  -- Discovery (optional, light for WFA)
  INSERT INTO impl_steps (template_id, position, step_key, step_type, title, description, quick_steps, help_text, estimated_minutes, is_optional, auto_complete, weight)
  VALUES (tpl,0,'discovery','discovery','Tell us about your team',
          'A couple of quick questions so we can tailor your setup.',
          '["Pick your industry","Pick your team size"]'::jsonb,'This helps us recommend the right defaults.',2,true,true,0.5)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s_disc;
  INSERT INTO impl_step_questions (step_id, position, question_key, label, input_type, options, required) VALUES
    (s_disc,0,'industry','Which industry are you in?','single_select',
     '[{"value":"fmcg","label":"FMCG / Distribution"},{"value":"pharma","label":"Pharma"},{"value":"services","label":"Services"},{"value":"other","label":"Other"}]'::jsonb,false),
    (s_disc,1,'team_size','How large is your field team?','single_select',
     '[{"value":"1_5","label":"1–5"},{"value":"6_20","label":"6–20"},{"value":"21_50","label":"21–50"},{"value":"50_plus","label":"50+"}]'::jsonb,false)
  ON CONFLICT (step_id, question_key) DO NOTHING;

  -- Step 1 Territory
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,1,'territory_setup','Set up your territories',
          'Create the geographic areas your team will cover.',
          '["Open Territories","Add each area / city / zone","Save"]'::jsonb,'Territories are how customers get grouped and assigned.',4,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s1;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (s1,0,'Create your territories','/territories') ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (s1,'territory_count','gt',0,5,1,'and');

  -- Step 2 Assignment method (question + OZZO tips + branching)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,2,'assignment_method','Choose how you assign customers',
          'Decide whether reps get customers by area, or assigned directly.',
          '["Pick an assignment method"]'::jsonb,'You can change this later in Settings.',2,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s2;
  INSERT INTO impl_step_questions (step_id, position, question_key, label, input_type, options, required) VALUES
    (s2,0,'customer_assignment_method','How do you want to assign customers?','single_select',
     '[{"value":"area_wise","label":"Area-wise","recommended_badge":"Recommended by OZZO ✓","note":"Best for 50+ customers"},{"value":"direct","label":"Direct assignment","note":"Best for smaller teams"}]'::jsonb,true)
  ON CONFLICT (step_id, question_key) DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, params, combine)
  VALUES (s2,'answer','exists','{"question_key":"customer_assignment_method"}'::jsonb,'and');

  -- Step 3 Customers
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,3,'customer_creation','Add your customers',
          'Import or add the customers your team will serve.',
          '["Open Customers","Import a spreadsheet or add manually"]'::jsonb,'Use Import for bulk upload.',5,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s3;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES
    (s3,0,'Add customers','/contacts'),(s3,1,'Bulk import customers','/import') ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (s3,'customer_count','gt',0,100,1,'and');
  -- Branch: area_wise surfaces an area-assignment task on the employee step; direct hides it.
  INSERT INTO impl_conditions (step_id, depends_on_question_key, comparator, value, effect)
  VALUES (s3,'customer_assignment_method','eq','"area_wise"'::jsonb,'show');

  -- Step 4 Roles
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,4,'role_creation','Create roles',
          'Define the roles your employees will have (e.g. Field Rep, Manager).',
          '["Open Roles","Create at least one role"]'::jsonb,'Roles carry permissions.',3,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s4;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (s4,0,'Create roles','/team') ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (s4,'role_count','gt',0,3,1,'and');

  -- Step 5 Employees (+ milestone M1)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,5,'employee_creation','Add your employees',
          'Invite your field team so they can log in on mobile.',
          '["Open Team","Invite employees by mobile/email"]'::jsonb,'Each employee gets a mobile login.',5,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s5;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link, optional) VALUES
    (s5,0,'Add employees','/team',false),
    (s5,1,'Assign areas to employees','/field-staff',true) ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (s5,'employee_count','gt',0,5,1,'and');

  -- Step 6 Mobile login (+ M2)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,6,'mobile_login','Get the team on the mobile app',
          'Have at least one employee download the app and log in.',
          '["Share the app link","Employee logs in once"]'::jsonb,'Login confirms the account is reachable on-device.',3,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s6;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, combine)
  VALUES (s6,'employee_logged_in','exists','and');

  -- Step 7 First activity (+ M3)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,7,'first_activity','Record your first activity',
          'Have an employee mark attendance or record a customer visit.',
          '["Employee marks attendance","or records a visit"]'::jsonb,'This proves the field loop works end-to-end.',3,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s7;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, combine)
  VALUES (s7,'attendance_or_visit','exists','and');

  -- Step 8 See live data (+ M4)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,8,'see_live_data','See your live data',
          'Confirm real field data is flowing — attendance, visits or tracking.',
          '["Open Location Tracking / Reports","Confirm data appears"]'::jsonb,'You are live once real data exists.',2,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s8;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (s8,0,'View live data','/location-tracking') ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, combine)
  VALUES (s8,'meaningful_data','exists','and');

  -- Milestones
  INSERT INTO impl_milestones (template_id, position, milestone_key, title, message, icon, trigger_step_key) VALUES
    (tpl,1,'m1_team_ready','Your team is ready for the mobile app','Employees are set up — share the app link next.','users','employee_creation'),
    (tpl,2,'m2_first_user','Your first field user is active','Someone logged in on mobile. You are connected.','smartphone','mobile_login'),
    (tpl,3,'m3_tracking','Live field tracking is working','First activity captured. The field loop works.','activity','first_activity'),
    (tpl,4,'m4_live','You''re live on OZZO','Real field data is flowing. Setup complete.','rocket','see_live_data')
  ON CONFLICT (template_id, milestone_key) DO NOTHING;
END $$;
