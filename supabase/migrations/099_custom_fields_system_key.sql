-- ============================================================
-- Migration 099: Custom Fields System Key (Predefined Fields)
-- ============================================================
-- Adds system_key column to custom_fields so admins can configure,
-- rename, reorder, and set visibility/validation on standard database
-- columns alongside custom fields in the Module Builder.

ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS system_key TEXT NULL;

ALTER TABLE custom_fields
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE custom_field_sections
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_custom_fields_system_key 
  ON custom_fields(account_id, module_name, system_key);
