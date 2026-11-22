# Partner Portal Phase 2C — My Activity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `partner_tasks` up to the CRM's activity model and build the My Activity screen, so a salesperson plans and records their day in the partner portal exactly as they would in `/follow-ups`.

**Architecture:** `partner_tasks` as shipped in Phase 2A is a two-state to-do list (`Undone`/`Done`, one assignee, a fixed `kind` CHECK). The CRM's `tasks` is a five-state activity with an editable type list, start and reminder dates, and a `task_assignees` child table where each person ticks their own box and a trigger rolls the result up. Phase 2C closes that gap in one migration, adds a fourth master list for the activity types, then builds one screen — the CRM's My Activity, which is a filtered card list rather than a DataTable.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 6, Tailwind 4, Base UI 1.9, Supabase (`@supabase/ssr` 0.10.3) against the Mumbai project `ltigfpywdbfilsagtpyd`, vitest 4.1.9, date-fns.

**Spec:** `docs/superpowers/specs/2026-11-20-partner-portal-design.md` — the row that reads `| My Activity | app/(dashboard)/follow-ups | Same screen and the same TaskForm, against partner leads/customers |`, and Phase 2's *done when*.

**Repos:** the app is `C:\Wacrm\ozzo-partner` (port 3300, repo `sumitvegad07-alt/ozzo-partner`). **Migrations and DB scenarios live in `C:\Wacrm\wacrm-web`**, which is where the harness and the whole migration history are. Two working directories, as in 2A and 2B.

## Global Constraints

- **Push directly to `main`.** No branches, no PRs — Vercel deploys `main`, so branched work never reaches live.
- **No local database.** The only way to exercise SQL is the throwaway harness: `cd C:\Wacrm\wacrm-web && PGPORT=54431 PGDATA_DIR=<scratchpad>/pgtest-2d bash scripts/run-db-tests.sh`. A fresh `PGPORT` and `PGDATA_DIR` per run. Never edit `scripts/run-db-tests.sh` while it is running. Roughly 47 migration errors on the way up are expected and pre-existing; what matters is the `passed | failed` table and `All scenarios passed.`
- **The scenario list in `scripts/run-db-tests.sh` is hard-coded, not a glob.** A new `supabase/tests/*.sql` file that is not added to the `for f in …` list on line 101 is never run, and the suite still says it passed.
- **Five gates before anything is called done:** `npx tsc --noEmit`, `npx vitest run`, `npx next build`, the harness, and a click-through on the running app.
- **Five questions answered in the comments of every migration:** (1) what breaks if this runs twice; (2) what else in either repo *and in `supabase/tests`* reads these columns; (3) what happens to rows that already exist; (4) which policy decides who may read the new rows; (5) how to undo it.
- **`qa_refused()` passes only when the statement RAISES.** Triggers, CHECKs, unique indexes and FKs raise. **RLS on UPDATE and DELETE does not** — it filters rows away, the statement completes quietly, and `qa_refused` reports "refused" even with RLS switched off. For those, run the statement plainly, then read the row back as `postgres` and assert it did not change. This was got wrong three times in files 81 and 82.
- **`\gset` must come before `SET ROLE`**, or it captures an id RLS hides and errors "no rows returned".
- **Never add a second foreign key between the same pair of tables** — it breaks PostgREST embeds with a 404. `partner_tasks.created_by` is `uuid` with no FK for exactly this reason, and `partner_task_assignees` must not gain a second route to `partner_employees`.
- **PostgREST silently caps a result at 1,000 rows.** Any list that could exceed it needs an explicit `.range()` and a banner.
- Every API route calls `requirePartnerRight()` on the caller's own RLS-scoped session **before** `serviceClient()` is built. A route-shape test pins the ordering.
- Plain English in all user-facing copy. The founder reads these screens; he does not read terminals.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## What is actually different between the two models

Worth having in front of you for the whole of Task 1.

| | CRM `tasks` | `partner_tasks` as shipped | Phase 2C |
|---|---|---|---|
| main text | `description`, `title` optional | `subject` NOT NULL, `detail` | rename to `description` / `title`, neither NOT NULL, CHECK that one is filled |
| type | `activity_type` text, list from `accounts.settings.task_types` | `kind` with a fixed 6-value CHECK | `activity_type` text, list from a new `partner_activity_types` master, validated by trigger |
| status | Pending / In Progress / Waiting / Completed / Cancelled | Undone / Done | the CRM's five |
| dates | `due_date`, `due_time`, `start_date`, `reminder_date`, `reminder_time` | `due_date`, `due_time` | add the three |
| assignee | `assigned_user_id` nullable + `task_assignees` child, per-person status, rollup trigger | `assignee_id` NOT NULL, single | nullable + `partner_task_assignees` + rollup |
| visibility | account membership | `assignee_id in partner_scope_ids()` | widened — see the trap below |

### The trap this phase turns on

`partner_tasks_select` reads `assignee_id in (select public.partner_scope_ids())`. Two changes in this phase each break it:

1. **`assignee_id` becomes nullable.** The rollup trigger sets it to NULL when the last assignee is removed, and the CRM explicitly allows an activity with nobody on it. A NULL `assignee_id` matches no scope, so the row becomes invisible **to its own author** — no error, it just disappears.
2. **A second assignee is not in `assignee_id`.** Whoever was added second would never see the activity on the screen called My Activity. This is the same fault the leads `collaborator_ids` widening fixed, and it is why that widening is worth copying rather than re-deriving.

So the policy must read: I have the right, **and** (the primary assignee is in my scope, **or** I created it, **or** one of the assignee rows is in my scope).

---

## File Structure

### `C:\Wacrm\wacrm-web` (migrations and DB scenarios)

| File | Responsibility |
|---|---|
| Create `supabase/migrations/20261124120000_partner_activity_crm_parity.sql` | The whole DB change: column renames, the five statuses, the three dates, `partner_activity_types`, `partner_task_assignees`, the rollup trigger, the type-validation trigger, the widened policies. |
| Create `supabase/tests/84_partner_activity.sql` | Scenario proving the rollup, the per-person tick, the widened visibility, and the type guard. |
| Modify `scripts/run-db-tests.sh:101` | Register `84_partner_activity` in the hard-coded list. |
| Create `docs/RUN-THIS-SQL-partner-activity.md` | The paste-into-Supabase document, **generated from the migration file, never hand-written** (the stale `-phase2.md` created 8 tables instead of 9 because it was hand-assembled). |
| Create `supabase/migrations/ROLLBACK-partner-portal-activity.md` | How to undo it. |
| Modify `docs/superpowers/plans/2026-11-22-partner-portal-phase-2c.md` | Append "What actually changed during execution" at the end. |

### `C:\Wacrm\ozzo-partner` (the app)

| File | Responsibility |
|---|---|
| Create `lib/activity/types.ts` | The `Activity` row type, `ActivityInput`, the status and priority constants, `linkedLabel()`. |
| Create `lib/activity/assignees.ts` | Pure mirror of the rollup trigger: `rollupStatus`, `myStatus`, `progressLabel`, `assigneeLabel`, `displayedStatus`. |
| Create `lib/activity/assignees.test.ts` | Tests for all five, including the case the trigger gets right and a naive version does not. |
| Create `lib/activity/period-filter.ts` | `TaskPeriod`, `DEFAULT_PERIOD`, `matchesPeriod` — ported from the CRM. |
| Create `lib/activity/period-filter.test.ts` | Tests, including the undated-task rule. |
| Create `lib/activity/validate.ts` | `validateActivityInput`, `stripActivityColumns`. |
| Create `lib/activity/validate.test.ts` | Tests. |
| Create `app/api/activity/route.ts` | POST / PATCH / DELETE, each gated, each writing the timeline. |
| Create `app/api/activity/route-shape.test.ts` | Pins the gate-before-service-client ordering and the right keys. |
| Create `app/api/activity/complete/route.ts` | The tick. One place, so the per-person rule cannot drift. |
| Create `app/(portal)/activity/page.tsx` | Server component: the gate, then the client. |
| Create `app/(portal)/activity/activity-client.tsx` | The filter bar, the list, the tick, the dialog. |
| Create `app/(portal)/activity/activity-form.tsx` | Add / edit, in a dialog like the CRM's `TaskForm`. |
| Modify `lib/masters/types.ts` | A fourth kind, `activity`. |
| Modify `app/(portal)/settings/settings-client.tsx:34` | Derive `KINDS` from `MASTER_TABLES` so a fifth list cannot be forgotten. |
| Modify `lib/masters/types.test.ts` | Assert the derivation covers every kind. |
| Modify `lib/nav.ts:66` | `/activity` → `built: true`. |
| Modify `lib/nav.test.ts:36` | Add `/activity` to the built list. |

---

### Task 1: The migration, and the scenario that proves it

**Files:**
- Create: `C:\Wacrm\wacrm-web\supabase\migrations\20261124120000_partner_activity_crm_parity.sql`
- Create: `C:\Wacrm\wacrm-web\supabase\tests\84_partner_activity.sql`
- Modify: `C:\Wacrm\wacrm-web\scripts\run-db-tests.sh:101`
- Create: `C:\Wacrm\wacrm-web\docs\RUN-THIS-SQL-partner-activity.md`
- Create: `C:\Wacrm\wacrm-web\supabase\migrations\ROLLBACK-partner-portal-activity.md`

**Interfaces:**
- Consumes: `public.partner_me()` → `partner_employees.id` of the caller; `public.partner_has_right(text)`; `public.partner_scope_ids()` → `setof uuid` of `partner_employees.id`; `public.partner_tasks`, `public.partner_leads`, `public.partner_customers`, `public.partner_module_activities` from `20261121120000` and `20261123120000`.
- Produces: table `public.partner_activity_types (id, name, sort_order, is_active)`; table `public.partner_task_assignees (id, task_id, employee_id, status, completed_at, created_at)`; `public.partner_tasks` with columns `title, description, activity_type, status, priority, due_date, due_time, start_date, reminder_date, reminder_time, assignee_id (nullable), lead_id, customer_id, completed_at, created_by, created_at, updated_at`; trigger functions `public.partner_task_assignees_rollup()` and `public.partner_tasks_check_type()`.

- [ ] **Step 1: Grep the rename's blast radius — both repos AND the test folder**

The Phase 2B rename aborted two scenario files because the grep covered the app repos and not `supabase/tests`. Do it properly this time, and paste the output into the migration's question 2.

```bash
cd /c/Wacrm
grep -rn "partner_tasks\|\bsubject\b\|\bdetail\b" \
  ozzo-partner/app ozzo-partner/lib \
  wacrm-web/src wacrm-web/supabase/migrations wacrm-web/supabase/tests \
  --include=*.ts --include=*.tsx --include=*.sql | grep -v node_modules
```

Expected today: `partner_tasks` appears only in `20261121120000_partner_portal_phase2.sql` (the table and its policies) and as the string `"task"` in `ozzo-partner/lib/activities.ts` and `ozzo-partner/lib/record-views/unseen.ts`. No screen reads `subject` or `detail` yet, because no screen exists. Record that, including the `unseen.ts` module name, which must keep saying `task`.

- [ ] **Step 2: Write the migration**

Create `C:\Wacrm\wacrm-web\supabase\migrations\20261124120000_partner_activity_crm_parity.sql`:

