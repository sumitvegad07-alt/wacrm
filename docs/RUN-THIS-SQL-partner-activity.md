# Run this in Supabase — My Activity

Open the Mumbai project (`ltigfpywdbfilsagtpyd`) → **SQL Editor** → **New query**, paste the whole block below, and press **Run**. It is safe to run twice.

This block is the migration file itself, copied by a script — not retyped. A hand-assembled block is how the Phase 2 paste created eight tables instead of nine, with a check query that asked about the same eight and so could not notice.

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
--    Checked properly this time: ozzo-partner/{app,lib}, wacrm-web/src,
--    supabase/migrations AND supabase/tests. That last folder is the one that
--    was missed when business_name was renamed in 20261123120000 — files 81
--    and 82 delete fixtures by the old column name, so both aborted half way
--    while the suite still reported 0 failed and a pass count TWENTY LOWER
--    than the run before. A rename's blast radius includes the tests.
--
--    The grep found exactly two live readers, and both are in the tests:
--      supabase/tests/81_partner_leads.sql:29   DELETE ... WHERE subject LIKE
--      supabase/tests/81_partner_leads.sql:232  DELETE ... WHERE subject LIKE
--    Both are changed to `title` in the same commit as this migration. Without
--    that, file 81 aborts on its first statement and takes its 20-odd
--    assertions with it, silently.
--
--    No application code reads these columns: no screen exists yet. Two
--    references to keep in mind that are NOT columns and are NOT touched here:
--      ozzo-partner/lib/activities.ts        PartnerModule includes "task"
--      ozzo-partner/lib/record-views/unseen.ts  RecordModule includes "task"
--    Both are the string 'task' in partner_module_activities.module_name and
--    partner_record_views.module_name.
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
-- the assignee rows is in scope). Scenarios 84.A5 and 84.A7 are those two.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. The activity types master
--
-- The CRM keeps this list in accounts.settings->>'task_types'. The portal has
-- no accounts row of its own, so it becomes a fourth master list beside lead
-- statuses, sources and industries — same shape, same Settings screen, same
-- API route. No colour column: an activity type has no use for one, and
-- giving three of four lists a colour is what produced "column
-- partner_industries.colour does not exist" on the live portal, with two of
-- the three lists silently empty.
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
--
-- Only ONE foreign key from here to partner_employees. A second route
-- between the same pair of tables breaks PostgREST embeds with a 404 — the
-- fault that broke every order in the CRM (orders-second-fk-broke-every-order).
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
declare
  v_name text;
begin
  if new.activity_type is null or btrim(new.activity_type) = '' then
    new.activity_type := 'Task';
  end if;

  select name into v_name from partner_activity_types
   where lower(name) = lower(btrim(new.activity_type));

  if v_name is null then
    raise exception 'Unknown activity type: %', new.activity_type
      using hint = 'Add it in Settings first.';
  end if;

  -- Store the master's spelling, so "call" and "Call" cannot both appear in
  -- a filter dropdown as two different types.
  new.activity_type := v_name;
  return new;
end $$;

drop trigger if exists trg_partner_tasks_check_type on public.partner_tasks;
create trigger trg_partner_tasks_check_type
  before insert or update of activity_type on public.partner_tasks
  for each row execute function public.partner_tasks_check_type();

-- ─────────────────────────────────────────────────────────────────────
-- 5. "Am I on this activity?", answered WITHOUT row-level security
--
-- THE FAULT THIS EXISTS FOR, found by the harness on the first run of
-- scenario 84 and never applied to a live database:
--
--     ERROR: infinite recursion detected in policy for relation
--            "partner_tasks"
--
-- The first draft had partner_tasks_select ask partner_task_assignees
-- "is one of this activity's people in my scope?", while
-- partner_task_assignees_select asked partner_tasks "can I see the parent?".
-- Each policy is correct read on its own. Together they are a cycle, and
-- Postgres refuses the whole query rather than looping — so EVERY read of
-- either table fails, which is a broken screen and not a subtle one.
--
-- security definer breaks the cycle: this function reads the child table
-- with RLS off, so the policy on partner_tasks no longer consults a table
-- whose own policy consults partner_tasks. The same trick, for the same
-- reason, as public.partner_scope_ids().
--
-- It is NOT a widening. It answers only about the caller's own scope, which
-- is what the policy would have asked anyway.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.partner_task_has_scoped_assignee(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.partner_task_assignees a
     where a.task_id = p_task_id
       and a.employee_id in (select public.partner_scope_ids())
  )
$$;

