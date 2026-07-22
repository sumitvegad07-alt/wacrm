-- ============================================================
-- 067_convert_lead_rpc.sql
-- Atomic lead -> customer(contact) conversion.
-- Replaces the web's non-transactional client-side handleConvert, which
-- hard-deleted the lead and could leave partial data. This KEEPS the lead
-- (flags is_converted + converted_contact_id) so history is preserved, and
-- runs as a single transaction (any failure rolls everything back).
-- SECURITY INVOKER: all reads/writes happen under the caller's RLS, so
-- multi-tenant isolation is enforced by the existing policies.
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
  -- Load + lock the lead (visible only under the caller's RLS).
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found or not accessible';
  END IF;
  IF v_lead.is_converted THEN
    RAISE EXCEPTION 'Lead already converted';
  END IF;

  -- Create the customer. phone is NOT NULL on contacts, so fall back to
  -- 'Unknown' when the lead has no whatsapp. company <- industry.
  INSERT INTO contacts (
    account_id, user_id, name, phone, email, company,
    city, state, country, latitude, longitude
  )
  VALUES (
    v_lead.account_id,
    COALESCE(v_lead.user_id, auth.uid()),
    v_lead.name,
    COALESCE(NULLIF(v_lead.whatsapp, ''), 'Unknown'),
    v_lead.email,
    v_lead.industry,
    v_lead.city, v_lead.state, v_lead.country,
    v_lead.latitude, v_lead.longitude
  )
  RETURNING id INTO v_contact_id;

  -- Copy custom values only where a same-named contact-module custom field
  -- exists (a lead field id would be meaningless on the contact side).
  INSERT INTO contact_custom_values (contact_id, custom_field_id, value)
  SELECT v_contact_id, ccf.id, lcv.value
  FROM lead_custom_values lcv
  JOIN custom_fields lcf
    ON lcf.id = lcv.custom_field_id AND lcf.module_name = 'lead'
  JOIN custom_fields ccf
    ON ccf.account_id = lcf.account_id
   AND ccf.module_name = 'contact'
   AND ccf.field_name = lcf.field_name
  WHERE lcv.lead_id = p_lead_id
    AND lcv.value IS NOT NULL AND lcv.value <> '';

  -- Copy notes (lead_notes.content -> contact_notes.note_text).
  INSERT INTO contact_notes (account_id, contact_id, user_id, note_text)
  SELECT v_lead.account_id, v_contact_id, ln.user_id, ln.content
  FROM lead_notes ln
  WHERE ln.lead_id = p_lead_id;

  -- Re-link tasks from the lead to the new customer.
  UPDATE tasks
  SET lead_id = NULL, contact_id = v_contact_id
  WHERE lead_id = p_lead_id;

  -- Rewrite timeline activities to point at the new customer.
  UPDATE module_activities
  SET module_name = 'contact', record_id = v_contact_id
  WHERE record_id = p_lead_id AND module_name = 'lead';

  -- Flag the lead as converted (kept, not deleted). This UPDATE is subject
  -- to the stricter leads_update policy (owner/collaborator/admin); if the
  -- caller isn't allowed, 0 rows change and we abort — rolling back the
  -- whole conversion including the contact just created.
  UPDATE leads
  SET is_converted = true, converted_contact_id = v_contact_id, updated_at = now()
  WHERE id = p_lead_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'You do not have permission to convert this lead';
  END IF;

  -- Timeline log on the new customer.
  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message)
  VALUES (v_lead.account_id, auth.uid(), 'contact', v_contact_id, 'created',
          'Customer created from converted Lead');

  RETURN v_contact_id;
END;
$$;

GRANT EXECUTE ON FUNCTION convert_lead_to_customer(uuid) TO authenticated;
