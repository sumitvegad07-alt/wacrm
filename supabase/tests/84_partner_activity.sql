-- ============================================================
-- 2026-11-24 — My Activity (20261124120000).
--
-- A5 is the scenario that matters most: a SECOND assignee must be able to
-- see the activity. The old policy read assignee_id alone, so whoever was
-- added second would have found the screen called My Activity empty — no
-- error, no empty state explaining itself, just nothing. A5 isolates that
-- arm of the policy on purpose: REP2 has 'own' scope and is NOT the
-- activity's assignee_id and did NOT create it, so the assignee-row arm is
-- the only thing that can make it visible.
--
-- A7 is the one that nearly went unwritten: an activity with nobody on it
-- must stay visible to its author. The rollup sets assignee_id to NULL by
-- design, and NULL is in no scope.
--
-- A13/A14 are the per-person tick. Both reps are on the shared activity, so
-- the parent is visible to both and the only thing deciding the write is
-- partner_task_assignees_tick_own. REP1 and REP2 hold a role WITHOUT
-- edit_activities for exactly this reason — the seeded Sales Executive has
-- that right, which would have made the test prove nothing.
--
-- ---------------------------------------------------------------------
-- WHEN qa_refused IS THE RIGHT TOOL, AND WHEN IT LIES
-- ---------------------------------------------------------------------
-- qa_refused() passes if the statement RAISES. Triggers, CHECKs, unique
-- indexes and foreign keys raise, so it is right for those. Row-level
-- security on UPDATE or DELETE does NOT raise — it filters rows away, so
-- the statement completes quietly and qa_refused reports "refused" even
-- against a table with RLS switched off. For those, run the statement
-- plainly and then assert the row did not change, read back as postgres.
-- Got wrong three times across files 81 and 82 before it was written down.
--
-- A second, quieter trap: qa_refused catches EVERY exception, so a typo in
-- its SQL passes too. Each refusal below is paired with a qa_allowed of the
-- same statement with only the forbidden part changed — if the statement is
-- broken for an unrelated reason, the pair fails.
-- ============================================================
\set ON_ERROR_STOP on

\set BOSS  '''e0000000-0000-0000-0000-00000000000a'''
\set REP1  '''e0000000-0000-0000-0000-00000000000b'''
\set REP2  '''e0000000-0000-0000-0000-00000000000c'''
\set OUTSID '''e0000000-0000-0000-0000-00000000000d'''

RESET ROLE;
SELECT set_config('test.uid', '', false);

-- Clean slate. partner_task_assignees cascades from partner_tasks, but the
-- delete is spelt out so a half-finished previous run cannot leave orphans
-- that the unique (task_id, employee_id) index would then reject.
DELETE FROM public.partner_task_assignees WHERE task_id IN
  (SELECT id FROM public.partner_tasks
    WHERE title LIKE 'QA5 %' OR description LIKE 'QA5 %');
DELETE FROM public.partner_module_activities WHERE message LIKE 'QA5 %';
DELETE FROM public.partner_tasks     WHERE title LIKE 'QA5 %' OR description LIKE 'QA5 %';
DELETE FROM public.partner_employees WHERE email LIKE '%@act.test';
DELETE FROM auth.users               WHERE email LIKE '%@act.test';
DELETE FROM public.partner_roles     WHERE name LIKE 'QA5 %';

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:BOSS,   'boss@act.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:REP1,   'rep1@act.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:REP2,   'rep2@act.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:OUTSID, 'out@act.test',   '{"skip_account_provision":"true"}'::jsonb);

-- A role with NO edit_activities. The seeded Sales Executive has it, so
-- using that role would make A13 and A14 pass for the wrong reason.
INSERT INTO public.partner_roles (name, description, permissions, data_scope, is_system)
VALUES ('QA5 Viewer',
        'Sees and adds activities. Cannot edit them.',
        '{"view_activities": true, "create_activities": true}'::jsonb,
        'own', false);

INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :BOSS, 'QA5 Boss', 'boss@act.test', id, 'active'
  FROM public.partner_roles WHERE name = 'Sales Manager';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status, manager_id)
SELECT :REP1, 'QA5 Rep One', 'rep1@act.test', r.id, 'active', b.id
  FROM public.partner_roles r, public.partner_employees b
 WHERE r.name = 'QA5 Viewer' AND b.email = 'boss@act.test';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status, manager_id)
SELECT :REP2, 'QA5 Rep Two', 'rep2@act.test', r.id, 'active', b.id
  FROM public.partner_roles r, public.partner_employees b
 WHERE r.name = 'QA5 Viewer' AND b.email = 'boss@act.test';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :OUTSID, 'QA5 Outsider', 'out@act.test', id, 'active'
  FROM public.partner_roles WHERE name = 'QA5 Viewer';

