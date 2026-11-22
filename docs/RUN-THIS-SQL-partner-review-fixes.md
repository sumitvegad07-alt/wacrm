# Run this in Supabase — the partner portal review fixes

Open the Mumbai project (`ltigfpywdbfilsagtpyd`) → **SQL Editor** → **New query**, paste the whole block below, and press **Run**. It is safe to run twice, and safe to run even if you have already run the My Activity block from `RUN-THIS-SQL-partner-activity.md`.

It takes about ten seconds.

**Nothing in OZZO CRM, the mobile app or the DMS portal is changed.** Everything this block creates or alters begins with `partner_`. The one thing it touches outside the portal it only *reads*: your CRM's territory list, so the **Copy from OZZO CRM** button has something to copy. It writes nothing there.

## What it does

Three things, in this order:

1. **My Activity's tables.** If you have already run the My Activity block, this part finds everything in place and changes nothing. If you have not, this is what makes that screen work instead of showing an error.
2. **Converting a lead now retires the lead.** Your point: *"that lead should be remove from lead's database once it is saved in customer database."* It also moves the calls and follow-ups you had planned on the lead over to the new customer, and copies the lead's history onto the customer's page. Leads already converted before today are left where they are — see the last section if you want those tidied up too.
3. **Territories.** A Country / State / City / Area list the portal owns, which Settings can now add to. There is a **Copy from OZZO CRM** button on the Settings page afterwards — press it once and the whole territory list you already built in the CRM comes across.

## Paste this

