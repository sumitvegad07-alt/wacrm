# Implementation Center ("Getting Started") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a configuration-driven onboarding/implementation engine ("Getting Started") for OZZO, reusable across WFA/SFA/CRM, shipping in Phase 1 with a live WFA v1 template on the web admin.

**Architecture:** Global, versioned template *definitions* in `impl_*` DB tables; per-account *runtime* state (progress, answers, analytics) with RLS. Validation rules are declared as data but resolved by a typed TS registry (no SQL from data). Pure scoring functions compute Progress/Score/Health. A server-action evaluation pipeline runs live resolvers on load and on "Re-check", auto-completing satisfied steps and firing milestones. Web UI is a premium "Getting Started" Center (hero, journey rail, active-step panel).

**Tech Stack:** Next.js 16 (App Router, `src/app/`), React 19, TypeScript strict, Supabase (Postgres + RLS via `is_account_member`), Tailwind + shadcn/ui (`@/components/ui/*`), `sonner`, `lucide-react`, vitest (`src/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-09-20-implementation-center-design.md`

## Global Constraints

- **Multi-tenant:** every runtime query filters explicitly by `account_id` AND relies on RLS. Definition tables (`impl_templates/steps/step_tasks/step_questions/step_media/validation_rules/conditions/milestones`) are global (no `account_id`).
- **Migrations:** SQL uses `uuid_generate_v4()` (not `gen_random_uuid()`), `CREATE TABLE IF NOT EXISTS`, RLS via `is_account_member(account_id)` for read and `is_account_member(account_id, 'admin'::account_role_enum)` for write, and an FK index on every `*_id` column. `account_role_enum` = `('owner','admin','agent','viewer')`.
- **No `any`** without a justifying comment. No fabricated stubs. Report real `npm run typecheck` / `npm run build` output.
- **Data pattern:** live pages/actions talk to Supabase directly via `createClient()` (server: `@/lib/supabase/server`; client: `@/lib/supabase/client`). Do NOT use the dead `src/lib/domain|application|repositories` layers.
- **Server action account lookup:** `const { data:{user} } = await supabase.auth.getUser()`; then `supabase.from('profiles').select('account_id, id').eq('user_id', user.id).single()`. `profiles.id` is the actor id; `user.id` is the auth id — they differ.
- **Naming:** DB/internal = `impl_*` / "Implementation Center"; all customer-facing copy = **"Getting Started"**. Route = `/getting-started`.
- **Validation source of truth:** resolvers query real tables only — `territories`, `contacts`, `employee_roles` (status='active'), `profiles`, `member_presence`, `tracking_sessions`, `site_visits`, `location_pings`, `impl_answers`. There is NO `reports_opened` resolver.

---

## File Structure

```
supabase/migrations/20260920120000_implementation_center.sql   # schema, RLS, indexes
supabase/migrations/20260920120100_seed_wfa_v1_template.sql     # WFA v1 definition seed
supabase/migrations/ROLLBACK-implementation-center.md           # rollback note
src/lib/implementation/types.ts          # row + evaluated-view TS types
src/lib/implementation/scoring.ts        # pure Progress/Score/Health fns
src/lib/implementation/scoring.test.ts
src/lib/implementation/resolvers.ts      # source_key -> resolver registry
src/lib/implementation/resolvers.test.ts
src/lib/implementation/conditions.ts     # applicable-step computation from answers
src/lib/implementation/conditions.test.ts
src/lib/implementation/evaluate.ts       # orchestration (loads defs+runtime, runs resolvers, persists)
src/lib/implementation/evaluate.test.ts
src/app/(dashboard)/getting-started/actions.ts   # server actions
src/app/(dashboard)/getting-started/page.tsx      # server component shell
src/app/(dashboard)/getting-started/GettingStartedClient.tsx  # client orchestrator
src/components/getting-started/Hero.tsx
src/components/getting-started/JourneyRail.tsx
src/components/getting-started/StepPanel.tsx
src/components/getting-started/ContentTabs.tsx
src/components/getting-started/HealthPanel.tsx
src/components/getting-started/MilestoneCard.tsx
src/components/getting-started/BackToGettingStarted.tsx
src/lib/auth/permissions-registry.ts     # MODIFY: add IMPLEMENTATION group
```

---

### Task 1: Database schema migration

**Files:**
- Create: `supabase/migrations/20260920120000_implementation_center.sql`

**Interfaces:**
- Produces: the 14 `impl_*` tables consumed by every later task. Definition tables: `impl_templates, impl_steps, impl_step_tasks, impl_step_questions, impl_step_media, impl_validation_rules, impl_conditions, impl_milestones`. Runtime tables: `impl_progress, impl_step_progress, impl_answers, impl_task_progress, impl_milestone_progress, impl_analytics_events`.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply locally / validate SQL parses**

Run (if a local Supabase/psql is available): `psql "$DATABASE_URL" -f supabase/migrations/20260920120000_implementation_center.sql`
Expected: no error. If no local DB, verify the file has balanced `$$` blocks and every `REFERENCES` target exists (`accounts`, `impl_*`). Application to prod is a manual step (Task 12).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260920120000_implementation_center.sql
git commit -m "feat(impl): Implementation Center schema (impl_* tables + RLS)"
```

---

### Task 2: WFA v1 template seed

**Files:**
- Create: `supabase/migrations/20260920120100_seed_wfa_v1_template.sql`

**Interfaces:**
- Consumes: all `impl_*` definition tables from Task 1.
- Produces: one active template `wfa_v1` (product_line `wfa`) with a discovery step + 8 task steps, questions, tasks, validation rules, conditions, and 4 milestones. Resolver `source_key`s used: `territory_count`, `answer`, `customer_count`, `role_count`, `employee_count`, `employee_logged_in`, `attendance_or_visit`, `meaningful_data`.

- [ ] **Step 1: Write the seed migration**

```sql
-- Seed: WFA v1 "Getting Started" template. Idempotent via ON CONFLICT on natural keys.
-- Spec: docs/superpowers/specs/2026-09-20-implementation-center-design.md
DO $$
DECLARE
  tpl uuid;
  s_disc uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid; s8 uuid;
BEGIN
  INSERT INTO impl_templates (product_line, template_key, version, name, display_name, description, estimated_minutes, support_whatsapp_url, is_active)
  VALUES ('wfa','wfa_v1',1,'WFA v1','Getting Started with Field Force',
          'Set up your team, territories and first field activity — no support call needed.',
          25,'https://wa.me/919000000000?text=I%20need%20help%20with%20OZZO%20setup', true)
  ON CONFLICT (template_key, version) DO UPDATE SET display_name=EXCLUDED.display_name
  RETURNING id INTO tpl;

  -- Discovery (optional, light for WFA)
  INSERT INTO impl_steps (template_id, position, step_key, step_type, title, description, quick_steps, help_text, estimated_minutes, is_optional, auto_complete, weight)
  VALUES (tpl,0,'discovery','discovery','Tell us about your team',
          'A couple of quick questions so we can tailor your setup.',
          '["Pick your industry","Pick your team size"]'::jsonb,'This helps us recommend the right defaults.',2,true,true,0.5)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s_disc;
  INSERT INTO impl_step_questions (step_id, position, question_key, label, input_type, options, required) VALUES
    (s_disc,0,'industry','Which industry are you in?','single_select',
     '[{"value":"fmcg","label":"FMCG / Distribution"},{"value":"pharma","label":"Pharma"},{"value":"services","label":"Services"},{"value":"other","label":"Other"}]'::jsonb,false),
    (s_disc,1,'team_size','How large is your field team?','single_select',
     '[{"value":"1_5","label":"1–5"},{"value":"6_20","label":"6–20"},{"value":"21_50","label":"21–50"},{"value":"50_plus","label":"50+"}]'::jsonb,false)
  ON CONFLICT (step_id, question_key) DO NOTHING;

  -- Step 1 Territory
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,1,'territory_setup','Set up your territories',
          'Create the geographic areas your team will cover.',
          '["Open Territories","Add each area / city / zone","Save"]'::jsonb,'Territories are how customers get grouped and assigned.',4,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s1;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (s1,0,'Create your territories','/territories') ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (s1,'territory_count','gt',0,5,1,'and');

  -- Step 2 Assignment method (question + OZZO tips + branching)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,2,'assignment_method','Choose how you assign customers',
          'Decide whether reps get customers by area, or assigned directly.',
          '["Pick an assignment method"]'::jsonb,'You can change this later in Settings.',2,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s2;
  INSERT INTO impl_step_questions (step_id, position, question_key, label, input_type, options, required) VALUES
    (s2,0,'customer_assignment_method','How do you want to assign customers?','single_select',
     '[{"value":"area_wise","label":"Area-wise","recommended_badge":"Recommended by OZZO ✓","note":"Best for 50+ customers"},{"value":"direct","label":"Direct assignment","note":"Best for smaller teams"}]'::jsonb,true)
  ON CONFLICT (step_id, question_key) DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, params, combine)
  VALUES (s2,'answer','exists','{"question_key":"customer_assignment_method"}'::jsonb,'and');

  -- Step 3 Customers
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,3,'customer_creation','Add your customers',
          'Import or add the customers your team will serve.',
          '["Open Customers","Import a spreadsheet or add manually"]'::jsonb,'Use Import for bulk upload.',5,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s3;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES
    (s3,0,'Add customers','/contacts'),(s3,1,'Bulk import customers','/import') ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (s3,'customer_count','gt',0,100,1,'and');
  -- Branch: area_wise surfaces an area-assignment task on the employee step; direct hides it.
  INSERT INTO impl_conditions (step_id, depends_on_question_key, comparator, value, effect)
  VALUES (s3,'customer_assignment_method','eq','"area_wise"'::jsonb,'show');

  -- Step 4 Roles
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,4,'role_creation','Create roles',
          'Define the roles your employees will have (e.g. Field Rep, Manager).',
          '["Open Roles","Create at least one role"]'::jsonb,'Roles carry permissions.',3,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s4;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (s4,0,'Create roles','/team') ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (s4,'role_count','gt',0,3,1,'and');

  -- Step 5 Employees (+ milestone M1)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,5,'employee_creation','Add your employees',
          'Invite your field team so they can log in on mobile.',
          '["Open Team","Invite employees by mobile/email"]'::jsonb,'Each employee gets a mobile login.',5,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s5;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link, optional) VALUES
    (s5,0,'Add employees','/team',false),
    (s5,1,'Assign areas to employees','/field-staff',true) ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, required_threshold, recommended_threshold, health_weight, combine)
  VALUES (s5,'employee_count','gt',0,5,1,'and');

  -- Step 6 Mobile login (+ M2)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,6,'mobile_login','Get the team on the mobile app',
          'Have at least one employee download the app and log in.',
          '["Share the app link","Employee logs in once"]'::jsonb,'Login confirms the account is reachable on-device.',3,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s6;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, combine)
  VALUES (s6,'employee_logged_in','exists','and');

  -- Step 7 First activity (+ M3)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,7,'first_activity','Record your first activity',
          'Have an employee mark attendance or record a customer visit.',
          '["Employee marks attendance","or records a visit"]'::jsonb,'This proves the field loop works end-to-end.',3,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s7;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, combine)
  VALUES (s7,'attendance_or_visit','exists','and');

  -- Step 8 See live data (+ M4)
  INSERT INTO impl_steps (template_id, position, step_key, title, description, quick_steps, help_text, estimated_minutes, weight)
  VALUES (tpl,8,'see_live_data','See your live data',
          'Confirm real field data is flowing — attendance, visits or tracking.',
          '["Open Location Tracking / Reports","Confirm data appears"]'::jsonb,'You are live once real data exists.',2,1)
  ON CONFLICT (template_id, step_key) DO UPDATE SET title=EXCLUDED.title RETURNING id INTO s8;
  INSERT INTO impl_step_tasks (step_id, position, label, deep_link) VALUES (s8,0,'View live data','/location-tracking') ON CONFLICT DO NOTHING;
  INSERT INTO impl_validation_rules (step_id, source_key, operator, combine)
  VALUES (s8,'meaningful_data','exists','and');

  -- Milestones
  INSERT INTO impl_milestones (template_id, position, milestone_key, title, message, icon, trigger_step_key) VALUES
    (tpl,1,'m1_team_ready','Your team is ready for the mobile app','Employees are set up — share the app link next.','users','employee_creation'),
    (tpl,2,'m2_first_user','Your first field user is active','Someone logged in on mobile. You are connected.','smartphone','mobile_login'),
    (tpl,3,'m3_tracking','Live field tracking is working','First activity captured. The field loop works.','activity','first_activity'),
    (tpl,4,'m4_live','You''re live on OZZO','Real field data is flowing. Setup complete.','rocket','see_live_data')
  ON CONFLICT (template_id, milestone_key) DO NOTHING;