revoke all on function public.partner_task_has_scoped_assignee(uuid) from public, anon;
grant execute on function public.partner_task_has_scoped_assignee(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Policies
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
      or  public.partner_task_has_scoped_assignee(id)
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
      or  public.partner_task_has_scoped_assignee(id)
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
-- activity can see who else is on it. The EXISTS is evaluated under the
-- caller's own RLS, so partner_tasks_select is what decides.
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
-- be able to finish their own work. Scoped to their own row, so this is not
-- a back door to reassigning somebody else's.
drop policy if exists partner_task_assignees_tick_own on public.partner_task_assignees;
create policy partner_task_assignees_tick_own on public.partner_task_assignees
  for update to authenticated
  using (employee_id = public.partner_me())
  with check (employee_id = public.partner_me());

-- ─────────────────────────────────────────────────────────────────────
-- 7. The hole the policy above opens, closed
--
-- FOUND IN REVIEW OF THIS MIGRATION, before it was ever applied.
--
-- partner_task_assignees_tick_own was written to let somebody finish their
-- own work without edit_activities. As written it permits an UPDATE of ANY
-- column of their own row — including task_id. Postgres has no column-level
-- RLS and a WITH CHECK cannot see the old row, so the policy cannot tell
-- "I ticked my box" from "I moved my row onto a different activity".
--
-- And moving it is privilege escalation: the assignee arm of
-- partner_tasks_select grants read on any activity you hold a row for. A
-- Telecaller who knows one activity id — from a URL they once had, say —
-- could attach themselves to it and read it.
--
-- A UUID is not guessable, so this is narrow. It is also exactly the shape
-- of fault that is invisible in review of the POLICY alone, because the
-- policy is correct about who may write and says nothing about what they
-- may write. The guard therefore lives where it can see both rows.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.partner_task_assignees_guard_move()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.task_id is distinct from old.task_id
      or new.employee_id is distinct from old.employee_id)
     and not partner_has_right('edit_activities') then
    raise exception 'You may finish your own work, not move it to another activity'
      using hint = 'Changing who is on an activity needs the Edit right.';
  end if;
  return new;
end $$;

drop trigger if exists trg_partner_task_assignees_guard_move on public.partner_task_assignees;
create trigger trg_partner_task_assignees_guard_move
  before update on public.partner_task_assignees
  for each row execute function public.partner_task_assignees_guard_move();
```

## Then check it worked

Paste this second block and run it. You should get one row, and the last column should say `ok`.

```sql
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('partner_activity_types','partner_task_assignees')) as new_tables,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'partner_tasks'
      and column_name in ('title','description','activity_type',
                          'start_date','reminder_date','reminder_time')) as renamed_and_added,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'partner_tasks'
      and column_name in ('subject','detail','kind')) as old_names_left,
  (select count(*) from public.partner_activity_types) as activity_types,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('partner_tasks','partner_task_assignees','partner_activity_types')) as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('partner_task_assignees_rollup','partner_tasks_check_type',
                        'partner_task_has_scoped_assignee',
                        'partner_task_assignees_guard_move')) as functions,
  (select count(*) from pg_trigger
    where not tgisinternal
      and tgname in ('trg_partner_task_assignees_rollup','trg_partner_tasks_check_type',
                     'trg_partner_task_assignees_guard_move')) as triggers,
  case
    when (select count(*) from information_schema.tables
           where table_schema = 'public'
             and table_name in ('partner_activity_types','partner_task_assignees')) = 2
     and (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'partner_tasks'
             and column_name in ('title','description','activity_type',
                                 'start_date','reminder_date','reminder_time')) = 6
     and (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'partner_tasks'
             and column_name in ('subject','detail','kind')) = 0
     and (select count(*) from public.partner_activity_types) >= 6
     and (select count(*) from pg_policies
           where schemaname = 'public'
             and tablename in ('partner_tasks','partner_task_assignees',
                               'partner_activity_types')) >= 9
     and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('partner_task_assignees_rollup','partner_tasks_check_type',
                               'partner_task_has_scoped_assignee',
                               'partner_task_assignees_guard_move')) = 4
     and (select count(*) from pg_trigger
           where not tgisinternal
             and tgname in ('trg_partner_task_assignees_rollup','trg_partner_tasks_check_type',
                            'trg_partner_task_assignees_guard_move')) = 3
    then 'ok'
    else 'SOMETHING IS MISSING — send this whole row back'
  end as verdict;
```

Expected: `2 | 6 | 0 | 6 | 9 | 4 | 3 | ok`.

What each number is:

- **new_tables 2** — the activity types list, and the one holding who is on each activity.
- **renamed_and_added 6** — title, description, activity_type, start date, reminder date, reminder time.
- **old_names_left 0** — the three old column names are gone.
- **activity_types 6** — Task, Call, Visit, Meeting, Follow up, Note. Add your own in Settings afterwards.
- **policies 9** — nine rules about who may read and write what.
- **functions 4** and **triggers 3** — the rollup that finishes a shared activity when everyone has ticked, the activity-type check, and the guard that stops somebody moving their own row to another activity.

If the verdict is not `ok`, send the whole row back — nothing else needs doing.

## Then tell me

Once this says `ok`, My Activity will work on the portal. Before that it will show an error, because the tables it reads do not exist yet.
