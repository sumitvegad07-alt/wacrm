-- Implementation Center ("Getting Started") — foundation
-- Spec: docs/superpowers/specs/2026-09-20-implementation-center-design.md
--
-- Definition tables are GLOBAL (no account_id): OZZO-authored, versioned, tenant
-- read-only. Runtime tables are per-account with RLS. Validation rules are declared
-- as data (source_key + operator + thresholds); the resolver code runs the queries.
-- Entirely additive.

-- ============================================================================
-- DEFINITION TABLES (global, versioned)
-- ============================================================================
CREATE TABLE IF NOT EXISTS impl_templates (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_line        text NOT NULL CHECK (product_line IN ('crm','wfa','sfa')),
  template_key        text NOT NULL,
  version             int  NOT NULL DEFAULT 1,
  name                text NOT NULL,
  display_name        text NOT NULL,
  description         text,
  estimated_minutes   int  NOT NULL DEFAULT 0,
  support_whatsapp_url text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impl_templates_key_version_uq UNIQUE (template_key, version)
);

CREATE TABLE IF NOT EXISTS impl_steps (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id       uuid NOT NULL REFERENCES impl_templates(id) ON DELETE CASCADE,
  position          int  NOT NULL,
  step_key          text NOT NULL,
  step_type         text NOT NULL DEFAULT 'task' CHECK (step_type IN ('task','discovery','milestone_gate')),
  title             text NOT NULL,
  description       text,
  video_url         text,
  quick_steps       jsonb NOT NULL DEFAULT '[]'::jsonb,
  help_text         text,
  help_context      text,
  estimated_minutes int NOT NULL DEFAULT 0,
  is_optional       boolean NOT NULL DEFAULT false,
  auto_complete     boolean NOT NULL DEFAULT true,
  weight            numeric NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impl_steps_template_key_uq UNIQUE (template_id, step_key)
);
CREATE INDEX IF NOT EXISTS impl_steps_template_idx ON impl_steps(template_id);

CREATE TABLE IF NOT EXISTS impl_step_tasks (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  step_id    uuid NOT NULL REFERENCES impl_steps(id) ON DELETE CASCADE,
  position   int  NOT NULL,
  label      text NOT NULL,
  help_text  text,
  deep_link  text,
  optional   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS impl_step_tasks_step_idx ON impl_step_tasks(step_id);

CREATE TABLE IF NOT EXISTS impl_step_questions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  step_id       uuid NOT NULL REFERENCES impl_steps(id) ON DELETE CASCADE,
  position      int  NOT NULL,
  question_key  text NOT NULL,
  label         text NOT NULL,
  input_type    text NOT NULL CHECK (input_type IN ('single_select','multi_select','text','bool')),
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,
  required      boolean NOT NULL DEFAULT false,
  CONSTRAINT impl_step_questions_key_uq UNIQUE (step_id, question_key)
);
CREATE INDEX IF NOT EXISTS impl_step_questions_step_idx ON impl_step_questions(step_id);

CREATE TABLE IF NOT EXISTS impl_step_media (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  step_id    uuid NOT NULL REFERENCES impl_steps(id) ON DELETE CASCADE,
  position   int  NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image','video')),
  url        text NOT NULL,
  caption    text
);
CREATE INDEX IF NOT EXISTS impl_step_media_step_idx ON impl_step_media(step_id);

CREATE TABLE IF NOT EXISTS impl_validation_rules (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  step_id               uuid NOT NULL REFERENCES impl_steps(id) ON DELETE CASCADE,
  source_key            text NOT NULL,
  operator              text NOT NULL CHECK (operator IN ('gt','gte','eq','exists')),
  required_threshold    numeric,
  recommended_threshold numeric,
  health_weight         numeric,
  params                jsonb,
  combine               text NOT NULL DEFAULT 'and' CHECK (combine IN ('and','or'))
);
CREATE INDEX IF NOT EXISTS impl_validation_rules_step_idx ON impl_validation_rules(step_id);

CREATE TABLE IF NOT EXISTS impl_conditions (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  step_id                 uuid NOT NULL REFERENCES impl_steps(id) ON DELETE CASCADE,
  depends_on_question_key text NOT NULL,
  comparator              text NOT NULL CHECK (comparator IN ('eq','neq','in','not_in','truthy')),
  value                   jsonb,
  effect                  text NOT NULL CHECK (effect IN ('show','hide','require','skip'))
);
CREATE INDEX IF NOT EXISTS impl_conditions_step_idx ON impl_conditions(step_id);

CREATE TABLE IF NOT EXISTS impl_milestones (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id      uuid NOT NULL REFERENCES impl_templates(id) ON DELETE CASCADE,
  position         int  NOT NULL,
  milestone_key    text NOT NULL,
  title            text NOT NULL,
  message          text,
  icon             text,
  trigger_step_key text NOT NULL,
  CONSTRAINT impl_milestones_key_uq UNIQUE (template_id, milestone_key)
);
CREATE INDEX IF NOT EXISTS impl_milestones_template_idx ON impl_milestones(template_id);

-- ============================================================================
-- RUNTIME TABLES (per-account, RLS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS impl_progress (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  template_id      uuid NOT NULL REFERENCES impl_templates(id) ON DELETE CASCADE,
  template_key     text NOT NULL,
  template_version int  NOT NULL,
  status           text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('not_started','in_progress','completed')),
  current_step_id  uuid,
  progress_pct     int NOT NULL DEFAULT 0,
  score            numeric NOT NULL DEFAULT 0,
  health_pct       int NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impl_progress_account_template_uq UNIQUE (account_id, template_key)
);
CREATE INDEX IF NOT EXISTS impl_progress_account_idx ON impl_progress(account_id);
CREATE INDEX IF NOT EXISTS impl_progress_template_idx ON impl_progress(template_id);