END $$;
```

- [ ] **Step 2: Validate parse & idempotency**

If local DB available: run the file twice; expect success both times (no duplicate-key errors thanks to `ON CONFLICT`). Otherwise verify all `RETURNING id INTO` variables are declared and every `source_key` string matches the list in Task 5.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260920120100_seed_wfa_v1_template.sql
git commit -m "feat(impl): seed WFA v1 Getting Started template"
```

---

### Task 3: Shared TypeScript types

**Files:**
- Create: `src/lib/implementation/types.ts`

**Interfaces:**
- Produces: `ProductLine`, `StepStatus`, `ValidationRule`, `TemplateStep`, `TemplateDefinition`, `StepProgressRow`, `AnswerMap`, `EvaluatedStep`, `EvaluatedTemplate`, `AnalyticsEventType`. Consumed by scoring, resolvers, conditions, evaluate, actions, and UI.

- [ ] **Step 1: Write the types file**

```ts
// Shared types for the Implementation Center ("Getting Started") engine.
export type ProductLine = 'crm' | 'wfa' | 'sfa';
export type StepStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'auto_completed' | 'skipped';
export type Operator = 'gt' | 'gte' | 'eq' | 'exists';
export type Combine = 'and' | 'or';

export type AnswerMap = Record<string, unknown>;

export interface ValidationRule {
  id: string;
  step_id: string;
  source_key: string;
  operator: Operator;
  required_threshold: number | null;
  recommended_threshold: number | null;
  health_weight: number | null;
  params: Record<string, unknown> | null;
  combine: Combine;
}

export interface StepCondition {
  id: string;
  step_id: string;
  depends_on_question_key: string;
  comparator: 'eq' | 'neq' | 'in' | 'not_in' | 'truthy';
  value: unknown;
  effect: 'show' | 'hide' | 'require' | 'skip';
}

export interface StepQuestionOption {
  value: string;
  label: string;
  recommended_badge?: string;
  note?: string;
}
export interface StepQuestion {
  id: string;
  step_id: string;
  position: number;
  question_key: string;
  label: string;
  input_type: 'single_select' | 'multi_select' | 'text' | 'bool';
  options: StepQuestionOption[];
  required: boolean;
}
export interface StepTask {
  id: string; step_id: string; position: number;
  label: string; help_text: string | null; deep_link: string | null; optional: boolean;
}
export interface StepMedia {
  id: string; step_id: string; position: number;
  media_type: 'image' | 'video'; url: string; caption: string | null;
}
export interface TemplateStep {
  id: string; template_id: string; position: number; step_key: string;
  step_type: 'task' | 'discovery' | 'milestone_gate';
  title: string; description: string | null; video_url: string | null;
  quick_steps: string[]; help_text: string | null; help_context: string | null;
  estimated_minutes: number; is_optional: boolean; auto_complete: boolean; weight: number;
  tasks: StepTask[]; questions: StepQuestion[]; media: StepMedia[];
  rules: ValidationRule[]; conditions: StepCondition[];
}
export interface Milestone {
  id: string; template_id: string; position: number; milestone_key: string;
  title: string; message: string | null; icon: string | null; trigger_step_key: string;
}
export interface TemplateDefinition {
  id: string; product_line: ProductLine; template_key: string; version: number;
  name: string; display_name: string; description: string | null;
  estimated_minutes: number; support_whatsapp_url: string | null;
  steps: TemplateStep[]; milestones: Milestone[];
}

export interface StepProgressRow {
  step_id: string; status: StepStatus; auto: boolean;
  validation_snapshot: Record<string, unknown> | null;
}

// One rule's live evaluation.
export interface RuleEvaluation {
  source_key: string;
  value: number | boolean;
  requiredPass: boolean;
  recommendedPass: boolean | null; // null when no recommended_threshold
  recommendedThreshold: number | null;
  healthWeight: number | null;
}
export interface EvaluatedStep {
  step: TemplateStep;
  applicable: boolean;
  status: StepStatus;
  ruleResults: RuleEvaluation[];
  requiredSatisfied: boolean;
}
export interface EvaluatedTemplate {
  template: TemplateDefinition;
  steps: EvaluatedStep[];
  progressPct: number;
  score: number;
  healthPct: number;
  currentStepId: string | null;
  completed: boolean;
}

export type AnalyticsEventType =
  | 'template_started' | 'step_viewed' | 'step_started' | 'step_completed'
  | 'step_auto_completed' | 'step_skipped' | 'validation_failed' | 'video_played'
  | 'task_toggled' | 'question_answered' | 'help_requested' | 'milestone_reached'
  | 'template_completed';
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `types.ts` (unused-type warnings are fine; strict mode passes).

- [ ] **Step 3: Commit**

```bash
git add src/lib/implementation/types.ts
git commit -m "feat(impl): shared engine types"
```

---

### Task 4: Scoring pure functions (TDD)

**Files:**
- Create: `src/lib/implementation/scoring.ts`
- Test: `src/lib/implementation/scoring.test.ts`

**Interfaces:**
- Consumes: `EvaluatedStep`, `RuleEvaluation` from `types.ts`.
- Produces: `computeProgressPct(steps)`, `computeScore(steps)`, `computeHealthPct(steps)`, all `(steps: EvaluatedStep[]) => number`. Resolved = status ∈ {completed, auto_completed, skipped}. Score numerator counts completed|auto_completed weights; denominator = applicable step weights. Health = Σ(healthWeight × min(1, value/recommended)) ÷ Σ healthWeight over applicable rules with a recommendedThreshold.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { computeProgressPct, computeScore, computeHealthPct } from './scoring';
import type { EvaluatedStep, TemplateStep } from './types';

function step(partial: Partial<TemplateStep> & { weight: number }): TemplateStep {
  return {
    id: partial.id ?? 's', template_id: 't', position: 0, step_key: partial.step_key ?? 'k',
    step_type: 'task', title: '', description: null, video_url: null, quick_steps: [],
    help_text: null, help_context: null, estimated_minutes: 0, is_optional: false,
    auto_complete: true, weight: partial.weight, tasks: [], questions: [], media: [],
    rules: [], conditions: [],
  };
}
function ev(status: EvaluatedStep['status'], weight: number, applicable = true, rules: EvaluatedStep['ruleResults'] = []): EvaluatedStep {
  return { step: step({ weight }), applicable, status, ruleResults: rules, requiredSatisfied: status === 'completed' || status === 'auto_completed' };
}

describe('computeProgressPct', () => {
  it('counts completed, auto_completed and skipped as resolved over applicable', () => {
    const steps = [ev('completed', 1), ev('auto_completed', 1), ev('skipped', 1), ev('available', 1)];
    expect(computeProgressPct(steps)).toBe(75);
  });
  it('excludes non-applicable steps from the denominator', () => {
    const steps = [ev('completed', 1), ev('available', 1, false)];
    expect(computeProgressPct(steps)).toBe(100);
  });
  it('is 0 when nothing applicable', () => {
    expect(computeProgressPct([ev('available', 1, false)])).toBe(0);
  });
});

describe('computeScore', () => {
  it('gives skipped steps zero credit (score < progress when skipping)', () => {
    const steps = [ev('completed', 1), ev('skipped', 1)];
    expect(computeProgressPct(steps)).toBe(100);
    expect(computeScore(steps)).toBe(50);
  });
  it('weights steps', () => {
    const steps = [ev('auto_completed', 3), ev('available', 1)];
    expect(computeScore(steps)).toBe(75);
  });
});

describe('computeHealthPct', () => {
  it('averages attainment vs recommended, capped at 100 per metric', () => {
    const steps = [
      ev('completed', 1, true, [{ source_key: 'territory_count', value: 5, requiredPass: true, recommendedPass: true, recommendedThreshold: 5, healthWeight: 1 }]),
      ev('completed', 1, true, [{ source_key: 'customer_count', value: 50, requiredPass: true, recommendedPass: false, recommendedThreshold: 100, healthWeight: 1 }]),
    ];
    // (min(1,5/5)=1  + min(1,50/100)=0.5) / 2 = 0.75
    expect(computeHealthPct(steps)).toBe(75);
  });
  it('ignores rules without a recommended threshold', () => {
    const steps = [ev('completed', 1, true, [{ source_key: 'x', value: true, requiredPass: true, recommendedPass: null, recommendedThreshold: null, healthWeight: null }])];
    expect(computeHealthPct(steps)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/implementation/scoring.test.ts`
