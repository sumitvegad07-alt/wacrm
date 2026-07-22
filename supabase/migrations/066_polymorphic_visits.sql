-- ============================================================
-- 066_polymorphic_visits.sql
-- Upgrades site_visits to support polymorphic VisitTargetTypes
-- (Customer, Lead, Supplier, Vendor, Employee, Prospect, etc.)
-- without breaking backward compatibility for existing contact_id queries.
-- ============================================================

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS target_type TEXT,
  ADD COLUMN IF NOT EXISTS target_id UUID;

-- Migrate existing visits to the new polymorphic structure
UPDATE site_visits
SET target_type = 'Customer', target_id = contact_id
WHERE contact_id IS NOT NULL AND target_type IS NULL;

-- Create an index for faster lookup by polymorphic target
CREATE INDEX IF NOT EXISTS idx_site_visits_target ON site_visits(target_type, target_id);
