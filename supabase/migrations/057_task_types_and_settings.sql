-- ============================================================
-- 057_task_types_and_settings.sql
-- Adds configurable task types via account settings and updates
-- tasks schema to support optional titles and activity_type.
-- ============================================================

-- 1. Add settings to accounts
ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"task_types": ["Task", "Call", "Visit", "Meeting", "Follow up", "Note"]}'::jsonb;

-- 2. Update tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'Task';

-- Make title optional (e.g. for Notes)
ALTER TABLE tasks
ALTER COLUMN title DROP NOT NULL;