-- Captured BEFORE any SET ROLE: after the switch, RLS hides rows these
-- \gset queries need and psql errors "no rows returned".
SELECT id AS e_boss   FROM public.partner_employees WHERE email = 'boss@act.test'  \gset
SELECT id AS e_rep1   FROM public.partner_employees WHERE email = 'rep1@act.test'  \gset
SELECT id AS e_rep2   FROM public.partner_employees WHERE email = 'rep2@act.test'  \gset
SELECT id AS e_outsid FROM public.partner_employees WHERE email = 'out@act.test'   \gset

-- ── A0 the fixture ───────────────────────────────────────────
SELECT qa('84.A0 four people exist, three of them without edit_activities',
  (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@act.test') = 4,
  'got ' || (SELECT count(*) FROM public.partner_employees WHERE email LIKE '%@act.test'));

-- ── A1 the schema change itself ──────────────────────────────
SELECT qa('84.A1 the columns are title, description and activity_type',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_tasks'
      AND column_name IN ('title','description','activity_type',
                          'start_date','reminder_date','reminder_time')) = 6
  AND (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_tasks'
      AND column_name IN ('subject','detail','kind')) = 0,
  'still present: ' || coalesce((SELECT string_agg(column_name, ', ')
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_tasks'
      AND column_name IN ('subject','detail','kind')), 'none'));

SELECT qa('84.A1b assignee_id is nullable now',
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_tasks'
      AND column_name = 'assignee_id') = 'YES',
  'the rollup sets it to NULL when the last person leaves an activity');

SELECT qa('84.A1c the six activity types are seeded',
  (SELECT count(*) FROM public.partner_activity_types
    WHERE name IN ('Task','Call','Visit','Meeting','Follow up','Note')) = 6,
  'got ' || (SELECT count(*) FROM public.partner_activity_types));

-- ── A2 the activity type guard (a trigger, so it RAISES) ─────
SELECT qa_refused('84.A2 an unknown activity type is refused', format($$
  INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
  VALUES ('QA5 bad type', 'Teleportation', %L, %L)
$$, :'e_rep1', :'e_rep1'));

-- The pair that proves A2 failed for the RIGHT reason. Same statement, a
-- type that exists. Without this, a typo in A2 would also "pass".
SELECT qa_allowed('84.A2b the same insert works with a real type', format($$
  INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
  VALUES ('QA5 good type', 'Visit', %L, %L)
$$, :'e_rep1', :'e_rep1'));

-- ── A3 the master's spelling wins ────────────────────────────
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
VALUES ('QA5 case test', 'cALL', :'e_rep1', :'e_rep1');
SELECT qa('84.A3 the master spelling wins over whatever the caller typed',
  (SELECT activity_type FROM public.partner_tasks WHERE description = 'QA5 case test') = 'Call',
  'otherwise "call" and "Call" appear as two different types in a filter');

-- ── A4 an activity with no words at all (a CHECK, so it RAISES) ──
SELECT qa_refused('84.A4 an activity with neither title nor description is refused', $$
  INSERT INTO public.partner_tasks (title, description, activity_type)
  VALUES ('  ', NULL, 'Task')
$$);

SELECT qa_allowed('84.A4b a title alone is enough', $$
  INSERT INTO public.partner_tasks (title, description, activity_type)
  VALUES ('QA5 title only', NULL, 'Task')
$$);

-- ── the shared activity both reps are on ─────────────────────
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by, due_date)
VALUES ('QA5 shared call', 'Call', :'e_rep1', :'e_rep1', current_date);
SELECT id AS shared_id FROM public.partner_tasks WHERE description = 'QA5 shared call' \gset

INSERT INTO public.partner_task_assignees (task_id, employee_id) VALUES
  (:'shared_id', :'e_rep1');
INSERT INTO public.partner_task_assignees (task_id, employee_id) VALUES
  (:'shared_id', :'e_rep2');

-- An activity with nobody on it, created by REP1. assignee_id is NULL from
-- the start, which is the (a) half of the visibility trap.
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
VALUES ('QA5 orphan note', 'Note', NULL, :'e_rep1');

-- ── A5-A7 who can see what ───────────────────────────────────
SET ROLE authenticated;

SELECT set_config('test.uid', :REP2, false);
SELECT qa('84.A5 THE SECOND ASSIGNEE SEES THE SHARED ACTIVITY',
  (SELECT count(*) FROM public.partner_tasks WHERE description = 'QA5 shared call') = 1,
  'REP2 is not assignee_id and did not create it: only the assignee-row arm '
  'of partner_tasks_select can make this visible');

