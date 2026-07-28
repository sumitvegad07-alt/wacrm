-- ============================================================
-- 095_leads_company_phone.sql
-- Adds company, phone, and estimated_value columns to leads table
-- to ensure schema cache consistency and proper field mapping.
-- ============================================================

ALTER TABLE leads 
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS estimated_value NUMERIC(15, 2);

-- Backfill company from name if empty
UPDATE leads SET company = name WHERE company IS NULL OR company = '';

-- Backfill phone from whatsapp if empty
UPDATE leads SET phone = whatsapp WHERE (phone IS NULL OR phone = '') AND whatsapp IS NOT NULL;

-- Update convert_lead_to_customer function to use company and phone properly
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
    COALESCE(NULLIF(v_lead.company, ''), v_lead.name),             -- firm/company (primary)
    COALESCE(NULLIF(v_lead.contact_person, ''), v_lead.name),      -- contact person
    COALESCE(NULLIF(v_lead.phone, ''), NULLIF(v_lead.whatsapp, ''), 'Unknown'),
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

  UPDATE leads
  SET is_converted = true,
      converted_contact_id = v_contact_id,
      status = 'converted',
      updated_at = NOW()
  WHERE id = p_lead_id;

  RETURN v_contact_id;
END;
$$;
