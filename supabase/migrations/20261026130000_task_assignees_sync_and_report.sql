-- ============================================================
-- 20261026130000_task_assignees_sync_and_report.sql
--
-- Two follow-ups to 20261026120000_task_assignees.sql:
--   1. keep task_assignees in step with anything that still writes only
--      tasks.assigned_user_id
--   2. make the Task report count every assignee, not just the first
--
-- Run AFTER 20261026120000_task_assignees.sql.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ANYTHING THAT SETS assigned_user_id GETS AN ASSIGNEE ROW
--
-- The import engine writes assigned_user_id directly, deep inside
-- import_commit. So does every APK already installed on a rep's phone, and so
-- will anything else written against the old column. Rather than chase each
-- writer — import_commit alone is hundreds of lines and rewriting it to add
-- one insert is a large change for a small need — the database closes the gap
-- itself. One trigger covers every path, present and future.
--
-- Only ever adds. Removing people is the app's job; a task whose assignee was
-- changed by an old client keeps the previous person as a second assignee,
-- which is visible and fixable, rather than silently losing their completion.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tasks_sync_assignee_row() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_user_id IS NOT NULL AND NEW.account_id IS NOT NULL THEN
    INSERT INTO task_assignees (account_id, task_id, profile_id, status, completed_at)
    VALUES (
      NEW.account_id,
      NEW.id,
      NEW.assigned_user_id,
      CASE WHEN NEW.status = 'Completed' THEN 'Completed' ELSE 'Pending' END,
      CASE WHEN NEW.status = 'Completed' THEN NOW() END
    )
    ON CONFLICT (task_id, profile_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tasks_sync_assignee_row ON tasks;
CREATE TRIGGER trg_tasks_sync_assignee_row
  AFTER INSERT OR UPDATE OF assigned_user_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_sync_assignee_row();

-- ------------------------------------------------------------
-- 1b. COMPLETING THE TASK ITSELF COMPLETES IT FOR EVERYONE
--
-- Someone who is not an assignee — a manager, an automation, an old APK — can
-- still set tasks.status directly. Without this the assignee rows would stay
-- Pending underneath, and the next person to tick their own box would send
-- the rollup recalculating and quietly reopen a task the manager had closed.
--
-- The WHERE guard matters: when the rollup is what completed the task, every
-- row is already Completed, this updates nothing, and the trigger chain ends
-- instead of bouncing between the two tables.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tasks_complete_all_assignees() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE task_assignees
     SET status = 'Completed', completed_at = COALESCE(completed_at, NOW())
   WHERE task_id = NEW.id AND status <> 'Completed';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tasks_complete_all_assignees ON tasks;
CREATE TRIGGER trg_tasks_complete_all_assignees
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW
  WHEN (NEW.status = 'Completed' AND OLD.status IS DISTINCT FROM 'Completed')
  EXECUTE FUNCTION tasks_complete_all_assignees();

-- ------------------------------------------------------------
-- 2. THE TASK REPORT READS EVERY ASSIGNEE
--
-- WARNING — THIS CHANGES REPORTED NUMBERS.
-- Grouped by assignee, a task with three people becomes three rows instead of
-- one. That is the right answer to "how many tasks does Priya have", but it
-- will not match an export taken before this ran. Agreed with the founder
-- before building.
--
-- `u` still resolves to profiles, so every dimension and measure already
-- written against `u.` keeps working untouched.
-- ------------------------------------------------------------
UPDATE report_registry_joins
   SET sql_join = 'LEFT JOIN task_assignees ta ON ta.task_id = base.id LEFT JOIN profiles u ON ta.profile_id = u.id'
 WHERE module_name = 'task' AND join_key = 'assignee';

-- The "Assigned to" filter matches a task when the chosen person is ANY of its
-- assignees. Its own alias (ta2), because this SQL and the join's SQL can land
-- in the same statement and reusing `ta` would collide.
--
-- Compared as TEXT and never cast to uuid, exactly as the original did: the
-- object payload shape would otherwise raise 22P02 instead of simply not
-- matching.
UPDATE report_registry_filters
   SET sql_where = 'EXISTS (SELECT 1 FROM task_assignees ta2 WHERE ta2.task_id = base.id AND ta2.profile_id IN (SELECT p.id FROM profiles p WHERE p.user_id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'') OR p.id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'')))'
 WHERE module_name = 'task' AND key = 'user';
