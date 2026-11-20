# RUN THIS IN SUPABASE — Partner Portal foundation

**What it does:** creates the two tables the partner portal needs (staff and
roles), the three functions that decide who may do what and whose records they
may see, two safety triggers, the row-level security policies, the four
starting roles, and your own Super Admin account.

**What it does NOT touch:** nothing that exists today. No tenant table, no
column, no policy, no function. A CRM user, a mobile user and a DMS user cannot
observe this change at all.

**Where:** the Supabase dashboard for the Mumbai project
(`ltigfpywdbfilsagtpyd`) → SQL Editor → paste → Run.

> The Supabase CLI on this machine is still linked to the old Singapore
> project, so `db push` would write to the wrong database. Pasting is the
> route. The same SQL is committed as
> `supabase/migrations/20261120120000_partner_portal_foundation.sql`.

It is wrapped in `begin; … commit;` — if any part of it fails, none of it is
applied, and you can simply fix and run it again. It is also safe to run twice.

---

## 1. Paste and run this

```sql
-- =====================================================================
-- Partner Portal foundation: staff, roles, rights, hierarchy.
--
-- A partner employee is an OZZO salesperson. They are an auth.users row plus a
-- partner_employees row, and deliberately NOT a profiles row: `profiles` means
-- "an employee of a tenant account" to 107 web files and 56 database
-- functions, which feed employee dropdowns, headcounts, incentive calculations
-- and account_id RLS. An OZZO salesperson in there surfaces in a customer's
-- team list the first time one of those places forgets to ask.
--
-- Additive and reversible. See ROLLBACK-partner-portal.md.
--
-- ---------------------------------------------------------------------
-- THE FIVE QUESTIONS (working agreement, 2026-11-06)
-- ---------------------------------------------------------------------
-- 1. Is this a SECOND foreign key between two tables that already have one?
--    No new FK between any existing pair. Two new tables; the only self-
--    reference is partner_employees.manager_id, and it is the ONLY one on
--    purpose: `created_by` is a bare uuid with no FK precisely because a
--    second self-reference makes every PostgREST embed of the table
--    ambiguous. That is what 404'd every order screen for three days when
--    orders.parent_contact_id became the second FK to contacts (88de60d).
--    partner_employees -> partner_roles is also single, which is what lets
--    `partner_roles(name, permissions, data_scope)` embed at all.
--
-- 2. Does a touched column appear in a .select() string in either repo?
--    No column is touched. Nothing existed before this migration, so no
--    select string in wacrm-web, wacrm-mobile, ozzo-dms or ozzo-partner can
--    be referring to any of it. Verified: `grep -rn "partner_employees\|
--    partner_roles" wacrm-web/src wacrm-mobile` returns nothing.
--
-- 3. New trigger / policy / constraint on a table that gets written?
--    Yes, all three, on two brand-new tables:
--      - trg_partner_prevent_manager_cycle (BEFORE INSERT OR UPDATE OF
--        manager_id) — without it a loop makes partner_scope_ids() recurse
--        until the connection dies.
--      - trg_partner_roles_protect_system — stops the built-in Super Admin
--        role being emptied or deleted, which would lock the founder out of
--        his own portal.
--      - five RLS policies.
--    Each is exercised by supabase/tests/80_partner_rights.sql, which is in
--    the runner's scenario list.
--
-- 4. Can an existing row fail the new rule?
--    There are no existing rows. The seeds are the first rows and are written
--    by this migration, so they satisfy every constraint by construction.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing, and that is load-bearing. These tables are not referenced by
--    any tenant-facing query, policy or function; `accounts`, `profiles`,
--    `leads`, `contacts` and every other existing object are untouched. A CRM
--    user, a mobile user and a DMS user cannot observe this migration at all.
--    The only visible change anywhere is in the partner portal, which does
--    not exist for them.
-- =====================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.partner_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  -- Same shape as employee_roles.permissions: a JSON OBJECT of key -> true,
  -- with {"all": true} as the wildcard. Keeping the shape identical is what
  -- lets the CRM's roles screen and has_permission()'s resolution rules be
  -- copied rather than reinvented.
  permissions jsonb not null default '{}'::jsonb,
  data_scope  text not null default 'own'
              check (data_scope in ('own', 'team', 'all')),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists uq_partner_roles_name
  on public.partner_roles (lower(name));

