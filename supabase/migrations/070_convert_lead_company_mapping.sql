-- ============================================================
-- 070_convert_lead_company_mapping.sql
-- Update convert_lead_to_customer so the mapping matches the new
-- customer model where the company/firm name is the PRIMARY identifier:
--   contact.company  <- lead.name           (the firm)
--   contact.name     <- lead.contact_person (the person)
-- Also carries over the lead's street address. Everything else (atomic,
-- keeps the lead flagged) is unchanged from migration 067.
-- ============================================================

CREATE OR REPLACE FUNCTION convert_lead_to_customer(p_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_lead RECORD;
  v_contact_id uuid;
  v_updated int;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found or not accessible';
  END IF;
  IF v_lead.is_converted THEN
    RAISE EXCEPTION 'Lead already converted';
  END IF;

  INSERT INTO contacts (
    account_id, user_id, company, name, phone, email,
    address, city, state, country, latitude, longitude
  )
  VALUES (
    v_lead.account_id,
    COALESCE(v_lead.user_id, auth.uid()),
    v_lead.name,                                   -- firm/company (primary)
    v_lead.contact_person,                         -- contact person
    COALESCE(NULLIF(v_lead.whatsapp, ''), 'Unknown'),
    v_lead.email,
    v_lead.address,
    v_lead.city, v_lead.state, v_lead.country,
    v_lead.latitude, v_lead.longitude
  )
  RETURNING id INTO v_contact_id;

  INSERT INTO contact_custom_values (contact_id, custom_field_id, value)
  SELECT v_contact_id, ccf.id, lcv.value
  FROM lead_custom_values lcv
  JOIN custom_fields lcf ON lcf.id = lcv.custom_field_id AND lcf.module_name = 'lead'
  JOIN custom_fields ccf ON ccf.account_id = lcf.account_id AND ccf.module_name = 'contact' AND ccf.field_name = lcf.field_name
  WHERE lcv.lead_id = p_lead_id AND lcv.value IS NOT NULL AND lcv.value <> '';

  INSERT INTO contact_notes (account_id, contact_id, user_id, note_text)
  SELECT v_lead.account_id, v_contact_id, ln.user_id, ln.content
  FROM lead_notes ln WHERE ln.lead_id = p_lead_id;

  UPDATE tasks SET lead_id = NULL, contact_id = v_contact_id WHERE lead_id = p_lead_id;

  UPDATE module_activities SET module_name = 'contact', record_id = v_contact_id
  WHERE record_id = p_lead_id AND module_name = 'lead';

  UPDATE leads SET is_converted = true, converted_contact_id = v_contact_id, updated_at = now()
  WHERE id = p_lead_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'You do not have permission to convert this lead';
  END IF;

  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message)
  VALUES (v_lead.account_id, auth.uid(), 'contact', v_contact_id, 'created', 'Customer created from converted Lead');

  RETURN v_contact_id;
END;
$$;
