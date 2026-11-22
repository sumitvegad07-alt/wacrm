# Rolling back 20261124120000_partner_activity_crm_parity.sql

## Read this first

**Rolling back loses data that has nowhere to go in the old shape.**

- **Extra assignees.** The old `partner_tasks` holds exactly one person per
  activity, in `assignee_id`. An activity shared by three people loses two of
  them, and each of those people's own Completed state with them.
- **The five statuses collapse to two.** `In Progress`, `Waiting` and
  `Cancelled` all become `Undone`, which is wrong about all three — a
  cancelled activity is not outstanding work.
- **Start dates and reminders are dropped.** There are no columns for them.

If the aim is only to stop using the new screen, hide the menu item instead:
set `built: false` for `/activity` in `ozzo-partner/lib/nav.ts` and push. The
data stays, the screen goes, and nothing is lost.

## If you still need to undo it

Run the blocks in this order. Each is safe to run twice.

### 1. Save what is about to be lost

Do this first or not at all. It costs nothing and it is the only copy.

```sql
create table if not exists public.partner_task_assignees_backup_20261124 as
  select a.*, t.activity_type, t.description, t.title, t.status as task_status
    from public.partner_task_assignees a
    join public.partner_tasks t on t.id = a.task_id;

create table if not exists public.partner_tasks_backup_20261124 as
  select id, status, start_date, reminder_date, reminder_time, activity_type
    from public.partner_tasks;
```

### 2. Drop the triggers and the child table

The rollup must go before `assignee_id` is made NOT NULL again, or it will
fire mid-way through and set the column it is about to be forbidden to null.

```sql
drop trigger if exists trg_partner_task_assignees_rollup     on public.partner_task_assignees;
drop trigger if exists trg_partner_task_assignees_guard_move on public.partner_task_assignees;
drop trigger if exists trg_partner_tasks_check_type          on public.partner_tasks;
drop function if exists public.partner_task_assignees_rollup();
drop function if exists public.partner_task_assignees_guard_move();
drop function if exists public.partner_tasks_check_type();

-- This one must go AFTER the policies in step 6 are replaced, or drop it
-- last: partner_tasks_select calls it, and dropping a function a live policy
-- depends on fails. If you are running these blocks in order, leave this
-- line until step 6 is done.
-- drop function if exists public.partner_task_has_scoped_assignee(uuid);

drop table if exists public.partner_task_assignees;
drop table if exists public.partner_activity_types;
```

### 3. Put the column names back

```sql
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'partner_tasks'
                and column_name = 'title') then
    alter table public.partner_tasks rename column title to subject;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'partner_tasks'
                and column_name = 'description') then
    alter table public.partner_tasks rename column description to detail;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'partner_tasks'
                and column_name = 'activity_type') then
    alter table public.partner_tasks rename column activity_type to kind;
  end if;
end $$;

alter table public.partner_tasks drop constraint if exists partner_tasks_has_words;
alter table public.partner_tasks drop column if exists start_date;
alter table public.partner_tasks drop column if exists reminder_date;
alter table public.partner_tasks drop column if exists reminder_time;
```

**`subject` was NOT NULL in the old shape.** Any row written through the new
screen with only a description has a null subject, and the next statement
fails until those rows are given one:

```sql
update public.partner_tasks
   set subject = coalesce(nullif(btrim(subject), ''), nullif(btrim(detail), ''), kind)
 where subject is null or btrim(subject) = '';

alter table public.partner_tasks alter column subject set not null;
```

### 4. Put the two-value status back

```sql
alter table public.partner_tasks drop constraint if exists partner_tasks_status_check;
alter table public.partner_tasks alter column status drop default;

update public.partner_tasks set status = 'Done'   where status = 'Completed';
update public.partner_tasks set status = 'Undone' where status <> 'Done';

alter table public.partner_tasks alter column status set default 'Undone';
alter table public.partner_tasks
  add constraint partner_tasks_status_check check (status in ('Undone', 'Done'));

alter table public.partner_tasks
  drop constraint if exists partner_tasks_kind_check;
alter table public.partner_tasks
  add constraint partner_tasks_kind_check
  check (kind in ('Task','Call','Visit','Meeting','Follow up','Note'));
alter table public.partner_tasks alter column kind set default 'Task';
```

Any `kind` added through Settings that is not one of those six fails this
CHECK. Find them first and decide what each should become:

```sql
select kind, count(*) from public.partner_tasks
 where kind not in ('Task','Call','Visit','Meeting','Follow up','Note')
 group by kind;
```

### 5. Put `assignee_id` back to NOT NULL

This fails while any activity has nobody on it — which the new shape allows
on purpose. Assign them or delete them first; the query shows which:

```sql
select id, kind, detail, subject from public.partner_tasks where assignee_id is null;
```

```sql
alter table public.partner_tasks
  drop constraint if exists partner_tasks_assignee_id_fkey;
alter table public.partner_tasks
  add constraint partner_tasks_assignee_id_fkey
  foreign key (assignee_id) references public.partner_employees(id) on delete restrict;
alter table public.partner_tasks alter column assignee_id set not null;
```

### 6. Restore the three Phase 2A policies

Verbatim from `20261121120000_partner_portal_phase2.sql`. The widened
versions reference `partner_task_assignees`, which no longer exists, so
these must be replaced rather than left alone.

```sql
drop policy if exists partner_tasks_select on public.partner_tasks;
create policy partner_tasks_select on public.partner_tasks
  for select to authenticated
  using (public.partner_has_right('view_activities')
         and assignee_id in (select public.partner_scope_ids()));

drop policy if exists partner_tasks_insert on public.partner_tasks;
create policy partner_tasks_insert on public.partner_tasks
  for insert to authenticated
  with check (public.partner_has_right('create_activities')
              and assignee_id in (select public.partner_scope_ids()));

drop policy if exists partner_tasks_update on public.partner_tasks;
create policy partner_tasks_update on public.partner_tasks
  for update to authenticated
  using (public.partner_has_right('edit_activities')
         and assignee_id in (select public.partner_scope_ids()))
  with check (assignee_id in (select public.partner_scope_ids()));

drop policy if exists partner_tasks_delete on public.partner_tasks;
create policy partner_tasks_delete on public.partner_tasks
  for delete to authenticated
  using (public.partner_has_right('delete_activities')
         and assignee_id in (select public.partner_scope_ids()));
```

Now that the policies no longer mention it, drop the helper that was left
until last in step 2:

```sql
drop function if exists public.partner_task_has_scoped_assignee(uuid);
```

### 7. The code side

- `ozzo-partner/lib/nav.ts` — `/activity` back to `built: false`, and
  `lib/nav.test.ts` back in step with it.
- Delete `ozzo-partner/app/(portal)/activity/`, `app/api/activity/` and
  `lib/activity/`.
- `lib/masters/types.ts` — remove the `activity` kind from all four maps.
  `MasterKind` is a union, so `tsc` will name every place that needs it.
- `wacrm-web/supabase/tests/81_partner_leads.sql` — the two fixture deletes
  go back to `WHERE subject LIKE`.
- Remove `84_partner_activity` from the list on line 101 of
  `scripts/run-db-tests.sh`, and delete `supabase/tests/84_partner_activity.sql`.

### 8. Check

```sql
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('partner_activity_types','partner_task_assignees')) as should_be_0,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'partner_tasks'
      and column_name in ('subject','detail','kind')) as should_be_3;
```

The backup tables from step 1 are deliberately left behind. Drop them by
hand once you are sure nothing is needed from them.
