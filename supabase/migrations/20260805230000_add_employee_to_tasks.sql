ALTER TABLE tasks ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES profiles(id) ON DELETE SET NULL; CREATE INDEX IF NOT EXISTS idx_tasks_employee_id ON tasks(employee_id);
