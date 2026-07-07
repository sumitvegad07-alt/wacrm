-- Migration: Relational Custom Fields
-- Adds source_type and source_module to custom_fields to support dynamic dropdowns.

-- Add the new columns
ALTER TABLE custom_fields
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'static', -- 'static' or 'module'
ADD COLUMN IF NOT EXISTS source_module TEXT; -- e.g., 'products', 'users', 'deals'

-- Drop existing function if it exists to replace it
DROP FUNCTION IF EXISTS filter_contacts_by_tags(uuid[], text, integer, integer);
