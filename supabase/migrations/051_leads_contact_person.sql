-- ============================================================
-- 051_leads_contact_person.sql
-- Adds contact_person field to leads table.
-- ============================================================

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS contact_person TEXT;
