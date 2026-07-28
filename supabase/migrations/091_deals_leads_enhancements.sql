-- ============================================================
-- 091_deals_leads_enhancements.sql
-- Adds creator_id, collaborator_ids, deal_for, lead_id, is_active,
-- is_converted, converted_quotation_id to deals.
-- Adds deal_items table for line items in deals.
-- Adds owner_id, collaborator_ids, is_active to leads.
-- Adds convert_deal_to_quotation and updates convert_lead_to_customer RPCs
-- with timeline activity copying.
-- ============================================================

-- 1. DEALS ENHANCEMENTS
ALTER TABLE deals ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_for TEXT DEFAULT 'customer' CHECK (deal_for IN ('customer', 'lead'));
ALTER TABLE deals ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS collaborator_ids UUID[] DEFAULT '{}';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_converted BOOLEAN DEFAULT FALSE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS converted_quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL;

-- Backfill existing deals
UPDATE deals SET creator_id = user_id WHERE creator_id IS NULL;
UPDATE deals SET deal_for = 'customer' WHERE deal_for IS NULL AND contact_id IS NOT NULL;
UPDATE deals SET is_active = TRUE WHERE is_active IS NULL;
UPDATE deals SET is_converted = FALSE WHERE is_converted IS NULL;
UPDATE deals SET collaborator_ids = '{}' WHERE collaborator_ids IS NULL;

-- 2. DEAL ITEMS TABLE
CREATE TABLE IF NOT EXISTS deal_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit TEXT,
  quantity NUMERIC(15, 2) NOT NULL DEFAULT 1,
  price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  sub_total NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_items_deal_id ON deal_items(deal_id);

ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deal_items_select" ON deal_items;
CREATE POLICY deal_items_select ON deal_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_items.deal_id AND is_account_member(d.account_id))
);
DROP POLICY IF EXISTS "deal_items_insert" ON deal_items;
CREATE POLICY deal_items_insert ON deal_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND is_account_member(d.account_id))
);
DROP POLICY IF EXISTS "deal_items_update" ON deal_items;
CREATE POLICY deal_items_update ON deal_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND is_account_member(d.account_id))
);
DROP POLICY IF EXISTS "deal_items_delete" ON deal_items;
CREATE POLICY deal_items_delete ON deal_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND is_account_member(d.account_id))
);

-- 3. LEADS ENHANCEMENTS
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS collaborator_ids UUID[] DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

UPDATE leads SET owner_id = user_id WHERE owner_id IS NULL;
UPDATE leads SET collaborator_ids = '{}' WHERE collaborator_ids IS NULL;
UPDATE leads SET is_active = TRUE WHERE is_active IS NULL;

-- 4. RLS UPDATES FOR DEALS AND LEADS
DROP POLICY IF EXISTS "Users can manage own deals" ON deals;
DROP POLICY IF EXISTS "deals_select" ON deals;
CREATE POLICY deals_select ON deals FOR SELECT USING (
  is_account_member(account_id)
);
DROP POLICY IF EXISTS "deals_insert" ON deals;
CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (
  is_account_member(account_id)
);
DROP POLICY IF EXISTS "deals_update" ON deals;
CREATE POLICY deals_update ON deals FOR UPDATE USING (
  auth.uid() = user_id OR 
  auth.uid() = creator_id OR 
  auth.uid() = ANY(collaborator_ids) OR 
  is_account_member(account_id, 'admin')
);

DROP POLICY IF EXISTS "leads_select" ON leads;
CREATE POLICY leads_select ON leads FOR SELECT USING (
  is_account_member(account_id)
);
DROP POLICY IF EXISTS "leads_insert" ON leads;
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (
  is_account_member(account_id)
);
DROP POLICY IF EXISTS "leads_update" ON leads;
CREATE POLICY leads_update ON leads FOR UPDATE USING (
  auth.uid() = user_id OR 
  auth.uid() = owner_id OR 
  auth.uid() = ANY(collaborator_ids) OR 
  is_account_member(account_id, 'admin')
);

-- 5. RPC: CONVERT DEAL TO QUOTATION
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
    COALESCE(SUM(sub_total), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(total), 0)
  INTO v_sub_total, v_tax_total, v_total_amount
  FROM deal_items
  WHERE deal_id = p_deal_id;

  -- If no items, use deal value as total
  IF v_total_amount = 0 AND v_deal.value > 0 THEN
    v_sub_total := v_deal.value;
    v_total_amount := v_deal.value;
  END IF;

  -- Generate quotation number
  v_quotation_num := get_next_quotation_number(v_deal.account_id);

  -- Insert Quotation
  INSERT INTO quotations (
    account_id, user_id, contact_id, lead_id, quotation_number, date,
    sub_total, tax_total, total_amount, status
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
    'Draft'
  )
  RETURNING id INTO v_quotation_id;

  -- Copy deal_items to quotation_items
  INSERT INTO quotation_items (
    quotation_id, product_id, product_name, unit, quantity, price, tax_rate, tax_amount, sub_total, total, position
  )
  SELECT 
    v_quotation_id, product_id, product_name, unit, quantity, price, tax_rate, tax_amount, sub_total, total, position
  FROM deal_items
  WHERE deal_id = p_deal_id;

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
    account_id, user_id, 'quotation', v_quotation_id, action, message, details, created_at
  FROM module_activities
  WHERE (module_name = 'deal' AND record_id = p_deal_id)
     OR (module_name = 'lead' AND record_id = v_deal.lead_id AND v_deal.lead_id IS NOT NULL);

  -- Log timeline activity on Quotation and Deal
  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message)
  VALUES 
    (v_deal.account_id, auth.uid(), 'quotation', v_quotation_id, 'created', 'Quotation created from converted Deal ' || COALESCE(v_deal.deal_number, '')),
    (v_deal.account_id, auth.uid(), 'deal', p_deal_id, 'converted', 'Deal converted to Quotation ' || v_quotation_num);

  RETURN v_quotation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION convert_deal_to_quotation(uuid) TO authenticated;

-- 6. UPDATED RPC: CONVERT LEAD TO CUSTOMER (with copy of timeline logs and is_active = false)
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

  INSERT INTO contact_notes (account_id, contact_id, user_id, note_text)
  SELECT v_lead.account_id, v_contact_id, ln.user_id, ln.content
  FROM lead_notes ln
  WHERE ln.lead_id = p_lead_id;

  UPDATE tasks
  SET lead_id = NULL, contact_id = v_contact_id
  WHERE lead_id = p_lead_id;

  -- Copy timeline activities from lead to new contact (keep original lead logs intact)
  INSERT INTO module_activities (
    account_id, user_id, module_name, record_id, action, message, details, created_at
  )
  SELECT 
    account_id, user_id, 'contact', v_contact_id, action, message, details, created_at
  FROM module_activities
  WHERE record_id = p_lead_id AND module_name = 'lead';

  UPDATE leads
  SET is_converted = true,
      is_active = false,
      converted_contact_id = v_contact_id,
      updated_at = now()
  WHERE id = p_lead_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'You do not have permission to convert this lead';
  END IF;

  INSERT INTO module_activities (account_id, user_id, module_name, record_id, action, message)
  VALUES 
    (v_lead.account_id, auth.uid(), 'contact', v_contact_id, 'created', 'Customer created from converted Lead'),
    (v_lead.account_id, auth.uid(), 'lead', p_lead_id, 'converted', 'Lead converted to Customer');

  RETURN v_contact_id;
END;
$$;

GRANT EXECUTE ON FUNCTION convert_lead_to_customer(uuid) TO authenticated;
