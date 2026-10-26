-- ============================================================
-- 20261026120000_task_assignees.sql
-- MULTI-USER TASK ASSIGNMENT
--
-- A task can be assigned to several people, and each marks their own
-- completion. The task is Completed only when everyone is.
--
-- tasks.assigned_user_id is NOT dropped. It keeps pointing at the first
-- assignee, maintained by the rollup trigger below, because the report engine,
-- the notification pipeline, the import engine and every APK already installed
-- on a rep's phone read that column. There is no moment when all clients are
-- new, so the old column has to keep telling the truth.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLE
--
-- Carries its own account_id and is scoped with is_account_member, which is
-- the pattern every other task child table uses (task_comments,
-- task_checklists, task_attachments — see 034_tasks_account_scoping.sql).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_assignees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_task_id ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_profile_id ON task_assignees(profile_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_account_id ON task_assignees(account_id);

-- ------------------------------------------------------------
-- 2. account_id IS DENORMALISED, NOT ASKED FOR
--
-- A BEFORE trigger fills it from the parent task on every path — web, mobile,
-- the import engine — so no caller can get it wrong or leave it null. Postgres
-- applies the RLS WITH CHECK to the row as it stands after BEFORE triggers,
-- so this runs early enough to satisfy the policy below.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION task_assignees_set_account() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    SELECT t.account_id INTO NEW.account_id FROM tasks t WHERE t.id = NEW.task_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_assignees_set_account ON task_assignees;
CREATE TRIGGER trg_task_assignees_set_account
  BEFORE INSERT OR UPDATE OF task_id ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION task_assignees_set_account();

-- ------------------------------------------------------------
-- 3. ROLLUP: assignee rows are the truth, tasks is the summary
--
-- The app sets tasks.assigned_user_id itself to the first person it is about
-- to insert, so the UPDATE below is usually a no-op for that column. That
-- matters: trg_notif_task_assigned_upd fires on a real change to
-- assigned_user_id, and letting this trigger change it would notify the first
-- assignee a second time.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION task_assignees_rollup() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task_id UUID := COALESCE(NEW.task_id, OLD.task_id);
  v_total   INT;
  v_done    INT;
  v_first   UUID;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'Completed')
    INTO v_total, v_done
    FROM task_assignees WHERE task_id = v_task_id;

  SELECT profile_id INTO v_first
    FROM task_assignees WHERE task_id = v_task_id
    ORDER BY created_at, id LIMIT 1;

  -- With no assignees left the task keeps whatever status it was given by
  -- hand: there is nobody to roll up from, and silently completing it would
  -- be a lie.
  IF v_total = 0 THEN
    UPDATE tasks SET assigned_user_id = NULL, updated_at = NOW()
     WHERE id = v_task_id AND assigned_user_id IS DISTINCT FROM NULL;
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE tasks
     SET assigned_user_id = v_first,
         status = CASE
                    WHEN v_done = v_total THEN 'Completed'
                    -- Dropping back out of Completed matters: adding a fourth
                    -- person to a finished task makes it unfinished again.
                    -- 'Cancelled' is not 'Completed', so a cancelled task is
                    -- never resurrected by this.
                    WHEN status = 'Completed' THEN 'Pending'
                    ELSE status
                  END,
         updated_at = NOW()
   WHERE id = v_task_id;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_task_assignees_rollup ON task_assignees;
CREATE TRIGGER trg_task_assignees_rollup
  AFTER INSERT OR UPDATE OF status OR DELETE ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION task_assignees_rollup();

-- ------------------------------------------------------------
-- 4. BACKFILL
--
-- One row per already-assigned task, so nothing changes for existing data.
-- Runs before RLS is enabled, and as the migration owner, so it is not
-- filtered. account_id is taken from the task directly rather than left to
-- the BEFORE trigger, to keep this a single scan.
-- ------------------------------------------------------------
INSERT INTO task_assignees (account_id, task_id, profile_id, status, completed_at)
SELECT t.account_id,
       t.id,
       t.assigned_user_id,
       CASE WHEN t.status = 'Completed' THEN 'Completed' ELSE 'Pending' END,
       CASE WHEN t.status = 'Completed' THEN t.updated_at END
  FROM tasks t
 WHERE t.assigned_user_id IS NOT NULL
   AND t.account_id IS NOT NULL
ON CONFLICT (task_id, profile_id) DO NOTHING;

-- ------------------------------------------------------------
-- 5. RLS
--
-- Mirrors the tasks policies exactly: read for any account member, write for
-- agent and above, delete for admin. auth.uid() is not called directly here —
-- is_account_member already wraps it the way the perf sprint requires.
-- ------------------------------------------------------------
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_assignees_select ON task_assignees;
CREATE POLICY task_assignees_select ON task_assignees FOR SELECT TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS task_assignees_insert ON task_assignees;
CREATE POLICY task_assignees_insert ON task_assignees FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS task_assignees_update ON task_assignees;
CREATE POLICY task_assignees_update ON task_assignees FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS task_assignees_delete ON task_assignees;
CREATE POLICY task_assignees_delete ON task_assignees FOR DELETE TO authenticated
  USING (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- 6. NOTIFY EVERY ASSIGNEE, NOT JUST THE FIRST
--
-- trg_notif_task_assigned_ins / _upd on tasks already cover whoever sits in
-- tasks.assigned_user_id. This covers the rest, and skips that person so
-- nobody is told twice. Wrapped in its own BEGIN/EXCEPTION like every other
-- notification trigger here: a failed notification must never fail the write.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notif_task_assignee_added() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_task FROM tasks WHERE id = NEW.task_id;
  IF FOUND AND NEW.profile_id IS DISTINCT FROM v_task.assigned_user_id THEN
    BEGIN
      PERFORM notif_emit_outbox(v_task.account_id, 'task_assigned', v_task.id,
                                to_jsonb(v_task), NEW.profile_id, NOW());
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notif task_assigned (extra assignee) % : %', NEW.task_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notif_task_assignee_added ON task_assignees;
CREATE TRIGGER trg_notif_task_assignee_added
  AFTER INSERT ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION notif_task_assignee_added();