create table if not exists public.partner_employees (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  phone       text,
  designation text,
  -- ON DELETE RESTRICT: deleting a role out from under staff would leave them
  -- signed in with no rights at all, which looks like a broken portal rather
  -- than like a deleted role. The screen reports 23503 as "move them first".
  role_id     uuid references public.partner_roles(id) on delete restrict,
  manager_id  uuid references public.partner_employees(id) on delete set null,
  status      text not null default 'active'
              check (status in ('active', 'inactive')),
  joined_on   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Intentionally NOT a foreign key. See question 1 above: manager_id is
  -- already a self-reference, and a second one makes every PostgREST embed of
  -- this table ambiguous.
  created_by  uuid
);

create unique index if not exists uq_partner_employees_email
  on public.partner_employees (lower(email));
create index if not exists ix_partner_employees_manager
  on public.partner_employees (manager_id);
create index if not exists ix_partner_employees_role
  on public.partner_employees (role_id);

comment on table public.partner_employees is
  'OZZO''s own sales staff for the partner portal. NOT tenant employees - those are profiles.';
comment on column public.partner_employees.created_by is
  'partner_employees.id of whoever added this person. Deliberately not a FK: a second self-reference breaks PostgREST embedding.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Helpers
-- ─────────────────────────────────────────────────────────────────────

-- Who am I. Inactive staff resolve to NULL, so deactivating somebody removes
-- them from every screen at once rather than only from the employees list.
create or replace function public.partner_me()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select e.id
  from public.partner_employees e
  where e.user_id = auth.uid()
    and e.status = 'active'
  limit 1
$$;

-- May I. The same four rules, in the same order, as public.has_permission():
-- an inactive employee is denied outright, then {"all":true}, then the exact
-- key, then the verb wildcard ('view_leads' is granted by 'view_*').
--
-- Note that `permissions ->> key = 'true'` is satisfied by both a jsonb
-- boolean true and the jsonb string "true" — ->> renders either as the text
-- `true`. lib/auth/rights.ts mirrors that exactly; a stricter mirror would
-- hide menu items this function allows.
create or replace function public.partner_has_right(p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.partner_employees e
    left join public.partner_roles r on r.id = e.role_id
    where e.user_id = auth.uid()
      and e.status = 'active'
      and (
        (r.permissions ->> 'all') = 'true'
        or (r.permissions ->> p_key) = 'true'
        or (r.permissions ->> (split_part(p_key, '_', 1) || '_*')) = 'true'
      )
  )
$$;

-- Whose records may I see. The role's data_scope decides:
--   own  -> just me
--   team -> me and everyone below me, however deep
--   all  -> everybody
--
-- plpgsql rather than sql because of the recursive walk. search_path is
-- `public` rather than '' so the recursive CTE can name the table unqualified
-- in both branches; every reference below is to a table in public.
create or replace function public.partner_scope_ids()
returns setof uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me    uuid;
  v_scope text;
begin
  select e.id, coalesce(r.data_scope, 'own')
    into v_me, v_scope
  from partner_employees e
  left join partner_roles r on r.id = e.role_id
  where e.user_id = auth.uid()
    and e.status = 'active'
  limit 1;

  if v_me is null then
    return;                      -- not portal staff: sees nothing at all
  end if;

  if v_scope = 'all' then
    return query select e.id from partner_employees e;
  elsif v_scope = 'team' then
    return query
      with recursive down as (
        select v_me as id
        union
        select e.id
        from partner_employees e
        join down d on e.manager_id = d.id
      )
      select id from down;
  else
    return query select v_me;
  end if;
end;
$$;

revoke all on function public.partner_me() from public, anon;
revoke all on function public.partner_has_right(text) from public, anon;
revoke all on function public.partner_scope_ids() from public, anon;
grant execute on function public.partner_me() to authenticated;
grant execute on function public.partner_has_right(text) to authenticated;
grant execute on function public.partner_scope_ids() to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. The reporting-loop guard
--
-- A copy of public.prevent_manager_cycle() from 106_reporting_hierarchy.sql,
-- retargeted. Without it, A -> B -> A makes partner_scope_ids() recurse until
-- the connection dies, and the symptom is a hung screen rather than an error.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_prevent_manager_cycle()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_cur   uuid;
  v_depth int := 0;
  v_name  text;
