-- ============================================================
-- Migration 096: Custom Field Sections & Priority Ordering
-- ============================================================

-- 1. Create table custom_field_sections
CREATE TABLE IF NOT EXISTS custom_field_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL DEFAULT 'contact',
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, module_name, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_sections_account_module 
  ON custom_field_sections(account_id, module_name, position);

ALTER TABLE custom_field_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_field_sections_select ON custom_field_sections;
DROP POLICY IF EXISTS custom_field_sections_insert ON custom_field_sections;
DROP POLICY IF EXISTS custom_field_sections_update ON custom_field_sections;
DROP POLICY IF EXISTS custom_field_sections_delete ON custom_field_sections;

CREATE POLICY custom_field_sections_select ON custom_field_sections
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY custom_field_sections_insert ON custom_field_sections
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY custom_field_sections_update ON custom_field_sections
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY custom_field_sections_delete ON custom_field_sections
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 2. Extend custom_fields table
ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES custom_field_sections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS field_id_number SERIAL;

CREATE INDEX IF NOT EXISTS idx_custom_fields_section 
  ON custom_fields(section_id, position);

-- 3. Backfill existing custom_fields with a default section
DO $$
DECLARE
  r RECORD;
  v_section_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT account_id, COALESCE(module_name, 'contact') AS module_name
    FROM custom_fields
    WHERE section_id IS NULL AND account_id IS NOT NULL
  LOOP
    INSERT INTO custom_field_sections (id, account_id, module_name, name, position)
    VALUES (uuid_generate_v4(), r.account_id, r.module_name, 'General Details', 0)
    ON CONFLICT (account_id, module_name, name) DO NOTHING;

    SELECT id INTO v_section_id
    FROM custom_field_sections
    WHERE account_id = r.account_id AND module_name = r.module_name AND name = 'General Details'
    LIMIT 1;

    IF v_section_id IS NOT NULL THEN
      UPDATE custom_fields
      SET section_id = v_section_id
      WHERE account_id = r.account_id
        AND COALESCE(module_name, 'contact') = r.module_name
        AND section_id IS NULL;
    END IF;
  END LOOP;
END $$;