```sql
-- ============================================================
-- 20261124120000_partner_activity_crm_parity.sql
-- MY ACTIVITY — partner_tasks brought up to the CRM's activity model
--
-- partner_tasks shipped in Phase 2A as a two-state to-do list. The founder's
-- module is the CRM's My Activity, which is a different thing: an activity
-- has a type from an editable list, five states, a start date and a reminder,
-- and can be shared by several people who each tick their own box.
--
-- ── THE FIVE QUESTIONS ──
--
-- 1. WHAT BREAKS IF THIS RUNS TWICE?
--    Nothing. Every rename is guarded on the old column still existing, every
--    create is IF NOT EXISTS, every policy and function is drop-then-create,
--    and the seed is ON CONFLICT DO NOTHING. The status backfill matches on
--    the old values, which no longer exist after the first run.
--
-- 2. WHAT ELSE READS THESE COLUMNS?
--    Nothing yet, and that was checked properly — in ozzo-partner/{app,lib},
--    wacrm-web/src, supabase/migrations AND supabase/tests. The last of those
--    is the one that was missed when business_name was renamed in
--    20261123120000: files 81 and 82 delete fixtures by the old column name,
--    so both aborted half way while the suite still reported 0 failed and a
--    pass count 20 lower than the run before. A rename's blast radius
--    includes the tests.
--    Two live references to keep in mind, neither of them a column:
--      - ozzo-partner/lib/activities.ts PartnerModule includes "task"
--      - ozzo-partner/lib/record-views/unseen.ts RecordModule includes "task"
--    Both are the string 'task' in partner_module_activities.module_name and
--    partner_record_views.module_name. This migration does not touch either.
--
-- 3. WHAT HAPPENS TO ROWS THAT ALREADY EXIST?
--    partner_tasks is empty on production — no screen has ever written to it.
--    The migration is still written as though it were not:
--      - 'Undone' becomes 'Pending', 'Done' becomes 'Completed'
--      - kind becomes activity_type with its value kept
--      - every existing assignee_id gets a partner_task_assignees row, so the
--        child table is the truth from the first moment rather than from the
--        first edit
--
-- 4. WHICH POLICY DECIDES WHO MAY READ THE NEW ROWS?
--    partner_tasks_select, widened here, and partner_task_assignees_select,
--    which defers to it. See THE VISIBILITY TRAP below — this is the part of
--    the migration most likely to be wrong in a way nobody notices.
--
-- 5. HOW DO I UNDO IT?
--    supabase/migrations/ROLLBACK-partner-portal-activity.md.
--
-- ── THE VISIBILITY TRAP ──
--
-- The old policy was `assignee_id in (select public.partner_scope_ids())`.
-- Two changes here each break it on their own:
--
--   (a) assignee_id becomes NULLABLE, because the rollup sets it to NULL when
--       the last assignee is removed and because the CRM allows an activity
--       with nobody on it. NULL matches no scope, so the row would vanish
--       from its own author's screen. No error. It simply is not there.
--
--   (b) a SECOND assignee is not in assignee_id at all, so whoever was added
--       second would never see the activity on the screen called My Activity.
--       This is the same fault the leads collaborator widening fixed in
--       20261122120000.
--
-- Hence: the right, AND (primary assignee in scope OR I created it OR one of
-- the assignee rows is in scope).
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. The activity types master
--
-- The CRM keeps this list in accounts.settings->>'task_types'. The portal has
-- no accounts row of its own, so it becomes a fourth master list beside lead
-- statuses, sources and industries — same shape, same Settings screen, same
-- API route. No colour column: an activity type has no use for one, and
-- giving three of four lists a colour is what produced "column
-- partner_industries.colour does not exist" on the live portal.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.partner_activity_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint partner_activity_types_name_not_blank check (btrim(name) <> '')
);
create unique index if not exists uq_partner_activity_types_name
  on public.partner_activity_types (lower(name));

insert into public.partner_activity_types (name, sort_order) values
  ('Task', 10), ('Call', 20), ('Visit', 30),
  ('Meeting', 40), ('Follow up', 50), ('Note', 60)
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- 2. partner_tasks: the columns
--
-- Renames are guarded on the OLD column still being there, so a re-run is a
-- no-op rather than an error. The names are the CRM's so that the two
-- screens can be read against each other line for line, which is the whole
-- reason Phase 2B renamed business_name and contact_person.
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'partner_tasks'
                and column_name = 'subject') then
    alter table public.partner_tasks rename column subject to title;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'partner_tasks'
                and column_name = 'detail') then
    alter table public.partner_tasks rename column detail to description;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'partner_tasks'
                and column_name = 'kind') then
    alter table public.partner_tasks rename column kind to activity_type;
  end if;
end $$;

-- The CRM makes title optional: an activity is usually one typed line, and
-- that line lands in description. A row with neither is a blank card, so one
-- of the two is required — by CHECK, not by hope.
alter table public.partner_tasks alter column title drop not null;
alter table public.partner_tasks
  drop constraint if exists partner_tasks_has_words;
alter table public.partner_tasks
  add constraint partner_tasks_has_words
  check (coalesce(btrim(title), '') <> '' or coalesce(btrim(description), '') <> '');

alter table public.partner_tasks add column if not exists start_date    date;
alter table public.partner_tasks add column if not exists reminder_date date;
alter table public.partner_tasks add column if not exists reminder_time time;

-- The fixed six-value CHECK and an editable master list contradict each
-- other: adding "Demo" in Settings would be rejected by the database. The
-- CHECK goes, and a trigger validates against the master instead (section 4).
alter table public.partner_tasks
  drop constraint if exists partner_tasks_kind_check;
alter table public.partner_tasks
  alter column activity_type set default 'Task';

-- The CRM's five states. Drop the old CHECK first: the backfill below writes
-- values the old one forbids.
alter table public.partner_tasks
  drop constraint if exists partner_tasks_status_check;
alter table public.partner_tasks alter column status drop default;

update public.partner_tasks set status = 'Pending'   where status = 'Undone';
update public.partner_tasks set status = 'Completed' where status = 'Done';

alter table public.partner_tasks
  alter column status set default 'Pending';
alter table public.partner_tasks
  add constraint partner_tasks_status_check
  check (status in ('Pending', 'In Progress', 'Waiting', 'Completed', 'Cancelled'));

-- Nullable, and ON DELETE SET NULL rather than RESTRICT. Deactivating an
-- employee should not be blocked by the activities they were on, and the
-- rollup below sets this column to NULL by design when the last assignee
-- goes. Read the visibility trap again before changing this.
alter table public.partner_tasks alter column assignee_id drop not null;
alter table public.partner_tasks
  drop constraint if exists partner_tasks_assignee_id_fkey;
alter table public.partner_tasks
  add constraint partner_tasks_assignee_id_fkey
  foreign key (assignee_id) references public.partner_employees(id) on delete set null;

create index if not exists ix_partner_tasks_status   on public.partner_tasks (status);
create index if not exists ix_partner_tasks_type     on public.partner_tasks (activity_type);
create index if not exists ix_partner_tasks_lead     on public.partner_tasks (lead_id);
create index if not exists ix_partner_tasks_customer on public.partner_tasks (customer_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. partner_task_assignees — several people, each ticking their own box
--
-- A copy of the CRM's task_assignees (20261026120000), retargeted:
-- profile_id becomes employee_id pointing at partner_employees, and there is
-- no account_id because the portal is single-tenant by construction.
--
-- assignee_id on the parent is NOT dropped. It keeps pointing at the first
-- assignee, maintained by the rollup, because the list screen sorts and
-- labels by it and because one FK is cheaper than an embed on every row.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.partner_task_assignees (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.partner_tasks(id) on delete cascade,
  employee_id  uuid not null references public.partner_employees(id) on delete cascade,
  status       text not null default 'Pending'
               check (status in ('Pending', 'Completed')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (task_id, employee_id)
);
create index if not exists ix_partner_task_assignees_task
  on public.partner_task_assignees (task_id);
create index if not exists ix_partner_task_assignees_employee
  on public.partner_task_assignees (employee_id);

-- One row per already-assigned task, so the child table is the truth from
-- now rather than from the first edit. Runs as the migration owner, before
-- RLS could filter it.
insert into public.partner_task_assignees (task_id, employee_id, status, completed_at)
select t.id,
       t.assignee_id,
       case when t.status = 'Completed' then 'Completed' else 'Pending' end,
       case when t.status = 'Completed' then t.updated_at end
  from public.partner_tasks t
 where t.assignee_id is not null
on conflict (task_id, employee_id) do nothing;

-- The rollup. The assignee rows are the truth; partner_tasks is the summary.
--
-- Note what it does NOT do: a status someone set by hand — In Progress,
-- Waiting, Cancelled — is left alone. Only Completed is derived, and only a
-- task that HAD been Completed is dropped back out of it when a new person
-- is added. A cancelled activity is never resurrected, because 'Cancelled'
-- is not 'Completed'.
create or replace function public.partner_task_assignees_rollup()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_task_id uuid := coalesce(new.task_id, old.task_id);
  v_total   int;
  v_done    int;
  v_first   uuid;
begin
  select count(*), count(*) filter (where status = 'Completed')
    into v_total, v_done
    from partner_task_assignees where task_id = v_task_id;

  select employee_id into v_first
    from partner_task_assignees where task_id = v_task_id
    order by created_at, id limit 1;

  -- Nobody left on it. The activity keeps whatever status it was given by
  -- hand: there is nothing to roll up from, and silently completing it would
  -- be a lie. It stays visible to its author — that is what the created_by
  -- arm of partner_tasks_select is for.
  if v_total = 0 then
    update partner_tasks
       set assignee_id = null, updated_at = now()
     where id = v_task_id and assignee_id is distinct from null;
    return coalesce(new, old);
  end if;

  update partner_tasks
     set assignee_id = v_first,
         status = case
                    when v_done = v_total then 'Completed'
                    when status = 'Completed' then 'Pending'
                    else status
                  end,
         completed_at = case when v_done = v_total then now() else null end,
         updated_at = now()
   where id = v_task_id;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_partner_task_assignees_rollup on public.partner_task_assignees;
create trigger trg_partner_task_assignees_rollup
  after insert or update of status or delete on public.partner_task_assignees
  for each row execute function public.partner_task_assignees_rollup();

-- ─────────────────────────────────────────────────────────────────────
-- 4. The activity type guard
--
-- Replaces the dropped CHECK. Validated on INSERT and only when the column
-- actually changes, and against EVERY row of the master including the
-- inactive ones: deactivating "Visit" should hide it from the picker, not
-- make last month's visits uneditable.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.partner_tasks_check_type()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.activity_type is null or btrim(new.activity_type) = '' then
    new.activity_type := 'Task';
  end if;

  if not exists (select 1 from partner_activity_types
                  where lower(name) = lower(btrim(new.activity_type))) then
    raise exception 'Unknown activity type: %', new.activity_type
      using hint = 'Add it in Settings first.';
  end if;

  -- Store the master's spelling, so "call" and "Call" cannot both appear in
  -- a filter dropdown as two different types.
  select name into new.activity_type from partner_activity_types
   where lower(name) = lower(btrim(new.activity_type));

  return new;
end $$;

drop trigger if exists trg_partner_tasks_check_type on public.partner_tasks;
create trigger trg_partner_tasks_check_type
  before insert or update of activity_type on public.partner_tasks
  for each row execute function public.partner_tasks_check_type();

-- ─────────────────────────────────────────────────────────────────────
-- 5. Policies
-- ─────────────────────────────────────────────────────────────────────
alter table public.partner_activity_types   enable row level security;
alter table public.partner_task_assignees   enable row level security;

-- Masters: everyone in the portal reads them, manage_masters writes them.
-- Identical to the other three lists in 20261121120000.
drop policy if exists partner_activity_types_select on public.partner_activity_types;
create policy partner_activity_types_select on public.partner_activity_types
  for select to authenticated
  using (public.partner_me() is not null);

drop policy if exists partner_activity_types_write on public.partner_activity_types;
create policy partner_activity_types_write on public.partner_activity_types
  for all to authenticated
  using (public.partner_has_right('manage_masters'))
  with check (public.partner_has_right('manage_masters'));

-- THE WIDENED SELECT. Read the visibility trap at the top before editing.
drop policy if exists partner_tasks_select on public.partner_tasks;
create policy partner_tasks_select on public.partner_tasks
  for select to authenticated
  using (
    public.partner_has_right('view_activities')
    and (
          assignee_id in (select public.partner_scope_ids())
      or  created_by  in (select public.partner_scope_ids())
      or  exists (
            select 1 from public.partner_task_assignees a
             where a.task_id = partner_tasks.id
               and a.employee_id in (select public.partner_scope_ids())
          )
    )
  );

-- Insert: assignee_id may be NULL now, so an unassigned activity is allowed
-- as long as it is one the caller could own.
drop policy if exists partner_tasks_insert on public.partner_tasks;
create policy partner_tasks_insert on public.partner_tasks
  for insert to authenticated
  with check (
    public.partner_has_right('create_activities')
    and (assignee_id is null or assignee_id in (select public.partner_scope_ids()))
  );

drop policy if exists partner_tasks_update on public.partner_tasks;
create policy partner_tasks_update on public.partner_tasks
  for update to authenticated
  using (
    public.partner_has_right('edit_activities')
    and (
          assignee_id in (select public.partner_scope_ids())
      or  created_by  in (select public.partner_scope_ids())
      or  exists (
            select 1 from public.partner_task_assignees a
             where a.task_id = partner_tasks.id
               and a.employee_id in (select public.partner_scope_ids())
          )
    )
  )
  with check (assignee_id is null or assignee_id in (select public.partner_scope_ids()));

drop policy if exists partner_tasks_delete on public.partner_tasks;
create policy partner_tasks_delete on public.partner_tasks
  for delete to authenticated
  using (
    public.partner_has_right('delete_activities')
    and (
          assignee_id in (select public.partner_scope_ids())
      or  created_by  in (select public.partner_scope_ids())
    )
  );

-- Assignee rows follow the parent for reading, so a person on a shared
-- activity can see who else is on it.
drop policy if exists partner_task_assignees_select on public.partner_task_assignees;
create policy partner_task_assignees_select on public.partner_task_assignees
  for select to authenticated
  using (exists (select 1 from public.partner_tasks t where t.id = task_id));

-- Writing the LIST of people is editing the activity.
drop policy if exists partner_task_assignees_write on public.partner_task_assignees;
create policy partner_task_assignees_write on public.partner_task_assignees
  for all to authenticated
  using (
    public.partner_has_right('edit_activities')
    and exists (select 1 from public.partner_tasks t where t.id = task_id)
  )
  with check (
    public.partner_has_right('edit_activities')
    and employee_id in (select public.partner_scope_ids())
  );

-- Ticking YOUR OWN box is not editing the activity, and must not need
-- edit_activities: a Sales Executive given only view_activities still has to
-- be able to finish their own work. Scoped to their own row and to the two
-- status values, so this is not a back door to reassignment.
drop policy if exists partner_task_assignees_tick_own on public.partner_task_assignees;
create policy partner_task_assignees_tick_own on public.partner_task_assignees
  for update to authenticated
  using (employee_id = public.partner_me())
  with check (employee_id = public.partner_me());
```

