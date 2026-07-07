-- ============================================================
-- 049_leads_module.sql
-- Creates the leads module with fields for source, status, industry, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  source TEXT DEFAULT 'organic',
  status TEXT DEFAULT 'new',
  industry TEXT,
  address TEXT,
  whatsapp TEXT,
  email TEXT,
  is_converted BOOLEAN DEFAULT false,
  converted_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for frequent queries
CREATE INDEX IF NOT EXISTS idx_leads_account_id ON leads(account_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);

-- Enable RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Setup RLS policies (using is_account_member)
DROP POLICY IF EXISTS leads_select ON leads;
DROP POLICY IF EXISTS leads_insert ON leads;
DROP POLICY IF EXISTS leads_update ON leads;
DROP POLICY IF EXISTS leads_delete ON leads;

CREATE POLICY leads_select ON leads FOR SELECT USING (is_account_member(account_id));
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY leads_update ON leads FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY leads_delete ON leads FOR DELETE USING (is_account_member(account_id, 'agent'));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at ON leads;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