```sql
-- =====================================================================
-- PART: My Activity — the tables the activity screen reads
-- file: supabase/migrations/20261124120000_partner_activity_crm_parity.sql
-- =====================================================================

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


-- =====================================================================
-- PART: Converting a lead retires it and moves its work across
-- file: supabase/migrations/20261125120000_partner_convert_retires_lead.sql
-- =====================================================================

-- =====================================================================
-- 2026-11-25 — Converting a lead RETIRES it, moves its activities, and
--              cannot half-succeed.
--
-- Founder's review of the partner portal, point 5, in his own words:
--
--   "Converting lead to customer is working but that lead should be remove
--    from lead's database once it is saved in customer database."
--
-- He is describing the CRM's behaviour, and the CRM has it in one line.
-- `public.convert_lead_to_customer` (migration 091) ends with:
--
--     UPDATE leads SET is_converted = true,
--                      is_active    = false,     <-- THIS
--                      converted_contact_id = v_contact_id
--
-- `is_active = false` is the CRM's soft-delete flag, so a converted lead
-- drops out of the Leads list the moment it becomes a customer. The portal's
-- own flag is `record_status`, its Leads list defaults to
-- `record_status = ['active']`, and `partner_convert_lead_to_customer` never
-- touched it — so a won lead sat in the pipeline for ever, next to the
-- customer it had already become. Two records, one business, and a rep
-- chasing a shop that had already signed.
--
-- THREE other things the CRM's function does and this one did not:
--
--   1. It MOVES THE OPEN WORK. `UPDATE tasks SET lead_id = NULL,
--      contact_id = v_contact_id WHERE lead_id = p_lead_id`. Without it,
--      every call and follow-up planned while the business was a lead stays
--      attached to the retired lead: invisible on the customer's new page,
--      and still listed under a record nobody will open again. This is the
--      half of point 5 nobody asks for until a follow-up is missed.
--
--   2. It COPIES THE HISTORY. The lead's timeline is reproduced on the
--      customer, so "spoke to Nilesh on the 3rd" survives the conversion.
--      The portal wrote the customer one line — "Created by converting the
--      lead X" — and left the rest behind a record that no longer appears in
--      any list.
--
--   3. It CHECKS THAT THE UPDATE LANDED. `GET DIAGNOSTICS v_updated =
--      ROW_COUNT; IF v_updated = 0 THEN RAISE`. The portal's function is
--      SECURITY INVOKER, so its `UPDATE partner_leads` is filtered by
--      partner_leads_update — which requires `edit_leads`. A role holding
--      `convert_leads` and NOT `edit_leads` therefore created the customer,
--      updated nothing, and returned success: a customer with no lead
--      marked converted, and a lead that could be converted again tomorrow.
--      Nothing raised. Nothing logged. That is the worst failure shape there
--      is, and it was reachable with the rights screen as shipped.
--
-- ── A TRAP THIS MIGRATION WALKED INTO, AND THE HARNESS CAUGHT ──
--
-- The first draft copied the CRM's `SELECT * INTO v_lead ... FOR UPDATE`, to
-- stop two clicks a second apart both passing the already-converted guard.
--
-- **`SELECT ... FOR UPDATE` is not a read as far as RLS is concerned.**
-- Postgres applies the UPDATE policy's USING clause to a locking select as
-- well as the SELECT policy, because the row is being claimed as an update
-- target. `partner_leads_update` requires `edit_leads` — so adding FOR UPDATE
-- re-introduced the exact coupling this migration exists to remove, and more
-- loudly: a role with `convert_leads` and no `edit_leads` got
-- "That lead does not exist, or you cannot see it." Scenario V6 failed with
-- that message and V6b with `record_status=active converted=null`, which read
-- like a policy bug and was a one-word addition to a SELECT.
--
-- The lock is gone. What stops the double conversion instead is a UNIQUE
-- INDEX on `partner_customers.source_lead_id` (section 0): two simultaneous
-- conversions of one lead both read a lead with no customer, both insert, and
-- the second one is refused by the index. A constraint beats a lock here —
-- it also covers the case the lock never did, which is two different callers
-- in two different sessions.
--
-- ── THE FIVE QUESTIONS ──
--
-- 1. What breaks if this runs twice?
--    Nothing. Both functions are CREATE OR REPLACE. The conversion guard
--    (`converted_customer_id is not null`) makes converting the same lead a
--    second time raise, as before.
--
-- 2. What else in either repo, AND in supabase/tests, reads these columns?
--    `partner_leads.record_status` — ozzo-partner's leads list (its default
--    saved-view filter), lib/leads/columns.tsx, the lead detail page and
--    PATCH /api/leads. All of them already understand `inactive`; this
--    migration makes conversion produce it.
--    `partner_tasks.lead_id` / `.customer_id` — the My Activity list, both
--    record timelines and app/api/activity. Moving a row between the two is
--    the same shape of change the activity form already makes.
--    `supabase/tests/83_partner_customers.sql` C8/C9 exercise the convert
--    function; 85_partner_convert.sql (new) covers what this adds.
--    NO new foreign key is added between any pair of tables. See
--    [orders-second-fk-broke-every-order] for why that sentence is here.
--
-- 3. New trigger / policy / constraint on a table that gets written?
--    ONE new constraint: a partial unique index on
--    partner_customers.source_lead_id. No new policy, and one new SECURITY
--    DEFINER function, `partner_finish_conversion`, which is the subject of
--    scenarios V5 and V6.
--
-- 4. Can an existing row fail the new rule?
--    The unique index can, if two customers somehow already share one source
--    lead. The convert guard made that all but impossible, but "all but" is
--    not "cannot", so section 0 CHECKS FIRST and raises a sentence naming the
--    problem rather than letting CREATE INDEX fail with a duplicate-key
--    message nobody can act on.
--    Leads already converted keep whatever
--    `record_status` they have — this does NOT retroactively retire them,
--    deliberately: a migration that moved live records out of somebody's
--    working list without being asked is exactly the kind of surprise the
--    working agreement exists to prevent. The paste doc carries the one-line
--    UPDATE to tidy them up, to run only if he wants it.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing. Only partner_* objects are touched, and no tenant has any.
--
-- ── TO UNDO ──
--    See ROLLBACK-partner-convert-retires-lead.md.
-- =====================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 0. One customer per lead, enforced
--
-- This is what replaces the FOR UPDATE lock — see the trap at the top. A
-- partial index, because `source_lead_id` is null for every customer who was
-- never a lead, and NULLs do not conflict with each other anyway.
--
-- Checked before created, so a database that already holds a duplicate gets a
-- sentence it can act on instead of "could not create unique index".
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select source_lead_id
      from public.partner_customers
     where source_lead_id is not null
     group by source_lead_id
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'Cannot continue: % lead(s) have more than one customer. Find them with: select source_lead_id, count(*) from partner_customers where source_lead_id is not null group by 1 having count(*) > 1;',
      v_dupes;
  end if;
end $$;

create unique index if not exists uq_partner_customers_source_lead
  on public.partner_customers (source_lead_id)
  where source_lead_id is not null;

comment on index public.uq_partner_customers_source_lead is
  'One customer per converted lead. Replaces a FOR UPDATE lock in partner_convert_lead_to_customer, which RLS turned into an edit_leads requirement.';

-- ─────────────────────────────────────────────────────────────────────
-- 1. The bookkeeping half of a conversion, as a definer function
--
-- WHY A DEFINER FUNCTION AT ALL, when the spec says a definer function
-- "would quietly let anybody convert anything":
--
-- This one converts nothing. It takes a lead and a customer, and refuses
-- unless that customer's `source_lead_id` is that lead — which only
-- partner_convert_lead_to_customer can have set, inside the transaction
-- that created the customer. Called directly by anybody, on any pair of
-- ids, it either raises or does exactly what the conversion it belongs to
-- would have done anyway, and a second call is a no-op because no task
-- still carries that lead_id.
--
-- What it buys is that the three writes AFTER the customer exists cannot be
-- filtered away one at a time by rights the converting role may not hold.
-- `convert_leads` is the right to convert; it should not also require
-- `edit_leads` to retire the lead and `edit_activities` to carry its work
-- across. Before this, missing either one failed in silence.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_finish_conversion(
  p_lead_id     uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
  v_won     text;
begin
  -- The only authorisation this function has, and it is enough: the customer
  -- must say it came from this lead. Nothing but the conversion writes that.
  if not exists (
    select 1 from partner_customers
     where id = p_customer_id
       and source_lead_id = p_lead_id
  ) then
    raise exception 'That customer did not come from that lead.'
      using errcode = '42501';
  end if;

  -- 'Won', if the founder's status list has one. coalesce keeps whatever the
  -- lead already said when it does not, rather than blanking the stage.
  select name into v_won
    from partner_lead_statuses
   where lower(name) = 'won' and is_active
   limit 1;

  -- THE LINE THE FOUNDER ASKED FOR. record_status = 'inactive' is what takes
  -- the lead out of the Leads list, which defaults to active rows only.
  update partner_leads
     set converted_customer_id = p_customer_id,
         converted_at  = now(),
         status        = coalesce(v_won, status),
         record_status = 'inactive',
         updated_at    = now()
   where id = p_lead_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    -- Unreachable now that this runs as definer, and kept anyway: if it ever
    -- fires, the alternative is a customer whose lead was never marked, and
    -- a silent wrong answer is worse than a loud failure.
    raise exception 'The lead could not be updated.' using errcode = '42501';
  end if;

  -- Move the open work across. `lead_id = null` as well as the new
  -- `customer_id`: nothing in the schema forbids an activity carrying both,
  -- but validateActivityInput() refuses it ("Link this to a lead or to a
  -- customer, not to both") and linkedLabel() would show the customer and
  -- silently hide the lead. One record per activity, as the app means it.
  -- The CRM's own convert function nulls `lead_id` for the same reason.
  update partner_tasks
     set lead_id     = null,
         customer_id = p_customer_id,
         updated_at  = now()
   where lead_id = p_lead_id;

  -- Copy the lead's history onto the customer, keeping each entry's own
  -- author and timestamp. The lead keeps its copy: the conversion is not a
  -- rewrite of what happened, and the lead's page still has to read.
  insert into partner_module_activities
    (user_id, module_name, record_id, action, message, created_at)
  select user_id, 'customer', p_customer_id, action, message, created_at
    from partner_module_activities
   where module_name = 'lead'
     and record_id = p_lead_id;
end;
$$;

revoke all on function public.partner_finish_conversion(uuid, uuid) from public, anon;
grant execute on function public.partner_finish_conversion(uuid, uuid) to authenticated;

comment on function public.partner_finish_conversion(uuid, uuid) is
  'The writes that follow a conversion: retire the lead, move its activities to the customer, copy its timeline. Definer, and authorised solely by partner_customers.source_lead_id matching.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. The conversion itself
--
-- STILL SECURITY INVOKER, which is the part that matters. The lead is read
-- and the customer is inserted as the caller, so partner_leads_select and
-- partner_customers_insert decide whether this person may convert this lead
-- at all. `not found` covers both "no such lead" and "not yours", and they
-- are deliberately indistinguishable.
--
-- There is deliberately NO `FOR UPDATE` here. It was in the first draft,
-- copied from the CRM, and RLS treats a locking select as an update target —
-- so it silently required `edit_leads` to convert. The unique index in
-- section 0 does that job without touching what a caller may read.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_convert_lead_to_customer(p_lead_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead     partner_leads%rowtype;
  v_customer uuid;
  v_me       uuid := partner_me();
begin
  select * into v_lead from partner_leads where id = p_lead_id;
  if not found then
    raise exception 'That lead does not exist, or you cannot see it.'
      using errcode = '42501';
  end if;

  if v_lead.converted_customer_id is not null then
    raise exception 'This lead has already been converted.' using errcode = '23505';
  end if;

  insert into partner_customers (
    company, name, phone, whatsapp, email, address, area, city, state,
    country, pincode, owner_id, collaborator_ids, became_customer_on,
    source_lead_id, notes, created_by
  ) values (
    v_lead.name,            -- the BUSINESS
    v_lead.contact_person,  -- the PERSON
    v_lead.phone, v_lead.whatsapp, v_lead.email, v_lead.address, v_lead.area,
    v_lead.city, v_lead.state, v_lead.country, v_lead.pincode,
    v_lead.owner_id, v_lead.collaborator_ids, current_date, v_lead.id,
    v_lead.notes, v_me
  )
  returning id into v_customer;

  -- Retire the lead, move its activities, copy its timeline. One call, so
  -- none of the three can be filtered away by a right this role lacks.
  perform partner_finish_conversion(p_lead_id, v_customer);

  insert into partner_module_activities (user_id, module_name, record_id, action, message)
  values (auth.uid(), 'lead', p_lead_id, 'converted',
          'Converted to customer ' || v_lead.name || ' — this lead is now Inactive');

  -- The customer's own line, written AFTER the copied history so it reads
  -- as the most recent thing to have happened.
  insert into partner_module_activities (user_id, module_name, record_id, action, message)
  values (auth.uid(), 'customer', v_customer, 'created',
          'Created by converting the lead ' || v_lead.name);

  return v_customer;
end;
$$;

revoke all on function public.partner_convert_lead_to_customer(uuid) from public, anon;
grant execute on function public.partner_convert_lead_to_customer(uuid) to authenticated;

commit;


-- =====================================================================
-- PART: Territories — Country, State, City, Area
-- file: supabase/migrations/20261126120000_partner_territories.sql
-- =====================================================================

-- =====================================================================
-- 2026-11-26 — Territories for the partner portal.
--
-- Founder's review of the partner portal, point 9, in his own words:
--
--   "Settings must have area/territory creation option just as we used to
--    create in existing OZZO. you can simply copy & paste all the
--    territories here too."
--
-- Two requests in one sentence, and this migration answers both:
--
--   (a) a territory tree the portal owns, created and edited from Settings
--       exactly as the CRM's Territory Master is; and
--   (b) a way to bring the CRM's existing tree across rather than retyping
--       India, its 36 states and its ~762 districts by hand.
--
-- ── The shape, and why it is the CRM's ──
--
-- `public.territories` (migration 101) is an adjacency list: `parent_id`,
-- `level`, a partial unique index on (parent, lower(name)), `status`, a
-- soft-delete `deleted_at`, and an `is_seed_data` flag that tells loaded
-- reference data apart from what a human typed. Every one of those earns its
-- place and the reasoning is already recorded in 101, so this table is that
-- table minus `account_id` — the portal is one organisation, OZZO itself.
--
-- `COALESCE(parent_id, '000…0')` in the unique index is the one subtlety
-- worth repeating: two children of different parents may share a name
-- ("Rajkot" the city and "Rajkot" the district are different rows), but two
-- ROOTS may not both be called India, and NULL never equals NULL, so the
-- roots have to be folded into one comparison bucket by hand.
--
-- The LEVEL NAMES are not a table. The CRM keeps them in
-- accounts.settings.territory_settings so a tenant can rename them; the
-- portal has no accounts row of its own and the founder asked for the
-- familiar four, so Country / State / City / Area are fixed in
-- ozzo-partner/lib/territories/types.ts and `level` here is just 1–4. A
-- fifth level is a migration away and nothing stores a level name, so
-- renaming one later cannot orphan data.
--
-- ── THE FIVE QUESTIONS ──
--
-- 1. What breaks if this runs twice?
--    Nothing. Every object is `if not exists` / `create or replace`, and
--    `partner_territory_copy_from_crm()` returns `skipped` the moment the
--    table already holds a copied row.
--
-- 2. What else in either repo, AND in supabase/tests, reads these columns?
--    Nothing yet — the table is new. `public.territories` is READ by the
--    copy function and never written, so no CRM screen, report or policy is
--    affected; `wacrm-web` has 41 files touching `territories` and none of
--    them can see this table. NO new foreign key is added between any
--    existing pair of tables — the only FK here is this table to itself.
--    That sentence is here because of
--    [orders-second-fk-broke-every-order], where an additive nullable FK
--    stopped PostgREST resolving an embed and broke every order screen for
--    three days.
--
-- 3. New trigger / policy / constraint on a table that gets written?
--    Four new policies and one trigger, all on this new table, so nothing
--    that exists today can start failing. The trigger is the depth guard:
--    `level` must be exactly one more than the parent's, which is what
--    stops a City being filed under a Country and makes the tree walkable
--    without a recursive query in every screen.
--
-- 4. Can an existing row fail the new rule?
--    There are no existing rows.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing. No tenant can reach this table, and the lead and customer
--    forms fall back to the distinct values already on their own records
--    when it is empty — so the portal works exactly as it does today until
--    somebody loads a tree.
--
-- ── TO UNDO ──
--    See ROLLBACK-partner-territories.md.
-- =====================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.partner_territories (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid null references public.partner_territories(id) on delete restrict,
  -- 1 Country, 2 State, 3 City, 4 Area. The names live in the app; see the
  -- note at the top about why they are not a table.
  level        int  not null check (level between 1 and 4),
  name         text not null check (btrim(name) <> ''),
  code         text null,
  status       text not null default 'active'
               check (status in ('active', 'inactive')),
  notes        text null,
  -- True for rows brought over from the CRM or loaded as reference data,
  -- false for anything a person typed. It is what lets "start again" mean
  -- "drop the loaded tree" without touching the areas somebody added by
  -- hand, and it is how the copy function stays idempotent.
  is_seed_data boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid null
);

-- Duplicate names rejected under the SAME parent, allowed under DIFFERENT
-- parents. COALESCE folds the roots into one bucket so two root "India"s
-- cannot both exist — NULL = NULL is never true, so without it the index
-- would not see them as duplicates at all.
create unique index if not exists uq_partner_territories_name_per_parent
  on public.partner_territories (
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

create index if not exists ix_partner_territories_parent
  on public.partner_territories (parent_id);
create index if not exists ix_partner_territories_level
  on public.partner_territories (level);
-- The lead and customer forms ask "every active City", so the level+status
-- pair is the hot path, not either column alone.
create index if not exists ix_partner_territories_level_status
  on public.partner_territories (level, status);

comment on table public.partner_territories is
  'OZZO''s own geography tree — Country > State > City > Area. public.territories without account_id, because the portal is one organisation.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. The depth guard
--
-- A row''s level must be exactly one more than its parent''s, and a root
-- must be level 1. Without this, nothing stops an Area being filed directly
-- under a Country: no error, and then every screen that walks the tree by
-- level disagrees with every screen that walks it by parent_id.
--
-- A BEFORE trigger rather than a CHECK, because a CHECK cannot read another
-- row. It also rejects a row that is its own parent, which is the one-row
-- case of the cycle that `prevent_manager_cycle` exists for on
-- partner_employees — and the reason that one exists is an infinite
-- recursion inside a scope walk.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_territory_check_level()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_level int;
begin
  if new.parent_id is null then
    if new.level <> 1 then
      raise exception 'A territory with no parent must be a Country (level 1), not level %.',
        new.level using errcode = '23514';
    end if;
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A territory cannot be its own parent.' using errcode = '23514';
  end if;

  select level into v_parent_level
    from partner_territories where id = new.parent_id;

  if v_parent_level is null then
    raise exception 'That parent territory does not exist.' using errcode = '23503';
  end if;

  if new.level <> v_parent_level + 1 then
    raise exception 'A level % territory cannot sit under a level % one.',
      new.level, v_parent_level using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_partner_territory_check_level on public.partner_territories;
create trigger trg_partner_territory_check_level
  before insert or update of parent_id, level on public.partner_territories
  for each row execute function public.partner_territory_check_level();

-- updated_at, the same way every other partner_* table does it.
drop trigger if exists trg_partner_territories_updated_at on public.partner_territories;
create trigger trg_partner_territories_updated_at
  before update on public.partner_territories
  for each row execute function public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Who may read and write
--
-- Read: anybody in the portal. A city name is not confidential, every lead
-- and customer form needs the list, and gating it behind a right would mean
-- a Sales Executive could not fill in an address.
--
-- Write: `manage_masters`, which is the right the other four master lists
-- already use — lead statuses, sources, industries and activity types. A
-- fifth list with a fifth rule would be a fifth thing to get wrong.
-- ─────────────────────────────────────────────────────────────────────

alter table public.partner_territories enable row level security;

drop policy if exists partner_territories_select on public.partner_territories;
create policy partner_territories_select on public.partner_territories
  for select to authenticated
  using (public.partner_me() is not null);

drop policy if exists partner_territories_insert on public.partner_territories;
create policy partner_territories_insert on public.partner_territories
  for insert to authenticated
  with check (public.partner_has_right('manage_masters'));

drop policy if exists partner_territories_update on public.partner_territories;
create policy partner_territories_update on public.partner_territories
  for update to authenticated
  using (public.partner_has_right('manage_masters'))
  with check (public.partner_has_right('manage_masters'));

-- No DELETE policy, on purpose and for the same reason the master lists have
-- none: a lead stores its city BY NAME, so removing a territory would leave
-- existing records showing a value that is in no dropdown and no filter.
-- Retiring is `status = 'inactive'`, which the UPDATE policy covers.

revoke all on table public.partner_territories from anon;
grant select on table public.partner_territories to authenticated;
grant insert, update on table public.partner_territories to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. "you can simply copy & paste all the territories here too"
--
-- The CRM's tree and this one live in the same Postgres database, so the
-- copy is one INSERT … SELECT per level rather than a thousand rows pushed
-- up from a browser. That is the whole reason this is a function and not a
-- button that posts JSON.
--
-- WHICH account's tree? The one with the most active territories. Prod holds
-- the founder's own tenant plus the four demo tenants, and the real tree is
-- the big one — the demo accounts carry whatever their seed gave them. It is
-- decided here rather than passed in so that nobody has to know an account
-- id, and `p_account_id` is there for the case where the guess is wrong.
--
-- SECURITY DEFINER because it reads `public.territories`, which is
-- account-scoped by RLS and which no partner employee is a member of — a
-- partner employee has no `profiles` row at all, by design. The right is
-- checked FIRST, on the caller's own session, exactly as every API route in
-- the portal does it.
--
-- Idempotent: a second run finds seed rows and does nothing. That matters
-- because this is pasted into the SQL editor by hand and may well be run
-- twice.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_territory_copy_from_crm(
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account    uuid;
  v_countries  int := 0;
  v_states     int := 0;
  v_cities     int := 0;
  v_areas      int := 0;
begin
  if not public.partner_has_right('manage_masters') then
    raise exception 'You cannot change the master lists.' using errcode = '42501';
  end if;

  if exists (select 1 from partner_territories where is_seed_data) then
    return jsonb_build_object('ok', true, 'skipped', true,
      'reason', 'The territories have already been copied.');
  end if;

  -- The account with the most live territories, which is the real tree.
  v_account := coalesce(
    p_account_id,
    (select t.account_id
       from territories t
      where t.deleted_at is null and t.status = 'active'
      group by t.account_id
      order by count(*) desc, t.account_id
      limit 1)
  );

  if v_account is null then
    return jsonb_build_object('ok', true, 'skipped', true,
      'reason', 'There are no territories in the CRM to copy.');
  end if;

  -- One level at a time, parents before children, so every child has a
  -- parent_id to point at and the depth trigger is satisfied as it goes.
  --
  -- `crm_id` carries the source row's id through each step purely so the
  -- next level can find its parent. It is not stored: a copied tree is the
  -- portal's own from the moment it lands, and a column pointing into an
  -- account-scoped table would be a second route to tenant data.
  -- A scratch map from each CRM row to its copy, so the next level down can
  -- find its parent. `on commit drop` ties it to the calling transaction;
  -- the explicit drop first is for the case where this function is called
  -- twice inside one transaction, where CREATE would otherwise fail with
  -- "relation already exists" and read as a broken copy.
  drop table if exists partner_tcopy;
  create temporary table partner_tcopy (
    crm_id    uuid primary key,
    new_id    uuid not null,
    level     int  not null
  ) on commit drop;

  -- Level 1 — countries.
  with src as (
    select t.id, t.name, t.code
      from territories t
     where t.account_id = v_account
       and t.deleted_at is null
       and t.level = 1
  ), ins as (
    insert into partner_territories (parent_id, level, name, code, status, is_seed_data)
    select null, 1, src.name, src.code, 'active', true
      from src
    -- A tree copied onto a tree somebody has already started by hand: keep
    -- what is there rather than failing the whole copy on one clash.
    on conflict do nothing
    returning id, lower(name) as lname
  )
  insert into partner_tcopy (crm_id, new_id, level)
  select src.id, coalesce(ins.id, existing.id), 1
    from src
    left join ins on ins.lname = lower(src.name)
    left join partner_territories existing
           on existing.parent_id is null and lower(existing.name) = lower(src.name)
   where coalesce(ins.id, existing.id) is not null;
  select count(*) into v_countries from partner_tcopy where level = 1;

  -- Levels 2, 3 and 4 — states, cities, areas. The same step three times,
  -- written out rather than looped: a loop would have to build the INSERT as
  -- text and EXECUTE it, and dynamic SQL inside a SECURITY DEFINER function
  -- is not worth saving thirty lines.

  -- Level 2 — states.
  with src as (
    select t.id, t.name, t.code, t.parent_id
      from territories t
     where t.account_id = v_account and t.deleted_at is null and t.level = 2
  ), ins as (
    insert into partner_territories (parent_id, level, name, code, status, is_seed_data)
    select p.new_id, 2, src.name, src.code, 'active', true
      from src join partner_tcopy p on p.crm_id = src.parent_id and p.level = 1
    on conflict do nothing
    returning id, parent_id, lower(name) as lname
  )
  insert into partner_tcopy (crm_id, new_id, level)
  select src.id, coalesce(ins.id, existing.id), 2
    from src
    join partner_tcopy p on p.crm_id = src.parent_id and p.level = 1
    left join ins on ins.parent_id = p.new_id and ins.lname = lower(src.name)
    left join partner_territories existing
           on existing.parent_id = p.new_id and lower(existing.name) = lower(src.name)
   where coalesce(ins.id, existing.id) is not null
  on conflict (crm_id) do nothing;
  select count(*) into v_states from partner_tcopy where level = 2;

  -- Level 3 — cities.
  with src as (
    select t.id, t.name, t.code, t.parent_id
      from territories t
     where t.account_id = v_account and t.deleted_at is null and t.level = 3
  ), ins as (
    insert into partner_territories (parent_id, level, name, code, status, is_seed_data)
    select p.new_id, 3, src.name, src.code, 'active', true
      from src join partner_tcopy p on p.crm_id = src.parent_id and p.level = 2
    on conflict do nothing
    returning id, parent_id, lower(name) as lname
  )
  insert into partner_tcopy (crm_id, new_id, level)
  select src.id, coalesce(ins.id, existing.id), 3
    from src
    join partner_tcopy p on p.crm_id = src.parent_id and p.level = 2
    left join ins on ins.parent_id = p.new_id and ins.lname = lower(src.name)
    left join partner_territories existing
           on existing.parent_id = p.new_id and lower(existing.name) = lower(src.name)
   where coalesce(ins.id, existing.id) is not null
  on conflict (crm_id) do nothing;
  select count(*) into v_cities from partner_tcopy where level = 3;

  -- Level 4 — areas.
  with src as (
    select t.id, t.name, t.code, t.parent_id
      from territories t
     where t.account_id = v_account and t.deleted_at is null and t.level = 4
  ), ins as (
    insert into partner_territories (parent_id, level, name, code, status, is_seed_data)
    select p.new_id, 4, src.name, src.code, 'active', true
      from src join partner_tcopy p on p.crm_id = src.parent_id and p.level = 3
    on conflict do nothing
    returning id, parent_id, lower(name) as lname
  )
  insert into partner_tcopy (crm_id, new_id, level)
  select src.id, coalesce(ins.id, existing.id), 4
    from src
    join partner_tcopy p on p.crm_id = src.parent_id and p.level = 3
    left join ins on ins.parent_id = p.new_id and ins.lname = lower(src.name)
    left join partner_territories existing
           on existing.parent_id = p.new_id and lower(existing.name) = lower(src.name)
   where coalesce(ins.id, existing.id) is not null
  on conflict (crm_id) do nothing;
  select count(*) into v_areas from partner_tcopy where level = 4;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'countries', v_countries,
    'states', v_states,
    'cities', v_cities,
    'areas', v_areas
  );
end;
$$;

revoke all on function public.partner_territory_copy_from_crm(uuid) from public, anon;
grant execute on function public.partner_territory_copy_from_crm(uuid) to authenticated;

comment on function public.partner_territory_copy_from_crm(uuid) is
  'Copies the CRM''s territory tree into partner_territories, parents first. Definer because it reads account-scoped territories; manage_masters is checked on the caller''s own session first. Idempotent.';

commit;


```