- [ ] **Step 3: Write the scenario**

Create `C:\Wacrm\wacrm-web\supabase\tests\84_partner_activity.sql`:

```sql
-- ============================================================
-- 2026-11-24 — My Activity (20261124120000).
--
-- A5 is the scenario that matters most: a SECOND assignee must be able to
-- see the activity. The old policy read assignee_id only, so whoever was
-- added second would have found the screen called My Activity empty — no
-- error, no empty-state explaining itself, just nothing.
--
-- A7 is the one that nearly went unwritten: an activity with nobody on it
-- must stay visible to its author. The rollup sets assignee_id to NULL by
-- design, and NULL is in no scope.
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
-- ============================================================
\set ON_ERROR_STOP on

\set BOSS  '''e0000000-0000-0000-0000-00000000000a'''
\set REP1  '''e0000000-0000-0000-0000-00000000000b'''
\set REP2  '''e0000000-0000-0000-0000-00000000000c'''
\set OTHER '''e0000000-0000-0000-0000-00000000000d'''

RESET ROLE;

DELETE FROM public.partner_task_assignees WHERE task_id IN
  (SELECT id FROM public.partner_tasks WHERE title LIKE 'QA5 %' OR description LIKE 'QA5 %');
DELETE FROM public.partner_tasks     WHERE title LIKE 'QA5 %' OR description LIKE 'QA5 %';
DELETE FROM public.partner_employees WHERE email LIKE '%@act.test';
DELETE FROM auth.users               WHERE email LIKE '%@act.test';

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:BOSS,  'boss@act.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:REP1,  'rep1@act.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:REP2,  'rep2@act.test',  '{"skip_account_provision":"true"}'::jsonb),
  (:OTHER, 'other@act.test', '{"skip_account_provision":"true"}'::jsonb);

-- Roles: a manager who sees their team, two reps who see only their own, and
-- an outsider on a different branch of the tree.
INSERT INTO public.partner_roles (name, permissions, data_scope, is_system)
VALUES ('QA5 Manager', '{"view_activities":true,"create_activities":true,"edit_activities":true,"delete_activities":true}'::jsonb, 'team', false),
       ('QA5 Rep',     '{"view_activities":true,"create_activities":true}'::jsonb, 'own', false)
ON CONFLICT DO NOTHING;

INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :BOSS, 'QA5 Boss', 'boss@act.test', r.id, 'active'
  FROM public.partner_roles r WHERE r.name = 'QA5 Manager';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status, manager_id)
SELECT :REP1, 'QA5 Rep One', 'rep1@act.test', r.id, 'active',
       (SELECT id FROM public.partner_employees WHERE email = 'boss@act.test')
  FROM public.partner_roles r WHERE r.name = 'QA5 Rep';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status, manager_id)
SELECT :REP2, 'QA5 Rep Two', 'rep2@act.test', r.id, 'active',
       (SELECT id FROM public.partner_employees WHERE email = 'boss@act.test')
  FROM public.partner_roles r WHERE r.name = 'QA5 Rep';
INSERT INTO public.partner_employees (user_id, full_name, email, role_id, status)
SELECT :OTHER, 'QA5 Outsider', 'other@act.test', r.id, 'active'
  FROM public.partner_roles r WHERE r.name = 'QA5 Rep';

-- Captured BEFORE any SET ROLE: after the switch, RLS hides rows these
-- \gset queries need and psql errors "no rows returned".
SELECT id AS e_boss  FROM public.partner_employees WHERE email = 'boss@act.test'  \gset
SELECT id AS e_rep1  FROM public.partner_employees WHERE email = 'rep1@act.test'  \gset
SELECT id AS e_rep2  FROM public.partner_employees WHERE email = 'rep2@act.test'  \gset
SELECT id AS e_other FROM public.partner_employees WHERE email = 'other@act.test' \gset

-- ── A1. The six types are seeded, and the guard knows them ──
SELECT qa('84.A1 six activity types seeded',
          (SELECT count(*) FROM public.partner_activity_types
            WHERE name IN ('Task','Call','Visit','Meeting','Follow up','Note')) = 6);

-- ── A2. An unknown type RAISES (a trigger, so qa_refused is right here) ──
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
VALUES ('QA5 bad type', 'Teleportation', :'e_rep1', :'e_rep1');
-- expected to fail; wrapped below instead
SELECT qa_refused('84.A2 an unknown activity type is refused', $$
  INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
  VALUES ('QA5 bad type', 'Teleportation', '00000000-0000-0000-0000-000000000000', null)
$$);

-- ── A3. The type is stored in the master's spelling ──
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
VALUES ('QA5 case test', 'cALL', :'e_rep1', :'e_rep1');
SELECT qa('84.A3 the master spelling wins over the caller''s',
          (SELECT activity_type FROM public.partner_tasks
            WHERE description = 'QA5 case test') = 'Call');

-- ── A4. A row with neither title nor description is refused (CHECK) ──
SELECT qa_refused('84.A4 an activity with no words at all is refused', $$
  INSERT INTO public.partner_tasks (title, description, assignee_id)
  VALUES ('  ', null, null)
$$);

-- ── A5. THE ONE THAT MATTERS: a second assignee can see it ──
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by, due_date)
VALUES ('QA5 shared call', 'Call', :'e_rep1', :'e_rep1', current_date)
RETURNING id \gset shared_
INSERT INTO public.partner_task_assignees (task_id, employee_id) VALUES
  (:'shared_id', :'e_rep1'),
  (:'shared_id', :'e_rep2');

SET ROLE authenticated;
SET request.jwt.claims TO '{"sub":"e0000000-0000-0000-0000-00000000000c"}';
SELECT qa('84.A5 the second assignee sees the shared activity',
          (SELECT count(*) FROM public.partner_tasks WHERE description = 'QA5 shared call') = 1);
RESET ROLE;
RESET request.jwt.claims;

-- ── A6. The outsider does not ──
SET ROLE authenticated;
SET request.jwt.claims TO '{"sub":"e0000000-0000-0000-0000-00000000000d"}';
SELECT qa('84.A6 somebody on another branch sees nothing of it',
          (SELECT count(*) FROM public.partner_tasks WHERE description = 'QA5 shared call') = 0);
RESET ROLE;
RESET request.jwt.claims;

-- ── A7. An activity with nobody on it stays visible to its author ──
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
VALUES ('QA5 orphan note', 'Note', null, :'e_rep1');
SET ROLE authenticated;
SET request.jwt.claims TO '{"sub":"e0000000-0000-0000-0000-00000000000b"}';
SELECT qa('84.A7 an unassigned activity is still visible to whoever made it',
          (SELECT count(*) FROM public.partner_tasks WHERE description = 'QA5 orphan note') = 1);
RESET ROLE;
RESET request.jwt.claims;

-- ── A8. The rollup: one of two done leaves the activity Pending ──
UPDATE public.partner_task_assignees SET status = 'Completed', completed_at = now()
 WHERE task_id = :'shared_id' AND employee_id = :'e_rep1';
SELECT qa('84.A8 one of two done does not finish the activity',
          (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Pending');

-- ── A9. Both done completes it, and stamps completed_at ──
UPDATE public.partner_task_assignees SET status = 'Completed', completed_at = now()
 WHERE task_id = :'shared_id' AND employee_id = :'e_rep2';
SELECT qa('84.A9 everyone done completes the activity',
          (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Completed');
SELECT qa('84.A9b and stamps completed_at',
          (SELECT completed_at IS NOT NULL FROM public.partner_tasks WHERE id = :'shared_id'));

-- ── A10. Adding a third person makes a finished activity unfinished again ──
INSERT INTO public.partner_task_assignees (task_id, employee_id)
VALUES (:'shared_id', :'e_boss');
SELECT qa('84.A10 adding somebody to a finished activity reopens it',
          (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Pending');

-- ── A11. A hand-set status is left alone by the rollup ──
UPDATE public.partner_tasks SET status = 'Cancelled' WHERE id = :'shared_id';
UPDATE public.partner_task_assignees SET status = 'Completed', completed_at = now()
 WHERE task_id = :'shared_id';
SELECT qa('84.A11 a cancelled activity is never resurrected by the rollup',
          (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Completed');

-- ── A12. Removing the last person nulls assignee_id, keeps the status ──
UPDATE public.partner_tasks SET status = 'Waiting' WHERE id = :'shared_id';
DELETE FROM public.partner_task_assignees WHERE task_id = :'shared_id';
SELECT qa('84.A12 with nobody left, assignee_id is null',
          (SELECT assignee_id IS NULL FROM public.partner_tasks WHERE id = :'shared_id'));
SELECT qa('84.A12b and the hand-set status survives',
          (SELECT status FROM public.partner_tasks WHERE id = :'shared_id') = 'Waiting');

-- ── A13. A rep with only view_activities can still tick their own box ──
-- RLS on UPDATE does NOT raise, so this is the run-then-read-back shape, not
-- qa_refused. Rep One holds view_activities and create_activities only.
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
VALUES ('QA5 own tick', 'Task', :'e_rep1', :'e_rep1')
RETURNING id \gset own_
INSERT INTO public.partner_task_assignees (task_id, employee_id)
VALUES (:'own_id', :'e_rep1');

SET ROLE authenticated;
SET request.jwt.claims TO '{"sub":"e0000000-0000-0000-0000-00000000000b"}';
UPDATE public.partner_task_assignees SET status = 'Completed', completed_at = now()
 WHERE task_id = :'own_id' AND employee_id = :'e_rep1';
RESET ROLE;
RESET request.jwt.claims;
SELECT qa('84.A13 a rep without edit_activities can finish their own work',
          (SELECT status FROM public.partner_task_assignees
            WHERE task_id = :'own_id' AND employee_id = :'e_rep1') = 'Completed');

-- ── A14. But they cannot tick somebody else's box ──
INSERT INTO public.partner_tasks (description, activity_type, assignee_id, created_by)
VALUES ('QA5 not yours', 'Task', :'e_rep2', :'e_rep2')
RETURNING id \gset theirs_
INSERT INTO public.partner_task_assignees (task_id, employee_id)
VALUES (:'theirs_id', :'e_rep2');

SET ROLE authenticated;
SET request.jwt.claims TO '{"sub":"e0000000-0000-0000-0000-00000000000b"}';
UPDATE public.partner_task_assignees SET status = 'Completed'
 WHERE task_id = :'theirs_id' AND employee_id = :'e_rep2';
RESET ROLE;
RESET request.jwt.claims;
SELECT qa('84.A14 one rep cannot finish another rep''s work',
          (SELECT status FROM public.partner_task_assignees
            WHERE task_id = :'theirs_id' AND employee_id = :'e_rep2') = 'Pending');

-- ── A15. The manager sees both reps' activities ──
SET ROLE authenticated;
SET request.jwt.claims TO '{"sub":"e0000000-0000-0000-0000-00000000000a"}';
SELECT qa('84.A15 the manager sees the team''s activities',
          (SELECT count(*) FROM public.partner_tasks WHERE description LIKE 'QA5 %') >= 3);
RESET ROLE;
RESET request.jwt.claims;

-- ── A16. Deactivating an employee does not block on their activities ──
-- ON DELETE SET NULL, not RESTRICT: this was the old shape and it would have
-- made an employee undeletable the moment they were given work.
DELETE FROM public.partner_employees WHERE email = 'other@act.test';
SELECT qa('84.A16 an employee with no activities deletes cleanly',
          (SELECT count(*) FROM public.partner_employees WHERE email = 'other@act.test') = 0);
```

