-- ============================================================
-- TASKS MODULE
-- ============================================================

-- TASKS TABLE
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Waiting', 'Completed', 'Cancelled')),
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  assigned_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date DATE,
  due_time TIME,
  start_date DATE,
  reminder_date DATE,
  reminder_time TIME,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_user_id ON tasks(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact_id ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal_id ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_conversation_id ON tasks(conversation_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own tasks" ON tasks;
CREATE POLICY "Users can manage own tasks" ON tasks FOR ALL USING (auth.uid() = user_id);

-- TASK COMMENTS
CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own task comments" ON task_comments;
CREATE POLICY "Users can manage own task comments" ON task_comments FOR ALL USING (auth.uid() = user_id);

-- TASK CHECKLISTS
CREATE TABLE IF NOT EXISTS task_checklists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_checklists_task_id ON task_checklists(task_id);

ALTER TABLE task_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage task checklists" ON task_checklists;
CREATE POLICY "Users can manage task checklists" ON task_checklists FOR ALL 
  USING (EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_checklists.task_id AND tasks.user_id = auth.uid()));

-- TASK ATTACHMENTS
CREATE TABLE IF NOT EXISTS task_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  content_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);

ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own task attachments" ON task_attachments;
CREATE POLICY "Users can manage own task attachments" ON task_attachments FOR ALL USING (auth.uid() = user_id);

-- UPDATED_AT TRIGGERS
DROP TRIGGER IF EXISTS set_updated_at ON tasks;
DROP TRIGGER IF EXISTS set_updated_at ON task_comments;
DROP TRIGGER IF EXISTS set_updated_at ON task_checklists;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON task_comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON task_checklists FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- INSERT STORAGE BUCKET FOR TASK ATTACHMENTS IF NOT EXISTS
-- Storage API runs in auth schema, but we can configure buckets here
INSERT INTO storage.buckets (id, name, public) 
VALUES ('task-attachments', 'task-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "Users can manage their task attachments" ON storage.objects;
CREATE POLICY "Users can manage their task attachments" ON storage.objects FOR ALL
  USING (bucket_id = 'task-attachments' AND auth.uid() = owner);
