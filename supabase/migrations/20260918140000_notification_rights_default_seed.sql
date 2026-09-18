-- Default-role seed for Notifications & Alarms — existing tenants.
--
-- New accounts get these rights via provision-account (the "Sales Executive"
-- default role). This backfills the 20 existing tenants so their reps actually
-- receive their own task reminders/assignments, announcements, and the shift
-- punch alarm without an admin having to hand-grant each right.
--
-- Only NON-admin roles are touched (owner/admin resolve all-true already). The
-- merge (||) only adds these keys; admins can still revoke any of them in the
-- Roles editor, and each user can mute a category in their own settings.
-- receive_team_activity_notifications is deliberately NOT seeded to rep roles —
-- team-activity is an admin alert.

UPDATE employee_roles
SET permissions = permissions || jsonb_build_object(
  'receive_task_notifications', true,
  'receive_assignment_notifications', true,
  'receive_announcement_notifications', true,
  'receive_punch_alarm', true
)
WHERE COALESCE(permissions->>'all', '') <> 'true';