Note on A2: the first bare INSERT above it is a mistake left in deliberately for you to delete — the scenario must contain only the `qa_refused` form. Remove the two lines above the `SELECT qa_refused('84.A2 …')` call before running. (If you ran the file with them in, `ON_ERROR_STOP` aborts it and the suite reports a scenario failure, which is the point: the file tells you.)

- [ ] **Step 4: Register the scenario — it is a hard-coded list, not a glob**

In `C:\Wacrm\wacrm-web\scripts\run-db-tests.sh`, line 101, append `84_partner_activity` after `83_partner_customers`:

```bash
for f in 00_fixture 10_buying_status 20_mapping_codes_territory 30_territory_coverage_rls 40_area_channel_mapping 50_rights_and_many_holders 60_dms_foundation 70_dashboard_viewer_scope 70_portal_visibility 75_portal_list_filters 71_portal_customer_create 72_portal_place_order 74_portal_payments_write 76_portal_dispatch_write 77_portal_reports 80_partner_rights 81_partner_leads 82_partner_lead_parity 83_partner_customers 84_partner_activity; do
```

- [ ] **Step 5: Run the harness and watch it fail**

```bash
cd /c/Wacrm/wacrm-web && PGPORT=54431 PGDATA_DIR="$SCRATCH/pgtest-2d" bash scripts/run-db-tests.sh 2>&1 | tail -40
```

Expected: `84_partner_activity` runs, and the deliberate bare INSERT in A2 aborts it with `Unknown activity type: Teleportation`. That proves the file is actually being executed — the thing the hard-coded list makes easy to get wrong.

Then delete those two lines and run again.

Expected on the second run: `All scenarios passed.` and a pass count **higher** than the 549 of `db-tests-2c`, by roughly the 18 assertions above. **A pass count that went DOWN while `failed` stayed 0 means a scenario file aborted part way** — that is exactly how the Phase 2B rename hid itself.

- [ ] **Step 6: Generate the paste document from the migration file**

Do not hand-write it. `RUN-THIS-SQL-partner-phase2.md` was hand-assembled before the ninth table was added, so the founder's paste created eight tables and the check query asked about the same eight and could not notice.

```bash
cd /c/Wacrm/wacrm-web
{
  echo '# Run this in Supabase — My Activity'
  echo
  echo 'Open the Mumbai project (ltigfpywdbfilsagtpyd) → SQL Editor → New query, paste the whole block below, and press Run. It is safe to run twice.'
  echo
  echo '```sql'
  cat supabase/migrations/20261124120000_partner_activity_crm_parity.sql
  echo '```'
  echo
  echo '## Then check it worked'
  echo
  echo 'Paste this second block and run it. You should see one row saying `ok`.'
  echo
  echo '```sql'
  cat <<'SQL'
select
  (select count(*) from information_schema.tables
    where table_schema='public'
      and table_name in ('partner_activity_types','partner_task_assignees')) as new_tables,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='partner_tasks'
      and column_name in ('title','description','activity_type',
                          'start_date','reminder_date','reminder_time')) as renamed_and_added,
  (select count(*) from public.partner_activity_types) as activity_types,
  (select count(*) from pg_policies
    where schemaname='public'
      and tablename in ('partner_tasks','partner_task_assignees','partner_activity_types')) as policies,
  case when (select count(*) from information_schema.tables
              where table_schema='public'
                and table_name in ('partner_activity_types','partner_task_assignees')) = 2
        and (select count(*) from information_schema.columns
              where table_schema='public' and table_name='partner_tasks'
                and column_name in ('title','description','activity_type',
                                    'start_date','reminder_date','reminder_time')) = 6
        and (select count(*) from public.partner_activity_types) >= 6
       then 'ok' else 'SOMETHING IS MISSING — send this row back' end as verdict;
SQL
  echo '```'
} > docs/RUN-THIS-SQL-partner-activity.md
```

Read the generated file top to bottom before telling anyone to run it. The expected row is `2 | 6 | 6 | 8 | ok` — count the policies in the migration and make the comment match whatever number it actually is.

- [ ] **Step 7: Write the rollback**

Create `C:\Wacrm\wacrm-web\supabase\migrations\ROLLBACK-partner-portal-activity.md` with the reverse, in order: drop the two triggers, drop `partner_task_assignees`, drop `partner_activity_types`, rename `title`→`subject` / `description`→`detail` / `activity_type`→`kind`, restore the two-value status CHECK (mapping the five back: Completed→Done, everything else→Undone), restore `assignee_id` NOT NULL (noting it fails if any row has NULL, and that those rows must be assigned or deleted first), and restore the three Phase 2A policies verbatim. State plainly at the top that rolling back **loses the extra assignees and the five-state detail** — there is nowhere in the old shape to put them.

- [ ] **Step 8: Commit**

```bash
cd /c/Wacrm/wacrm-web
git add supabase/migrations/20261124120000_partner_activity_crm_parity.sql \
        supabase/tests/84_partner_activity.sql scripts/run-db-tests.sh \
        docs/RUN-THIS-SQL-partner-activity.md \
        supabase/migrations/ROLLBACK-partner-portal-activity.md \
        docs/superpowers/plans/2026-11-22-partner-portal-phase-2c.md
git commit -m "feat(partner): bring partner_tasks up to the CRM activity model

Five statuses, an editable activity-type list, start and reminder dates, and
a partner_task_assignees child table with per-person status and a rollup
trigger.

The select policy is widened in the same migration. It read assignee_id
alone, which breaks twice over here: assignee_id becomes nullable, so an
unassigned activity would vanish from its own author's screen, and a second
assignee is not in that column at all, so whoever was added second would
find My Activity empty.

84_partner_activity covers both, plus the rollup, the per-person tick and
the type guard. Registered in the runner's hard-coded list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: The pure logic, with tests first

Everything in this task is a pure function with no Supabase and no React. It is the half of the feature that can be proven without a browser, so it goes first and it goes test-first.

**Files:**
- Create: `C:\Wacrm\ozzo-partner\lib\activity\types.ts`
- Create: `C:\Wacrm\ozzo-partner\lib\activity\assignees.ts`
- Create: `C:\Wacrm\ozzo-partner\lib\activity\assignees.test.ts`
- Create: `C:\Wacrm\ozzo-partner\lib\activity\period-filter.ts`
- Create: `C:\Wacrm\ozzo-partner\lib\activity\period-filter.test.ts`
- Create: `C:\Wacrm\ozzo-partner\lib\activity\validate.ts`
- Create: `C:\Wacrm\ozzo-partner\lib\activity\validate.test.ts`

**Interfaces:**
- Consumes: `isPlausiblePhone` is not needed here; nothing from earlier tasks except the column names Task 1 settled.
- Produces:
  - `type Activity` and `type ActivityInput` (shapes below)
  - `type ActivityAssignee = { id: string; task_id: string; employee_id: string; status: "Pending" | "Completed"; completed_at: string | null; created_at: string; employee?: { full_name: string } | { full_name: string }[] | null }`
  - `ACTIVITY_STATUSES: readonly ["Pending","In Progress","Waiting","Completed","Cancelled"]`
  - `ACTIVITY_PRIORITIES: readonly ["Low","Medium","High","Urgent"]`
  - `rollupStatus(assignees: ActivityAssignee[], current: string): string`
  - `myStatus(assignees: ActivityAssignee[], employeeId: string | null | undefined): "Pending" | "Completed" | null`
  - `displayedStatus(assignees: ActivityAssignee[], employeeId: string | null | undefined, activityStatus: string): string`
  - `progressLabel(assignees: ActivityAssignee[]): string | null`
  - `assigneeLabel(names: string[]): string`
  - `type TaskPeriod`, `DEFAULT_PERIOD: TaskPeriod`, `matchesPeriod(dueDate, period, customStart?, customEnd?): boolean`
  - `validateActivityInput(input: Partial<ActivityInput>): { ok: boolean; errors: Record<string, string> }`
  - `stripActivityColumns<T extends Record<string, unknown>>(body: T): T`

- [ ] **Step 1: Write the failing tests for the rollup mirror**

Create `C:\Wacrm\ozzo-partner\lib\activity\assignees.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assigneeLabel,
  displayedStatus,
  myStatus,
  progressLabel,
  rollupStatus,
  type ActivityAssignee,
} from "./assignees";

function row(employee_id: string, status: "Pending" | "Completed" = "Pending"): ActivityAssignee {
  return {
    id: `a-${employee_id}-${status}`,
    task_id: "t1",
    employee_id,
    status,
    completed_at: status === "Completed" ? "2026-11-24T10:00:00Z" : null,
    created_at: "2026-11-24T09:00:00Z",
  };
}

describe("rollupStatus — the mirror of partner_task_assignees_rollup", () => {
  it("leaves the status alone when nobody is on the activity", () => {
    // The trigger does the same. There is nothing to roll up from, and
    // silently completing it would be a lie.
    expect(rollupStatus([], "Waiting")).toBe("Waiting");
  });

  it("completes it only when everyone is done", () => {
    expect(rollupStatus([row("x", "Completed")], "Pending")).toBe("Completed");
    expect(rollupStatus([row("x", "Completed"), row("y")], "Pending")).toBe("Pending");
  });

  it("reopens a finished activity when somebody new is added", () => {
    expect(rollupStatus([row("x", "Completed"), row("y")], "Completed")).toBe("Pending");
  });

  it("never resurrects a cancelled activity", () => {
    // 'Cancelled' is not 'Completed', so the reopen arm must not touch it.
    expect(rollupStatus([row("x", "Completed"), row("y")], "Cancelled")).toBe("Cancelled");
  });

  it("leaves a hand-set In Progress or Waiting alone", () => {
    expect(rollupStatus([row("x"), row("y")], "In Progress")).toBe("In Progress");
    expect(rollupStatus([row("x"), row("y")], "Waiting")).toBe("Waiting");
  });
});

describe("myStatus", () => {
  it("is null when the activity is not yours", () => {
    expect(myStatus([row("x")], "me")).toBeNull();
  });

  it("is null when we do not know who you are", () => {
    expect(myStatus([row("me")], null)).toBeNull();
    expect(myStatus([row("me")], undefined)).toBeNull();
  });

  it("is your own row's status, not the activity's", () => {
    expect(myStatus([row("me", "Completed"), row("x")], "me")).toBe("Completed");
  });
});

describe("displayedStatus", () => {
  it("shows your own state when the activity is yours", () => {
    // The activity is still Pending because the other person has not
    // finished, but YOUR tick must look ticked.
    expect(displayedStatus([row("me", "Completed"), row("x")], "me", "Pending")).toBe("Completed");
  });

  it("falls back to the activity's own state when you are only watching", () => {
    expect(displayedStatus([row("x")], "me", "Waiting")).toBe("Waiting");
  });
});

describe("progressLabel", () => {
  it("says nothing for a single assignee — '0 of 1' is noise", () => {
    expect(progressLabel([row("x")])).toBeNull();
    expect(progressLabel([])).toBeNull();
  });

  it("counts, so it is obvious the activity lives on after you tick", () => {
    expect(progressLabel([row("x", "Completed"), row("y"), row("z")])).toBe("1 of 3 done");
  });
});

describe("assigneeLabel", () => {
  it("says Unassigned rather than printing nothing", () => {
    expect(assigneeLabel([])).toBe("Unassigned");
  });

  it("fits one name and a count into a list column", () => {
    expect(assigneeLabel(["Priya"])).toBe("Priya");
    expect(assigneeLabel(["Priya", "Amit", "Ravi"])).toBe("Priya +2");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/activity/assignees.test.ts
```

