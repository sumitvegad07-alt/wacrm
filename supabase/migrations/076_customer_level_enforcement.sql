-- ============================================================
-- 076_customer_level_enforcement.sql
--
-- ⚠️ BEHAVIOUR-CHANGING MIGRATION — READ BEFORE APPLYING ⚠️
--
-- Enforces at the DATABASE that a customer cannot be saved without a
-- level while the account has order hierarchy enabled. Previously this
-- was only a UI check in wacrm-web contact-form.tsx:175, so mobile and
-- any direct write bypassed it entirely.
--
-- WHY AT THE DATABASE: "block it at save, both platforms" cannot be done
-- reliably in two clients. One trigger covers web, mobile, imports and
-- anything added later.
--
-- KNOWN CONSEQUENCES — both intended, both worth knowing:
--
--   1. Existing customers with no level become UN-EDITABLE until a level
--      is assigned. As of writing, the hierarchy-enabled account has 7
--      customers and 6 have no level. Editing any of those six — even to
--      fix a phone number — will now require setting their level first.
--      This is self-healing (every edit forces cleanup) and the web admin
--      gains a "customers missing a level" list to work through, but it
--      WILL surprise someone if they are not told.
--
--   2. Their existing orders classify as 'direct', meaning "we don't know
--      yet" — deliberately NOT 'secondary', which would assert a position
--      in the hierarchy that nobody has actually stated.
--
-- This migration does NOT retro-fix existing rows. It blocks new saves.
--
-- MUST SHIP TOGETHER WITH the convert_lead_to_customer replacement below:
-- that function currently inserts a contact with no hierarchy_level
-- (migration 070, line 29) and would start failing the moment the trigger
-- exists. The two halves are one change.
-- ============================================================

-- ---------- 1. The enforcement trigger ----------

CREATE OR REPLACE FUNCTION enforce_contact_hierarchy_level()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_hierarchy_enabled BOOLEAN;
BEGIN
  SELECT COALESCE((settings -> 'order_settings' ->> 'hierarchy_enabled')::boolean, false)
    INTO v_hierarchy_enabled
  FROM accounts
  WHERE id = NEW.account_id;

  IF COALESCE(v_hierarchy_enabled, false) AND NEW.hierarchy_level IS NULL THEN
    RAISE EXCEPTION
      'Customer Level is required because order hierarchy is enabled for this account. Set the customer''s level and save again.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_contact_hierarchy_level ON contacts;
CREATE TRIGGER trg_enforce_contact_hierarchy_level
BEFORE INSERT OR UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION enforce_contact_hierarchy_level();

-- ---------- 2. Lead conversion, updated to carry the level ----------
-- Replaces the single-argument version from migration 070. The new
-- argument defaults to NULL so the existing one-argument call sites keep
-- resolving; when hierarchy is enabled and no level is supplied, the
-- trigger above rejects the insert with an actionable message and the
-- whole conversion rolls back atomically.

DROP FUNCTION IF EXISTS convert_lead_to_customer(uuid);

CREATE OR REPLACE FUNCTION convert_lead_to_customer(
  p_lead_id uuid,
  p_hierarchy_level integer DEFAULT NULL
)
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
    address, city, state, country, latitude, longitude,
    hierarchy_level
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
    v_lead.latitude, v_lead.longitude,
    p_hierarchy_level
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
