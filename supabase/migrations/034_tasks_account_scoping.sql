-- ============================================================
-- 034_tasks_account_scoping.sql
-- Fixes the Tasks module RLS to use the multi-tenant pattern.
-- ============================================================

-- 1. ADD account_id TO ALL TASK TABLES
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE task_checklists ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

-- 2. BACKFILL account_id FROM profiles
-- Backfill tasks
UPDATE tasks
SET account_id = profiles.account_id
FROM profiles
WHERE tasks.user_id = profiles.user_id;

-- Backfill task_comments (from tasks)
UPDATE task_comments
SET account_id = tasks.account_id
FROM tasks
WHERE task_comments.task_id = tasks.id;

-- Backfill task_checklists (from tasks)
UPDATE task_checklists
SET account_id = tasks.account_id
FROM tasks
WHERE task_checklists.task_id = tasks.id;

-- Backfill task_attachments (from tasks)
UPDATE task_attachments
SET account_id = tasks.account_id
FROM tasks
WHERE task_attachments.task_id = tasks.id;

-- 3. ENFORCE account_id NOT NULL & ADD INDEXES
-- Delete any orphan tasks that couldn't be backfilled (defensive)
DELETE FROM tasks WHERE account_id IS NULL;
ALTER TABLE tasks ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_account_id ON tasks(account_id);

DELETE FROM task_comments WHERE account_id IS NULL;
ALTER TABLE task_comments ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_comments_account_id ON task_comments(account_id);

DELETE FROM task_checklists WHERE account_id IS NULL;
ALTER TABLE task_checklists ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_checklists_account_id ON task_checklists(account_id);

DELETE FROM task_attachments WHERE account_id IS NULL;
ALTER TABLE task_attachments ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_attachments_account_id ON task_attachments(account_id);

-- 4. UPDATE RLS POLICIES FOR tasks
DROP POLICY IF EXISTS "Users can manage own tasks" ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT USING (is_account_member(account_id));
CREATE POLICY tasks_insert ON tasks FOR INSERT WITH CHECK (is_account_member(account_id));
CREATE POLICY tasks_update ON tasks FOR UPDATE USING (is_account_member(account_id));
CREATE POLICY tasks_delete ON tasks FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 5. UPDATE RLS POLICIES FOR task_comments
DROP POLICY IF EXISTS "Users can manage own task comments" ON task_comments;
CREATE POLICY task_comments_select ON task_comments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY task_comments_insert ON task_comments FOR INSERT WITH CHECK (is_account_member(account_id));
CREATE POLICY task_comments_update ON task_comments FOR UPDATE USING (is_account_member(account_id));
CREATE POLICY task_comments_delete ON task_comments FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 6. UPDATE RLS POLICIES FOR task_checklists
DROP POLICY IF EXISTS "Users can manage task checklists" ON task_checklists;
CREATE POLICY task_checklists_select ON task_checklists FOR SELECT USING (is_account_member(account_id));
CREATE POLICY task_checklists_insert ON task_checklists FOR INSERT WITH CHECK (is_account_member(account_id));
CREATE POLICY task_checklists_update ON task_checklists FOR UPDATE USING (is_account_member(account_id));
CREATE POLICY task_checklists_delete ON task_checklists FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 7. UPDATE RLS POLICIES FOR task_attachments
DROP POLICY IF EXISTS "Users can manage own task attachments" ON task_attachments;
CREATE POLICY task_attachments_select ON task_attachments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY task_attachments_insert ON task_attachments FOR INSERT WITH CHECK (is_account_member(account_id));
CREATE POLICY task_attachments_update ON task_attachments FOR UPDATE USING (is_account_member(account_id));
CREATE POLICY task_attachments_delete ON task_attachments FOR DELETE USING (is_account_member(account_id, 'admin'));