begin
  if NEW.manager_id is null then return NEW; end if;

  if NEW.manager_id = NEW.id then
    raise exception 'An employee cannot report to themselves.'
      using errcode = '23514';
  end if;

  v_cur := NEW.manager_id;
  while v_cur is not null and v_depth < 10000 loop
    if v_cur = NEW.id then
      select full_name into v_name from partner_employees where id = NEW.id;
      raise exception 'Reporting loop: % would end up reporting to themselves through this manager.',
        coalesce(v_name, NEW.id::text) using errcode = '23514';
    end if;
    select manager_id into v_cur from partner_employees where id = v_cur;
    v_depth := v_depth + 1;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_partner_prevent_manager_cycle on public.partner_employees;
create trigger trg_partner_prevent_manager_cycle
  before insert or update of manager_id on public.partner_employees
  for each row execute function public.partner_prevent_manager_cycle();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Protect the built-in role
--
-- Emptying the Super Admin role's rights, or deleting it, locks the founder
-- out of his own portal with no way back in through the UI.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_roles_protect_system()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.is_system then
      raise exception 'The % role is built in and cannot be deleted.', OLD.name
        using errcode = '23514';
    end if;
    return OLD;
  end if;

  if OLD.is_system and (NEW.permissions is distinct from OLD.permissions
                        or NEW.data_scope is distinct from OLD.data_scope
                        or NEW.is_system is distinct from OLD.is_system) then
    raise exception 'The % role''s rights are built in and cannot be changed.', OLD.name
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_partner_roles_protect_system on public.partner_roles;
create trigger trg_partner_roles_protect_system
  before update or delete on public.partner_roles
  for each row execute function public.partner_roles_protect_system();

-- ─────────────────────────────────────────────────────────────────────
-- 5. RLS
--
-- The portal's screens read these tables directly through the anon key, so
-- these policies ARE the enforcement. Hiding a sidebar link while the row
-- still fetches is the shape of bug that made RBAC UI-only once already.
-- ─────────────────────────────────────────────────────────────────────

alter table public.partner_roles     enable row level security;
alter table public.partner_employees enable row level security;

-- Roles: every portal member may read them — the sidebar needs the caller's
-- own rights, and the employee form needs the role dropdown. Only
-- manage_roles may write.
drop policy if exists partner_roles_select on public.partner_roles;
create policy partner_roles_select on public.partner_roles
  for select to authenticated
  using (public.partner_me() is not null);

drop policy if exists partner_roles_write on public.partner_roles;
create policy partner_roles_write on public.partner_roles
  for all to authenticated
  using (public.partner_has_right('manage_roles'))
  with check (public.partner_has_right('manage_roles'));

-- Employees, three policies that OR together:
--
--   self   — always your own row. Without this a Telecaller with no
--            view_employees could not boot the app at all, because the gate
--            reads this table to find out who they are.
--   scope  — view_employees, limited to partner_scope_ids(): a manager sees
--            their team, an executive sees themselves.
--   write  — manage_employees. FOR ALL covers SELECT too, which is
--            deliberate: an administrator who cannot see everybody cannot
--            assign a manager, and managing staff is company-wide by nature.
drop policy if exists partner_employees_select_self on public.partner_employees;
create policy partner_employees_select_self on public.partner_employees
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists partner_employees_select_scope on public.partner_employees;
create policy partner_employees_select_scope on public.partner_employees
  for select to authenticated
  using (
    public.partner_has_right('view_employees')
    and id in (select public.partner_scope_ids())
  );

drop policy if exists partner_employees_write on public.partner_employees;
create policy partner_employees_write on public.partner_employees
  for all to authenticated
  using (public.partner_has_right('manage_employees'))
  with check (public.partner_has_right('manage_employees'));

-- ─────────────────────────────────────────────────────────────────────
-- 6. The four seeded roles
--
-- Super Admin is the only is_system role. Note what the others do NOT get:
-- Invoices, Forecast, Renew and Send start as Super Admin only, and are handed
-- out deliberately rather than by default.
-- ─────────────────────────────────────────────────────────────────────

