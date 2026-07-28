-- ============================================================
-- 092_deal_numbers_and_timeline.sql
-- 1. Ensure deal_number exists on deals and backfill any missing deal numbers
-- 2. Update convert_deal_to_quotation RPC with:
--    - copying module_activities using 'message' column
--    - logging clickable/referenced quotation number in timeline with details jsonb
--    - marking deal is_converted = true, is_active = false, status = 'won'
-- 3. Update convert_lead_to_customer RPC with:
--    - copying module_activities using 'message' column
--    - marking lead is_converted = true, is_active = false
-- ============================================================

-- 1. Ensure deal_number column exists and backfill existing rows
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_number TEXT;
ALTER TABLE account_sequences ADD COLUMN IF NOT EXISTS deal_seq BIGINT DEFAULT 0;

DO $$
DECLARE
  r RECORD;
  v_num TEXT;
  v_seq BIGINT;
BEGIN
  FOR r IN SELECT id, account_id FROM deals WHERE deal_number IS NULL OR deal_number = '' ORDER BY created_at ASC
  LOOP
    UPDATE account_sequences
    SET deal_seq = COALESCE(deal_seq, 0) + 1
    WHERE account_id = r.account_id
    RETURNING deal_seq INTO v_seq;

    IF v_seq IS NULL THEN
      INSERT INTO account_sequences (account_id, deal_seq)
      VALUES (r.account_id, 1)
      RETURNING 1 INTO v_seq;
    END IF;

    v_num := 'DEAL-' || LPAD(v_seq::text, 6, '0');
    UPDATE deals SET deal_number = v_num WHERE id = r.id;
  END LOOP;
END
$$;

