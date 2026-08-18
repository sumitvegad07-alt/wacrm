-- Task report on the generic report engine.
--
-- ── FK traps on `tasks` ──────────────────────────────────────────────────────
-- BOTH user columns exist on this one table and point at DIFFERENT keys:
--   assigned_user_id -> profiles(id)   the assignee: who must do it
--   user_id          -> auth uid       the creator: who raised it
-- Verified on prod: 10/10 assignees match profiles.id and 0 match user_id;
-- 14/14 creators match user_id and 0 match profiles.id. Guessing wrong gives a
-- silently empty column rather than an error, because the LEFT JOIN just never
-- matches. Same shape as the expenses table (see §5h).
--
-- ── Dating ───────────────────────────────────────────────────────────────────
-- Tasks are dated by due_date, FALLING BACK to created_at. 3 of 14 prod tasks
-- have no due date; dating strictly by due_date would silently drop them from
-- every period, so the report would under-report while looking perfectly
-- healthy. "When was it meant to happen, else when was it raised."
--
-- ── Counts / status ──────────────────────────────────────────────────────────
-- The tasks table stores five statuses (Pending | In Progress | Waiting |
-- Completed | Cancelled, per src/components/tasks/task-form.tsx STATUSES) but
-- the REPORT exposes only two, by founder decision 2026-08-18:
--   Done   = status = 'Completed'
--   Undone = everything else, INCLUDING Cancelled and NULL
-- "All" is simply leaving the Status filter unset. So
--   # done + # undone = # task
-- exactly, with no third bucket to leak into. `# overdue` is deliberately NOT
-- part of that sum: it is a SUBSET of undone (past due and still open), so
-- adding it in would double-count.
--
-- ── Types ────────────────────────────────────────────────────────────────────
-- Every string column here is genuinely `text` (status, priority, activity_type
-- are NOT enums, unlike expenses.status). Checked rather than assumed — see §5i.

-- ── Base table ───────────────────────────────────────────────────────────────
-- Patched in place off pg_get_functiondef so the rest of the function cannot
-- regress to an older copy; refuses to run if the switch has drifted, no-op if
-- already applied.
DO $do$
DECLARE
  v_def    text;
  v_anchor text := E'  ELSE\n    RAISE EXCEPTION ''Unsupported module: %'', p_module;\n  END IF;';
  v_new    text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'execute_report';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'execute_report not found';
  END IF;

  IF position('p_module = ''task''' IN v_def) > 0 THEN
    RAISE NOTICE 'execute_report already knows the task module; nothing to do';
    RETURN;
  END IF;

  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'execute_report module switch has drifted; refusing to patch blindly';
  END IF;

  v_new := $repl$  ELSIF p_module = 'task' THEN
    v_base_table := 'tasks';
    v_registry_modules := ARRAY['task'];
$repl$ || v_anchor;

  EXECUTE replace(v_def, v_anchor, v_new);
END
$do$;

-- ── Joins ────────────────────────────────────────────────────────────────────
INSERT INTO report_registry_joins (module_name, join_key, sql_join) VALUES
-- profiles(id) — the assignee.
('task', 'assignee',  'LEFT JOIN profiles u ON base.assigned_user_id = u.id'),
-- auth uid — the creator.
('task', 'creator',   'LEFT JOIN profiles cr ON base.user_id = cr.user_id'),
('task', 'contacts',  'LEFT JOIN contacts c ON base.contact_id = c.id'),
('task', 'leads_all', 'LEFT JOIN leads l ON base.lead_id = l.id'),
-- INNER, so the Customer tab lists only customer tasks and the Lead tab only
-- lead tasks, instead of collapsing the other side into one blank row.
('task', 'customer',  'JOIN contacts cq ON base.contact_id = cq.id'),
('task', 'lead',      'JOIN leads lq ON base.lead_id = lq.id'),
('task', 'territory', 'LEFT JOIN territories t ON COALESCE(c.territory_id, l.territory_id) = t.id')
ON CONFLICT (module_name, join_key) DO UPDATE SET sql_join = EXCLUDED.sql_join;