Expected: FAIL — `Cannot find module './assignees'`.

- [ ] **Step 3: Write `assignees.ts`**

Create `C:\Wacrm\ozzo-partner\lib\activity\assignees.ts`:

```ts
export interface ActivityAssignee {
  id: string;
  task_id: string;
  employee_id: string;
  status: "Pending" | "Completed";
  completed_at: string | null;
  created_at: string;
  /** Joined on the screens that select it, for names rather than ids. */
  employee?: { full_name: string } | { full_name: string }[] | null;
}

/**
 * What the activity's own status should be, given its assignee rows.
 *
 * Mirrors public.partner_task_assignees_rollup() exactly. The database is the
 * authority; this exists so the screen can show the answer immediately rather
 * than after a round trip to Mumbai. If the two ever disagree, the trigger is
 * right and this is the bug.
 *
 * Note what it does NOT do: a status someone set by hand — In Progress,
 * Waiting, Cancelled — is left alone. Only Completed is derived, and only an
 * activity that HAD been Completed is dropped back out of it.
 */
export function rollupStatus(assignees: ActivityAssignee[], current: string): string {
  if (assignees.length === 0) return current;
  const done = assignees.filter((a) => a.status === "Completed").length;
  if (done === assignees.length) return "Completed";
  return current === "Completed" ? "Pending" : current;
}

/** Your own row's status, or null when the activity is not yours. */
export function myStatus(
  assignees: ActivityAssignee[],
  employeeId: string | null | undefined,
): "Pending" | "Completed" | null {
  if (!employeeId) return null;
  return assignees.find((a) => a.employee_id === employeeId)?.status ?? null;
}

/**
 * What the tick should look like: your own state when the activity is yours,
 * the activity's rolled-up state when you are watching someone else's work.
 */
export function displayedStatus(
  assignees: ActivityAssignee[],
  employeeId: string | null | undefined,
  activityStatus: string,
): string {
  return myStatus(assignees, employeeId) ?? activityStatus;
}

/**
 * "1 of 3 done", so it is obvious the activity lives on after you tick your
 * own box. Silent for one assignee: that is the ordinary case and "0 of 1"
 * is noise.
 */
export function progressLabel(assignees: ActivityAssignee[]): string | null {
  if (assignees.length < 2) return null;
  const done = assignees.filter((a) => a.status === "Completed").length;
  return `${done} of ${assignees.length} done`;
}

/** "Priya +2" — a list row has space for one name and a count. */
export function assigneeLabel(names: string[]): string {
  if (names.length === 0) return "Unassigned";
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

/** PostgREST returns a to-one embed as an object or a one-element array. */
export function assigneeNames(assignees: ActivityAssignee[]): string[] {
  return assignees
    .map((a) => (Array.isArray(a.employee) ? a.employee[0] : a.employee)?.full_name)
    .filter((n): n is string => !!n);
}
```

- [ ] **Step 4: Run it and watch it pass**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/activity/assignees.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Write the failing tests for the period filter**

Create `C:\Wacrm\ozzo-partner\lib\activity\period-filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, format } from "date-fns";
import { DEFAULT_PERIOD, matchesPeriod } from "./period-filter";

const day = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");

describe("matchesPeriod", () => {
  it("opens on today, not on everything", () => {
    // A rep with four hundred finished activities behind them should see the
    // handful that matter now.
    expect(DEFAULT_PERIOD).toBe("Today");
  });

  it("keeps an undated activity on Today and nowhere else", () => {
    // An activity with no due date is not a future activity, it is an
    // unscheduled one. Dropping it would make it invisible on the screen the
    // portal opens to.
    expect(matchesPeriod(null, "Today")).toBe(true);
    expect(matchesPeriod(null, "Tomorrow")).toBe(false);
    expect(matchesPeriod(null, "Overdue")).toBe(false);
    expect(matchesPeriod(null, "This Week")).toBe(false);
  });

  it("keeps everything on All, dated or not", () => {
    expect(matchesPeriod(null, "All")).toBe(true);
    expect(matchesPeriod(day(-400), "All")).toBe(true);
  });

  it("separates today, tomorrow and overdue", () => {
    expect(matchesPeriod(day(0), "Today")).toBe(true);
    expect(matchesPeriod(day(1), "Today")).toBe(false);
    expect(matchesPeriod(day(1), "Tomorrow")).toBe(true);
    expect(matchesPeriod(day(-1), "Overdue")).toBe(true);
    expect(matchesPeriod(day(0), "Overdue")).toBe(false);
  });

  it("includes the last day of a custom range, not just up to its morning", () => {
    // A range ending today must include work due today. Comparing raw dates
    // puts the end at 00:00 and silently drops the final day.
    expect(matchesPeriod(day(0), "Custom Range", day(-7), day(0))).toBe(true);
  });

  it("falls back to everything when a custom range is half filled in", () => {
    expect(matchesPeriod(day(30), "Custom Range", day(0), "")).toBe(true);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/activity/period-filter.test.ts
```

Expected: FAIL — `Cannot find module './period-filter'`.

- [ ] **Step 7: Port `period-filter.ts`**

Create `C:\Wacrm\ozzo-partner\lib\activity\period-filter.ts`. This is a straight port of `wacrm-web/src/lib/tasks/period-filter.ts` — copy it, including the reasoning in its comments, rather than rewriting:

```ts
import { isBefore, isThisMonth, isThisWeek, isToday, isTomorrow, startOfToday } from "date-fns";

export type TaskPeriod =
  | "All"
  | "Overdue"
  | "Today"
  | "Tomorrow"
  | "This Week"
  | "This Month"
  | "Custom Range";

export const PERIODS: readonly TaskPeriod[] = [
  "Today",
  "Tomorrow",
  "Overdue",
  "This Week",
  "This Month",
  "All",
  "Custom Range",
];

/**
 * My Activity opens on today rather than on everything, so a rep with four
 * hundred finished activities behind them sees the handful that matter now.
 */
export const DEFAULT_PERIOD: TaskPeriod = "Today";

/**
 * Does an activity's due date fall inside the chosen period?
 *
 * `Today` is the only period that keeps undated activities. An activity with
 * no due date is not a future one, it is an unscheduled one, and dropping it
 * would make it invisible on the screen the portal opens to. Every other
 * period is a date range the user named on purpose, so an undated activity is
 * correctly outside it.
 */
export function matchesPeriod(
  dueDate: string | null | undefined,
  period: TaskPeriod,
  customStart?: string,
  customEnd?: string,
): boolean {
  if (period === "All") return true;
  if (!dueDate) return period === "Today";

  const taskDate = new Date(dueDate);

  switch (period) {
    case "Overdue":
      return isBefore(taskDate, startOfToday());
    case "Today":
      return isToday(taskDate);
    case "Tomorrow":
      return isTomorrow(taskDate);
    case "This Week":
      return isThisWeek(taskDate);
    case "This Month":
      return isThisMonth(taskDate);
    case "Custom Range": {
      if (!customStart || !customEnd) return true;
      const start = new Date(customStart);
      const end = new Date(customEnd);
      // The end of the day, not its morning: a range ending today must
      // include work due today.
      end.setHours(23, 59, 59, 999);
      return taskDate >= start && taskDate <= end;
    }
    default:
      return true;
  }
}
```

- [ ] **Step 8: Run it and watch it pass**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/activity/period-filter.test.ts
```

Expected: PASS, 6 tests. If `date-fns` is not in `ozzo-partner/package.json`, add it — `npm install date-fns@4.1.0` — and do not rely on it resolving from `C:\Wacrm\node_modules`. Two Vercel deploys failed exactly that way: `@dnd-kit/*` was declared in `wacrm-web` and the portal built locally only because Node walked up a directory. `lib/dependencies.test.ts` audits every bare import; run it.

- [ ] **Step 9: Write `types.ts`**

Create `C:\Wacrm\ozzo-partner\lib\activity\types.ts`:

```ts
import type { ActivityAssignee } from "./assignees";

/**
 * One activity: a call, a visit, a meeting, a note, a plain task.
 *
 * The column names are the CRM's `tasks` names on purpose, so the two
 * screens can be read against each other line for line. `description` is the
 * main typed field and `title` is optional — that is the CRM's arrangement,
 * not an accident: an activity is usually one typed line.
 */
export type Activity = {
  id: string;
  title: string | null;
  description: string | null;
  activity_type: string;
  status: ActivityStatus;
  priority: ActivityPriority;
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  reminder_date: string | null;
  reminder_time: string | null;
  completed_at: string | null;
  /** The FIRST assignee, maintained by the rollup trigger. May be null. */
  assignee_id: string | null;
  lead_id: string | null;
  customer_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** PostgREST returns a to-one embed as an object or a one-element array. */
  assignee?: { full_name: string } | { full_name: string }[] | null;
  lead?: { id: string; name: string } | { id: string; name: string }[] | null;
  customer?: { id: string; company: string } | { id: string; company: string }[] | null;
  /** The real truth about who is on it. Selected as a nested embed. */
  assignees?: ActivityAssignee[];
};

export const ACTIVITY_STATUSES = [
  "Pending",
  "In Progress",
  "Waiting",
  "Completed",
  "Cancelled",
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export type ActivityPriority = (typeof ACTIVITY_PRIORITIES)[number];

/** The two statuses the list's Done / Undone toggle means. */
export const DONE_STATUSES: readonly ActivityStatus[] = ["Completed", "Cancelled"];

export type ActivityInput = {
  /** Present when editing, absent when adding. */
  id?: string;
  activity_type: string;
  title?: string | null;
  description?: string | null;
  status?: ActivityStatus;
  priority?: ActivityPriority;
  due_date?: string | null;
  due_time?: string | null;
  start_date?: string | null;
  reminder_date?: string | null;
  reminder_time?: string | null;
  /** partner_employees.id values. Empty is allowed — nobody on it is valid. */
  assignee_ids?: string[];
  lead_id?: string | null;
  customer_id?: string | null;
};

/** What to show as this activity's one line of text. */
export function activityText(a: Activity): string {
  const text = (a.description ?? "").trim() || (a.title ?? "").trim();
  // The CHECK constraint makes this unreachable for rows written by this app.
  // Kept so a row imported by hand cannot render an empty card.
  return text || a.activity_type;
}

/** "Balaji Agencies" / "Sharma Traders" — what this activity is about. */
export function linkedLabel(a: Activity): { label: string; href: string } | null {
  const customer = Array.isArray(a.customer) ? a.customer[0] : a.customer;
  if (customer) return { label: customer.company, href: `/customers/${customer.id}` };
  const lead = Array.isArray(a.lead) ? a.lead[0] : a.lead;
  if (lead) return { label: lead.name, href: `/leads/${lead.id}` };
  return null;
}

export function ownerName(a: Activity): string {
  const o = Array.isArray(a.assignee) ? a.assignee[0] : a.assignee;
  return o?.full_name ?? "Unassigned";
}
```

- [ ] **Step 10: Write the failing tests for validation**

Create `C:\Wacrm\ozzo-partner\lib\activity\validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stripActivityColumns, validateActivityInput } from "./validate";

