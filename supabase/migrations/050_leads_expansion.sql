-- ============================================================
-- 050_leads_expansion.sql
-- Expands the leads module with location fields, task associations, and notes.
-- ============================================================

-- 1. Add location fields to leads
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 8),
ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 8);

-- 2. Add lead_id to tasks
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_lead_id ON tasks(lead_id);

-- 3. Create lead_notes table for the timeline
CREATE TABLE IF NOT EXISTS lead_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id);

-- Enable RLS for lead_notes
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;

-- Setup RLS policies for lead_notes
-- We join with leads to check account_id access via is_account_member
DROP POLICY IF EXISTS lead_notes_select ON lead_notes;
DROP POLICY IF EXISTS lead_notes_insert ON lead_notes;
DROP POLICY IF EXISTS lead_notes_update ON lead_notes;
DROP POLICY IF EXISTS lead_notes_delete ON lead_notes;

CREATE POLICY lead_notes_select ON lead_notes FOR SELECT 
USING (EXISTS (SELECT 1 FROM leads WHERE leads.id = lead_notes.lead_id AND is_account_member(leads.account_id)));

CREATE POLICY lead_notes_insert ON lead_notes FOR INSERT 
WITH CHECK (EXISTS (SELECT 1 FROM leads WHERE leads.id = lead_notes.lead_id AND is_account_member(leads.account_id, 'agent')));

CREATE POLICY lead_notes_update ON lead_notes FOR UPDATE 
USING (EXISTS (SELECT 1 FROM leads WHERE leads.id = lead_notes.lead_id AND is_account_member(leads.account_id, 'agent')));

CREATE POLICY lead_notes_delete ON lead_notes FOR DELETE 
USING (EXISTS (SELECT 1 FROM leads WHERE leads.id = lead_notes.lead_id AND is_account_member(leads.account_id, 'agent')));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at ON lead_notes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