-- 2. RPC: CONVERT DEAL TO QUOTATION
CREATE OR REPLACE FUNCTION convert_deal_to_quotation(p_deal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_deal RECORD;
  v_quotation_id uuid;
  v_quotation_num text;
  v_sub_total numeric(15, 2) := 0;
  v_tax_total numeric(15, 2) := 0;
  v_total_amount numeric(15, 2) := 0;
  v_items_count int := 0;
BEGIN
  -- Load + lock the deal
  SELECT * INTO v_deal FROM deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found or not accessible';
  END IF;
  IF v_deal.is_converted THEN
    RAISE EXCEPTION 'Deal already converted';
  END IF;

  -- Calculate item totals
  SELECT 
    COUNT(*),
    COALESCE(SUM(sub_total), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(total), 0)
  INTO v_items_count, v_sub_total, v_tax_total, v_total_amount
  FROM deal_items
  WHERE deal_id = p_deal_id;

  -- If no items, use deal value as total
  IF v_items_count = 0 OR (v_total_amount = 0 AND v_deal.value > 0) THEN
    v_sub_total := COALESCE(v_deal.value, 0);
    v_total_amount := COALESCE(v_deal.value, 0);
  END IF;

  -- Generate quotation number
  v_quotation_num := get_next_quotation_number(v_deal.account_id);

  -- Insert Quotation
  INSERT INTO quotations (
    account_id, user_id, contact_id, lead_id, quotation_number, date,
    sub_total, tax_total, total_amount, status, terms_conditions
  )
  VALUES (
    v_deal.account_id,
    COALESCE(auth.uid(), v_deal.user_id),
    v_deal.contact_id,
    v_deal.lead_id,
    v_quotation_num,
    CURRENT_DATE,
    v_sub_total,
    v_tax_total,
    v_total_amount,
    'Draft',
    COALESCE(v_deal.notes, '')
  )
  RETURNING id INTO v_quotation_id;

  -- Copy deal_items to quotation_items
  IF v_items_count > 0 THEN
    INSERT INTO quotation_items (
      quotation_id, product_id, product_name, unit, quantity, price, tax_rate, tax_amount, sub_total, total, position
    )
    SELECT 
      v_quotation_id, product_id, product_name, COALESCE(unit, '—'), quantity, price, tax_rate, tax_amount, sub_total, total, position
    FROM deal_items
    WHERE deal_id = p_deal_id;
  ELSE
    -- Fallback item if no line items were created in deal
    INSERT INTO quotation_items (
      quotation_id, product_name, unit, quantity, price, tax_rate, tax_amount, sub_total, total, position
    )
    VALUES (
      v_quotation_id,
      COALESCE(v_deal.deal_number, 'Deal') || ' - Sales Opportunity',
      '—',
      1,
      v_total_amount,
      0,
      0,
      v_total_amount,
      v_total_amount,
      0
    );
  END IF;

  -- Mark Deal inactive & converted
  UPDATE deals
  SET is_converted = true,
      is_active = false,
      converted_quotation_id = v_quotation_id,
      status = 'won',
      updated_at = now()
  WHERE id = p_deal_id;

  -- Copy timeline activities from Deal (and Lead if any) to the new Quotation
  INSERT INTO module_activities (
    account_id, user_id, module_name, record_id, action, message, details, created_at
  )
  SELECT 
    account_id, user_id, 'quotation', v_quotation_id, action, 
    '[From Deal ' || COALESCE(v_deal.deal_number, 'Deal') || '] ' || COALESCE(message, ''), 
    details, created_at
  FROM module_activities
  WHERE (module_name = 'deal' AND record_id = p_deal_id)
     OR (module_name = 'lead' AND record_id = v_deal.lead_id AND v_deal.lead_id IS NOT NULL);

  -- Log timeline activity on Quotation and Deal with details JSONB for clickable links
  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
  VALUES 
    (v_deal.account_id, COALESCE(auth.uid(), v_deal.user_id), 'quotation', v_quotation_id, 'created', 'Quotation created from converted Deal ' || COALESCE(v_deal.deal_number, p_deal_id::text), jsonb_build_object('deal_id', p_deal_id, 'deal_number', COALESCE(v_deal.deal_number, 'Deal'))),
    (v_deal.account_id, COALESCE(auth.uid(), v_deal.user_id), 'deal', p_deal_id, 'converted', 'Deal converted to Quotation #' || v_quotation_num, jsonb_build_object('quotation_id', v_quotation_id, 'quotation_number', v_quotation_num));

  RETURN v_quotation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION convert_deal_to_quotation(uuid) TO authenticated;

-- 3. RPC: CONVERT LEAD TO CUSTOMER
CREATE OR REPLACE FUNCTION convert_lead_to_customer(p_lead_id uuid, p_hierarchy_level integer DEFAULT NULL)
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

  -- Check if a contact with this phone already exists
  SELECT id INTO v_contact_id FROM contacts 
  WHERE account_id = v_lead.account_id AND phone = v_lead.phone 
  LIMIT 1;

  IF v_contact_id IS NOT NULL THEN
    -- Update existing contact
    UPDATE contacts
    SET name = COALESCE(v_lead.name, contacts.name),
        company = COALESCE(v_lead.company, contacts.company),
        email = COALESCE(v_lead.email, contacts.email),
        updated_at = NOW()
    WHERE id = v_contact_id;
  ELSE
    -- Create new contact
    INSERT INTO contacts (
      account_id, user_id, name, company, phone, email, hierarchy_level
    )
    VALUES (
      v_lead.account_id,
      COALESCE(v_lead.owner_id, v_lead.user_id, auth.uid()),
      v_lead.name,
      v_lead.company,
      v_lead.phone,
      v_lead.email,
      p_hierarchy_level
    )
    RETURNING id INTO v_contact_id;
  END IF;

  -- Copy timeline logs from lead to contact
  INSERT INTO module_activities (
    account_id, user_id, module_name, record_id, action, message, details, created_at
  )
  SELECT 
    account_id, user_id, 'contact', v_contact_id, action, 
    '[From Lead ' || COALESCE(v_lead.name, '') || '] ' || COALESCE(message, ''), 
    details, created_at
  FROM module_activities
  WHERE module_name = 'lead' AND record_id = p_lead_id;

  -- Log timeline activity on Lead and Contact with details JSONB for clickable links
  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message, details)
  VALUES 
    (v_lead.account_id, COALESCE(auth.uid(), v_lead.user_id), 'contact', v_contact_id, 'created', 'Customer contact created from Lead ' || COALESCE(v_lead.name, ''), jsonb_build_object('lead_id', p_lead_id, 'lead_name', v_lead.name)),
    (v_lead.account_id, COALESCE(auth.uid(), v_lead.user_id), 'lead', p_lead_id, 'converted', 'Lead converted to Customer Contact', jsonb_build_object('contact_id', v_contact_id, 'contact_name', v_lead.name));

  -- Mark lead inactive & converted
  UPDATE leads
  SET is_converted = true,
      is_active = false,
      converted_contact_id = v_contact_id,
      status = 'won',
      updated_at = NOW()
  WHERE id = p_lead_id;

  RETURN v_contact_id;
END;
$$;

GRANT EXECUTE ON FUNCTION convert_lead_to_customer(uuid, integer) TO authenticated;