SELECT qa('84.A6 and not REP1''s other activities',
  (SELECT count(*) FROM public.partner_tasks WHERE description = 'QA5 orphan note') = 0,
  'the clause must widen to the shared activity, not to REP1''s whole list');

SELECT set_config('test.uid', :REP1, false);
SELECT qa('84.A7 an unassigned activity is still visible to whoever made it',
  (SELECT count(*) FROM public.partner_tasks WHERE description = 'QA5 orphan note') = 1,
  'the rollup nulls assignee_id by design, and NULL is in no scope');

SELECT set_config('test.uid', :OUTSID, false);
SELECT qa('84.A8 somebody on another branch sees none of it',
  (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %') = 0,
  'got ' || (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %'));

SELECT set_config('test.uid', :BOSS, false);
SELECT qa('84.A9 the manager sees the team''s activities',
  (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %') >= 4,
  'got ' || (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %'));

RESET ROLE;
SELECT set_config('test.uid', '', false);

-- ── A10-A14 the rollup, as postgres (it is a trigger, not a policy) ──
UPDATE public.partner_task_assignees SET status = 'Completed', completed_at = now()
 WHERE task_id = :'shared_id' AND employee_id = :'e_rep1';
SELECT qa('84.A10 one of two done does not finish the activity',
  (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Pending',
  'status is ' || (SELECT status FROM public.partner_tasks WHERE id = :'shared_id'));

UPDATE public.partner_task_assignees SET status = 'Completed', completed_at = now()
 WHERE task_id = :'shared_id' AND employee_id = :'e_rep2';
SELECT qa('84.A11 everyone done completes the activity',
  (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Completed',
  'status is ' || (SELECT status FROM public.partner_tasks WHERE id = :'shared_id'));
SELECT qa('84.A11b and stamps completed_at',
  (SELECT completed_at IS NOT NULL FROM public.partner_tasks WHERE id = :'shared_id'),
  'a finished activity with no finish time is no use to a report');

INSERT INTO public.partner_task_assignees (task_id, employee_id)
VALUES (:'shared_id', :'e_boss');
SELECT qa('84.A12 adding somebody to a finished activity reopens it',
  (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Pending',
  'status is ' || (SELECT status FROM public.partner_tasks WHERE id = :'shared_id'));
SELECT qa('84.A12b and clears completed_at again',
  (SELECT completed_at IS NULL FROM public.partner_tasks WHERE id = :'shared_id'),
  'an activity that is not finished must not carry a finish time');

UPDATE public.partner_tasks SET status = 'Cancelled' WHERE id = :'shared_id';
UPDATE public.partner_task_assignees SET status = 'Pending', completed_at = NULL
 WHERE task_id = :'shared_id';
SELECT qa('84.A13 a cancelled activity is never resurrected by the rollup',
  (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Cancelled',
  'only Completed is derived; a hand-set status is left alone');

UPDATE public.partner_tasks SET status = 'Waiting' WHERE id = :'shared_id';
DELETE FROM public.partner_task_assignees WHERE task_id = :'shared_id';
SELECT qa('84.A14 with nobody left, assignee_id is null',
  (SELECT assignee_id IS NULL FROM public.partner_tasks WHERE id = :'shared_id'),
  'assignee_id is ' || coalesce((SELECT assignee_id::text FROM public.partner_tasks
                                  WHERE id = :'shared_id'), 'NULL'));
SELECT qa('84.A14b and the hand-set status survives',
  (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Waiting',
  'there is nothing to roll up from, so completing it would be a lie');

-- ── A15-A16 the per-person tick ──────────────────────────────
-- Both reps back on the shared activity, so the PARENT is visible to both
-- and the only rule deciding these two writes is
-- partner_task_assignees_tick_own.
UPDATE public.partner_tasks SET status = 'Pending' WHERE id = :'shared_id';
INSERT INTO public.partner_task_assignees (task_id, employee_id) VALUES
  (:'shared_id', :'e_rep1');
INSERT INTO public.partner_task_assignees (task_id, employee_id) VALUES
  (:'shared_id', :'e_rep2');

SET ROLE authenticated;
SELECT set_config('test.uid', :REP1, false);

-- NOT qa_refused: RLS filters on UPDATE, it does not raise. See the rule at
-- the top of this file.
UPDATE public.partner_task_assignees SET status = 'Completed', completed_at = now()
 WHERE task_id = :'shared_id' AND employee_id = :'e_rep1';

UPDATE public.partner_task_assignees SET status = 'Completed', completed_at = now()
 WHERE task_id = :'shared_id' AND employee_id = :'e_rep2';

RESET ROLE;
SELECT set_config('test.uid', '', false);

SELECT qa('84.A15 a rep WITHOUT edit_activities can finish their own work',
  (SELECT status FROM public.partner_task_assignees
    WHERE task_id = :'shared_id' AND employee_id = :'e_rep1') = 'Completed',
  'status is ' || (SELECT status FROM public.partner_task_assignees
                    WHERE task_id = :'shared_id' AND employee_id = :'e_rep1'));

SELECT qa('84.A16 but cannot finish the other rep''s, on the same activity',
  (SELECT status FROM public.partner_task_assignees
    WHERE task_id = :'shared_id' AND employee_id = :'e_rep2') = 'Pending',
  'status is ' || (SELECT status FROM public.partner_task_assignees
                    WHERE task_id = :'shared_id' AND employee_id = :'e_rep2'));

-- ── A16c a rep cannot MOVE their own row to another activity ─
-- The hole partner_task_assignees_tick_own opens on its own: it allows an
-- UPDATE of any column of your own row, task_id included, and the assignee
-- arm of partner_tasks_select then grants read on whatever you attached
-- yourself to. A BEFORE UPDATE trigger closes it, and a trigger RAISES, so
-- qa_refused is the right tool here.
SELECT id AS other_id FROM public.partner_tasks WHERE description = 'QA5 orphan note' \gset

SET ROLE authenticated;
SELECT set_config('test.uid', :REP1, false);
SELECT qa_refused('84.A16c a rep cannot move their own row onto another activity', format($$
  UPDATE public.partner_task_assignees SET task_id = %L
   WHERE task_id = %L AND employee_id = %L
$$, :'other_id', :'shared_id', :'e_rep1'));
RESET ROLE;
SELECT set_config('test.uid', '', false);

SELECT qa('84.A16d and the row is still on the activity it belonged to',
  (SELECT count(*) FROM public.partner_task_assignees
    WHERE task_id = :'shared_id' AND employee_id = :'e_rep1') = 1,
  'the trigger must refuse the move, not merely be present');

-- ── A16e reading either table does not recurse ───────────────
-- The first draft of this migration had partner_tasks_select ask
-- partner_task_assignees and partner_task_assignees_select ask
-- partner_tasks. Postgres answered "infinite recursion detected in policy
-- for relation partner_tasks" and refused EVERY read of both tables. Each
-- policy was a correct read on its own; the cycle was only visible here.
SET ROLE authenticated;
SELECT set_config('test.uid', :REP2, false);
SELECT qa('84.A16e reading the assignee rows of a visible activity works',
  (SELECT count(*) FROM public.partner_task_assignees
    WHERE task_id = :'shared_id') >= 1,
  'a recursive policy pair makes this error rather than return a number');
SELECT qa('84.A16f and reading the activities themselves still works',
  (SELECT count(*) FROM public.partner_tasks WHERE description = 'QA5 shared call') = 1,
  'both directions, because the cycle broke both');
RESET ROLE;
SELECT set_config('test.uid', '', false);

-- ── A17 the old two-value status is gone ─────────────────────
SELECT qa_refused('84.A17 the old Undone status is no longer accepted', format($$
  INSERT INTO public.partner_tasks (description, status, assignee_id, created_by)
  VALUES ('QA5 old status', 'Undone', %L, %L)
$$, :'e_rep1', :'e_rep1'));

SELECT qa_allowed('84.A17b and In Progress now is', format($$
  INSERT INTO public.partner_tasks (description, status, assignee_id, created_by)
  VALUES ('QA5 new status', 'In Progress', %L, %L)
$$, :'e_rep1', :'e_rep1'));

-- ── A18 an employee with activities can still be removed ─────
-- ON DELETE SET NULL on the parent and CASCADE on the child. The Phase 2A
-- shape was RESTRICT, which would have made an employee undeletable the
-- moment they were given any work.
SELECT qa_allowed('84.A18 an employee with activities can still be deleted', format($$
  DELETE FROM public.partner_employees WHERE id = %L
$$, :'e_outsid'));

-- ── clean up ─────────────────────────────────────────────────
DELETE FROM public.partner_task_assignees WHERE task_id IN
  (SELECT id FROM public.partner_tasks
    WHERE title LIKE 'QA5 %' OR description LIKE 'QA5 %');
DELETE FROM public.partner_tasks     WHERE title LIKE 'QA5 %' OR description LIKE 'QA5 %';
DELETE FROM public.partner_employees WHERE email LIKE '%@act.test';
DELETE FROM auth.users               WHERE email LIKE '%@act.test';
DELETE FROM public.partner_roles     WHERE name LIKE 'QA5 %';
