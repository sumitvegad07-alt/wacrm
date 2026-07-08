-- ============================================================
-- 056_contact_address.sql
-- Adds city, state, country to contacts table
-- ============================================================

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS country TEXT;