Expected: FAIL — `computeProgressPct` etc. not exported.

- [ ] **Step 3: Write the implementation**

```ts
import type { EvaluatedStep } from './types';

const RESOLVED = new Set(['completed', 'auto_completed', 'skipped']);
const CREDITED = new Set(['completed', 'auto_completed']);
const applicable = (steps: EvaluatedStep[]) => steps.filter((s) => s.applicable);

export function computeProgressPct(steps: EvaluatedStep[]): number {
  const app = applicable(steps);
  const denom = app.reduce((a, s) => a + s.step.weight, 0);
  if (denom === 0) return 0;
  const num = app.filter((s) => RESOLVED.has(s.status)).reduce((a, s) => a + s.step.weight, 0);
  return Math.round((100 * num) / denom);
}

export function computeScore(steps: EvaluatedStep[]): number {
  const app = applicable(steps);
  const denom = app.reduce((a, s) => a + s.step.weight, 0);
  if (denom === 0) return 0;
  const num = app.filter((s) => CREDITED.has(s.status)).reduce((a, s) => a + s.step.weight, 0);
  return Math.round((100 * num) / denom);
}

export function computeHealthPct(steps: EvaluatedStep[]): number {
  let wsum = 0;
  let acc = 0;
  for (const s of applicable(steps)) {
    for (const r of s.ruleResults) {
      if (r.recommendedThreshold == null || r.healthWeight == null) continue;
      const val = typeof r.value === 'number' ? r.value : r.value ? 1 : 0;
      const attainment = r.recommendedThreshold === 0 ? 1 : Math.min(1, val / r.recommendedThreshold);
      acc += r.healthWeight * attainment;
      wsum += r.healthWeight;
    }
  }
  if (wsum === 0) return 0;
  return Math.round((100 * acc) / wsum);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/implementation/scoring.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/implementation/scoring.ts src/lib/implementation/scoring.test.ts
git commit -m "feat(impl): scoring (progress/score/health) pure functions + tests"
```

---

### Task 5: Validation resolver registry (TDD)

**Files:**
- Create: `src/lib/implementation/resolvers.ts`
- Test: `src/lib/implementation/resolvers.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks except a Supabase client type (`@supabase/supabase-js`).
- Produces: `RESOLVERS: Record<string, Resolver>` and `runResolver(sourceKey, ctx)`. `Resolver = (ctx: ResolverCtx) => Promise<number | boolean>`; `ResolverCtx = { accountId: string; supabase: SupabaseClient; params?: Record<string,unknown> | null; answers: AnswerMap }`. Keys: `territory_count, customer_count, role_count, employee_count, employee_logged_in, attendance_or_visit, meaningful_data, answer`.

- [ ] **Step 1: Write the failing tests** (mock a minimal Supabase query builder)

```ts
import { describe, it, expect } from 'vitest';
import { runResolver, RESOLVERS } from './resolvers';
import type { SupabaseClient } from '@supabase/supabase-js';

// Minimal chainable mock: from(table).select(..,{count}).eq(...) resolves to {count}.
function mockSupabase(counts: Record<string, number>): SupabaseClient {
  const make = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain; builder.eq = chain; builder.gt = chain;
    builder.limit = chain; builder.not = chain;
    // resolve as a thenable returning the configured count / rows
    (builder as { then: unknown }).then = (res: (v: unknown) => void) =>
      res({ count: counts[table] ?? 0, data: (counts[table] ?? 0) > 0 ? [{ id: 'x' }] : [], error: null });
    return builder;
  };
  return { from: (t: string) => make(t) } as unknown as SupabaseClient;
}

const ctx = (supabase: SupabaseClient, params: Record<string, unknown> | null = null, answers = {}) =>
  ({ accountId: 'acc', supabase, params, answers });

describe('count resolvers', () => {
  it('territory_count returns the territories count', async () => {
    expect(await runResolver('territory_count', ctx(mockSupabase({ territories: 3 })))).toBe(3);
  });
  it('role_count counts employee_roles', async () => {
    expect(await runResolver('role_count', ctx(mockSupabase({ employee_roles: 2 })))).toBe(2);
  });
  it('employee_count counts profiles', async () => {
    expect(await runResolver('employee_count', ctx(mockSupabase({ profiles: 4 })))).toBe(4);
  });
});

describe('exists resolvers', () => {
  it('attendance_or_visit is true when tracking_sessions exist', async () => {
    expect(await runResolver('attendance_or_visit', ctx(mockSupabase({ tracking_sessions: 1 })))).toBe(true);
  });
  it('attendance_or_visit is false when neither exists', async () => {
    expect(await runResolver('attendance_or_visit', ctx(mockSupabase({})))).toBe(false);
  });
  it('meaningful_data is true when location_pings exist', async () => {
    expect(await runResolver('meaningful_data', ctx(mockSupabase({ location_pings: 10 })))).toBe(true);
  });
});

describe('answer resolver', () => {
  it('returns true when the answer is present', async () => {
    const c = ctx(mockSupabase({}), { question_key: 'customer_assignment_method' }, { customer_assignment_method: 'area_wise' });
    expect(await runResolver('answer', c)).toBe(true);
  });
  it('returns false when the answer is missing', async () => {
    const c = ctx(mockSupabase({}), { question_key: 'customer_assignment_method' }, {});
    expect(await runResolver('answer', c)).toBe(false);
  });
});