## Then run this to check it worked

Paste this into a **new query** and press **Run**. It changes nothing — it only looks.

```sql
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('partner_activity_types','partner_task_assignees',
                         'partner_territories'))                       as new_tables,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'partner_tasks'
      and column_name in ('title','description','activity_type',
                          'start_date','reminder_date','reminder_time')) as activity_columns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('partner_convert_lead_to_customer',
                        'partner_finish_conversion',
                        'partner_territory_copy_from_crm',
                        'partner_territory_check_level'))               as functions,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'partner_territories')  as territory_rules,
  (select count(*) from pg_trigger
    where not tgisinternal
      and tgname in ('trg_partner_territory_check_level',
                     'trg_partner_territories_updated_at'))             as territory_triggers,
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname = 'uq_partner_customers_source_lead')               as one_customer_per_lead,
  case
    when (select count(*) from information_schema.tables
           where table_schema = 'public'
             and table_name in ('partner_activity_types','partner_task_assignees',
                                'partner_territories')) = 3
     and (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'partner_tasks'
             and column_name in ('title','description','activity_type',
                                 'start_date','reminder_date','reminder_time')) = 6
     and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('partner_convert_lead_to_customer',
                               'partner_finish_conversion',
                               'partner_territory_copy_from_crm',
                               'partner_territory_check_level')) = 4
     and (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'partner_territories') = 3
     and (select count(*) from pg_trigger
           where not tgisinternal
             and tgname in ('trg_partner_territory_check_level',
                            'trg_partner_territories_updated_at')) = 2
     and (select count(*) from pg_indexes
           where schemaname = 'public'
             and indexname = 'uq_partner_customers_source_lead') = 1
    then 'ok'
    else 'SOMETHING IS MISSING - send this whole row back'
  end as verdict;
```