-- ── Dimensions ───────────────────────────────────────────────────────────────
INSERT INTO report_registry_dimensions (module_name, key, label, sql_select, required_joins) VALUES
('task', 'customer',      'Customer',      'COALESCE(cq.company, cq.name)', '["customer"]'),
('task', 'lead',          'Lead',          'COALESCE(lq.company, lq.name)', '["lead"]'),
('task', 'user',          'User',          'COALESCE(u.full_name, u.email, ''Unassigned'')', '["assignee"]'),
('task', 'created_by',    'Created By',    'COALESCE(cr.full_name, cr.email, ''Unknown'')', '["creator"]'),
('task', 'area',          'Area',          'COALESCE(NULLIF(c.area, ''''), NULLIF(t.name, ''''), NULLIF(l.city, ''''), ''-'')', '["contacts","leads_all","territory"]'),
('task', 'city',          'City',          'COALESCE(NULLIF(c.city, ''''), NULLIF(l.city, ''''), ''-'')', '["contacts","leads_all"]'),
('task', 'state',         'State',         'COALESCE(NULLIF(c.state, ''''), NULLIF(l.state, ''''), ''-'')', '["contacts","leads_all"]'),
('task', 'country',       'Country',       'COALESCE(NULLIF(c.country, ''''), NULLIF(l.country, ''''), ''India'')', '["contacts","leads_all"]'),
('task', 'date',          'Period',        'TO_CHAR(COALESCE(base.due_date, base.created_at::date), ''FMMonth YYYY'')', '[]'),
('task', 'activity_type', 'Activity Type', 'COALESCE(NULLIF(base.activity_type, ''''), ''Task'')', '[]'),
-- Two states, not five — see the header.
('task', 'status',        'Status',        'CASE WHEN base.status = ''Completed'' THEN ''Done'' ELSE ''Undone'' END', '[]'),
('task', 'priority',      'Priority',      'COALESCE(NULLIF(base.priority, ''''), ''Medium'')', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, required_joins = EXCLUDED.required_joins;

-- ── Measures ─────────────────────────────────────────────────────────────────
INSERT INTO report_registry_measures (module_name, key, label, sql_select, type, required_joins) VALUES
('task', 'task_count',      '# task',      'COUNT(DISTINCT base.id)', 'number', '[]'),
('task', 'done_count',   '# done',   'COUNT(DISTINCT base.id) FILTER (WHERE base.status = ''Completed'')', 'number', '[]'),
-- COALESCE so a null status counts as undone rather than vanishing from both
-- columns and quietly breaking the reconciliation.
('task', 'undone_count', '# undone',
 'COUNT(DISTINCT base.id) FILTER (WHERE COALESCE(base.status, '''') <> ''Completed'')', 'number', '[]'),
-- A SUBSET of undone, not a third bucket — past due and still open.
('task', 'overdue_count',   '# overdue',
 'COUNT(DISTINCT base.id) FILTER (WHERE base.due_date IS NOT NULL AND base.due_date < CURRENT_DATE AND base.status NOT IN (''Completed'', ''Cancelled''))', 'number', '[]'),
-- Computed per group, never summed (§5e).
('task', 'completion_ratio', 'Done %',
 'ROUND(100.0 * COUNT(DISTINCT base.id) FILTER (WHERE base.status = ''Completed'') / NULLIF(COUNT(DISTINCT base.id), 0), 1)', 'percent', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_select = EXCLUDED.sql_select, type = EXCLUDED.type, required_joins = EXCLUDED.required_joins;

-- ── Filters ──────────────────────────────────────────────────────────────────
INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins) VALUES
('task', 'date_range', 'Period',
 'COALESCE(base.due_date, base.created_at::date) >= ($2::jsonb->''date_range''->>''start_date'')::date AND COALESCE(base.due_date, base.created_at::date) <= ($2::jsonb->''date_range''->>''end_date'')::date', '[]'),
-- Compares against the same CASE the dimension uses, so filtering and grouping
-- can never disagree about what "Done" means.
('task', 'status',        'Status',        '(CASE WHEN base.status = ''Completed'' THEN ''Done'' ELSE ''Undone'' END) = ($2::jsonb->>''status'')', '[]'),
('task', 'priority',      'Priority',      'base.priority = ($2::jsonb->>''priority'')', '[]'),
('task', 'activity_type', 'Activity Type', 'base.activity_type = ($2::jsonb->>''activity_type'')', '[]'),
('task', 'overdue', 'Overdue',
 'CASE WHEN ($2::jsonb->>''overdue'') = ''yes'' THEN (base.due_date IS NOT NULL AND base.due_date < CURRENT_DATE AND base.status NOT IN (''Completed'', ''Cancelled'')) ELSE NOT (base.due_date IS NOT NULL AND base.due_date < CURRENT_DATE AND base.status NOT IN (''Completed'', ''Cancelled'')) END', '[]'),
('task', 'customer', 'Customer', 'base.contact_id = ($2::jsonb->''customer''->>''contact_id'')::uuid', '[]'),
('task', 'lead', 'Lead', 'base.lead_id = ($2::jsonb->>''lead'')::uuid', '[]'),
-- Compared as TEXT, never cast to uuid (§5i): the object payload shape would
-- otherwise raise 22P02 instead of simply not matching.
('task', 'user', 'Assigned to',
 'base.assigned_user_id IN (SELECT p.id FROM profiles p WHERE p.user_id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user'') OR p.id::text = COALESCE($2::jsonb->''user''->>''user_id'', $2::jsonb->>''user''))', '[]'),
('task', 'created_by', 'Created by',
 'base.user_id IN (SELECT p.user_id FROM profiles p WHERE p.user_id::text = COALESCE($2::jsonb->''created_by''->>''user_id'', $2::jsonb->>''created_by'') OR p.id::text = COALESCE($2::jsonb->''created_by''->>''user_id'', $2::jsonb->>''created_by''))', '[]')
ON CONFLICT (module_name, key) DO UPDATE
  SET label = EXCLUDED.label, sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;

INSERT INTO report_registry_filters (module_name, key, label, sql_where, required_joins)
SELECT 'task', 'territory_' || lvl, 'Territory Level ' || lvl,
       'COALESCE(c.territory_id, l.territory_id) IN (WITH RECURSIVE t AS (SELECT id FROM territories WHERE id = ($2::jsonb->>''territory_' || lvl || ''')::uuid UNION ALL SELECT t2.id FROM territories t2 JOIN t ON t2.parent_id = t.id) SELECT id FROM t)',
       '["contacts","leads_all"]'
  FROM generate_series(1, 6) AS lvl
ON CONFLICT (module_name, key) DO UPDATE
  SET sql_where = EXCLUDED.sql_where, required_joins = EXCLUDED.required_joins;
