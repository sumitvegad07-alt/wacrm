-- ============================================================
-- 054_contact_location.sql
-- Adds latitude and longitude to contacts for manual geo-tagging
-- ============================================================

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 8),
ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 8);
