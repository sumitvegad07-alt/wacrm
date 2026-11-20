# RUN THIS IN SUPABASE — Partner Portal Phase 2

**What it does:** adds the eight tables the Leads module needs — leads,
customers, activity, your three master lists (lead statuses, sources,
industries), plus two small tables that remember each person's saved views and
which rows they have already opened.

**What it does NOT touch:** nothing that exists today. No tenant table, no
column, no policy, no function. Your CRM, the mobile app and the DMS portal
cannot see this change at all.

**Where:** the Supabase dashboard for the Mumbai project
(`ltigfpywdbfilsagtpyd`) → SQL Editor → paste → Run.

It is wrapped in `begin; … commit;` — if any part fails, none of it is applied,
and you can fix and run it again. It is also safe to run twice.

**The important rule it enforces:** no two of these tables have more than one
link between them. That sounds like a technical detail and is not — two links
between the same pair is what made every order screen say "not found" for three
days in November. Check 3 below is there to prove it.

---

## ⚠ NOT READY TO RUN YET

The database harness has been run against this migration once. The SQL itself
applied cleanly — 317 migrations, no new errors — but four of the test
scenarios failed, and the cause turned out to be faults in the **tests**, not
in this SQL: a delete or update that matches no row raises no error in
Postgres, so three "must be refused" checks were passing nothing through and
reporting success either way.

Those four scenarios have been corrected and **have not been re-run**. Please
wait for that run before pasting this. It costs twenty minutes and is the
difference between "the scoping works" and "the scoping was never actually
tested".

## 1. Paste and run this