Expected: `3 | 6 | 4 | 3 | 2 | 1 | ok`.

What each number is:

- **new_tables 3** — the activity types list, the one holding who is on each activity, and the new territories table.
- **activity_columns 6** — the six columns My Activity reads on an activity.
- **functions 4** — converting a lead, the bookkeeping that follows it, the copy-from-CRM, and the rule that keeps a city under a state.
- **territory_rules 3** — who may read territories (everyone in the portal) and who may add or change them (whoever holds "Edit the master lists").
- **territory_triggers 2** — the level rule, and the one that stamps the time whenever a territory is edited.
- **one_customer_per_lead 1** — the rule that stops two quick clicks on **Convert to Customer** creating the same customer twice.

If the verdict is not `ok`, send the whole row back — nothing else needs doing.

## If the block stops with a message about duplicates

It will say something like *"Cannot continue: 2 lead(s) have more than one customer"* and change nothing. That means two customers were somehow created from one lead before today. Run the query it gives you, send me the result, and I will tell you which to keep — it is not something to guess at, because one of them has the invoices attached.

## Optional: tidy up the leads you converted before today

From now on, converting a lead retires it automatically. The leads you converted **before** running this are deliberately left where they are: a script that moved live records out of your working list without being asked is exactly the kind of surprise we agreed to avoid.

If you would like them tidied up, run this. It only touches leads that already have a customer:

```sql
update public.partner_leads
   set record_status = 'inactive',
       updated_at = now()
 where converted_customer_id is not null
   and record_status = 'active';
```

It will tell you how many rows it changed. If it says `UPDATE 0`, there were none to tidy.

## Then tell me

Once the check says `ok`:

- **My Activity** works, with the Apply button and the CRM's filter bar.
- **Converting a lead** takes it out of the Leads list and carries its work across.
- **Settings → Territories** is there. Press **Copy from OZZO CRM** once to bring your existing list across.