describe("validateActivityInput", () => {
  it("accepts one typed line and nothing else", () => {
    // The CRM's form is one input and a type. Demanding a title as well
    // would make the portal slower to use than the thing it copies.
    expect(validateActivityInput({ activity_type: "Call", description: "Ring Balaji" }).ok).toBe(
      true,
    );
  });

  it("refuses an activity with no words at all", () => {
    const { ok, errors } = validateActivityInput({ activity_type: "Call" });
    expect(ok).toBe(false);
    expect(errors.description).toBeTruthy();
  });

  it("does not count whitespace as words", () => {
    // The database CHECK uses btrim, so accepting "   " here would hand the
    // user a Postgres constraint message instead of a sentence.
    expect(validateActivityInput({ activity_type: "Call", description: "   " }).ok).toBe(false);
  });

  it("requires an activity type", () => {
    const { ok, errors } = validateActivityInput({ description: "Ring Balaji" });
    expect(ok).toBe(false);
    expect(errors.activity_type).toBeTruthy();
  });

  it("refuses a status the database would reject", () => {
    const { ok, errors } = validateActivityInput({
      activity_type: "Call",
      description: "x",
      status: "Done" as never,
    });
    expect(ok).toBe(false);
    expect(errors.status).toBeTruthy();
  });

  it("refuses a reminder time with no reminder date", () => {
    // A time on no day never fires. Better to say so than to store it.
    const { ok, errors } = validateActivityInput({
      activity_type: "Call",
      description: "x",
      reminder_time: "09:30",
    });
    expect(ok).toBe(false);
    expect(errors.reminder_date).toBeTruthy();
  });

  it("refuses a start date after the due date", () => {
    const { ok, errors } = validateActivityInput({
      activity_type: "Call",
      description: "x",
      start_date: "2026-12-02",
      due_date: "2026-12-01",
    });
    expect(ok).toBe(false);
    expect(errors.start_date).toBeTruthy();
  });

  it("allows a start date equal to the due date", () => {
    expect(
      validateActivityInput({
        activity_type: "Call",
        description: "x",
        start_date: "2026-12-01",
        due_date: "2026-12-01",
      }).ok,
    ).toBe(true);
  });

  it("refuses linking to a lead and a customer at once", () => {
    // One activity is about one thing. Two links make every "what is this
    // about" column a guess.
    const { ok, errors } = validateActivityInput({
      activity_type: "Call",
      description: "x",
      lead_id: "l1",
      customer_id: "c1",
    });
    expect(ok).toBe(false);
    expect(errors.linked_to).toBeTruthy();
  });
});

describe("stripActivityColumns", () => {
  it("drops the columns a request must never set", () => {
    const out = stripActivityColumns({
      description: "keep me",
      id: "spoofed",
      created_by: "someone else",
      created_at: "1999-01-01",
      completed_at: "1999-01-01",
      assignee_id: "sneaky",
    });
    expect(out).toEqual({ description: "keep me" });
  });
});
```

- [ ] **Step 11: Run it and watch it fail**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/activity/validate.test.ts
```

Expected: FAIL — `Cannot find module './validate'`.

- [ ] **Step 12: Write `validate.ts`**

Create `C:\Wacrm\ozzo-partner\lib\activity\validate.ts`:

```ts
import { ACTIVITY_PRIORITIES, ACTIVITY_STATUSES, type ActivityInput } from "./types";

/**
 * Columns a request may never set, whatever it sends.
 *
 * `assignee_id` is on the list because the rollup trigger owns it: it always
 * holds the FIRST assignee, and a request that set it by hand would be
 * overwritten on the next assignee change anyway — silently disagreeing with
 * the screen in the meantime. Assignment goes through `assignee_ids`.
 *
 * `completed_at` is the trigger's too.
 */
const PRIVILEGE_COLUMNS = [
  "id",
  "created_at",
  "created_by",
  "completed_at",
  "assignee_id",
  "updated_at",
] as const;

export function stripActivityColumns<T extends Record<string, unknown>>(body: T): T {
  const out = { ...body };
  for (const key of PRIVILEGE_COLUMNS) delete out[key];
  return out;
}

const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";

export function validateActivityInput(
  input: Partial<ActivityInput>,
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (blank(input.activity_type)) {
    errors.activity_type = "Pick what kind of activity this is.";
  }

  // The database CHECK is `title or description`. Mirror it here so the user
  // reads a sentence rather than a constraint name.
  if (blank(input.title) && blank(input.description)) {
    errors.description = "Write what this is, in a line.";
  }

  if (input.status !== undefined && !ACTIVITY_STATUSES.includes(input.status)) {
    errors.status = "That is not one of the five statuses.";
  }

  if (input.priority !== undefined && !ACTIVITY_PRIORITIES.includes(input.priority)) {
    errors.priority = "That is not one of the four priorities.";
  }

  if (!blank(input.reminder_time) && blank(input.reminder_date)) {
    errors.reminder_date = "A reminder time needs a day to go with it.";
  }

  if (!blank(input.start_date) && !blank(input.due_date)) {
    if ((input.start_date as string) > (input.due_date as string)) {
      errors.start_date = "This starts after it is due.";
    }
  }

  if (!blank(input.lead_id) && !blank(input.customer_id)) {
    errors.linked_to = "Link this to a lead or to a customer, not to both.";
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 13: Run the whole suite and the type check**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run; npx tsc --noEmit
```

Expected: everything green, and the count up by about 29 from the 204 of Phase 2B.

- [ ] **Step 14: Commit**

```bash
cd /c/Wacrm/ozzo-partner
git add lib/activity package.json package-lock.json
git commit -m "feat(activity): the pure logic, mirroring the rollup trigger

rollupStatus is a mirror of partner_task_assignees_rollup, written so the
screen can show the answer without a round trip to Mumbai. Where the two
disagree the trigger is right — the tests say so, including the case a naive
version gets wrong: a Cancelled activity must never be resurrected by
somebody ticking a box.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: The API routes

**Files:**
- Create: `C:\Wacrm\ozzo-partner\app\api\activity\route.ts`
- Create: `C:\Wacrm\ozzo-partner\app\api\activity\route-shape.test.ts`
- Create: `C:\Wacrm\ozzo-partner\app\api\activity\complete\route.ts`

**Interfaces:**
- Consumes: `requirePartnerRight(key: string): Promise<PartnerMe>` from `@/lib/auth/partner`; `serviceClient()` from `@/lib/auth/partner-service`; `can(permissions, key)` from `@/lib/auth/rights`; `logPartnerActivity(supabase, { userId, module, recordId, action, message })` from `@/lib/activities`; `validateActivityInput`, `stripActivityColumns` from Task 2.
- Produces: `POST /api/activity` → `{ activity: Activity }` or `{ errors }` 400; `PATCH /api/activity` → same; `DELETE /api/activity?id=…` → `{ ok: true }`; `POST /api/activity/complete` with `{ id, done: boolean }` → `{ ok: true; perPerson: boolean }`.

- [ ] **Step 1: Write the failing route-shape test**

This test class has already caught a real fault: the Phase 2B billing guard passed while the service client was built above the rights decision, because the assertion compared the wrong pair. Write it so a deliberate break fails it, then deliberately break it.

Create `C:\Wacrm\ozzo-partner\app\api\activity\route-shape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "app", "api", "activity", "route.ts"), "utf8");
const complete = readFileSync(
  join(ROOT, "app", "api", "activity", "complete", "route.ts"),
  "utf8",
);

function handlerBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  if (start === -1) return "";
  const rest = source.slice(start);
  const end = rest.indexOf("\n}\n");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the activity route", () => {
  it("has POST, PATCH and DELETE", () => {
    // Unlike leads and customers, an activity IS deletable. It is a note
    // about a day, not a business record, and the CRM deletes them outright.
    for (const name of ["POST", "PATCH", "DELETE"]) {
      expect(handlerBody(src, name), name).not.toBe("");
    }
  });

  it("checks the right before it ever builds a service client", () => {
    for (const name of ["POST", "PATCH", "DELETE"]) {
      const fn = handlerBody(src, name);
      const guard = fn.indexOf("requirePartnerRight");
      const service = fn.indexOf("serviceClient(");
      expect(guard, `${name} has no right check`).toBeGreaterThan(-1);
      expect(service, `${name} never builds a service client`).toBeGreaterThan(-1);
      expect(guard, `${name} builds the service client first`).toBeLessThan(service);
    }
  });

  it("gates each handler on its own right", () => {
    expect(handlerBody(src, "POST")).toContain('requirePartnerRight("create_activities")');
    expect(handlerBody(src, "PATCH")).toContain('requirePartnerRight("edit_activities")');
    expect(handlerBody(src, "DELETE")).toContain('requirePartnerRight("delete_activities")');
  });

  it("strips the columns a request must never set", () => {
    expect(src).toContain("stripActivityColumns");
  });

  it("never writes assignee_id by hand", () => {
    // The rollup trigger owns that column. Writing it here would disagree
    // with the database the moment anyone changed the assignee list.
    expect(src).not.toMatch(/assignee_id:\s*/);
  });

  it("writes to the timeline on create, update and delete", () => {
    for (const name of ["POST", "PATCH", "DELETE"]) {
      expect(handlerBody(src, name), name).toContain("logPartnerActivity");
    }
  });
});