```sql
-- =====================================================================
-- Partner Portal Phase 2: leads, customers, activity, the master lists,
-- saved table views and unseen-record tracking.
--
-- One migration for all of it so the founder pastes once. Additive and
-- reversible. See ROLLBACK-partner-portal-phase2.md.
--
-- ---------------------------------------------------------------------
-- THE FIVE QUESTIONS (working agreement, 2026-11-06)
-- ---------------------------------------------------------------------
-- 1. A SECOND foreign key between two tables that already have one?
--    No. Checked pair by pair, because this migration adds eight tables
--    that reference each other and it is the easiest place to get wrong:
--      leads -> employees (owner_id)              1
--      leads -> customers (converted_customer_id) 1
--      customers -> employees (owner_id)          1
--      customers -> accounts (account_id)         1
--      tasks -> employees (assignee_id)           1
--      tasks -> leads / tasks -> customers        1 each
--      table_views -> auth.users                  1
--      record_views -> auth.users                 1
--    `created_by` is a bare uuid on every table, and
--    `partner_customers.source_lead_id` is a bare uuid TOO - leads and
--    customers already have one FK between them in the other direction,
--    and a second, even pointing the other way, makes PostgREST ambiguous
--    about which relationship an embed of that pair means. That is the
--    fault that 404'd every order for three days (88de60d).
--    81_partner_leads.sql asserts the count for every pair.
--
-- 2. Does a touched column appear in a .select() string in either repo?
--    No existing column is touched. Eight new tables; `accounts` is only
--    referenced by a foreign key, never altered.
--
-- 3. New trigger / policy / constraint on a table that gets written?
--    Yes, on new tables only: 20 RLS policies, record_status checks on
--    leads and customers, kind/priority/status checks on tasks, a partial
--    unique index on customers.account_id, and partner_distinct_values'
--    allowlist. All exercised by supabase/tests/81_partner_leads.sql.
--
-- 4. Can an existing row fail the new rule?
--    There are no existing rows. The master seeds are the first rows and
--    are written here.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing. No tenant-facing query, policy or function references any of
--    these tables. A CRM, mobile or DMS user cannot observe this migration.
-- =====================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. The three lists the founder controls from Settings
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.partner_lead_statuses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  colour     text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_partner_lead_statuses_name
  on public.partner_lead_statuses (lower(name));

create table if not exists public.partner_lead_sources (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_partner_lead_sources_name
  on public.partner_lead_sources (lower(name));

create table if not exists public.partner_industries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_partner_industries_name
  on public.partner_industries (lower(name));

-- ─────────────────────────────────────────────────────────────────────
-- 2. Customers, leads and activity
--
-- ORDER IS LOAD-BEARING: partner_leads.converted_customer_id references
-- partner_customers, so customers is created first. Statuses, sources and
-- industries are stored on the lead BY NAME, not by id, exactly as the CRM's
-- own leads table does - so renaming a master in Settings does not retro-
-- rename history, which is the behaviour the founder already expects.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.partner_customers (
  id             uuid primary key default gen_random_uuid(),
  business_name  text not null,
  account_id     uuid references public.accounts(id) on delete set null,
  contact_person text,
  phone          text,
  email          text,
  city           text,
  state          text,
  gstin          text,
  plan           text,
  billing_term   text,
  owner_id       uuid not null references public.partner_employees(id) on delete restrict,
  became_customer_on date,
  -- Bare uuid. partner_leads.converted_customer_id is already the one foreign
  -- key between these two tables; a second, even in the other direction, makes
  -- every PostgREST embed of the pair ambiguous.
  source_lead_id uuid,
  notes          text,
  record_status  text not null default 'active'
                 check (record_status in ('active', 'inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid
);
-- One portal customer per real account, but many customers may have none yet.
create unique index if not exists uq_partner_customers_account
  on public.partner_customers (account_id) where account_id is not null;
create index if not exists ix_partner_customers_owner
  on public.partner_customers (owner_id);

create table if not exists public.partner_leads (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  company        text,
  contact_person text,
  phone          text,
  email          text,
  status         text,
  source         text,
  industry       text,
  owner_id       uuid not null references public.partner_employees(id) on delete restrict,
  est_value      numeric(14,2),
  expected_close date,
  next_follow_up date,
  address        text,
  area           text,
  city           text,
  state          text,
  country        text,
  pincode        text,
  notes          text,
  -- Bare uuid, not an FK: Phase 3 fills it from re_discovery_leads, and a
  -- cross-module foreign key would couple this table to the Revenue Engine's
  -- purge schedule for nothing but provenance.
  discovery_lead_id     uuid,
  converted_customer_id uuid references public.partner_customers(id) on delete set null,
  converted_at   timestamptz,
  record_status  text not null default 'active'
                 check (record_status in ('active', 'inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid
);
create index if not exists ix_partner_leads_owner   on public.partner_leads (owner_id);
create index if not exists ix_partner_leads_status  on public.partner_leads (status);
create index if not exists ix_partner_leads_phone   on public.partner_leads (phone);
create index if not exists ix_partner_leads_created on public.partner_leads (created_at desc);

create table if not exists public.partner_tasks (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'Task'
               check (kind in ('Task','Call','Visit','Meeting','Follow up','Note')),
  subject      text not null,
  detail       text,
  due_date     date,
  due_time     time,
  priority     text not null default 'Medium'
               check (priority in ('Low','Medium','High','Urgent')),
  status       text not null default 'Undone'
               check (status in ('Undone','Done')),
  completed_at timestamptz,
  assignee_id  uuid not null references public.partner_employees(id) on delete restrict,
  lead_id      uuid references public.partner_leads(id) on delete cascade,
  customer_id  uuid references public.partner_customers(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid
);
create index if not exists ix_partner_tasks_assignee on public.partner_tasks (assignee_id);
create index if not exists ix_partner_tasks_due      on public.partner_tasks (due_date);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Per-person table preferences
-- ─────────────────────────────────────────────────────────────────────

-- Saved views, per person. Same shape as public.table_views minus account_id.
create table if not exists public.partner_table_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  table_key  text not null,
  name       text not null,
  -- { filters: {...}, columns: { active: [...], visible: [...] } | null, pageSize: int | null }
  config     jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_table_views_name_not_blank check (btrim(name) <> '')
);
create unique index if not exists uq_partner_table_views_name
  on public.partner_table_views (user_id, table_key, lower(name));

-- Which rows a person has already opened, for the new-entry highlight.
create table if not exists public.partner_record_views (
  user_id     uuid not null references auth.users(id) on delete cascade,
  module_name text not null,
  record_id   uuid not null,
  viewed_at   timestamptz not null default now(),
  primary key (user_id, module_name, record_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Values for a `select` filter on a free-text column
--
-- The CRM serves these from an API route with a hard-coded allowlist. Here it
-- is a function, so the allowlist and the scoping live in the same place as
-- the policies rather than in a second place that can drift. The allowlist IS
-- the branching below: a module/column pair that is not named here raises, and
-- nothing is ever interpolated into SQL. Results respect the caller's scope,
-- so an executive's City filter offers only the cities in their own leads.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_distinct_values(p_module text, p_column text)
returns setof text
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_module = 'lead' then
    if p_column = 'company' then
      return query select distinct l.company from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.company), '') is not null
        order by 1 limit 500;
      return;
    elsif p_column = 'city' then
      return query select distinct l.city from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.city), '') is not null
        order by 1 limit 500;
      return;
    elsif p_column = 'state' then
      return query select distinct l.state from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.state), '') is not null
        order by 1 limit 500;
      return;
    elsif p_column = 'area' then
      return query select distinct l.area from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.area), '') is not null
        order by 1 limit 500;
      return;
    end if;
  end if;

  raise exception 'Unknown filter source %.%', p_module, p_column
    using errcode = '22023';
end;
$$;

revoke all on function public.partner_distinct_values(text, text) from public, anon;
grant execute on function public.partner_distinct_values(text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Row-level security
--
-- The portal's screens read these tables directly through the anon key, so
-- these policies ARE the enforcement. Hiding a sidebar link while the row
-- still fetches is the shape of bug that made RBAC UI-only once already.
-- ─────────────────────────────────────────────────────────────────────

alter table public.partner_lead_statuses enable row level security;
alter table public.partner_lead_sources  enable row level security;
alter table public.partner_industries    enable row level security;
alter table public.partner_leads         enable row level security;
alter table public.partner_customers     enable row level security;
alter table public.partner_tasks         enable row level security;
alter table public.partner_table_views   enable row level security;
alter table public.partner_record_views  enable row level security;

-- ── masters: everyone in the portal reads, manage_masters writes ─────
-- A lead form needs the status list whoever is filling it in.
do $$
declare t text;
begin
  foreach t in array array['partner_lead_statuses','partner_lead_sources','partner_industries']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (public.partner_me() is not null)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
         using (public.partner_has_right(''manage_masters''))
         with check (public.partner_has_right(''manage_masters''))', t, t);
  end loop;
end $$;

-- ── leads ────────────────────────────────────────────────────────────
-- Read what your scope allows. Write only rows you could also read: the
-- WITH CHECK on owner_id is what stops an executive creating a lead owned by
-- somebody else, without needing a separate assign_leads check in the policy.
drop policy if exists partner_leads_select on public.partner_leads;
create policy partner_leads_select on public.partner_leads
  for select to authenticated
  using (public.partner_has_right('view_leads')
         and owner_id in (select public.partner_scope_ids()));

drop policy if exists partner_leads_insert on public.partner_leads;
create policy partner_leads_insert on public.partner_leads
  for insert to authenticated
  with check (public.partner_has_right('create_leads')
              and owner_id in (select public.partner_scope_ids()));

drop policy if exists partner_leads_update on public.partner_leads;
create policy partner_leads_update on public.partner_leads
  for update to authenticated
  using (public.partner_has_right('edit_leads')
         and owner_id in (select public.partner_scope_ids()))
  with check (owner_id in (select public.partner_scope_ids()));

drop policy if exists partner_leads_delete on public.partner_leads;
create policy partner_leads_delete on public.partner_leads
  for delete to authenticated
  using (public.partner_has_right('delete_leads')
         and owner_id in (select public.partner_scope_ids()));

-- ── customers (screens arrive in Phase 2B; the rules arrive now) ─────
drop policy if exists partner_customers_select on public.partner_customers;
create policy partner_customers_select on public.partner_customers
  for select to authenticated
  using (public.partner_has_right('view_customers')
         and owner_id in (select public.partner_scope_ids()));

drop policy if exists partner_customers_insert on public.partner_customers;
create policy partner_customers_insert on public.partner_customers
  for insert to authenticated
  with check (public.partner_has_right('create_customers')
              and owner_id in (select public.partner_scope_ids()));

drop policy if exists partner_customers_update on public.partner_customers;
create policy partner_customers_update on public.partner_customers
  for update to authenticated
  using (public.partner_has_right('edit_customers')
         and owner_id in (select public.partner_scope_ids()))
  with check (owner_id in (select public.partner_scope_ids()));

drop policy if exists partner_customers_delete on public.partner_customers;
create policy partner_customers_delete on public.partner_customers
  for delete to authenticated
  using (public.partner_has_right('delete_customers')
         and owner_id in (select public.partner_scope_ids()));

-- ── activity ─────────────────────────────────────────────────────────
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

-- ── a person's own saved views and reading history ───────────────────
-- No rights check: these are preferences, not data. Yours and nobody else's.
drop policy if exists partner_table_views_own on public.partner_table_views;
create policy partner_table_views_own on public.partner_table_views
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists partner_record_views_own on public.partner_record_views;
create policy partner_record_views_own on public.partner_record_views
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- 6. Seed the master lists
-- ─────────────────────────────────────────────────────────────────────

insert into public.partner_lead_statuses (name, colour, sort_order) values
  ('New',         '#6366f1', 10),
  ('Contacted',   '#0ea5e9', 20),
  ('Demo Given',  '#8b5cf6', 30),
  ('Quoted',      '#f59e0b', 40),
  ('Negotiating', '#f97316', 50),
  ('Won',         '#22c55e', 60),
  ('Lost',        '#ef4444', 70)
on conflict (lower(name)) do nothing;

insert into public.partner_lead_sources (name, sort_order) values
  ('Lead Discovery', 10), ('Website', 20), ('WhatsApp', 30),
  ('Referral', 40), ('Cold Call', 50), ('Exhibition', 60), ('Other', 70)
on conflict (lower(name)) do nothing;

insert into public.partner_industries (name, sort_order) values
  ('Manufacturing', 10), ('Distribution', 20), ('Retail', 30),
  ('Pharma', 40), ('FMCG', 50), ('Textiles', 60), ('Services', 70), ('Other', 80)
on conflict (lower(name)) do nothing;

commit;
```

