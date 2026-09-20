-- Seed CRM + SFA step groups into the composite (wfa_v1) template. Each step is
-- line-tagged; the loader shows it only for plans that grant the line. Idempotent
-- (ON CONFLICT on steps; rules cleared+reinserted per step).
DO $$
DECLARE
  tpl uuid;
  c1 uuid; c2 uuid; c3 uuid;            -- CRM steps
  f1 uuid; f2 uuid; f3 uuid;            -- SFA steps
BEGIN
  SELECT id INTO tpl FROM impl_templates
   WHERE template_key = 'wfa_v1' AND is_active = true
   ORDER BY version DESC LIMIT 1;
  IF tpl IS NULL THEN RETURN; END IF;

  -- Keep "See your live data" as the shared finale, after the CRM/SFA steps.
  UPDATE impl_steps SET position = 90 WHERE template_id = tpl AND step_key = 'see_live_data';

  -- ============ CRM line ============
  INSERT INTO impl_steps (template_id, position, step_key, line, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,20,'lead_capture','crm','Capture your first lead',
          'Add a prospect so your team can follow up.',
          '["Open Leads","Add a lead"]'::jsonb,'Leads become deals as they progress.',4,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title, line=EXCLUDED.line, position=EXCLUDED.position, description=EXCLUDED.description RETURNING id INTO c1;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (c1,0,'Add a lead','/leads') ON CONFLICT DO NOTHING;
  DELETE FROM impl_validation_rules WHERE step_id = c1;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (c1,'lead_count','gt',0,5,1,'and');

  INSERT INTO impl_steps (template_id, position, step_key, line, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,21,'deal_pipeline','crm','Create your first deal',
          'Track an opportunity through your pipeline stages.',
          '["Open Deals","Create a deal"]'::jsonb,'Deals move through stages to Won.',4,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title, line=EXCLUDED.line, position=EXCLUDED.position, description=EXCLUDED.description RETURNING id INTO c2;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (c2,0,'Create a deal','/deals') ON CONFLICT DO NOTHING;
  DELETE FROM impl_validation_rules WHERE step_id = c2;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (c2,'deal_count','gt',0,3,1,'and');

  INSERT INTO impl_steps (template_id, position, step_key, line, title, description, quick_steps, help_text, estimated_minutes, weight, is_optional)
  VALUES (tpl,22,'quotation_first','crm','Send your first quotation',
          'Create a price quote for a customer.',
          '["Open Quotations","Create a quotation"]'::jsonb,'Optional — quotations can convert to orders.',4,1,true)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title, line=EXCLUDED.line, position=EXCLUDED.position, description=EXCLUDED.description RETURNING id INTO c3;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (c3,0,'Create a quotation','/quotations') ON CONFLICT DO NOTHING;
  DELETE FROM impl_validation_rules WHERE step_id = c3;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (c3,'quotation_count','gt',0,1,1,'and');

  -- ============ SFA line ============
  INSERT INTO impl_steps (template_id, position, step_key, line, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,30,'product_setup','sfa','Add your products',
          'Build the catalogue your team will sell.',
          '["Open Products","Add or import products"]'::jsonb,'Products power orders and pricing.',5,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title, line=EXCLUDED.line, position=EXCLUDED.position, description=EXCLUDED.description RETURNING id INTO f1;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES
    (f1,0,'Add products','/products'),(f1,1,'Bulk import products','/import') ON CONFLICT DO NOTHING;
  DELETE FROM impl_validation_rules WHERE step_id = f1;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (f1,'product_count','gt',0,10,1,'and');

  INSERT INTO impl_steps (template_id, position, step_key, line, title, description, quick_steps, help_text, estimated_minutes, weight, is_optional)
  VALUES (tpl,31,'pricing_setup','sfa','Set up pricing',
          'Give specific customers their own price list (optional).',
          '["Open Price Lists","Create a price list"]'::jsonb,'Optional — skip to use catalogue prices.',3,1,true)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title, line=EXCLUDED.line, position=EXCLUDED.position, description=EXCLUDED.description RETURNING id INTO f2;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (f2,0,'Create a price list','/price-lists') ON CONFLICT DO NOTHING;
  DELETE FROM impl_validation_rules WHERE step_id = f2;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (f2,'price_list_count','gt',0,1,1,'and');

  INSERT INTO impl_steps (template_id, position, step_key, line, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,32,'order_first','sfa','Record your first order',
          'Place an order for a customer.',
          '["Open Orders","Create an order"]'::jsonb,'Orders are the heart of SFA.',5,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title, line=EXCLUDED.line, position=EXCLUDED.position, description=EXCLUDED.description RETURNING id INTO f3;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (f3,0,'Create an order','/orders') ON CONFLICT DO NOTHING;
  DELETE FROM impl_validation_rules WHERE step_id = f3;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (f3,'order_count','gt',0,5,1,'and');

  -- Milestones (one per new line).
  INSERT INTO impl_milestones (template_id, position, milestone_key, line, title, message, icon, trigger_step_key) VALUES
    (tpl,20,'m_crm_pipeline','crm','Your sales pipeline is live','First deal created — track it to Won.','trending-up','deal_pipeline'),
    (tpl,30,'m_sfa_first_order','sfa','First order recorded','Your sales flow works end-to-end.','shopping-cart','order_first')
  ON CONFLICT (template_id, milestone_key) DO NOTHING;
END $$;
