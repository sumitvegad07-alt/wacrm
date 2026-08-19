-- ============================================================
-- 20260820100000_tasks_scheme_link.sql
-- Let a task be linked to a scheme, so the Scheme Details page can carry task
-- management like every other module (contact, product, order, …). Additive:
-- one nullable column + its index + FK. Existing `tasks` RLS already governs the
-- row, so no policy change is needed.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS scheme_id uuid REFERENCES schemes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_scheme_id ON tasks(scheme_id);