insert into public.partner_roles (name, description, permissions, data_scope, is_system)
values
  ('Super Admin',
   'The platform owner. Every right, every record.',
   '{"all": true}'::jsonb,
   'all', true),

  ('Sales Manager',
   'Runs a sales team. Sees their own work and their team''s.',
   '{"view_dashboard": true,
     "view_leads": true, "create_leads": true, "edit_leads": true,
     "delete_leads": true, "convert_leads": true, "assign_leads": true,
     "import_leads": true, "export_leads": true,
     "view_customers": true, "create_customers": true, "edit_customers": true,
     "export_customers": true,
     "view_activities": true, "create_activities": true,
     "edit_activities": true, "delete_activities": true,
     "view_team_activities": true,
     "view_proposals": true, "create_proposals": true,
     "view_renewals": true, "view_calculator": true,
     "view_discovery": true, "push_discovery_to_leads": true,
     "view_tickets": true, "create_tickets": true, "edit_tickets": true,
     "assign_tickets": true,
     "view_employees": true, "view_roles": true}'::jsonb,
   'team', false),

  ('Sales Executive',
   'Sells. Sees only their own records.',
   '{"view_dashboard": true,
     "view_leads": true, "create_leads": true, "edit_leads": true,
     "convert_leads": true, "export_leads": true,
     "view_customers": true, "create_customers": true, "edit_customers": true,
     "view_activities": true, "create_activities": true, "edit_activities": true,
     "view_proposals": true, "view_calculator": true,
     "view_tickets": true, "create_tickets": true}'::jsonb,
   'own', false),

  ('Telecaller',
   'Calls and qualifies. Leads and activity only.',
   '{"view_dashboard": true,
     "view_leads": true, "create_leads": true, "edit_leads": true,
     "view_activities": true, "create_activities": true, "edit_activities": true,
     "create_tickets": true}'::jsonb,
   'own', false)
on conflict (lower(name)) do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- 7. The founder, as Super Admin
--
-- Matched by email so no UUID is hard-coded. The address is the one already
-- in wacrm-web/src/lib/auth/founder.ts. If auth.users holds a different
-- address, this inserts nothing and the verification query below returns zero
-- rows — which is the point of running it.
-- ─────────────────────────────────────────────────────────────────────

insert into public.partner_employees (user_id, full_name, email, role_id, status, joined_on)
select u.id, 'Sumit Vegad', u.email, r.id, 'active', current_date
from auth.users u
cross join public.partner_roles r
where lower(u.email) = 'sumitvegad07@gmail.com'
  and r.name = 'Super Admin'
on conflict (user_id) do nothing;

commit;
```

---

## 2. Then run these five checks

Do not treat the portal as working until checks 2 and 4 pass. They are the two
that fail silently otherwise.

```sql
-- 1. Four roles, Super Admin wildcarded and the only built-in one.
select name, data_scope, is_system, permissions ->> 'all' as wildcard
from public.partner_roles order by is_system desc, name;
-- Expect 4 rows. Super Admin / all / true / true.
```

```sql
-- 2. You are in, as Super Admin.
select e.full_name, e.email, e.status, r.name as role
from public.partner_employees e
join public.partner_roles r on r.id = e.role_id;
-- Expect exactly 1 row: you.
-- If 0, the email in auth.users is not sumitvegad07@gmail.com. Find yours with
--   select email from auth.users order by created_at limit 20;
-- and tell me which it is — the seed needs changing, not working around.
```

```sql
-- 3. Row-level security is on, with policies, on both tables.
select c.relname, c.relrowsecurity as rls_on, count(p.polname) as policies
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname in ('partner_roles', 'partner_employees')
group by c.relname, c.relrowsecurity;
-- Expect: partner_employees | t | 3   and   partner_roles | t | 2
```

```sql
-- 4. Exactly ONE foreign key from the staff table to itself.
select count(*) as self_fks from pg_constraint
where conrelid = 'public.partner_employees'::regclass
  and confrelid = 'public.partner_employees'::regclass
  and contype = 'f';
-- Expect 1.
-- A 2 here means `created_by` was given a foreign key, and every query against
-- this table will start returning "not found" — the same fault that broke
-- every order screen for three days in November.
```

```sql
-- 5. The reporting-loop guard actually bites.
do $$
declare v_a uuid;
begin
  select id into v_a from public.partner_employees limit 1;
  begin
    update public.partner_employees set manager_id = v_a where id = v_a;
    raise exception 'FAIL: an employee was allowed to report to themselves';
  exception when check_violation then
    raise notice 'PASS: self-management refused';
  end;
end $$;
-- Expect the notice: PASS: self-management refused
```

---

## 3. If you need to undo it

See `supabase/migrations/ROLLBACK-partner-portal.md`. Nothing else in the
database depends on these tables, so the rollback is clean.