describe("the completion route", () => {
  it("gates on view_activities, not edit_activities", () => {
    // Finishing your OWN work is not editing the activity. A Sales Executive
    // holding only view_activities must still be able to tick their box —
    // partner_task_assignees_tick_own says the same thing in SQL.
    expect(complete).toContain('requirePartnerRight("view_activities")');
    expect(complete).not.toContain('requirePartnerRight("edit_activities")');
  });

  it("checks the right before it builds a service client", () => {
    const guard = complete.indexOf("requirePartnerRight");
    const service = complete.indexOf("serviceClient(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(service);
  });

  it("writes the assignee row when the activity is yours, and only then the activity", () => {
    expect(complete).toContain("partner_task_assignees");
    expect(complete).toContain("partner_tasks");
  });

  it("re-reads the activity rather than guessing what the rollup did", () => {
    // Whether your tick finished the activity is the trigger's call. A client
    // that works it out itself duplicates the trigger and drifts from it.
    expect(complete).toMatch(/select\(/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run app/api/activity/route-shape.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory … app/api/activity/route.ts`.

- [ ] **Step 3: Write the main route**

Create `C:\Wacrm\ozzo-partner\app\api\activity\route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

import { requirePartnerRight } from "@/lib/auth/partner";
import { serviceClient } from "@/lib/auth/partner-service";
import { can } from "@/lib/auth/rights";
import { logPartnerActivity } from "@/lib/activities";
import { stripActivityColumns, validateActivityInput } from "@/lib/activity/validate";

// ============================================================
// Activities: create, update, delete.
//
// Every handler calls requirePartnerRight() on the caller's own RLS-scoped
// session BEFORE building the service client. route-shape.test.ts pins the
// ordering, and it does so because a weaker version of that test let a
// Phase 2B route pass with the service client built first.
//
// Unlike leads and customers, an activity IS deletable. It is a note about a
// day rather than a business record, and the CRM deletes them outright.
//
// assignee_id is never written here. The rollup trigger owns it.
// ============================================================

const SELECT =
  "*, assignee:partner_employees!partner_tasks_assignee_id_fkey(full_name)," +
  "assignees:partner_task_assignees(id, task_id, employee_id, status, completed_at, created_at," +
  "employee:partner_employees(full_name))," +
  "lead:partner_leads(id, name), customer:partner_customers(id, company)";

function textOrNull(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? null : s;
}

/** Who may be put on an activity: yourself always, others with the right. */
function requestedAssignees(
  body: Record<string, unknown>,
  mePermissions: Record<string, unknown>,
  meId: string,
): string[] {
  const asked = Array.isArray(body.assignee_ids) ? (body.assignee_ids as string[]) : [];
  if (can(mePermissions, "view_team_activities")) return asked;
  // Without the team right you may only assign yourself. An empty list stays
  // empty: an activity with nobody on it is valid, and silently adding
  // yourself to one you deliberately left open would be worse than refusing.
  return asked.filter((id) => id === meId);
}

export async function POST(req: NextRequest) {
  const me = await requirePartnerRight("create_activities");
  const body = stripActivityColumns(await req.json());

  const { ok, errors } = validateActivityInput(body);
  if (!ok) return NextResponse.json({ errors }, { status: 400 });

  const db = serviceClient();

  const { data, error } = await db
    .from("partner_tasks")
    .insert({
      activity_type: String(body.activity_type).trim(),
      title: textOrNull(body.title),
      description: textOrNull(body.description),
      status: body.status ?? "Pending",
      priority: body.priority ?? "Medium",
      due_date: body.due_date || null,
      due_time: body.due_time || null,
      start_date: body.start_date || null,
      reminder_date: body.reminder_date || null,
      reminder_time: body.reminder_time || null,
      lead_id: body.lead_id || null,
      customer_id: body.customer_id || null,
      created_by: me.id,
    })
    .select("id")
    .single();

  if (error) {
    // The type trigger raises in plain English on purpose; pass it through
    // rather than turning it into "something went wrong".
    return NextResponse.json({ errors: { form: error.message } }, { status: 400 });
  }

  const people = requestedAssignees(body, me.permissions, me.id);
  if (people.length > 0) {
    await db
      .from("partner_task_assignees")
      .insert(people.map((employee_id) => ({ task_id: data.id, employee_id })));
  }

  await logPartnerActivity(db, {
    userId: me.authUserId,
    module: "task",
    recordId: data.id,
    action: "created",
    message: `${body.activity_type} added`,
  });

  // Re-read through the full select so the client gets the row as the
  // triggers left it — assignee_id included.
  const { data: full } = await db.from("partner_tasks").select(SELECT).eq("id", data.id).single();
  return NextResponse.json({ activity: full });
}

export async function PATCH(req: NextRequest) {
  const me = await requirePartnerRight("edit_activities");
  const body = stripActivityColumns(await req.json());
  const id = typeof body.id === "string" ? body.id : String((await req.json()).id ?? "");

  if (!id) return NextResponse.json({ errors: { form: "Which activity?" } }, { status: 400 });

  const { ok, errors } = validateActivityInput(body);
  if (!ok) return NextResponse.json({ errors }, { status: 400 });

  const db = serviceClient();

  const { error } = await db
    .from("partner_tasks")
    .update({
      activity_type: String(body.activity_type).trim(),
      title: textOrNull(body.title),
      description: textOrNull(body.description),
      ...(body.status ? { status: body.status } : {}),
      ...(body.priority ? { priority: body.priority } : {}),
      due_date: body.due_date || null,
      due_time: body.due_time || null,
      start_date: body.start_date || null,
      reminder_date: body.reminder_date || null,
      reminder_time: body.reminder_time || null,
      lead_id: body.lead_id || null,
      customer_id: body.customer_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ errors: { form: error.message } }, { status: 400 });

  // The assignee list is replaced rather than diffed, but the rows that are
  // staying are left alone — deleting and re-inserting them would throw away
  // each person's own Completed state and fire the rollup twice.
  if (Array.isArray(body.assignee_ids)) {
    const want = requestedAssignees(body, me.permissions, me.id);
    const { data: have } = await db
      .from("partner_task_assignees")
      .select("id, employee_id")
      .eq("task_id", id);

    const haveIds = (have ?? []).map((r) => r.employee_id as string);
    const toAdd = want.filter((x) => !haveIds.includes(x));
    const toDrop = (have ?? []).filter((r) => !want.includes(r.employee_id as string));

    if (toDrop.length > 0) {
      await db
        .from("partner_task_assignees")
        .delete()
        .in("id", toDrop.map((r) => r.id as string));
    }
    if (toAdd.length > 0) {
      await db
        .from("partner_task_assignees")
        .insert(toAdd.map((employee_id) => ({ task_id: id, employee_id })));
    }
  }

  await logPartnerActivity(db, {
    userId: me.authUserId,
    module: "task",
    recordId: id,
    action: "updated",
    message: `${body.activity_type} edited`,
  });

  const { data: full } = await db.from("partner_tasks").select(SELECT).eq("id", id).single();
  return NextResponse.json({ activity: full });
}

export async function DELETE(req: NextRequest) {
  const me = await requirePartnerRight("delete_activities");
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ errors: { form: "Which activity?" } }, { status: 400 });

  const db = serviceClient();

  // The timeline entry is written BEFORE the delete. Afterwards there is no
  // row to describe, and partner_module_activities does not cascade — so the
  // note survives the activity, which is the point of a timeline.
  const { data: before } = await db
    .from("partner_tasks")
    .select("activity_type, description, title, lead_id, customer_id")
    .eq("id", id)
    .maybeSingle();

  if (before) {
    const what = (before.description ?? before.title ?? before.activity_type) as string;
    for (const [module, recordId] of [
      ["lead", before.lead_id],
      ["customer", before.customer_id],
    ] as const) {
      if (recordId) {
        await logPartnerActivity(db, {
          userId: me.authUserId,
          module,
          recordId: recordId as string,
          action: "note",
          message: `Activity deleted: ${what}`,
        });
      }
    }
  }

  const { error } = await db.from("partner_tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ errors: { form: error.message } }, { status: 400 });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Write the completion route**

Create `C:\Wacrm\ozzo-partner\app\api\activity\complete\route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

import { requirePartnerRight } from "@/lib/auth/partner";
import { serviceClient } from "@/lib/auth/partner-service";
import { logPartnerActivity } from "@/lib/activities";

// ============================================================
// The tick. One route, because the rule has two halves and every screen
// that offers a tick must agree about them:
//
//   - You are one of the assignees: YOUR partner_task_assignees row changes,
//     and the rollup trigger decides whether that finishes the activity.
//     Writing partner_tasks.status as well would finish it for everybody.
//   - The activity is not assigned to you: there is no row to tick, so the
//     activity's own status changes.
//
// Gated on view_activities, NOT edit_activities. Finishing your own work is
// not editing the activity — partner_task_assignees_tick_own says the same
// thing in SQL, and a Sales Executive holds only the view right.
// ============================================================

export async function POST(req: NextRequest) {
  const me = await requirePartnerRight("view_activities");
  const { id, done } = (await req.json()) as { id?: string; done?: boolean };
  if (!id) return NextResponse.json({ errors: { form: "Which activity?" } }, { status: 400 });

  const db = serviceClient();

  const { data: mine } = await db
    .from("partner_task_assignees")
    .select("id")
    .eq("task_id", id)
    .eq("employee_id", me.id)
    .maybeSingle();

  const now = new Date().toISOString();
  const perPerson = !!mine;

  if (perPerson) {
    const { error } = await db
      .from("partner_task_assignees")
      .update({ status: done ? "Completed" : "Pending", completed_at: done ? now : null })
      .eq("id", mine.id);
    if (error) return NextResponse.json({ errors: { form: error.message } }, { status: 400 });
  } else {
    const { error } = await db
      .from("partner_tasks")
      .update({ status: done ? "Completed" : "Pending", updated_at: now })
      .eq("id", id);
    if (error) return NextResponse.json({ errors: { form: error.message } }, { status: 400 });
  }

  // Read the activity back rather than working out what the rollup did. With
  // several people on it, your tick may or may not have finished the whole
  // thing — that is the trigger's call, and duplicating it here is how the
  // screen and the database start disagreeing.
  const { data: after } = await db
    .from("partner_tasks")
    .select("status, activity_type, description, title, lead_id, customer_id")
    .eq("id", id)
    .single();

  if (after) {
    const what = (after.description ?? after.title ?? after.activity_type) as string;
    for (const [module, recordId] of [
      ["lead", after.lead_id],
      ["customer", after.customer_id],
    ] as const) {
      if (recordId) {
        await logPartnerActivity(db, {
          userId: me.authUserId,
          module,
          recordId: recordId as string,
          action: "status_changed",
          message: `${what} — ${done ? "done" : "reopened"}`,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, perPerson, status: after?.status ?? null });
}
```

- [ ] **Step 5: Run the route-shape test and watch it pass**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run app/api/activity/route-shape.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Prove the guard test actually guards**

Move the `const db = serviceClient();` line in `POST` above the `requirePartnerRight` call, re-run, and confirm it FAILS with "POST builds the service client first". Then put it back and confirm it passes again. A guard test that has never been seen to fail is decoration.

- [ ] **Step 7: Commit**

```bash
cd /c/Wacrm/ozzo-partner
git add app/api/activity
git commit -m "feat(activity): the API routes, with the tick in one place

The completion route is gated on view_activities rather than
edit_activities: finishing your own work is not editing the activity, which
is what partner_task_assignees_tick_own says in SQL too. It re-reads the
activity after writing rather than deciding for itself whether the tick
finished it — that is the rollup trigger's call.

The guard test was seen to fail with the service client built first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: The activity types list in Settings

Small, and it comes before the screen because the screen's type tabs read it.

**Files:**
- Modify: `C:\Wacrm\ozzo-partner\lib\masters\types.ts`
- Modify: `C:\Wacrm\ozzo-partner\lib\masters\types.test.ts`
- Modify: `C:\Wacrm\ozzo-partner\app\(portal)\settings\settings-client.tsx:34,59`

**Interfaces:**
- Consumes: `MASTER_TABLES`, `MASTER_LABELS`, `MASTER_HINTS`, `MASTER_HAS_COLOUR`, `masterSelect(kind)`, `isMasterKind(kind)` — all already in `lib/masters/types.ts`; `public.partner_activity_types` from Task 1.
- Produces: `MasterKind` gains `"activity"`.

- [ ] **Step 1: Write the failing test**

`settings-client.tsx` holds `const KINDS: MasterKind[] = ["status", "source", "industry"]`. That array is typed but not exhaustive-checked, so adding a fourth kind and forgetting this line compiles cleanly and the list simply never appears — the same shape of fault as the eleven dead menu items, which were invisible to tsc, vitest and next build alike.

Add to `C:\Wacrm\ozzo-partner\lib\masters\types.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MASTER_HINTS, MASTER_LABELS, MASTER_TABLES } from "./types";

describe("the Settings screen shows every master list there is", () => {
  it("has a label and a hint for every kind", () => {
    for (const kind of Object.keys(MASTER_TABLES)) {
      expect(MASTER_LABELS[kind as keyof typeof MASTER_LABELS], kind).toBeTruthy();
      expect(MASTER_HINTS[kind as keyof typeof MASTER_HINTS], kind).toBeTruthy();
    }
  });

  it("derives its list of panels from MASTER_TABLES rather than repeating it", () => {
    // A hand-written array drifts silently: the kind exists, the table
    // exists, the API route serves it, and the panel is simply not on the
    // screen. Nothing fails. Deriving it makes that impossible.
    const src = readFileSync(
      join(process.cwd(), "app", "(portal)", "settings", "settings-client.tsx"),
      "utf8",
    );
    expect(src).toContain("Object.keys(MASTER_TABLES)");
    expect(src).not.toMatch(/const KINDS:\s*MasterKind\[\]\s*=\s*\[/);
  });

  it("includes the activity types", () => {
    expect(MASTER_TABLES.activity).toBe("partner_activity_types");
    expect(MASTER_HAS_COLOUR.activity).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/masters/types.test.ts
```

Expected: FAIL on all three — `MASTER_TABLES.activity` is undefined and `KINDS` is still a literal.

- [ ] **Step 3: Add the fourth kind**

In `C:\Wacrm\ozzo-partner\lib\masters\types.ts`:

```ts
export type MasterKind = "status" | "source" | "industry" | "activity";
```

and add to each of the four maps:

```ts
// MASTER_TABLES
  activity: "partner_activity_types",

// MASTER_LABELS
  activity: "Activity types",

// MASTER_HINTS
  activity:
    "The kinds of activity your team can log — a call, a visit, a meeting. These are the tabs on the Add Activity form.",

// MASTER_HAS_COLOUR
  activity: false,
```

- [ ] **Step 4: Derive the panel list**

In `C:\Wacrm\ozzo-partner\app\(portal)\settings\settings-client.tsx`, replace line 34 and the hand-written initial state on line 59:

```ts
/**
 * Derived, not written out. A hand-written list drifts silently: the kind
 * exists, its table exists, the API route serves it, and the panel is simply
 * missing from the screen with nothing failing anywhere. types.test.ts pins
 * the derivation.
 */
const KINDS = Object.keys(MASTER_TABLES) as MasterKind[];

const EMPTY_LISTS = Object.fromEntries(KINDS.map((k) => [k, []])) as Record<MasterKind, Master[]>;
```

and use `EMPTY_LISTS` in both `useState` and the `next` assembly in place of the two `{ status: [], source: [], industry: [] }` literals.

- [ ] **Step 5: Run the tests and the type check**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/masters; npx tsc --noEmit
```

Expected: PASS. `tsc` is what catches any remaining place that enumerates the kinds by hand.

- [ ] **Step 6: Commit**

```bash
cd /c/Wacrm/ozzo-partner
git add lib/masters "app/(portal)/settings/settings-client.tsx"
git commit -m "feat(settings): activity types as a fourth master list

KINDS is now derived from MASTER_TABLES. The hand-written array was a
silent-drift hazard of exactly the kind that shipped eleven dead menu items:
add a kind, forget the array, and the panel is missing with nothing failing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: The My Activity screen

The CRM's My Activity is a card list with a filter bar, not a DataTable. Copy that: it is the screen the founder knows, and a table here would be a different product.

**Files:**
- Create: `C:\Wacrm\ozzo-partner\app\(portal)\activity\page.tsx`
- Create: `C:\Wacrm\ozzo-partner\app\(portal)\activity\activity-client.tsx`
- Create: `C:\Wacrm\ozzo-partner\app\(portal)\activity\activity-form.tsx`

**Interfaces:**
- Consumes: `requirePartnerRight` from `@/lib/auth/partner`; `createBrowserSupabase` from `@/lib/supabase/client`; everything from `lib/activity/*` (Task 2); `POST/PATCH/DELETE /api/activity` and `POST /api/activity/complete` (Task 3); `partner_activity_types` (Task 1); `PageLayout` and `PageHeader` from `@/components/shared` and `@/components/page-header`; `Button`, `buttonVariants`, `Input` from `@/components/ui/*`; `EmptyState`, `LoadingState` from `@/components/shared`.
- Produces: the `/activity` route.

- [ ] **Step 1: The server page**

Create `C:\Wacrm\ozzo-partner\app\(portal)\activity\page.tsx`:

```tsx
import { requirePartnerRight } from "@/lib/auth/partner";
import { can } from "@/lib/auth/rights";
import ActivityClient from "./activity-client";

export default async function ActivityPage() {
  const me = await requirePartnerRight("view_activities");

  return (
    <ActivityClient
      meId={me.id}
      meName={me.fullName}
      canCreate={can(me.permissions, "create_activities")}
      canEdit={can(me.permissions, "edit_activities")}
      canDelete={can(me.permissions, "delete_activities")}
      canSeeTeam={can(me.permissions, "view_team_activities")}
    />
  );
}
```

- [ ] **Step 2: The client — filter bar, list, tick**

Create `C:\Wacrm\ozzo-partner\app\(portal)\activity\activity-client.tsx`. The shape, in full:

- **State:** `assignedTo` (defaults to `meId`, or `"all"` when `!canSeeTeam` is false and nothing resolves), `doneFilter` (`"Undone" | "Done" | "All"`, default `"Undone"`), `period` (`DEFAULT_PERIOD`), `typeFilter` (`"all"`), `priorityFilter` (`"All"`), `search`, `customStart`, `customEnd`.
- **Load once:** the activity types (`partner_activity_types`, `is_active` only, ordered by `sort_order`) and the employees (`partner_employees`, `status = 'active'`, `id, full_name`). The employees query is RLS-scoped, so somebody without `view_employees` gets back only themselves and the picker is honestly short. Do not add a second mechanism for that.
- **Fetch:** one query, `.select(SELECT)` with the same string as the API route, `.order("due_date", { ascending: true, nullsFirst: false })`, `.order("created_at", { ascending: false })`, `.range(0, 999)`.
  - `assignedTo !== "all"` → first read `partner_task_assignees` for that person's `task_id`s and `.in("id", ids)`. **If that list is empty, set `[]` and return** rather than sending `.in("id", [])`, which PostgREST treats as no filter and would show the whole team's work.
  - `typeFilter !== "all"` → `.eq("activity_type", typeFilter)`.
  - `doneFilter === "Undone"` → `.not("status", "in", '("Completed","Cancelled")')`; `"Done"` → `.in("status", ["Completed", "Cancelled"])`.
  - `search` → `.or("title.ilike.%s%,description.ilike.%s%")`.
  - Then client-side: `matchesPeriod(a.due_date, period, customStart, customEnd)` and the priority filter.
- **The 1,000-row banner:** if the result length is exactly 1,000, show "Showing the first 1,000. Narrow the dates or the search to see the rest." PostgREST caps silently; a list that stops at a round number with no explanation is the fault this banner exists for.
- **Each row:** the type icon (Phone for Call, MapPin for Visit, FileText for Note, CalendarCheck otherwise), a tick button, `activityText(a)` with the type as a bold prefix, the `linkedLabel(a)` chip linking to the lead or customer, the due date, `assigneeLabel(assigneeNames(a.assignees ?? []))`, `progressLabel(a.assignees ?? [])` when there are two or more people, and the priority badge. Overdue and not done → red. `displayedStatus(...) === "Completed"` → struck through and faded.
- **The tick:** `POST /api/activity/complete` with `{ id, done }`, then **refetch**. Do not patch the row in place: whether your tick finished the activity is the rollup trigger's call.
- **Empty state:** when nothing matches, say which filters are on — "Nothing due today. Try This Week, or All." An empty list that does not explain itself reads as a broken screen.

The row and the filter bar must use `components/ui` and the design tokens, exactly as `leads-client.tsx` does. Read that file first and follow it; do not invent a second visual language.

- [ ] **Step 3: The form**

Create `C:\Wacrm\ozzo-partner\app\(portal)\activity\activity-form.tsx`, modelled on the CRM's `TaskForm` and on the portal's own `lead-form.tsx`:

- **Type tabs across the top**, from `partner_activity_types` — the CRM's segmented row, not a dropdown. The chosen type is the form's mode.
- **Note is different:** when the type is `Note`, show one autofocused textarea and nothing else. That is what the CRM does, and a note with a priority and a reminder is a task wearing a note's name.
- **Otherwise, in this order** (the founder's order from the CRM): the one-line `description` input, autofocused, placeholder = the chosen type; Scheduled Date; Scheduled Time; Priority; Assigned To.
- **Assigned To is a multi-select**, searchable, placeholder "Unassigned", and **hidden outright** when `!canSeeTeam` — a disabled picker advertises a choice the role does not have. The activity then simply stays with its creator.
- **Then, collapsed behind a "More" disclosure:** Start Date, Reminder Date, Reminder Time, Status. These exist in the CRM's table and its Manage Column list but not on its form; putting them behind one click gives the portal parity without making the common case slower.
- **Linked To:** one `Select` of "Nothing / A lead / A customer", then a searchable picker of the chosen one. Only one, because `validateActivityInput` refuses both.
- Errors come back from the route as `{ errors: { field: message } }`; show them under their fields, and `errors.form` at the top.

- [ ] **Step 4: Run it and look at it**

```powershell
cd C:\Wacrm\ozzo-partner; npx next build
```

Then start the dev server through the preview tool (not Bash) and walk the screen: add a Call due today, see it appear; tick it and see it strike through; untick it; switch the period to All; add a Note and confirm the form collapses to one box; add a second person to an activity and confirm the row says "0 of 2 done"; tick your own box and confirm it says "1 of 2 done" and the activity is still Undone. That last pair is the whole point of the phase.

- [ ] **Step 5: Commit**

```bash
cd /c/Wacrm/ozzo-partner
git add "app/(portal)/activity"
git commit -m "feat(activity): the My Activity screen

A card list with the CRM's filter bar, not a DataTable — this is the screen
the founder knows. The tick goes through /api/activity/complete and the list
refetches afterwards rather than patching the row, because whether your tick
finished a shared activity is the rollup trigger's call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: Turn it on, and prove it

**Files:**
- Modify: `C:\Wacrm\ozzo-partner\lib\nav.ts:66`
- Modify: `C:\Wacrm\ozzo-partner\lib\nav.test.ts:36`
- Modify: `C:\Wacrm\wacrm-web\docs\superpowers\plans\2026-11-22-partner-portal-phase-2c.md`

- [ ] **Step 1: Add `/activity` to the built list in the test FIRST**

In `C:\Wacrm\ozzo-partner\lib\nav.test.ts`, line 36:

```ts
    expect(BUILT.map((i) => i.href).sort()).toEqual(["/", "/activity", "/customers", "/employees", "/leads", "/roles", "/settings"]);
```

and in the Super Admin expectation, insert `"My Activity"` after `"Customers"`. In the Sales Executive expectation, the same.

- [ ] **Step 2: Run it and watch it fail**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/nav.test.ts
```

Expected: FAIL — `/activity` is still `built: false`.

- [ ] **Step 3: Flip the flag**

`C:\Wacrm\ozzo-partner\lib\nav.ts`, line 66: `built: false` → `built: true`.

- [ ] **Step 4: Run it and watch it pass**

```powershell
cd C:\Wacrm\ozzo-partner; npx vitest run lib/nav.test.ts
```

Expected: PASS. The test walks the real route folder, so this only goes green because `app/(portal)/activity/page.tsx` exists.

- [ ] **Step 5: All five gates**

```powershell
cd C:\Wacrm\ozzo-partner; npx tsc --noEmit; npx vitest run; npx next build
```

```bash
cd /c/Wacrm/wacrm-web && PGPORT=54432 PGDATA_DIR="$SCRATCH/pgtest-2e" bash scripts/run-db-tests.sh 2>&1 | tail -30
```

The fifth gate is the click-through from Task 5, Step 4. Report the harness's `passed | failed` numbers, and say plainly whether the pass count went **up** from the previous run — a count that fell while `failed` stayed 0 means a scenario aborted part way.

- [ ] **Step 6: Commit and watch the deploy**

```bash
cd /c/Wacrm/ozzo-partner
git add lib/nav.ts lib/nav.test.ts
git commit -m "feat(nav): My Activity is built

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

Then check the Vercel deployment actually reached **Ready** and **Production**. Two deploys in Phase 1 failed silently with module-not-found while everything was green locally, because a dependency was declared in `wacrm-web` and resolved from `C:\Wacrm\node_modules`. A push is not a deploy.

- [ ] **Step 7: Append what actually changed**

At the end of this plan file, add a "What actually changed during execution" section: every place the plan was wrong, every trap found that is not written above, and the harness pass counts before and after. The Phase 1 and 2A plans both carry one, and they are where the next phase's traps come from.

---

## Self-Review

**Spec coverage.** The spec's My Activity row asks for the CRM's screen and the same form against partner leads and customers: Tasks 1–5 cover it, and Task 1's rollup plus Task 3's completion route are what make "the same screen" true rather than approximate. Phase 2's *done when* clause — an executive sees only their own rows, their manager sees both, **and both facts hold against the database and not only the screen** — is scenario 84's A5, A6 and A15. The master list is Task 4; the spec puts the master lists in Settings and this is a fourth one.

**Not in this phase, deliberately:** the CRM's task comments, checklists and attachments. They are three more tables and three more panels, the founder did not name them, and My Activity does not show them — the CRM's task *detail page* does. If he wants them they are their own small phase.

**Also not in this phase:** a Tasks DataTable with filter row and Manage Column. The CRM has both My Activity and a Tasks table; the spec maps the founder's module to My Activity only. Worth telling him that the table is the thing he has not got, so it is his choice rather than an omission he discovers.

**Placeholder scan.** No TBDs. Task 5's two client components are described rather than written out in full — they are 300–400 lines of JSX against components whose exact props are in `leads-client.tsx` and `lead-form.tsx`, and transcribing them here from memory would put wrong prop names into the plan. The behaviour, the order of the fields, the query shape, the empty-row trap, the 1,000-row banner and the refetch-not-patch rule are all specified; the executor reads the two neighbouring files for the house style. Every other task carries its real code.

**Type consistency.** `employee_id` throughout `partner_task_assignees` (not `profile_id`, which is the CRM's column against its own `profiles` table). `assignee_ids` is the request field; `assignee_id` is the trigger-owned column and appears in `PRIVILEGE_COLUMNS` so a request cannot set it. `activity_type` everywhere after the rename — never `kind`. `ActivityAssignee` is defined in `assignees.ts` and imported by `types.ts`, not redeclared. `matchesPeriod` and `DEFAULT_PERIOD` keep the CRM's names so the two files can be diffed.

**One thing the executor should push back on.** Task 1 renames three columns in a table that has never been written to. The rename buys readability against the CRM and costs a guarded `do $$` block. If `partner_tasks` turns out to hold real rows by the time this runs, the renames are still safe — but check, and say so.