---

## 2. Then run these four checks

```sql
-- 1. Eight new tables, all with row-level security on.
select c.relname, c.relrowsecurity as rls_on, count(p.polname) as policies
from pg_class c left join pg_policy p on p.polrelid = c.oid
where c.relname in ('partner_lead_statuses','partner_lead_sources','partner_industries',
                    'partner_leads','partner_customers','partner_tasks',
                    'partner_table_views','partner_record_views')
group by c.relname, c.relrowsecurity order by c.relname;
-- Expect 8 rows, rls_on = t on every one.
-- Policies: the three master lists 2 each, leads/customers/tasks 4 each,
-- the two preference tables 1 each.
```

```sql
-- 2. The master lists are seeded.
select 'statuses' as list, count(*) from public.partner_lead_statuses
union all select 'sources',    count(*) from public.partner_lead_sources
union all select 'industries', count(*) from public.partner_industries;
-- Expect 7, 7, 8.
```

```sql
-- 3. No pair of tables has two links between them.
select conrelid::regclass::text  as from_table,
       confrelid::regclass::text as to_table,
       count(*) as links
from pg_constraint
where contype = 'f'
  and (conrelid::regclass::text like 'partner\_%'
       or confrelid::regclass::text like 'partner\_%')
group by 1, 2 having count(*) > 1;
-- Expect ZERO rows.
-- Any row here is the fault that broke every order screen. Stop and tell me.
```

```sql
-- 4. The filter-value list refuses a column it was not told about.
select public.partner_distinct_values('lead', 'city');
-- Fine — returns nothing yet, because there are no leads.

select public.partner_distinct_values('lead', 'notes');
-- MUST fail, with: Unknown filter source lead.notes
-- If this one succeeds, the allowlist is not working and should be fixed
-- before anybody uses the portal.
```

---

## 3. If you need to undo it

See `supabase/migrations/ROLLBACK-partner-portal-phase2.md`. Be aware that
undoing it deletes every lead, customer and activity record — unlike the Phase
1 rollback, this one destroys business data once your team has started using it.
