-- ============================================================
-- 069_customer_address_fields.sql
-- Richer customer (contacts) address capture. city/state/country
-- and latitude/longitude already exist (migrations 055/056); this adds
-- the remaining fields so web manual entry and mobile GPS geo-tagging
-- can store a full address. Additive only.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address TEXT;   -- full street address
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS area TEXT;      -- locality / neighbourhood
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pincode TEXT;   -- postal / PIN code