describe('registry', () => {
  it('exposes exactly the WFA v1 keys', () => {
    expect(Object.keys(RESOLVERS).sort()).toEqual(
      ['answer','attendance_or_visit','customer_count','employee_count','employee_logged_in','meaningful_data','role_count','territory_count'].sort()
    );
  });
  it('throws on unknown key', async () => {
    await expect(runResolver('nope', ctx(mockSupabase({})))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/implementation/resolvers.test.ts`
Expected: FAIL — module not found / `runResolver` undefined.

- [ ] **Step 3: Write the implementation**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnswerMap } from './types';

export interface ResolverCtx {
  accountId: string;
  supabase: SupabaseClient;
  params?: Record<string, unknown> | null;
  answers: AnswerMap;
}
export type Resolver = (ctx: ResolverCtx) => Promise<number | boolean>;

// COUNT helper: head+count is cheapest, but our mock returns {count}; use exact count.
async function countRows(ctx: ResolverCtx, table: string, extra?: (q: any) => any): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase builder is dynamically chained
  let q: any = ctx.supabase.from(table).select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId);
  if (extra) q = extra(q);
  const { count } = await q;
  return count ?? 0;
}
async function existsRows(ctx: ResolverCtx, table: string, extra?: (q: any) => any): Promise<boolean> {
  return (await countRows(ctx, table, extra)) > 0;
}

export const RESOLVERS: Record<string, Resolver> = {
  territory_count: (ctx) => countRows(ctx, 'territories'),
  customer_count: (ctx) => countRows(ctx, 'contacts'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chained builder
  role_count: (ctx) => countRows(ctx, 'employee_roles', (q: any) => q.eq('status', 'active')),
  employee_count: (ctx) => countRows(ctx, 'profiles'),
  employee_logged_in: async (ctx) => {
    // A login/activity signal: presence OR any tracking session for the account.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chained builder
    const presence = await existsRows(ctx, 'member_presence', (q: any) => q.not('last_seen_at', 'is', null));
    if (presence) return true;
    return existsRows(ctx, 'tracking_sessions');
  },
  attendance_or_visit: async (ctx) => {
    if (await existsRows(ctx, 'tracking_sessions')) return true;
    return existsRows(ctx, 'site_visits');
  },
  meaningful_data: async (ctx) => {
    if (await existsRows(ctx, 'location_pings')) return true;
    if (await existsRows(ctx, 'site_visits')) return true;
    return existsRows(ctx, 'tracking_sessions');
  },
  answer: async (ctx) => {
    const key = ctx.params?.question_key as string | undefined;
    if (!key) return false;
    const v = ctx.answers[key];
    return v !== undefined && v !== null && v !== '';
  },
};

export async function runResolver(sourceKey: string, ctx: ResolverCtx): Promise<number | boolean> {
  const r = RESOLVERS[sourceKey];
  if (!r) throw new Error(`Unknown validation source_key: ${sourceKey}`);
  return r(ctx);
}
```

> Note: the test mock ignores `.select(...,{head:true})` and resolves `{count}` directly, so `countRows` works against it. Against real Supabase, `head:true` + `count:'exact'` returns the count without rows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/implementation/resolvers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/implementation/resolvers.ts src/lib/implementation/resolvers.test.ts
git commit -m "feat(impl): validation resolver registry (real OZZO entities) + tests"
```

---

### Task 6: Condition (applicable-step) evaluation (TDD)

**Files:**
- Create: `src/lib/implementation/conditions.ts`
- Test: `src/lib/implementation/conditions.test.ts`

**Interfaces:**
- Consumes: `StepCondition`, `AnswerMap`, `TemplateStep` from `types.ts`.
- Produces: `isStepApplicable(step: TemplateStep, answers: AnswerMap): boolean`. Default applicable=true. `hide`/`skip` effect whose condition matches → not applicable; `show` effect that does NOT match → not applicable (i.e. a `show` condition gates visibility on the answer). Multiple conditions AND together.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { isStepApplicable, matchesCondition } from './conditions';
import type { StepCondition, TemplateStep } from './types';

const baseStep = (conditions: StepCondition[]): TemplateStep => ({
  id: 's', template_id: 't', position: 0, step_key: 'k', step_type: 'task', title: '',
  description: null, video_url: null, quick_steps: [], help_text: null, help_context: null,
  estimated_minutes: 0, is_optional: false, auto_complete: true, weight: 1,
  tasks: [], questions: [], media: [], rules: [], conditions,
});
const cond = (c: Partial<StepCondition>): StepCondition => ({
  id: 'c', step_id: 's', depends_on_question_key: 'method', comparator: 'eq', value: 'area_wise', effect: 'show', ...c,
});

describe('matchesCondition', () => {
  it('eq matches', () => expect(matchesCondition(cond({ comparator: 'eq', value: 'area_wise' }), { method: 'area_wise' })).toBe(true));
  it('neq matches when different', () => expect(matchesCondition(cond({ comparator: 'neq', value: 'direct' }), { method: 'area_wise' })).toBe(true));
  it('in matches membership', () => expect(matchesCondition(cond({ comparator: 'in', value: ['a', 'area_wise'] }), { method: 'area_wise' })).toBe(true));
  it('truthy matches non-empty', () => expect(matchesCondition(cond({ comparator: 'truthy' }), { method: 'x' })).toBe(true));
});

describe('isStepApplicable', () => {
  it('is applicable with no conditions', () => expect(isStepApplicable(baseStep([]), {})).toBe(true));
  it('show + match → applicable', () => expect(isStepApplicable(baseStep([cond({ effect: 'show' })]), { method: 'area_wise' })).toBe(true));
  it('show + no match → not applicable', () => expect(isStepApplicable(baseStep([cond({ effect: 'show' })]), { method: 'direct' })).toBe(false));
  it('hide + match → not applicable', () => expect(isStepApplicable(baseStep([cond({ effect: 'hide' })]), { method: 'area_wise' })).toBe(false));
  it('hide + no match → applicable', () => expect(isStepApplicable(baseStep([cond({ effect: 'hide' })]), { method: 'direct' })).toBe(true));
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/implementation/conditions.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
import type { StepCondition, TemplateStep, AnswerMap } from './types';

export function matchesCondition(c: StepCondition, answers: AnswerMap): boolean {
  const a = answers[c.depends_on_question_key];
  switch (c.comparator) {
    case 'eq': return a === c.value;
    case 'neq': return a !== c.value;
    case 'in': return Array.isArray(c.value) && (c.value as unknown[]).includes(a);
    case 'not_in': return Array.isArray(c.value) && !(c.value as unknown[]).includes(a);
    case 'truthy': return a !== undefined && a !== null && a !== '' && a !== false;
    default: return false;
  }
}

// A step is applicable unless a hide/skip condition matches, or a show condition
// is present and does NOT match. Multiple conditions AND together.
export function isStepApplicable(step: TemplateStep, answers: AnswerMap): boolean {
  for (const c of step.conditions) {
    const m = matchesCondition(c, answers);
    if ((c.effect === 'hide' || c.effect === 'skip') && m) return false;
    if (c.effect === 'show' && !m) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/implementation/conditions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/implementation/conditions.ts src/lib/implementation/conditions.test.ts
git commit -m "feat(impl): conditional applicable-step evaluation + tests"
```

---

### Task 7: Evaluation orchestrator (TDD, pure core)

**Files:**
- Create: `src/lib/implementation/evaluate.ts`
- Test: `src/lib/implementation/evaluate.test.ts`

**Interfaces:**
- Consumes: `runResolver` (Task 5), `isStepApplicable` (Task 6), scoring fns (Task 4), all types.
- Produces:
  - `evaluateRules(step, ctx): Promise<{ ruleResults: RuleEvaluation[]; requiredSatisfied: boolean }>` — runs a step's rules and combines per `combine`.
  - `evaluateTemplate(def, answers, priorStatuses, ctx): Promise<EvaluatedTemplate>` — the pure computation used by the server action (no DB writes; caller persists). `priorStatuses: Record<stepId, StepStatus>`. A step already `completed`/`skipped` keeps that status; otherwise if `auto_complete` and `requiredSatisfied` → `auto_completed`, else `available`. Non-applicable → status `locked` and `applicable:false`. Computes progress/score/health and `currentStepId` (first applicable non-resolved step by position) and `completed`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { evaluateRules, evaluateTemplate } from './evaluate';
import type { TemplateDefinition, TemplateStep, ValidationRule, ResolverOverride } from './types';
import type { ResolverCtx } from './resolvers';

// Inject a fake resolver map so the test never touches Supabase.
const fakeCtx = (values: Record<string, number | boolean>): ResolverCtx & { __values: typeof values } =>
  ({ accountId: 'acc', supabase: {} as never, params: null, answers: {}, __values: values });

// evaluate.ts accepts an optional resolver override for testability.
const override = (values: Record<string, number | boolean>) =>
  async (sourceKey: string) => { if (!(sourceKey in values)) throw new Error(sourceKey); return values[sourceKey]; };

function mkStep(p: Partial<TemplateStep> & { step_key: string; rules: ValidationRule[] }): TemplateStep {
  return { id: p.step_key, template_id: 't', position: p.position ?? 0, step_key: p.step_key, step_type: 'task',
    title: '', description: null, video_url: null, quick_steps: [], help_text: null, help_context: null,
    estimated_minutes: 0, is_optional: p.is_optional ?? false, auto_complete: p.auto_complete ?? true, weight: p.weight ?? 1,
    tasks: [], questions: [], media: [], rules: p.rules, conditions: p.conditions ?? [] };
}
const rule = (source_key: string, extra: Partial<ValidationRule> = {}): ValidationRule =>
  ({ id: source_key, step_id: 's', source_key, operator: extra.operator ?? 'gt', required_threshold: extra.required_threshold ?? 0,
     recommended_threshold: extra.recommended_threshold ?? null, health_weight: extra.health_weight ?? null,
     params: extra.params ?? null, combine: extra.combine ?? 'and' });

describe('evaluateRules', () => {
  it('gt threshold passes when value exceeds', async () => {
    const step = mkStep({ step_key: 'a', rules: [rule('territory_count', { operator: 'gt', required_threshold: 0 })] });
    const r = await evaluateRules(step, fakeCtx({}), override({ territory_count: 3 }));
    expect(r.requiredSatisfied).toBe(true);
    expect(r.ruleResults[0].value).toBe(3);
  });
  it('exists false → not satisfied', async () => {
    const step = mkStep({ step_key: 'b', rules: [rule('meaningful_data', { operator: 'exists' })] });
    const r = await evaluateRules(step, fakeCtx({}), override({ meaningful_data: false }));
    expect(r.requiredSatisfied).toBe(false);
  });
});

describe('evaluateTemplate', () => {
  const def: TemplateDefinition = {
    id: 't', product_line: 'wfa', template_key: 'wfa_v1', version: 1, name: 'x', display_name: 'X',
    description: null, estimated_minutes: 0, support_whatsapp_url: null, milestones: [],
    steps: [
      mkStep({ step_key: 's1', position: 1, rules: [rule('territory_count', { required_threshold: 0, recommended_threshold: 5, health_weight: 1 })] }),
      mkStep({ step_key: 's2', position: 2, rules: [rule('customer_count', { required_threshold: 0 })] }),
    ],
  };
  it('auto-completes satisfied steps and advances currentStep', async () => {
    const out = await evaluateTemplate(def, {}, {}, fakeCtx({}), override({ territory_count: 5, customer_count: 0 }));
    expect(out.steps[0].status).toBe('auto_completed');
    expect(out.steps[1].status).toBe('available');
    expect(out.currentStepId).toBe('s2');
    expect(out.progressPct).toBe(50);
    expect(out.completed).toBe(false);
  });
  it('respects prior completed/skipped statuses', async () => {
    const out = await evaluateTemplate(def, {}, { s2: 'skipped' }, fakeCtx({}), override({ territory_count: 5, customer_count: 0 }));
    expect(out.steps[1].status).toBe('skipped');
    expect(out.completed).toBe(true); // s1 auto, s2 skipped → all applicable resolved
  });
  it('marks completed and computes health', async () => {
    const out = await evaluateTemplate(def, {}, {}, fakeCtx({}), override({ territory_count: 5, customer_count: 10 }));
    expect(out.completed).toBe(true);
    expect(out.healthPct).toBe(100); // 5/5 recommended
  });
});
```

- [ ] **Step 2: Add the two override types to `types.ts`**

Append to `src/lib/implementation/types.ts`:

```ts
// Optional injected resolver for testing evaluate() without Supabase.
export type ResolverOverride = (sourceKey: string, params?: Record<string, unknown> | null) => Promise<number | boolean>;
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run src/lib/implementation/evaluate.test.ts`
Expected: FAIL — `evaluateRules`/`evaluateTemplate` not defined.

- [ ] **Step 4: Implement**

```ts
import type {
  TemplateDefinition, TemplateStep, EvaluatedStep, EvaluatedTemplate,
  RuleEvaluation, StepStatus, AnswerMap, ResolverOverride,
} from './types';
import { runResolver, type ResolverCtx } from './resolvers';
import { isStepApplicable } from './conditions';
import { computeProgressPct, computeScore, computeHealthPct } from './scoring';

const RESOLVED = new Set<StepStatus>(['completed', 'auto_completed', 'skipped']);

function ruleRequiredPass(op: string, value: number | boolean, threshold: number | null): boolean {
  if (op === 'exists') return value === true || (typeof value === 'number' && value > 0);
  const v = typeof value === 'number' ? value : value ? 1 : 0;
  const t = threshold ?? 0;
  if (op === 'gt') return v > t;
  if (op === 'gte') return v >= t;
  if (op === 'eq') return v === t;
  return false;
}

export async function evaluateRules(
  step: TemplateStep, ctx: ResolverCtx, resolver: ResolverOverride = (k, p) => runResolver(k, { ...ctx, params: p ?? null }),
): Promise<{ ruleResults: RuleEvaluation[]; requiredSatisfied: boolean }> {
  const ruleResults: RuleEvaluation[] = [];
  const passes: boolean[] = [];
  let combine: 'and' | 'or' = 'and';
  for (const rule of step.rules) {
    combine = rule.combine;
    const value = await resolver(rule.source_key, rule.params);
    const requiredPass = ruleRequiredPass(rule.operator, value, rule.required_threshold);
    const numeric = typeof value === 'number' ? value : value ? 1 : 0;
    const recommendedPass = rule.recommended_threshold == null ? null : numeric >= rule.recommended_threshold;
    ruleResults.push({
      source_key: rule.source_key, value, requiredPass, recommendedPass,
      recommendedThreshold: rule.recommended_threshold, healthWeight: rule.health_weight,
    });
    passes.push(requiredPass);
  }
  const requiredSatisfied = step.rules.length === 0
    ? true
    : combine === 'or' ? passes.some(Boolean) : passes.every(Boolean);
  return { ruleResults, requiredSatisfied };
}

export async function evaluateTemplate(
  def: TemplateDefinition,
  answers: AnswerMap,
  priorStatuses: Record<string, StepStatus>,
  ctx: ResolverCtx,
  resolver?: ResolverOverride,
): Promise<EvaluatedTemplate> {
  const steps: EvaluatedStep[] = [];
  for (const step of [...def.steps].sort((a, b) => a.position - b.position)) {
    const applicable = isStepApplicable(step, answers);
    const { ruleResults, requiredSatisfied } = applicable
      ? await evaluateRules(step, { ...ctx, answers }, resolver)
      : { ruleResults: [], requiredSatisfied: false };
    const prior = priorStatuses[step.id];
    let status: StepStatus;
    if (!applicable) status = 'locked';
    else if (prior === 'completed' || prior === 'skipped') status = prior;
    else if (step.auto_complete && requiredSatisfied) status = 'auto_completed';
    else if (prior === 'in_progress') status = 'in_progress';
    else status = 'available';
    steps.push({ step, applicable, status, ruleResults, requiredSatisfied });
  }
  const currentStep = steps.find((s) => s.applicable && !RESOLVED.has(s.status));
  const applicableSteps = steps.filter((s) => s.applicable);
  const completed = applicableSteps.length > 0 && applicableSteps.every((s) => RESOLVED.has(s.status));
  return {
    template: def, steps,
    progressPct: computeProgressPct(steps),
    score: computeScore(steps),
    healthPct: computeHealthPct(steps),
    currentStepId: currentStep?.step.id ?? null,
    completed,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/lib/implementation/evaluate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/implementation/evaluate.ts src/lib/implementation/types.ts src/lib/implementation/evaluate.test.ts
git commit -m "feat(impl): evaluation orchestrator (rules + template) + tests"
```

---

### Task 8: Permission keys + plan gating helper

**Files:**
- Modify: `src/lib/auth/permissions-registry.ts` (append an `IMPLEMENTATION` group)
- Create: `src/lib/implementation/access.ts`
- Test: `src/lib/implementation/access.test.ts`

**Interfaces:**
- Consumes: `planLines` from `@/lib/plans/catalog`.
- Produces: `PERMISSIONS.IMPLEMENTATION = { VIEW: 'view_implementation', MANAGE: 'manage_implementation' }`; `templateLineAllowed(plan, productLine): boolean`.

- [ ] **Step 1: Add the permission group**

In `src/lib/auth/permissions-registry.ts`, inside the `PERMISSIONS` object (near the other module groups), add:

```ts
  // Implementation Center ("Getting Started") — admin/owner onboarding
  IMPLEMENTATION: {
    VIEW: 'view_implementation',
    MANAGE: 'manage_implementation',
  },
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { templateLineAllowed } from './access';

describe('templateLineAllowed', () => {
  it('WFA template allowed on SFA plan (SFA includes WFA)', () => expect(templateLineAllowed('SFA', 'wfa')).toBe(true));
  it('WFA template not allowed on CRM plan', () => expect(templateLineAllowed('CRM', 'wfa')).toBe(false));
  it('legacy/unknown plan → full access', () => expect(templateLineAllowed('Pro', 'wfa')).toBe(true));
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run src/lib/implementation/access.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

```ts
import { planLines, type ProductLine } from '@/lib/plans/catalog';

/** True if the account's plan grants the product line a template belongs to. */
export function templateLineAllowed(plan: unknown, productLine: ProductLine): boolean {
  return planLines(plan)[productLine];
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/lib/implementation/access.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/permissions-registry.ts src/lib/implementation/access.ts src/lib/implementation/access.test.ts
git commit -m "feat(impl): implementation permissions + plan-gating helper"
```

---

### Task 9: Server actions (load, answer, recheck, skip, mark-done, task-toggle, help, ack-milestone)

**Files:**
- Create: `src/app/(dashboard)/getting-started/actions.ts`

**Interfaces:**
- Consumes: `evaluateTemplate`, `RESOLVERS/runResolver`, `templateLineAllowed`, all types, `@/lib/supabase/server`.
- Produces (all `'use server'` async): `loadGettingStarted(): Promise<EvaluatedTemplate & { answers: AnswerMap; milestonesToCelebrate: Milestone[]; progressId: string } | { locked: true }>`, `saveAnswer(questionKey, value)`, `recheck()`, `skipStep(stepId)`, `markStepDone(stepId)`, `toggleTask(taskId, done)`, `requestHelp(stepId|null)`, `acknowledgeMilestone(milestoneId)`. Each re-runs evaluation and persists, returning the fresh `EvaluatedTemplate`.

- [ ] **Step 1: Write the actions file**

```ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { evaluateTemplate } from '@/lib/implementation/evaluate';
import { templateLineAllowed } from '@/lib/implementation/access';
import type {
  TemplateDefinition, TemplateStep, AnswerMap, StepStatus, EvaluatedTemplate,
  Milestone, AnalyticsEventType,
} from '@/lib/implementation/types';
import type { ResolverCtx } from '@/lib/implementation/resolvers';

const TEMPLATE_KEY = 'wfa_v1';
const ROUTE = '/getting-started';

// --- helpers -------------------------------------------------------------
async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data: profile } = await supabase
    .from('profiles').select('id, account_id, account_role').eq('user_id', user.id).single();
  if (!profile?.account_id) throw new Error('No account');
  return { supabase, actorId: profile.id as string, accountId: profile.account_id as string };
}

async function logEvent(
  supabase: Awaited<ReturnType<typeof createClient>>, accountId: string, actorId: string,
  templateId: string | null, progressId: string | null, stepId: string | null,
  eventType: AnalyticsEventType, metadata: Record<string, unknown> = {},
) {
  await supabase.from('impl_analytics_events').insert({
    account_id: accountId, actor_id: actorId, template_id: templateId,
    progress_id: progressId, step_id: stepId, event_type: eventType, metadata,
  });
}

// Assemble the nested TemplateDefinition from its 8 definition tables.
async function loadDefinition(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<TemplateDefinition | null> {
  const { data: tpl } = await supabase
    .from('impl_templates').select('*')
    .eq('template_key', TEMPLATE_KEY).eq('is_active', true)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (!tpl) return null;
  const { data: steps } = await supabase.from('impl_steps').select('*').eq('template_id', tpl.id).order('position');
  const stepIds = (steps ?? []).map((s) => s.id);
  const inStep = (t: string) => supabase.from(t).select('*').in('step_id', stepIds);
  const [tasks, questions, media, rules, conditions, milestones] = await Promise.all([
    inStep('impl_step_tasks'), inStep('impl_step_questions'), inStep('impl_step_media'),
    inStep('impl_validation_rules'), inStep('impl_conditions'),
    supabase.from('impl_milestones').select('*').eq('template_id', tpl.id).order('position'),
  ]);
  const by = <T extends { step_id: string }>(rows: T[] | null, id: string) => (rows ?? []).filter((r) => r.step_id === id);
  const fullSteps: TemplateStep[] = (steps ?? []).map((s) => ({
    ...s, quick_steps: (s.quick_steps as string[]) ?? [],
    tasks: by(tasks.data, s.id).sort((a, b) => a.position - b.position),
    questions: by(questions.data, s.id).sort((a, b) => a.position - b.position),
    media: by(media.data, s.id).sort((a, b) => a.position - b.position),
    rules: by(rules.data, s.id), conditions: by(conditions.data, s.id),
  })) as TemplateStep[];
  return { ...tpl, steps: fullSteps, milestones: (milestones.data ?? []) as Milestone[] } as TemplateDefinition;
}

async function getOrCreateProgress(
  supabase: Awaited<ReturnType<typeof createClient>>, accountId: string, def: TemplateDefinition, actorId: string,
) {
  const { data: existing } = await supabase.from('impl_progress').select('*')
    .eq('account_id', accountId).eq('template_key', TEMPLATE_KEY).maybeSingle();
  if (existing) return existing;
  const { data: created } = await supabase.from('impl_progress').insert({
    account_id: accountId, template_id: def.id, template_key: TEMPLATE_KEY, template_version: def.version,
    status: 'in_progress',
  }).select('*').single();
  await logEvent(supabase, accountId, actorId, def.id, created!.id, null, 'template_started');
  return created!;
}

async function loadAnswers(supabase: Awaited<ReturnType<typeof createClient>>, progressId: string): Promise<AnswerMap> {
  const { data } = await supabase.from('impl_answers').select('question_key, value').eq('progress_id', progressId);
  const map: AnswerMap = {};
  for (const row of data ?? []) map[row.question_key] = row.value;
  return map;
}

async function priorStatuses(supabase: Awaited<ReturnType<typeof createClient>>, progressId: string): Promise<Record<string, StepStatus>> {
  const { data } = await supabase.from('impl_step_progress').select('step_id, status').eq('progress_id', progressId);
  const map: Record<string, StepStatus> = {};
  for (const row of data ?? []) map[row.step_id] = row.status as StepStatus;
  return map;
}

// The core: evaluate, persist step_progress + progress caches, fire milestones.
async function evaluateAndPersist(
  supabase: Awaited<ReturnType<typeof createClient>>, accountId: string, actorId: string,
  def: TemplateDefinition, progress: { id: string },
): Promise<EvaluatedTemplate & { answers: AnswerMap; milestonesToCelebrate: Milestone[]; progressId: string }> {
  const answers = await loadAnswers(supabase, progress.id);
  const prior = await priorStatuses(supabase, progress.id);
  const resolverCtx: ResolverCtx = { accountId, supabase: supabase as never, params: null, answers };
  const evalResult = await evaluateTemplate(def, answers, prior, resolverCtx);

  // Persist step_progress (upsert on progress_id+step_id).
  const rows = evalResult.steps.map((s) => ({
    account_id: accountId, progress_id: progress.id, step_id: s.step.id, status: s.status,
    auto: s.status === 'auto_completed',
    validation_snapshot: Object.fromEntries(s.ruleResults.map((r) => [r.source_key, r.value])),
    last_checked_at: new Date().toISOString(),
    completed_at: (s.status === 'completed' || s.status === 'auto_completed') ? new Date().toISOString() : null,
  }));
  if (rows.length) await supabase.from('impl_step_progress').upsert(rows, { onConflict: 'progress_id,step_id' });

  // Fire milestones whose trigger step is now completed/auto and not yet reached.
  const completedKeys = new Set(evalResult.steps.filter((s) => s.status === 'completed' || s.status === 'auto_completed').map((s) => s.step.step_key));
  const { data: reached } = await supabase.from('impl_milestone_progress').select('milestone_id').eq('progress_id', progress.id);
  const reachedIds = new Set((reached ?? []).map((r) => r.milestone_id));
  const newlyReached = def.milestones.filter((m) => completedKeys.has(m.trigger_step_key) && !reachedIds.has(m.id));
  if (newlyReached.length) {
    await supabase.from('impl_milestone_progress').insert(newlyReached.map((m) => ({
      account_id: accountId, progress_id: progress.id, milestone_id: m.id,
    })));
    for (const m of newlyReached) await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'milestone_reached', { milestone_key: m.milestone_key });
  }

  // Persist progress caches + completion.
  await supabase.from('impl_progress').update({
    progress_pct: evalResult.progressPct, score: evalResult.score, health_pct: evalResult.healthPct,
    current_step_id: evalResult.currentStepId, status: evalResult.completed ? 'completed' : 'in_progress',
    completed_at: evalResult.completed ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }).eq('id', progress.id);
  if (evalResult.completed) await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'template_completed');

  // Milestones still awaiting acknowledgement (for the celebration card).
  const { data: toAck } = await supabase.from('impl_milestone_progress')
    .select('milestone_id').eq('progress_id', progress.id).eq('acknowledged', false);
  const ackIds = new Set((toAck ?? []).map((r) => r.milestone_id));
  const milestonesToCelebrate = def.milestones.filter((m) => ackIds.has(m.id));

  return { ...evalResult, answers, milestonesToCelebrate, progressId: progress.id };
}

// --- public actions ------------------------------------------------------
export async function loadGettingStarted() {
  const { supabase, actorId, accountId } = await ctx();
  const { data: acct } = await supabase.from('accounts').select('subscription_plan').eq('id', accountId).single();
  const def = await loadDefinition(supabase);
  if (!def || !templateLineAllowed(acct?.subscription_plan, def.product_line)) return { locked: true as const };
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  return evaluateAndPersist(supabase, accountId, actorId, def, progress);
}

export async function saveAnswer(questionKey: string, value: unknown) {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  if (!def) throw new Error('No template');
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  await supabase.from('impl_answers').upsert({
    account_id: accountId, progress_id: progress.id, question_key: questionKey, value, answered_by: actorId,
    answered_at: new Date().toISOString(),
  }, { onConflict: 'progress_id,question_key' });
  await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'question_answered', { question_key: questionKey });
  const out = await evaluateAndPersist(supabase, accountId, actorId, def, progress);
  revalidatePath(ROUTE);
  return out;
}

export async function recheck() {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  if (!def) throw new Error('No template');
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  const out = await evaluateAndPersist(supabase, accountId, actorId, def, progress);
  revalidatePath(ROUTE);
  return out;
}

async function setStepStatus(stepId: string, status: 'skipped' | 'completed', event: AnalyticsEventType) {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  if (!def) throw new Error('No template');
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  await supabase.from('impl_step_progress').upsert({
    account_id: accountId, progress_id: progress.id, step_id: stepId, status,
    completed_by: actorId, completed_at: status === 'completed' ? new Date().toISOString() : null,
  }, { onConflict: 'progress_id,step_id' });
  await logEvent(supabase, accountId, actorId, def.id, progress.id, stepId, event);
  const out = await evaluateAndPersist(supabase, accountId, actorId, def, progress);
  revalidatePath(ROUTE);
  return out;
}
export async function skipStep(stepId: string) { return setStepStatus(stepId, 'skipped', 'step_skipped'); }
export async function markStepDone(stepId: string) { return setStepStatus(stepId, 'completed', 'step_completed'); }

export async function toggleTask(taskId: string, done: boolean) {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  if (!def) throw new Error('No template');
  const progress = await getOrCreateProgress(supabase, accountId, def, actorId);
  await supabase.from('impl_task_progress').upsert({
    account_id: accountId, progress_id: progress.id, task_id: taskId, done,
    done_by: actorId, done_at: done ? new Date().toISOString() : null,
  }, { onConflict: 'progress_id,task_id' });
  await logEvent(supabase, accountId, actorId, def.id, progress.id, null, 'task_toggled', { task_id: taskId, done });
  revalidatePath(ROUTE);
  return { ok: true };
}

export async function requestHelp(stepId: string | null) {
  const { supabase, actorId, accountId } = await ctx();
  const def = await loadDefinition(supabase);
  const progress = def ? await getOrCreateProgress(supabase, accountId, def, actorId) : null;
  await logEvent(supabase, accountId, actorId, def?.id ?? null, progress?.id ?? null, stepId, 'help_requested');
  return { supportUrl: def?.support_whatsapp_url ?? null };
}

export async function acknowledgeMilestone(milestoneId: string) {
  const { supabase, accountId } = await ctx();
  await supabase.from('impl_milestone_progress').update({ acknowledged: true })
    .eq('account_id', accountId).eq('milestone_id', milestoneId);
  revalidatePath(ROUTE);
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (If Supabase row typings complain, add a one-line justifying `// eslint-disable ... no-explicit-any` cast where a row is spread into a typed shape — the repo permits `any` with a justification.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/getting-started/actions.ts"
git commit -m "feat(impl): Getting Started server actions (load/answer/recheck/skip/mark/help/milestone)"
```

---

### Task 10: Web UI — page, client orchestrator, components

**Files:**
- Create: `src/app/(dashboard)/getting-started/page.tsx`
- Create: `src/app/(dashboard)/getting-started/GettingStartedClient.tsx`
- Create: `src/components/getting-started/{Hero,JourneyRail,StepPanel,ContentTabs,HealthPanel,MilestoneCard,BackToGettingStarted}.tsx`

**Interfaces:**
- Consumes: all server actions (Task 9) and types (Task 3).
- Produces: the `/getting-started` route + a reusable `BackToGettingStarted` chip.

- [ ] **Step 1: Page shell (server component)**

`page.tsx`:

```tsx
import { loadGettingStarted } from './actions';
import GettingStartedClient from './GettingStartedClient';

export const dynamic = 'force-dynamic';

export default async function GettingStartedPage() {
  const data = await loadGettingStarted();
  if ('locked' in data) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <h1 className="text-2xl font-semibold">Getting Started</h1>
        <p className="mt-2 text-muted-foreground">
          Your current plan doesn’t include this setup guide yet.
        </p>
      </div>
    );
  }
  return <GettingStartedClient initial={data} />;
}
```

- [ ] **Step 2: Client orchestrator**

`GettingStartedClient.tsx` — holds the evaluated state, selected step, and wires actions. Uses `useTransition` + `sonner`.

```tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { EvaluatedTemplate, AnswerMap, Milestone } from '@/lib/implementation/types';
import { saveAnswer, recheck, skipStep, markStepDone, toggleTask, requestHelp, acknowledgeMilestone } from './actions';
import { Hero } from '@/components/getting-started/Hero';
import { JourneyRail } from '@/components/getting-started/JourneyRail';
import { StepPanel } from '@/components/getting-started/StepPanel';
import { MilestoneCard } from '@/components/getting-started/MilestoneCard';

type LoadResult = EvaluatedTemplate & { answers: AnswerMap; milestonesToCelebrate: Milestone[]; progressId: string };

export default function GettingStartedClient({ initial }: { initial: LoadResult }) {
  const [state, setState] = useState<LoadResult>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.currentStepId ?? initial.steps[0]?.step.id ?? null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>, msg?: string) =>
    startTransition(async () => {
      try {
        const res = (await fn()) as LoadResult | { ok: true } | { supportUrl: string | null };
        if (res && 'steps' in res) setState(res);
        if (msg) toast.success(msg);
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); }
    });

  const selected = state.steps.find((s) => s.step.id === selectedId) ?? state.steps.find((s) => s.step.id === state.currentStepId);
  const celebrate = state.milestonesToCelebrate[0];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      <Hero state={state} onResume={() => setSelectedId(state.currentStepId)} onRecheck={() => run(recheck, 'Re-checked')} pending={pending} />
      {celebrate && (
        <MilestoneCard milestone={celebrate} onDismiss={() => run(() => acknowledgeMilestone(celebrate.id))} />
      )}
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <JourneyRail steps={state.steps} selectedId={selected?.step.id ?? null} onSelect={setSelectedId} />
        {selected && (
          <StepPanel
            evaluated={selected}
            answers={state.answers}
            pending={pending}
            onAnswer={(k, v) => run(() => saveAnswer(k, v))}
            onSkip={() => run(() => skipStep(selected.step.id), 'Step skipped')}
            onMarkDone={() => run(() => markStepDone(selected.step.id), 'Marked done')}
            onToggleTask={(taskId, done) => run(() => toggleTask(taskId, done))}
            onHelp={async () => { const r = await requestHelp(selected.step.id); if (r.supportUrl) window.open(r.supportUrl, '_blank'); }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `Hero.tsx`** — progress ring (SVG), score, health chip, badges, est. time, Resume + Re-check.

```tsx
'use client';
import type { EvaluatedTemplate } from '@/lib/implementation/types';
import { Button } from '@/components/ui/button';
import { HealthPanel } from './HealthPanel';

function Ring({ pct }: { pct: number }) {
  const r = 34, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="8" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 44 44)" className="text-primary transition-all" />
      <text x="44" y="49" textAnchor="middle" className="fill-foreground text-lg font-semibold">{pct}%</text>
    </svg>
  );
}

export function Hero({ state, onResume, onRecheck, pending }: {
  state: EvaluatedTemplate; onResume: () => void; onRecheck: () => void; pending: boolean;
}) {
  const remaining = state.steps.filter((s) => s.applicable && s.status !== 'completed' && s.status !== 'auto_completed' && s.status !== 'skipped')
    .reduce((a, s) => a + s.step.estimated_minutes, 0);
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-6">
      <div className="flex flex-col md:flex-row md:items-center gap-6">
        <Ring pct={state.progressPct} />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{state.template.display_name}</h1>
          <p className="text-sm text-muted-foreground">{state.template.description}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span>Score: <b>{state.score}%</b></span>
            <span>Health: <b>{state.healthPct}%</b></span>
            {remaining > 0 && <span>~{remaining} min left</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {!state.completed && <Button onClick={onResume}>Resume</Button>}
          <Button variant="outline" onClick={onRecheck} disabled={pending}>Re-check</Button>
        </div>
      </div>
      <HealthPanel steps={state.steps} />
    </div>
  );
}
```

- [ ] **Step 4: `HealthPanel.tsx`** — per-metric rows with ✓ / ⚠️ vs recommended.

```tsx
'use client';
import type { EvaluatedStep } from '@/lib/implementation/types';

export function HealthPanel({ steps }: { steps: EvaluatedStep[] }) {
  const metrics = steps.flatMap((s) => s.ruleResults
    .filter((r) => r.recommendedThreshold != null)
    .map((r) => ({ key: r.source_key, value: typeof r.value === 'number' ? r.value : (r.value ? 1 : 0), rec: r.recommendedThreshold!, ok: r.recommendedPass === true })));
  if (metrics.length === 0) return null;
  const label: Record<string, string> = { territory_count: 'Territories', customer_count: 'Customers', employee_count: 'Employees', role_count: 'Roles' };
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.key} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <span>{label[m.key] ?? m.key}</span>
          <span className={m.ok ? 'text-green-600' : 'text-amber-600'}>{m.value}{m.ok ? ' ✓' : ` ⚠️ (rec ${m.rec})`}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: `JourneyRail.tsx`** — status-pilled step list, mobile accordion.

```tsx
'use client';
import type { EvaluatedStep } from '@/lib/implementation/types';
import { cn } from '@/lib/utils';

const PILL: Record<string, string> = {
  completed: 'bg-green-100 text-green-700', auto_completed: 'bg-green-100 text-green-700',
  skipped: 'bg-muted text-muted-foreground', available: 'bg-primary/10 text-primary',
  in_progress: 'bg-primary/10 text-primary', locked: 'bg-muted text-muted-foreground',
};
const LABEL: Record<string, string> = {
  completed: 'Done', auto_completed: 'Done', skipped: 'Skipped', available: 'To do', in_progress: 'In progress', locked: 'Locked',
};

export function JourneyRail({ steps, selectedId, onSelect }: {
  steps: EvaluatedStep[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <nav className="space-y-2">
      {steps.filter((s) => s.applicable).map((s, i) => (
        <button key={s.step.id} onClick={() => onSelect(s.step.id)}
          className={cn('w-full rounded-xl border p-3 text-left transition', selectedId === s.step.id && 'ring-2 ring-primary')}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{i + 1}. {s.step.title}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-xs', PILL[s.status])}>{LABEL[s.status]}</span>
          </div>
          {s.step.estimated_minutes > 0 && <span className="text-xs text-muted-foreground">~{s.step.estimated_minutes} min</span>}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 6: `ContentTabs.tsx`** — Watch / Read / Screenshots (tabs shown only when content exists).

```tsx
'use client';
import { useState } from 'react';
import type { TemplateStep } from '@/lib/implementation/types';

export function ContentTabs({ step }: { step: TemplateStep }) {
  const tabs: string[] = [];
  if (step.video_url) tabs.push('Watch');
  if (step.quick_steps.length) tabs.push('Read');
  if (step.media.some((m) => m.media_type === 'image')) tabs.push('Screenshots');
  const [active, setActive] = useState(tabs[0] ?? 'Read');
  if (tabs.length === 0) return null;
  return (
    <div className="rounded-xl border">
      <div className="flex gap-1 border-b p-1">
        {tabs.map((t) => (
          <button key={t} onClick={() => setActive(t)}
            className={`rounded-lg px-3 py-1.5 text-sm ${active === t ? 'bg-muted font-medium' : 'text-muted-foreground'}`}>{t}</button>
        ))}
      </div>
      <div className="p-4">
        {active === 'Watch' && step.video_url && (
          <div className="aspect-video"><iframe className="h-full w-full rounded-lg" src={step.video_url} title="Walkthrough" allowFullScreen /></div>
        )}
        {active === 'Read' && (
          <ol className="list-decimal space-y-1 pl-5 text-sm">{step.quick_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        )}
        {active === 'Screenshots' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {step.media.filter((m) => m.media_type === 'image').map((m) => (
              <figure key={m.id}><img src={m.url} alt={m.caption ?? ''} className="rounded-lg border" />
                {m.caption && <figcaption className="mt-1 text-xs text-muted-foreground">{m.caption}</figcaption>}</figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: `StepPanel.tsx`** — description, ContentTabs, questions (with OZZO tips), task checklist (deep links w/ `?from=`), validation status, Re-check/Skip/Mark done/Need Help.

```tsx
'use client';
import type { EvaluatedStep, AnswerMap } from '@/lib/implementation/types';
import { Button } from '@/components/ui/button';
import { ContentTabs } from './ContentTabs';

export function StepPanel({ evaluated, answers, pending, onAnswer, onSkip, onMarkDone, onToggleTask, onHelp }: {
  evaluated: EvaluatedStep; answers: AnswerMap; pending: boolean;
  onAnswer: (k: string, v: unknown) => void; onSkip: () => void; onMarkDone: () => void;
  onToggleTask: (taskId: string, done: boolean) => void; onHelp: () => void;
}) {
  const { step, status, ruleResults } = evaluated;
  const done = status === 'completed' || status === 'auto_completed';
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{step.title}</h2>
        {step.description && <p className="text-sm text-muted-foreground">{step.description}</p>}
      </div>
      <ContentTabs step={step} />

      {step.questions.map((q) => (
        <div key={q.id} className="rounded-xl border p-4">
          <p className="text-sm font-medium">{q.label}</p>
          <div className="mt-2 grid gap-2">
            {q.options.map((o) => {
              const selected = answers[q.question_key] === o.value;
              return (
                <button key={o.value} onClick={() => onAnswer(q.question_key, o.value)}
                  className={`rounded-lg border p-3 text-left text-sm ${selected ? 'ring-2 ring-primary' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span>{o.label}</span>
                    {o.recommended_badge && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{o.recommended_badge}</span>}
                  </div>
                  {o.note && <p className="mt-1 text-xs text-muted-foreground">{o.note}</p>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {step.tasks.length > 0 && (
        <ul className="space-y-2">
          {step.tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm">{t.label}</span>
              {t.deep_link && (
                <a className="text-sm font-medium text-primary underline"
                   href={`${t.deep_link}?from=getting-started&step=${step.step_key}`}
                   onClick={() => onToggleTask(t.id, true)}>Go →</a>
              )}
            </li>
          ))}
        </ul>
      )}

      {ruleResults.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          {ruleResults.map((r) => (
            <div key={r.source_key} className={r.requiredPass ? 'text-green-600' : 'text-muted-foreground'}>
              {r.source_key}: {String(r.value)} {r.requiredPass ? '✓' : ''}
              {r.recommendedThreshold != null && ` · recommended ${r.recommendedThreshold}${r.recommendedPass ? ' ✓' : ' ⚠️'}`}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!done && !step.auto_complete && <Button onClick={onMarkDone} disabled={pending}>Mark done</Button>}
        {!done && step.is_optional && <Button variant="ghost" onClick={onSkip} disabled={pending}>Skip</Button>}
        <Button variant="outline" onClick={onHelp}>Need help?</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: `MilestoneCard.tsx`** — celebration, dismiss → acknowledge.

```tsx
'use client';
import type { Milestone } from '@/lib/implementation/types';
import { Button } from '@/components/ui/button';

export function MilestoneCard({ milestone, onDismiss }: { milestone: Milestone; onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div>
        <p className="font-semibold">🎉 {milestone.title}</p>
        {milestone.message && <p className="text-sm text-muted-foreground">{milestone.message}</p>}
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
    </div>
  );
}
```

- [ ] **Step 9: `BackToGettingStarted.tsx`** — chip that any deep-linked page renders when `?from=getting-started`.

```tsx
'use client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export function BackToGettingStarted() {
  const params = useSearchParams();
  if (params.get('from') !== 'getting-started') return null;
  const step = params.get('step');
  return (
    <Link href={`/getting-started${step ? `?step=${step}` : ''}`}
      className="mb-3 inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-sm text-primary shadow-sm">
      <ArrowLeft className="h-4 w-4" /> Back to Getting Started
    </Link>
  );
}
```

- [ ] **Step 10: Typecheck & build**

Run: `npm run typecheck` then `npm run build`
Expected: clean typecheck; successful build. Paste the real tail of each. Fix any error before committing (common: `cn` import path is `@/lib/utils`; `Button` is `@/components/ui/button`).

- [ ] **Step 11: Commit**

```bash
git add "src/app/(dashboard)/getting-started" src/components/getting-started
git commit -m "feat(impl): Getting Started web UI (hero, journey rail, step panel, milestones, health)"
```

---

### Task 11: Sidebar nav entry + deep-link back chip wiring

**Files:**
- Modify: the dashboard sidebar/nav definition (find with `grep -rl "location-tracking\|/territories" src/components | grep -i nav`; likely `src/components/layout/*` or a `nav`/`sidebar` file).
- Modify: the shared page header used by `/territories`, `/contacts`, `/team`, `/import`, `/field-staff`, `/location-tracking` — OR add `<BackToGettingStarted />` at the top of each of those page files.

**Interfaces:**
- Consumes: `BackToGettingStarted` (Task 10), `useAuth().hasWFA` + `hasPermission('view_implementation')`.

- [ ] **Step 1: Locate the nav file**

Run: `grep -rln "Territories\|location-tracking" src/components src/app | grep -iE "nav|sidebar|layout"`
Read the matched file; identify the array of `{ label, href, icon }` items and the gating pattern (it will already gate items on `hasWFA` / `isModuleEnabled`).

- [ ] **Step 2: Add the nav item**

Add, following the file's existing item shape (adjust key names to match), gated so it shows for WFA-entitled admins/owners:

```tsx
// Example — match the file's actual item type and gating helper:
{ label: 'Getting Started', href: '/getting-started', icon: Rocket,
  show: (hasWFA || hasCRM || hasSFA) && (isOwner || isAdmin || hasPermission('view_implementation')) },
```

Import `Rocket` from `lucide-react`.

- [ ] **Step 3: Add the return chip to deep-link targets**

For each of `/territories`, `/contacts`, `/team`, `/import`, `/field-staff`, `/location-tracking` page (client components), add near the top of the returned JSX:

```tsx
import { BackToGettingStarted } from '@/components/getting-started/BackToGettingStarted';
// ...inside the top of the page's returned layout:
<BackToGettingStarted />
```

If those pages are server components, wrap the chip usage — `BackToGettingStarted` is a client component using `useSearchParams`, which is valid to render inside a server component. Ensure a `<Suspense>` boundary exists if the page build complains about `useSearchParams` (Next 16: wrap `<Suspense fallback={null}><BackToGettingStarted/></Suspense>`).

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: success. If `useSearchParams` triggers a CSR-bailout error, apply the `<Suspense>` wrap from Step 3.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(impl): sidebar Getting Started entry + back-to-setup chips on deep-link targets"
```

---

### Task 12: Full verification, push, apply, rollback note

**Files:**
- Create: `supabase/migrations/ROLLBACK-implementation-center.md`

- [ ] **Step 1: Run the full test + type + build suite**

```bash
npm test
npm run typecheck
npm run build
```
Expected: all green. Paste the real summary lines (test count, `tsc` clean, build success). Do NOT proceed if anything fails.

- [ ] **Step 2: Write the rollback note**

`ROLLBACK-implementation-center.md`:

```markdown
# Rollback — Implementation Center (2026-09-20)

Migrations: 20260920120000_implementation_center.sql, 20260920120100_seed_wfa_v1_template.sql

To fully remove (dev/prod):

```sql
DROP TABLE IF EXISTS impl_analytics_events, impl_milestone_progress, impl_task_progress,
  impl_answers, impl_step_progress, impl_progress,
  impl_milestones, impl_conditions, impl_validation_rules, impl_step_media,
  impl_step_questions, impl_step_tasks, impl_steps, impl_templates CASCADE;
```

Web: revert the feature commits; the sidebar entry and `/getting-started` route disappear with them.
Permissions `view_implementation` / `manage_implementation` are inert once the UI is gone.
```

- [ ] **Step 3: Commit & push to main**

```bash
git add supabase/migrations/ROLLBACK-implementation-center.md
git commit -m "docs(impl): rollback note for Implementation Center"
git push origin main
```

- [ ] **Step 4: Apply migrations to production (MANUAL — call out to founder)**

The two migrations are NOT auto-applied. Apply in Supabase (SQL editor or MCP `apply_migration`) in order:
1. `20260920120000_implementation_center.sql`
2. `20260920120100_seed_wfa_v1_template.sql`

Because definition tables are global and the seed inserts `wfa_v1`, every WFA-entitled tenant sees "Getting Started" immediately after apply + deploy. Report the Vercel deploy + confirm the route renders for a WFA account.

---

## Self-Review

**1. Spec coverage**
- Templates/steps/tasks/questions/media/rules/conditions/milestones + runtime progress/answers/analytics → Task 1 (schema), Task 2 (seed). ✓
- Configuration-driven, versioned, reusable across lines → Task 1 (`product_line`, `template_key`, `version`), Task 8 gating, §9 path. ✓
- Conditional branching → Task 6 + seed condition (Step 3 area_wise show). ✓
- Progress tracking, auto-completion, skipped steps → Task 7 (`evaluateTemplate`), Task 9 (`skipStep`). ✓
- Implementation score + Health + estimated time + progress % + badges + next action → Task 4 (score/health/progress), Task 10 (Hero ring, HealthPanel, remaining-min, currentStep). ✓
- Milestones (#4), Need-Help (#3), Video+Read+Screenshots (#5), Discovery (#6), Resume-after-deeplink (#7), Recommended tips (#8), friendly naming (#1), meaningful-data not reports-opened (#8-disagreement) → Tasks 2/9/10/11. ✓
- Analytics drop-off/completion events → Task 1 (`impl_analytics_events`), Task 9 (`logEvent` on every action). ✓
- DB design for all entities → Task 1. ✓
- Validation sources = real entities → Task 5 resolvers. ✓

**2. Placeholder scan** — No TBD/TODO. Every code step has real code. Nav file is located by grep in Task 11 (its exact path can't be known ahead of reading it) — the step gives the discovery command and the concrete item to add, not a vague instruction.

**3. Type consistency** — `EvaluatedTemplate`, `EvaluatedStep`, `RuleEvaluation`, `StepStatus`, `AnswerMap`, `ResolverCtx`, `ResolverOverride`, `TemplateDefinition` used identically across Tasks 3–10. `runResolver(sourceKey, ctx)` signature consistent (Tasks 5, 7). Scoring fns `computeProgressPct/computeScore/computeHealthPct` consistent (Tasks 4, 7). Server-action return shape (`EvaluatedTemplate & { answers, milestonesToCelebrate, progressId }`) consistent (Tasks 9, 10). `source_key` list identical in Tasks 2, 5, 7.

**Note on Task 11:** the exact nav file path is discovered at execution time; this is the one place the plan intentionally defers to a grep because the repo's nav location must be read, not guessed. Every other file path is exact.
