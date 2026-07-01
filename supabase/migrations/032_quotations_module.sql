-- ============================================================
-- QUOTATIONS MODULE
-- ============================================================

-- ACCOUNT SEQUENCES (for auto-generating quotation numbers, invoice numbers, etc)
CREATE TABLE IF NOT EXISTS account_sequences (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  quotation_seq BIGINT DEFAULT 0
);

ALTER TABLE account_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_sequences_select" ON account_sequences;
CREATE POLICY account_sequences_select ON account_sequences FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "account_sequences_update" ON account_sequences;
CREATE POLICY account_sequences_update ON account_sequences FOR ALL USING (is_account_member(account_id));

-- QUOTATIONS TABLE
CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  quotation_number TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  sub_total NUMERIC(15, 2) DEFAULT 0,
  tax_total NUMERIC(15, 2) DEFAULT 0,
  total_amount NUMERIC(15, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft',
  terms_conditions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, quotation_number)
);

CREATE INDEX IF NOT EXISTS idx_quotations_account_id ON quotations(account_id);
CREATE INDEX IF NOT EXISTS idx_quotations_contact_id ON quotations(contact_id);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotations_select" ON quotations;
CREATE POLICY quotations_select ON quotations FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "quotations_insert" ON quotations;
CREATE POLICY quotations_insert ON quotations FOR INSERT WITH CHECK (is_account_member(account_id));
DROP POLICY IF EXISTS "quotations_update" ON quotations;
CREATE POLICY quotations_update ON quotations FOR UPDATE USING (is_account_member(account_id));
DROP POLICY IF EXISTS "quotations_delete" ON quotations;
CREATE POLICY quotations_delete ON quotations FOR DELETE USING (is_account_member(account_id, 'admin'));

-- QUOTATION ITEMS TABLE
CREATE TABLE IF NOT EXISTS quotation_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);

ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotation_items_select" ON quotation_items;
CREATE POLICY quotation_items_select ON quotation_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_items.quotation_id AND is_account_member(q.account_id))
);
DROP POLICY IF EXISTS "quotation_items_insert" ON quotation_items;
CREATE POLICY quotation_items_insert ON quotation_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id))
);
DROP POLICY IF EXISTS "quotation_items_update" ON quotation_items;
CREATE POLICY quotation_items_update ON quotation_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id))
);
DROP POLICY IF EXISTS "quotation_items_delete" ON quotation_items;
CREATE POLICY quotation_items_delete ON quotation_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id))
);

-- QUOTATION TERMS TEMPLATES TABLE
CREATE TABLE IF NOT EXISTS quotation_terms_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotation_terms_templates_account_id ON quotation_terms_templates(account_id);

ALTER TABLE quotation_terms_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotation_terms_select" ON quotation_terms_templates;
CREATE POLICY quotation_terms_select ON quotation_terms_templates FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "quotation_terms_insert" ON quotation_terms_templates;
CREATE POLICY quotation_terms_insert ON quotation_terms_templates FOR INSERT WITH CHECK (is_account_member(account_id));
DROP POLICY IF EXISTS "quotation_terms_update" ON quotation_terms_templates;
CREATE POLICY quotation_terms_update ON quotation_terms_templates FOR UPDATE USING (is_account_member(account_id));
DROP POLICY IF EXISTS "quotation_terms_delete" ON quotation_terms_templates;
CREATE POLICY quotation_terms_delete ON quotation_terms_templates FOR DELETE USING (is_account_member(account_id, 'admin'));

-- QUOTATION CUSTOM VALUES
CREATE TABLE IF NOT EXISTS quotation_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(quotation_id, custom_field_id)
);

ALTER TABLE quotation_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotation_cv_select" ON quotation_custom_values;
CREATE POLICY quotation_cv_select ON quotation_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_custom_values.quotation_id AND is_account_member(q.account_id))
);
DROP POLICY IF EXISTS "quotation_cv_insert" ON quotation_custom_values;
CREATE POLICY quotation_cv_insert ON quotation_custom_values FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id))
);
DROP POLICY IF EXISTS "quotation_cv_update" ON quotation_custom_values;
CREATE POLICY quotation_cv_update ON quotation_custom_values FOR UPDATE USING (
  EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id))
);
DROP POLICY IF EXISTS "quotation_cv_delete" ON quotation_custom_values;
CREATE POLICY quotation_cv_delete ON quotation_custom_values FOR DELETE USING (
  EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id))
);

-- AUTO-GENERATION OF QUOTATION NUMBER
CREATE OR REPLACE FUNCTION get_next_quotation_number(p_account_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO account_sequences (account_id, quotation_seq)
  VALUES (p_account_id, 1)
  ON CONFLICT (account_id) DO UPDATE
  SET quotation_seq = account_sequences.quotation_seq + 1
  RETURNING quotation_seq INTO v_seq;
  
  -- Format: QT-0001
  RETURN 'QT-' || LPAD(v_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_quotation_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quotation_number IS NULL OR NEW.quotation_number = '' THEN
    NEW.quotation_number := get_next_quotation_number(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_quotation_number ON quotations;
CREATE TRIGGER trg_set_quotation_number
BEFORE INSERT ON quotations
FOR EACH ROW EXECUTE FUNCTION set_quotation_number();

-- Add updated_at trigger to quotations
DROP TRIGGER IF EXISTS set_updated_at ON quotations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
