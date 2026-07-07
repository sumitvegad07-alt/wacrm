-- ============================================================
-- 052_leads_customization.sql
-- Creates settings tables for lead statuses, sources, industries, lead tags, and lead custom values.
-- ============================================================

-- 1. Lead Statuses
CREATE TABLE IF NOT EXISTS lead_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_statuses_account ON lead_statuses(account_id);
ALTER TABLE lead_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_statuses_select ON lead_statuses;
DROP POLICY IF EXISTS lead_statuses_insert ON lead_statuses;
DROP POLICY IF EXISTS lead_statuses_update ON lead_statuses;
DROP POLICY IF EXISTS lead_statuses_delete ON lead_statuses;

CREATE POLICY lead_statuses_select ON lead_statuses FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_statuses_insert ON lead_statuses FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY lead_statuses_update ON lead_statuses FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY lead_statuses_delete ON lead_statuses FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 2. Lead Sources
CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_account ON lead_sources(account_id);
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_sources_select ON lead_sources;
DROP POLICY IF EXISTS lead_sources_insert ON lead_sources;
DROP POLICY IF EXISTS lead_sources_update ON lead_sources;
DROP POLICY IF EXISTS lead_sources_delete ON lead_sources;

CREATE POLICY lead_sources_select ON lead_sources FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_sources_insert ON lead_sources FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY lead_sources_update ON lead_sources FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY lead_sources_delete ON lead_sources FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 3. Lead Industries
CREATE TABLE IF NOT EXISTS lead_industries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_industries_account ON lead_industries(account_id);
ALTER TABLE lead_industries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_industries_select ON lead_industries;
DROP POLICY IF EXISTS lead_industries_insert ON lead_industries;
DROP POLICY IF EXISTS lead_industries_update ON lead_industries;
DROP POLICY IF EXISTS lead_industries_delete ON lead_industries;

CREATE POLICY lead_industries_select ON lead_industries FOR SELECT USING (is_account_member(account_id));
CREATE POLICY lead_industries_insert ON lead_industries FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY lead_industries_update ON lead_industries FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY lead_industries_delete ON lead_industries FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 4. Update Leads Table for Ownership Privacy
ALTER TABLE leads 
  ADD COLUMN IF NOT EXISTS collaborator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS leads_select ON leads;
DROP POLICY IF EXISTS leads_update ON leads;
DROP POLICY IF EXISTS leads_delete ON leads;

CREATE POLICY leads_select ON leads FOR SELECT USING (
  is_account_member(account_id) AND (
    is_account_member(account_id, 'admin') 
    OR user_id = auth.uid() 
    OR collaborator_id = auth.uid()
  )
);

CREATE POLICY leads_update ON leads FOR UPDATE USING (
  is_account_member(account_id) AND (
    is_account_member(account_id, 'admin') 
    OR user_id = auth.uid() 
    OR collaborator_id = auth.uid()
  )
);

CREATE POLICY leads_delete ON leads FOR DELETE USING (
  is_account_member(account_id) AND (
    is_account_member(account_id, 'admin') 
    OR user_id = auth.uid()
  )
);


-- 5. Lead Custom Values Table
CREATE TABLE IF NOT EXISTS lead_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id, custom_field_id)
);

ALTER TABLE lead_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_cv_select" ON lead_custom_values;
CREATE POLICY lead_cv_select ON lead_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_custom_values.lead_id AND is_account_member(l.account_id))
);
DROP POLICY IF EXISTS "lead_cv_insert" ON lead_custom_values;
CREATE POLICY lead_cv_insert ON lead_custom_values FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_custom_values.lead_id AND is_account_member(l.account_id, 'agent'))
);
DROP POLICY IF EXISTS "lead_cv_update" ON lead_custom_values;
CREATE POLICY lead_cv_update ON lead_custom_values FOR UPDATE USING (
  EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_custom_values.lead_id AND is_account_member(l.account_id, 'agent'))
);
DROP POLICY IF EXISTS "lead_cv_delete" ON lead_custom_values;
CREATE POLICY lead_cv_delete ON lead_custom_values FOR DELETE USING (
  EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_custom_values.lead_id AND is_account_member(l.account_id, 'admin'))
);


-- 6. Add triggers for updated_at
DROP TRIGGER IF EXISTS set_updated_at ON lead_statuses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_statuses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON lead_sources;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_sources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON lead_industries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_industries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