CREATE TABLE IF NOT EXISTS impl_step_progress (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  progress_id         uuid NOT NULL REFERENCES impl_progress(id) ON DELETE CASCADE,
  step_id             uuid NOT NULL REFERENCES impl_steps(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'available' CHECK (status IN ('locked','available','in_progress','completed','auto_completed','skipped')),
  auto                boolean NOT NULL DEFAULT false,
  completed_by        uuid,
  last_checked_at     timestamptz,
  validation_snapshot jsonb,
  completed_at        timestamptz,
  CONSTRAINT impl_step_progress_uq UNIQUE (progress_id, step_id)
);
CREATE INDEX IF NOT EXISTS impl_step_progress_account_idx ON impl_step_progress(account_id);
CREATE INDEX IF NOT EXISTS impl_step_progress_progress_idx ON impl_step_progress(progress_id);
CREATE INDEX IF NOT EXISTS impl_step_progress_step_idx ON impl_step_progress(step_id);

CREATE TABLE IF NOT EXISTS impl_answers (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  progress_id  uuid NOT NULL REFERENCES impl_progress(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  value        jsonb,
  answered_by  uuid,
  answered_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impl_answers_uq UNIQUE (progress_id, question_key)
);
CREATE INDEX IF NOT EXISTS impl_answers_account_idx ON impl_answers(account_id);
CREATE INDEX IF NOT EXISTS impl_answers_progress_idx ON impl_answers(progress_id);

CREATE TABLE IF NOT EXISTS impl_task_progress (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  progress_id uuid NOT NULL REFERENCES impl_progress(id) ON DELETE CASCADE,
  task_id     uuid NOT NULL REFERENCES impl_step_tasks(id) ON DELETE CASCADE,
  done        boolean NOT NULL DEFAULT false,
  done_by     uuid,
  done_at     timestamptz,
  CONSTRAINT impl_task_progress_uq UNIQUE (progress_id, task_id)
);
CREATE INDEX IF NOT EXISTS impl_task_progress_account_idx ON impl_task_progress(account_id);
CREATE INDEX IF NOT EXISTS impl_task_progress_progress_idx ON impl_task_progress(progress_id);

CREATE TABLE IF NOT EXISTS impl_milestone_progress (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  progress_id  uuid NOT NULL REFERENCES impl_progress(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES impl_milestones(id) ON DELETE CASCADE,
  reached_at   timestamptz NOT NULL DEFAULT now(),
  acknowledged boolean NOT NULL DEFAULT false,
  CONSTRAINT impl_milestone_progress_uq UNIQUE (progress_id, milestone_id)
);
CREATE INDEX IF NOT EXISTS impl_milestone_progress_account_idx ON impl_milestone_progress(account_id);
CREATE INDEX IF NOT EXISTS impl_milestone_progress_progress_idx ON impl_milestone_progress(progress_id);

CREATE TABLE IF NOT EXISTS impl_analytics_events (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  progress_id uuid,
  template_id uuid,
  step_id     uuid,
  event_type  text NOT NULL,
  actor_id    uuid,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS impl_analytics_account_idx ON impl_analytics_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS impl_analytics_template_step_idx ON impl_analytics_events(template_id, step_id, event_type);

-- ============================================================================
-- RLS
-- ============================================================================
-- Definition tables: any authenticated member may read; no write policy (writes
-- come from migrations / service_role, which bypass RLS).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'impl_templates','impl_steps','impl_step_tasks','impl_step_questions',
    'impl_step_media','impl_validation_rules','impl_conditions','impl_milestones'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I;', t, t);
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT USING (auth.uid() IS NOT NULL);', t, t);
  END LOOP;
END $$;

-- Runtime tables: members read their account; admin/owner write.
ALTER TABLE impl_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS impl_progress_select ON impl_progress;
CREATE POLICY impl_progress_select ON impl_progress FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS impl_progress_write ON impl_progress;
CREATE POLICY impl_progress_write ON impl_progress FOR ALL
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

ALTER TABLE impl_step_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS impl_step_progress_select ON impl_step_progress;
CREATE POLICY impl_step_progress_select ON impl_step_progress FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS impl_step_progress_write ON impl_step_progress;
CREATE POLICY impl_step_progress_write ON impl_step_progress FOR ALL
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

ALTER TABLE impl_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS impl_answers_select ON impl_answers;
CREATE POLICY impl_answers_select ON impl_answers FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS impl_answers_write ON impl_answers;
CREATE POLICY impl_answers_write ON impl_answers FOR ALL
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

ALTER TABLE impl_task_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS impl_task_progress_select ON impl_task_progress;
CREATE POLICY impl_task_progress_select ON impl_task_progress FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS impl_task_progress_write ON impl_task_progress;
CREATE POLICY impl_task_progress_write ON impl_task_progress FOR ALL
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

ALTER TABLE impl_milestone_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS impl_milestone_progress_select ON impl_milestone_progress;
CREATE POLICY impl_milestone_progress_select ON impl_milestone_progress FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS impl_milestone_progress_write ON impl_milestone_progress;
CREATE POLICY impl_milestone_progress_write ON impl_milestone_progress FOR ALL
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

-- Analytics: any member may INSERT (actor-attributed) and read own account; no update/delete.
ALTER TABLE impl_analytics_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS impl_analytics_select ON impl_analytics_events;
CREATE POLICY impl_analytics_select ON impl_analytics_events FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS impl_analytics_insert ON impl_analytics_events;
CREATE POLICY impl_analytics_insert ON impl_analytics_events FOR INSERT WITH CHECK (is_account_member(account_id));
