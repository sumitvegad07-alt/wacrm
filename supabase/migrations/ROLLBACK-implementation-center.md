# Rollback — Implementation Center (2026-09-20)

Migrations: `20260920120000_implementation_center.sql`, `20260920120100_seed_wfa_v1_template.sql`

To fully remove (dev/prod), run in the Supabase SQL editor:

```sql
DROP TABLE IF EXISTS impl_analytics_events, impl_milestone_progress, impl_task_progress,
  impl_answers, impl_step_progress, impl_progress,
  impl_milestones, impl_conditions, impl_validation_rules, impl_step_media,
  impl_step_questions, impl_step_tasks, impl_steps, impl_templates CASCADE;
```

Web: revert the feature commits; the sidebar entry and `/getting-started` route disappear with them.
Permissions `view_implementation` / `manage_implementation` are inert once the UI is gone.

To roll back only the seeded template (keeping the schema):

```sql
DELETE FROM impl_templates WHERE template_key = 'wfa_v1';
-- child rows (steps/tasks/questions/media/rules/conditions/milestones and all
-- runtime progress) cascade via ON DELETE CASCADE.
```
