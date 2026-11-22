# Partner Portal — Phase 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give OZZO's sales staff a working Leads module — the CRM's full table, with a filter row, Manage Columns, saved views, export, print, soft delete and CSV import — with every row scoped to who is allowed to see it.

**Architecture:** One migration adds every Phase 2 table at once, so the founder pastes SQL once rather than three times. The CRM's `DataTable` suite is ported whole rather than re-approximated, because the founder asked for parity with the admin portal; its two hosted dependencies (saved views, unseen-record highlighting) get `partner_` tables of their own, and its two account-shaped dependencies (people filters, distinct-value filters) are repointed at `partner_employees` and a new allowlisted SQL function. Leads is then an ordinary screen on top of that table.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 6, Tailwind 4, `@supabase/ssr` 0.10.3, `@supabase/supabase-js` 2.107.0, Base UI 1.9, lucide-react 1.29, sonner 2.0.7, vitest 4.1.9, PostgreSQL 17 (Supabase, Mumbai).

**Spec:** `docs/superpowers/specs/2026-11-20-partner-portal-design.md`
**Phase 1 (built, live):** `docs/superpowers/plans/2026-11-20-partner-portal-phase-1.md`

## Global Constraints

- App is `C:\Wacrm\ozzo-partner`, dev port **3300**, repo `sumitvegad07-alt/ozzo-partner`, live at **https://partner.ozzo.co.in**. Pushing `main` deploys it.
- Dependency versions stay pinned as Phase 1 set them. Add no new runtime dependency; everything needed is already installed or is being copied from `wacrm-web`.
- The `service_role` key may appear in **exactly two places**: `lib/auth/partner-service.ts` and files under `app/api/**`. `lib/supabase/key-containment.test.ts` enforces it.
- Partner staff get **no `profiles` row**, ever. Any route creating a login passes `user_metadata: { skip_account_provision: "true" }` — see `partner-portal-auth-trigger-trap`.
- **Every nav item this phase builds must flip `built: true` in `lib/nav.ts` in the same commit that adds its page.** `lib/nav.test.ts` walks `app/(portal)` and fails otherwise. This is the Phase 1 bug that reached production.
- Rights are enforced by RLS and by `requirePartnerRight()` **before** any service client is built. `can()` in `lib/auth/rights.ts` only hides menu items.
- Anything that counts or lists records scopes by `partner_scope_ids()`.
- Migrations go in `wacrm-web/supabase/migrations/` with a paste-ready `wacrm-web/docs/RUN-THIS-SQL-partner-*.md`. The Supabase CLI points at the stale Singapore project; `db push` must not be used.
- Every migration carries **the five questions** in its own comments (working agreement, 2026-11-06).
- Five gates before `main`: `npx tsc --noEmit`, `npx vitest run`, `npx next build`, `bash scripts/run-db-tests.sh` in `wacrm-web`, and clicking it through.
- **At most one foreign key between any pair of tables.** A second one makes every PostgREST embed of that pair ambiguous and returns 404 for everything — `orders-second-fk-broke-every-order`.

---

## File Structure

### New in `wacrm-web`

| File | Responsibility |
|---|---|
| `supabase/migrations/20261121120000_partner_portal_phase2.sql` | Every Phase 2 table, its RLS, the masters seed, the distinct-values function |
| `supabase/migrations/ROLLBACK-partner-portal-phase2.md` | How to undo it |
| `docs/RUN-THIS-SQL-partner-phase2.md` | Paste-ready block + verification queries |
| `supabase/tests/81_partner_leads.sql` | Scenarios for lead scoping, the masters and the distinct-values allowlist |

### New in `ozzo-partner`

| File | Responsibility |
|---|---|
| `components/ui/data-table/*` | The CRM's table suite, ported |
| `components/layout/table-toolbar-slot.tsx` | Where the table puts its toolbar, ported |
| `hooks/use-table-view.ts` | Filters, column layout, page size, saved views |
| `hooks/use-record-views.ts` | Which rows this viewer has not opened yet |
| `hooks/use-data-export.ts` | CSV export |
| `lib/table-views.ts` | `reconcileColumns` |
| `lib/table/export-all-pages.ts` | `EXPORT_MAX_ROWS` |
| `lib/print/list-payload.ts` | Hands a list to the print route |
| `lib/errors/message.ts` | `errorMessage` |
| `app/print/list/page.tsx` | The A4/A5 list print view |
| `lib/masters/types.ts` | `Master`, `MasterKind` |
| `app/(portal)/settings/page.tsx`, `settings-client.tsx` | The three master lists |
| `app/api/masters/route.ts` | Master writes, gated on `manage_masters` |
| `lib/leads/types.ts` | `Lead`, `LeadInput` |
| `lib/leads/columns.tsx` | The Leads table's `ColumnDef[]` |
| `lib/leads/validate.ts` | `validateLeadInput()` |
| `lib/leads/csv.ts` | `parseLeadCsv()`, `LEAD_CSV_HEADERS` |
| `app/(portal)/leads/page.tsx`, `leads-client.tsx` | The Leads list |
| `app/(portal)/leads/new/page.tsx`, `app/(portal)/leads/[id]/page.tsx`, `lead-form.tsx` | Add / edit a lead |
| `app/(portal)/leads/import/page.tsx`, `import-client.tsx` | CSV import |
| `app/api/leads/route.ts` | Lead writes |
| `app/api/leads/import/route.ts` | Import commit |

---

## Task 1: The Phase 2 database

**Files:**
- Create: `wacrm-web/supabase/migrations/20261121120000_partner_portal_phase2.sql`
- Create: `wacrm-web/docs/RUN-THIS-SQL-partner-phase2.md`
- Create: `wacrm-web/supabase/migrations/ROLLBACK-partner-portal-phase2.md`
- Create: `wacrm-web/supabase/tests/81_partner_leads.sql`
- Modify: `wacrm-web/scripts/run-db-tests.sh` (the hard-coded scenario list)

**Interfaces:**
- Consumes: `partner_me()`, `partner_has_right(text)`, `partner_scope_ids()` from Phase 1.
- Produces: tables `partner_lead_statuses`, `partner_lead_sources`, `partner_industries`, `partner_leads`, `partner_customers`, `partner_tasks`, `partner_table_views`, `partner_record_views`; function `partner_distinct_values(p_module text, p_column text) -> setof text`.

- [ ] **Step 1: Write the migration header with the five questions**

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
--      leads -> employees (owner_id)            1
--      leads -> customers (converted_customer_id) 1
--      customers -> employees (owner_id)        1
--      customers -> accounts (account_id)       1
--      tasks -> employees (assignee_id)         1
--      tasks -> leads / tasks -> customers      1 each
--      table_views -> auth.users                1
--    `created_by` is a bare uuid on every table, and
--    `partner_customers.source_lead_id` is a bare uuid TOO — leads and
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
--    Yes, on new tables only: 20 RLS policies, a record_status check on
--    leads and customers, a partial unique index on customers.account_id,
--    and partner_distinct_values' allowlist. All exercised by
--    supabase/tests/81_partner_leads.sql.
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
```

- [ ] **Step 2: Write the master lists**

```sql
-- ── The three lists the founder controls from Settings ───────────────
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
```

- [ ] **Step 3: Write customers, leads and tasks — in that order**

Statuses, sources and industries are stored on the lead **by name**, not by id, exactly as the CRM's `leads` table does. Renaming a master in Settings therefore does not retro-rename history, which is the CRM's behaviour and the one the founder already expects.

```sql
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
  discovery_lead_id    uuid,
  converted_customer_id uuid references public.partner_customers(id) on delete set null,
  converted_at   timestamptz,
  record_status  text not null default 'active'
                 check (record_status in ('active', 'inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid
);
create index if not exists ix_partner_leads_owner  on public.partner_leads (owner_id);
create index if not exists ix_partner_leads_status on public.partner_leads (status);
create index if not exists ix_partner_leads_phone  on public.partner_leads (phone);
create index if not exists ix_partner_leads_created on public.partner_leads (created_at desc);

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
create index if not exists ix_partner_customers_owner on public.partner_customers (owner_id);

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
create index if not exists ix_partner_tasks_due on public.partner_tasks (due_date);
```

**The order above is load-bearing.** `partner_leads.converted_customer_id`
references `partner_customers`, so that table must be created first — write the
`partner_customers` block above the `partner_leads` block in the file. Get it
wrong and the whole migration fails inside its transaction, which is noisy but
harmless: nothing is applied and you fix the order and run it again.

- [ ] **Step 4: Write the table-view and record-view tables**

```sql
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
```

- [ ] **Step 5: Write the distinct-values function**

The CRM serves these from an API route with a hard-coded allowlist. Here it is
a function, so the allowlist and the scoping live in the same place as the
policies rather than in a second place that can drift.

```sql
-- Values for a `select` filter on a free-text column (City, Area, Company).
-- The allowlist is the CASE below: a module/column pair that is not named here
-- raises, and nothing is ever interpolated into SQL. Results respect the
-- caller's scope, so an executive's City filter offers only the cities in
-- their own leads.
create or replace function public.partner_distinct_values(p_module text, p_column text)
returns setof text
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_module = 'lead' then
    if    p_column = 'company' then
      return query select distinct l.company from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.company), '') is not null
        order by 1 limit 500;
    elsif p_column = 'city' then
      return query select distinct l.city from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.city), '') is not null
        order by 1 limit 500;
    elsif p_column = 'state' then
      return query select distinct l.state from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.state), '') is not null
        order by 1 limit 500;
    elsif p_column = 'area' then
      return query select distinct l.area from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.area), '') is not null
        order by 1 limit 500;
    end if;
  end if;

  raise exception 'Unknown filter source %.%', p_module, p_column
    using errcode = '22023';
end;
$$;

revoke all on function public.partner_distinct_values(text, text) from public, anon;
grant execute on function public.partner_distinct_values(text, text) to authenticated;
```

- [ ] **Step 6: Write the RLS policies**

```sql
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
```

- [ ] **Step 7: Seed the master lists and close the transaction**

```sql
insert into public.partner_lead_statuses (name, colour, sort_order) values
  ('New',          '#6366f1', 10),
  ('Contacted',    '#0ea5e9', 20),
  ('Demo Given',   '#8b5cf6', 30),
  ('Quoted',       '#f59e0b', 40),
  ('Negotiating',  '#f97316', 50),
  ('Won',          '#22c55e', 60),
  ('Lost',         '#ef4444', 70)
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

- [ ] **Step 8: Write the paste-ready doc**

Create `docs/RUN-THIS-SQL-partner-phase2.md` in the shape of
`docs/RUN-THIS-SQL-partner-foundation.md`: what it does, what it does not
touch, where to paste it, the whole migration in one `sql` block, then these
checks.

```sql
-- 1. Eight new tables, all with RLS on.
select c.relname, c.relrowsecurity as rls_on, count(p.polname) as policies
from pg_class c left join pg_policy p on p.polrelid = c.oid
where c.relname in ('partner_lead_statuses','partner_lead_sources','partner_industries',
                    'partner_leads','partner_customers','partner_tasks',
                    'partner_table_views','partner_record_views')
group by c.relname, c.relrowsecurity order by c.relname;
-- Expect 8 rows, rls_on = t on every one, and policies: masters 2 each,
-- leads/customers/tasks 4 each, the two view tables 1 each.
```

```sql
-- 2. The master lists are seeded.
select 'statuses' as list, count(*) from public.partner_lead_statuses
union all select 'sources',  count(*) from public.partner_lead_sources
union all select 'industries', count(*) from public.partner_industries;
-- Expect 7, 7, 8.
```

```sql
-- 3. No pair of tables has two foreign keys between them.
select conrelid::regclass::text as from_table,
       confrelid::regclass::text as to_table,
       count(*) as fks
from pg_constraint
where contype = 'f'
  and (conrelid::regclass::text like 'partner_%' or confrelid::regclass::text like 'partner_%')
group by 1, 2 having count(*) > 1;
-- Expect ZERO rows. Any row here is the fault that 404'd every order screen.
```

```sql
-- 4. The distinct-values allowlist refuses anything not named in it.
select public.partner_distinct_values('lead', 'city');          -- fine, may be empty
select public.partner_distinct_values('lead', 'notes');         -- must ERROR
-- The second must fail with "Unknown filter source lead.notes".
```

- [ ] **Step 9: Write the rollback doc**

`supabase/migrations/ROLLBACK-partner-portal-phase2.md`, in the shape of
`ROLLBACK-partner-portal.md`: drop the function, then the tables in dependency
order (`partner_tasks`, `partner_leads`, `partner_customers`, the three
masters, the two view tables), and state plainly that this destroys every lead,
customer and activity record.

- [ ] **Step 10: Write the database scenarios**

Create `supabase/tests/81_partner_leads.sql`, following the conventions in
`80_partner_rights.sql`: `\set ON_ERROR_STOP on`, top-level `SELECT qa(...)`
only, inserts into `auth.users` carrying
`'{"skip_account_provision":"true"}'::jsonb`, and its own explicit starting
state rather than inheriting file 80's.

Scenarios to write, each as one `SELECT qa(...)` or `qa_refused(...)`:

```
L0  the fixture loaded: three employees, six leads
L1  an executive reads only their own leads
L2  a manager reads their whole downline's leads, and not the founder's
L3  the founder reads every lead
L4  an executive cannot create a lead owned by somebody else   (qa_refused)
L5  a manager CAN create a lead owned by someone in their team (qa_allowed)
L6  an executive cannot update a colleague's lead              (qa_refused)
L7  a telecaller with no delete_leads cannot delete a lead     (qa_refused)
L8  partner_distinct_values respects scope: an executive's city list holds
    only cities from their own leads
L9  partner_distinct_values refuses a column not on the allowlist (qa_refused)
L10 a saved view is private: one employee cannot read another's   (qa: count 0)
L11 no pair of partner_ tables has two foreign keys between them
L12 the masters are readable by every portal member and writable by none
    without manage_masters                                      (qa_refused)
```

Then add `81_partner_leads` to the `for f in …` list in
`scripts/run-db-tests.sh`, **after** `80_partner_rights`. The list is
hard-coded, not a glob: a file that is not in it is silently never run and the
suite still reports green. Never edit that script while a run is in progress.

- [ ] **Step 11: Run the harness and read the numbers**

Run: `PGPORT=54473 PGDATA_DIR=<scratch>/pgtest-p2 bash scripts/run-db-tests.sh`
Expected: `317 migrations applied, 47 reported errors` (a JUMP in that count
means the new migration failed — look for its filename in the error list), and
`All scenarios passed` with the passed count up by the number of `qa(...)`
calls in file 81. Takes 6–20 minutes; run it in the background.

- [ ] **Step 12: Commit, then have the founder apply it**

```bash
cd C:\Wacrm\wacrm-web
git add supabase/migrations/20261121120000_partner_portal_phase2.sql supabase/migrations/ROLLBACK-partner-portal-phase2.md supabase/tests/81_partner_leads.sql scripts/run-db-tests.sh docs/RUN-THIS-SQL-partner-phase2.md
git commit -m "feat(db): partner portal phase 2 - leads, customers, activity, masters"
git push origin main
```

The founder pastes `docs/RUN-THIS-SQL-partner-phase2.md` into the Supabase SQL
editor and runs the four checks. **Do not start Task 4 until check 3 returns
zero rows.**

---

## Task 2: Port the table framework

**Files:**
- Create in `ozzo-partner`: `components/ui/data-table/{data-table.tsx,data-table-types.ts,data-table-header.tsx,data-table-filter-row.tsx,manage-columns-dialog.tsx,table-views-bar.tsx,row-actions.tsx}`
- Create: `components/layout/table-toolbar-slot.tsx`, `hooks/use-table-view.ts`, `hooks/use-record-views.ts`, `hooks/use-data-export.ts`, `lib/table-views.ts`, `lib/table/export-all-pages.ts`, `lib/print/list-payload.ts`, `lib/errors/message.ts`
- Create: `app/print/list/page.tsx`
- Modify: `components/layout/partner-shell.tsx` (mount the toolbar slot)
- Test: `components/ui/data-table/data-table-contract.test.ts`

**Interfaces:**
- Consumes: `partner_table_views`, `partner_record_views` (Task 1); `createBrowserSupabase()` (Phase 1).
- Produces:
  - `ColumnDef<T>` from `components/ui/data-table/data-table-types` — fields `id`, `label`, `type?: "text"|"select"|"date"|"range"`, `options?: {label,value}[]`, `valueSource?: {kind:"people"} | {kind:"distinct"; module: string; column: string}`, `visibleByDefault?`, `sortable?`, `filterValue?`, `cellClassName?`, `render?`
  - `useTableView(storageKey: string, defaultFilters?: Record<string, unknown>): TableViewApi`
  - `<DataTable columns data tableView rowKey rowHref isLoading emptyMessage actions menuActions unseenModule createdAtOf />`
  - `reconcileColumns(...)` from `lib/table-views`

- [ ] **Step 1: Copy the suite unchanged, then make it compile**

Copy these from `wacrm-web/src` to the same paths in `ozzo-partner`:

```
components/ui/data-table/           (all 7 files)
components/layout/table-toolbar-slot.tsx
hooks/use-table-view.ts
hooks/use-record-views.ts
hooks/use-data-export.ts
lib/table/export-all-pages.ts
lib/print/list-payload.ts
lib/errors/message.ts
```

`lib/table-views.ts` does not exist at that path in the CRM — find
`reconcileColumns` with
`grep -rn "export function reconcileColumns" C:\Wacrm\wacrm-web\src`
and copy the file it lives in to `ozzo-partner/lib/table-views.ts`.

Run `npx tsc --noEmit` and work through the errors. Every one will be a missing
import; resolve each by copying that file too, or by the adaptation below if it
is named there. Add each copied file to `COPIED-FROM.md` with
`git -C C:\Wacrm\wacrm-web rev-parse --short HEAD`.

- [ ] **Step 2: Repoint saved views at `partner_table_views`**

In `hooks/use-table-view.ts`, change `.from("table_views")` to
`.from("partner_table_views")` and delete every `account_id` from its selects,
inserts and filters — this portal has no accounts, and the policy keys on
`user_id` alone.

- [ ] **Step 3: Repoint the unseen-record highlight at `partner_record_views`**

In `hooks/use-record-views.ts`, change `.from("record_views")` to
`.from("partner_record_views")` and drop `account_id` the same way. Narrow its
`RecordModule` type to this portal's modules:

```ts
export type RecordModule = "lead" | "customer" | "task";
```

- [ ] **Step 4: Repoint the people filter at `partner_employees`**

`ColumnDef.valueSource` has a `{kind:"people", idSpace:"profile"|"auth"}` form.
This portal has one id space — `partner_employees.id` — so the discriminator is
noise that can only be got wrong. Simplify the type to `{kind:"people"}` and
have the filter row load options with:

```ts
const { data } = await supabase
  .from("partner_employees")
  .select("id, full_name")
  .eq("status", "active")
  .order("full_name");
```

- [ ] **Step 5: Repoint distinct-value filters at the SQL function**

Replace the CRM's `/api/.../distinct` fetch in
`components/ui/data-table/data-table-filter-row.tsx` with:

```ts
const { data, error } = await supabase.rpc("partner_distinct_values", {
  p_module: source.module,
  p_column: source.column,
});
```

`data` is `string[]`. On error, render the filter as a plain text box rather
than an empty dropdown — an empty dropdown looks like "no leads have a city",
which is a different and wrong message.

- [ ] **Step 6: Mount the toolbar slot in the shell**

The table renders its toolbar into a slot in the page header. Wrap the shell's
`<main>` content in the provider from `components/layout/table-toolbar-slot.tsx`
and render its outlet where the CRM renders it — read that file's own comments
for which. Without this the table's Manage Columns, export and print buttons
mount nowhere and simply do not appear.

- [ ] **Step 7: Write the contract test**

Create `components/ui/data-table/data-table-contract.test.ts`. This is a
source-scanning test, like the Phase 1 route-shape guard, because the component
needs a browser to run.

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "components", "ui", "data-table");
const sources = readdirSync(DIR)
  .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
  .map((f) => [f, readFileSync(join(DIR, f), "utf8")] as const);

describe("the ported table suite", () => {
  it("was actually copied", () => {
    expect(sources.length).toBeGreaterThanOrEqual(6);
  });

  it("reads no CRM table", () => {
    // table_views and record_views exist in this database and belong to
    // tenants. A leftover reference would read another company's rows, or
    // more likely return nothing and look like a broken feature.
    for (const [name, src] of sources) {
      expect(src, name).not.toMatch(/from\("table_views"\)/);
      expect(src, name).not.toMatch(/from\("record_views"\)/);
      expect(src, name).not.toMatch(/from\("profiles"\)/);
    }
  });

  it("never mentions account_id", () => {
    for (const [name, src] of sources) expect(src, name).not.toContain("account_id");
  });
});
```

Run: `npx vitest run data-table-contract` — expect PASS. Then prove it bites:
temporarily put `from("profiles")` in `data-table-filter-row.tsx`, re-run, see
it fail, and revert.

- [ ] **Step 8: Gates and commit**

```bash
cd C:\Wacrm\ozzo-partner
npx tsc --noEmit && npx vitest run && npx next build
git add -A
git commit -F - <<'MSG'
feat: port the CRM's table suite

Filter row, Manage Columns, saved views, export and print, copied rather
than approximated so the portal's tables are the admin portal's tables.
Saved views and the unseen-record highlight are repointed at
partner_table_views and partner_record_views; the people filter reads
partner_employees; distinct-value filters call partner_distinct_values.
MSG
```

---

## Task 3: The master lists and the Settings screen

**Files:**
- Create: `lib/masters/types.ts`, `app/(portal)/settings/page.tsx`, `app/(portal)/settings/settings-client.tsx`, `app/api/masters/route.ts`
- Create: `app/api/masters/route-shape.test.ts`
- Modify: `lib/nav.ts` (`/settings` → `built: true`)

**Interfaces:**
- Consumes: the three master tables (Task 1); `requirePartnerRight` (Phase 1).
- Produces: `type MasterKind = "status" | "source" | "industry"`; `type Master = { id: string; name: string; colour?: string | null; sort_order: number; is_active: boolean }`; `MASTER_TABLES: Record<MasterKind, string>`.

- [ ] **Step 1: Write the types**

```ts
export type MasterKind = "status" | "source" | "industry";

export type Master = {
  id: string;
  name: string;
  colour?: string | null;
  sort_order: number;
  is_active: boolean;
};

/**
 * The table behind each list. An allowlist, not a format string: the API route
 * looks the table name up here and never takes it from the request, so a
 * crafted `kind` cannot reach another table.
 */
export const MASTER_TABLES: Record<MasterKind, string> = {
  status: "partner_lead_statuses",
  source: "partner_lead_sources",
  industry: "partner_industries",
};

export const MASTER_LABELS: Record<MasterKind, string> = {
  status: "Lead statuses",
  source: "Lead sources",
  industry: "Industries",
};
```

- [ ] **Step 2: Write the API route**

`app/api/masters/route.ts`, with `POST` (add), `PATCH` (rename, recolour,
reorder, activate/deactivate) and `DELETE` (deactivate only — a master that has
been used is referenced by name on existing leads, and removing it would leave
those leads showing a status that is not in the list).

Every handler: `await requirePartnerRight("manage_masters")` **before**
`serviceClient()`, and the table resolved through `MASTER_TABLES[kind]` with a
400 for an unknown kind.

- [ ] **Step 3: Write the route-shape guard**

`app/api/masters/route-shape.test.ts`, modelled on
`app/api/employees/route-shape.test.ts`: all three handlers call
`requirePartnerRight("manage_masters")`, the guard appears before
`serviceClient(`, the route never interpolates a table name
(`expect(src).not.toMatch(/from\(`/)`), and `DELETE` sets `is_active: false`
rather than deleting.

Run it, then break the order in `POST` to watch it fail, and revert.

- [ ] **Step 4: Write the Settings screen**

`app/(portal)/settings/page.tsx` is the server page: `requirePartnerRight("manage_masters")`.

`settings-client.tsx` renders three cards — plain
`rounded-xl border border-border bg-card p-4` sections, the same shape the
Roles screen uses, because `wacrm-web`'s `SettingsPanel` family was not copied
into this app and one screen does not justify porting it — one card per list,
each with: the rows in `sort_order`, an inline rename, a colour swatch for
statuses only, up/down reordering, an active toggle, and an "Add" row. Writes
go to `/api/masters`.

- [ ] **Step 5: Flip the nav flag and run the gates**

Set `built: true` on the `/settings` item in `lib/nav.ts`.

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: PASS, including `lib/nav.test.ts`, whose "marks exactly the screens
that exist as built" assertion must be updated to include `/settings`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Settings, with the three master lists"
```

---

## Task 4: The Leads list

**Files:**
- Create: `lib/leads/types.ts`, `lib/leads/columns.tsx`, `app/(portal)/leads/page.tsx`, `app/(portal)/leads/leads-client.tsx`
- Modify: `lib/nav.ts` (`/leads` → `built: true`), `lib/nav.test.ts`
- Test: `lib/leads/columns.test.ts`

**Interfaces:**
- Consumes: `DataTable`, `ColumnDef`, `useTableView` (Task 2); `Master` (Task 3); `partner_leads` (Task 1).
- Produces: `type Lead` (every column of `partner_leads`, plus `owner?: { full_name: string }`); `leadColumns(opts: { statuses: Master[]; sources: Master[]; industries: Master[] }): ColumnDef<Lead>[]`.

- [ ] **Step 1: Write the types**

```ts
export type Lead = {
  id: string;
  name: string;
  company: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  source: string | null;
  industry: string | null;
  owner_id: string;
  est_value: number | null;
  expected_close: string | null;
  next_follow_up: string | null;
  address: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  notes: string | null;
  record_status: "active" | "inactive";
  created_at: string;
  // PostgREST returns a to-one embed as an object or a one-element array
  // depending on how it resolves the relationship. Handle both — Phase 1's
  // getPartnerMe() learned this the same way.
  owner?: { full_name: string } | { full_name: string }[] | null;
};

export function ownerName(lead: Lead): string {
  const o = lead.owner;
  const one = Array.isArray(o) ? o[0] : o;
  return one?.full_name ?? "—";
}
```

- [ ] **Step 2: Write the failing column test**

```ts
import { describe, expect, it } from "vitest";
import { leadColumns } from "./columns";

const masters = {
  statuses: [{ id: "1", name: "New", sort_order: 10, is_active: true }],
  sources: [{ id: "2", name: "Website", sort_order: 10, is_active: true }],
  industries: [{ id: "3", name: "Retail", sort_order: 10, is_active: true }],
};

describe("leadColumns()", () => {
  it("gives every column a unique id", () => {
    const ids = leadColumns(masters).map((c) => c.id);
    expect([...new Set(ids)]).toHaveLength(ids.length);
  });

  it("builds the status filter from the master list, not a hard-coded one", () => {
    const status = leadColumns(masters).find((c) => c.id === "status")!;
    expect(status.type).toBe("select");
    expect(status.options).toEqual([{ label: "New", value: "New" }]);
  });

  it("offers only allowlisted distinct sources, or the function will raise", () => {
    // partner_distinct_values accepts lead.company / city / state / area and
    // raises on anything else, so a column asking for another one shows an
    // error instead of a filter.
    const allowed = new Set(["company", "city", "state", "area"]);
    for (const c of leadColumns(masters)) {
      if (c.valueSource?.kind === "distinct") {
        expect(allowed, `${c.id} asks for ${c.valueSource.column}`).toContain(
          c.valueSource.column,
        );
        expect(c.valueSource.module).toBe("lead");
      }
    }
  });

  it("shows a sensible handful by default and hides the rest", () => {
    const cols = leadColumns(masters);
    const shown = cols.filter((c) => c.visibleByDefault !== false);
    expect(shown.length).toBeGreaterThanOrEqual(5);
    expect(shown.length).toBeLessThanOrEqual(8);
    expect(cols.length).toBeGreaterThan(shown.length);
  });
});
```

Run: `npx vitest run leads/columns` — expect FAIL, cannot resolve `./columns`.

- [ ] **Step 3: Write the columns**

`lib/leads/columns.tsx` exporting `leadColumns(masters)`. Visible by default:
Name, Lead Status, Lead Owner, Contact no, Source, Created at. Hidden but
available in Manage Columns: Company, Contact Person, Email, Industry, Address,
Area, City, State, Country, Pincode, Estimated Value, Expected Close, Next
Follow-up, Record Status. Status renders a coloured pill from the master's
`colour`. Record Status is a select of Active / Inactive with
`filterValue: (l) => l.record_status`.

Run the test again — expect PASS, four cases.

- [ ] **Step 4: Write the server page**

```tsx
import { requirePartnerRight } from "@/lib/auth/partner";
import { can } from "@/lib/auth/rights";
import LeadsClient from "./leads-client";

export default async function LeadsPage() {
  const me = await requirePartnerRight("view_leads");
  return (
    <LeadsClient
      canCreate={can(me.permissions, "create_leads")}
      canEdit={can(me.permissions, "edit_leads")}
      canDelete={can(me.permissions, "delete_leads")}
      canImport={can(me.permissions, "import_leads")}
      canAssign={can(me.permissions, "assign_leads")}
    />
  );
}
```

- [ ] **Step 5: Write the list client**

`leads-client.tsx`: `useTableView("partner_leads_table")`, loads the three
master lists and the leads, and renders `<DataTable>` with
`unseenModule="lead"`, `createdAtOf={(l) => l.created_at}`,
`rowHref={(l) => \`/leads/${l.id}\`}`, an "Add lead" action when `canCreate`,
and an "Import" menu action when `canImport`.

The read:

```ts
const { data } = await supabase
  .from("partner_leads")
  .select("*, owner:partner_employees!partner_leads_owner_id_fkey(full_name)")
  .order("created_at", { ascending: false })
  .limit(1000);
```

The embed names the constraint explicitly. `partner_leads` has exactly one
foreign key to `partner_employees` today, so a bare `partner_employees(...)`
would also resolve — naming it means a future second reference cannot silently
change which relationship this is.

A **search box** sits above the table and filters the loaded rows on name,
company, contact person, phone and email, case-insensitively. It is separate
from the filter row on purpose: the filter row answers "which status", search
answers "where is that shop I spoke to". The CRM's Leads screen has both.

Default to hiding inactive rows (`record_status === "active"`) with a "Show
inactive" toggle in the menu actions, matching the CRM.

**On the 1,000 limit:** PostgREST silently caps a response at 1,000 rows, which
once looked like missing data across this product
(`postgrest-1000-row-silent-cap`). Asking for 1,000 explicitly and showing a
banner when exactly 1,000 come back — "showing the newest 1,000 leads; use the
filters to narrow" — is honest. Server-side paging is Phase 2B's problem, not a
silent truncation now.

- [ ] **Step 6: Soft delete and re-activate**

Row actions: Edit (when `canEdit`), Move to Inactive / Re-activate (when
`canDelete`). Both `PATCH /api/leads` with `record_status`. Nothing in this
portal hard-deletes a lead: from Phase 2B a lead owns activity and may have
become a customer.

- [ ] **Step 7: Flip the nav flag, update its test, run the gates**

Set `built: true` on `/leads`, and add `/leads` to the expected list in
`lib/nav.test.ts`'s "marks exactly the screens that exist as built".

Run: `npx tsc --noEmit && npx vitest run && npx next build` — expect PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: the Leads list, on the ported table"
```

---

## Task 5: Add and edit a lead

**Files:**
- Create: `lib/leads/validate.ts`, `app/(portal)/leads/lead-form.tsx`, `app/(portal)/leads/new/page.tsx`, `app/(portal)/leads/[id]/page.tsx`, `app/api/leads/route.ts`
- Test: `lib/leads/validate.test.ts`, `app/api/leads/route-shape.test.ts`

**Interfaces:**
- Consumes: `Lead` (Task 4), masters (Task 3), `requirePartnerRight` (Phase 1).
- Produces: `validateLeadInput(input: Partial<LeadInput>): { ok: boolean; errors: Record<string, string> }` and `stripLeadColumns<T>(updates: T): Partial<T>`. `LeadInput` is declared in `lib/leads/types.ts` beside `Lead`: `{ id?: string; name: string; owner_id: string; company?: string; contact_person?: string; phone?: string; email?: string; status?: string; source?: string; industry?: string; est_value?: number | string | null; expected_close?: string | null; next_follow_up?: string | null; address?: string; area?: string; city?: string; state?: string; country?: string; pincode?: string; notes?: string }`.

- [ ] **Step 1: Write the failing validation test**

```ts
import { describe, expect, it } from "vitest";
import { validateLeadInput } from "./validate";

const valid = { name: "Shah Traders", owner_id: "11111111-1111-1111-1111-111111111111" };

describe("validateLeadInput()", () => {
  it("accepts a lead with just a name and an owner", () => {
    expect(validateLeadInput(valid)).toEqual({ ok: true, errors: {} });
  });

  it("requires a name and an owner", () => {
    const { ok, errors } = validateLeadInput({});
    expect(ok).toBe(false);
    expect(Object.keys(errors).sort()).toEqual(["name", "owner_id"]);
  });

  it("rejects an email that is not one, but allows no email at all", () => {
    expect(validateLeadInput({ ...valid, email: "nope" }).errors.email).toMatch(/valid email/i);
    expect(validateLeadInput({ ...valid, email: "" })).toEqual({ ok: true, errors: {} });
  });

  it("rejects a phone with no digits, and accepts the ways people write one", () => {
    expect(validateLeadInput({ ...valid, phone: "call me" }).errors.phone).toMatch(/phone/i);
    for (const p of ["9876543210", "+91 98765 43210", "079-2222 3333"]) {
      expect(validateLeadInput({ ...valid, phone: p }).errors.phone, p).toBeUndefined();
    }
  });

  it("rejects a negative or non-numeric estimated value", () => {
    expect(validateLeadInput({ ...valid, est_value: -5 }).errors.est_value).toBeTruthy();
    expect(validateLeadInput({ ...valid, est_value: "lots" }).errors.est_value).toBeTruthy();
    expect(validateLeadInput({ ...valid, est_value: "25000" }).errors.est_value).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to watch it fail, then write `lib/leads/validate.ts`**

Phone is validated as "has at least 7 digits once punctuation is stripped" —
Indian numbers get written with spaces, dashes, `+91` and STD codes, and a
stricter rule rejects real numbers.

Run again — expect PASS, five cases.

- [ ] **Step 3: Write the API route**

`app/api/leads/route.ts` with `POST`, `PATCH` and no `DELETE`. Each calls
`requirePartnerRight("create_leads" | "edit_leads")` before
`serviceClient()`, validates with `validateLeadInput`, and strips the columns a
request must never set (`id`, `created_at`, `created_by`, `converted_customer_id`,
`converted_at`) with `stripLeadColumns()`, a new
`lib/leads/privilege-columns.ts` written the same way as
`lib/employees/privilege-columns.ts` and tested the same way.

Assignment rule: when the caller lacks `assign_leads`, force
`owner_id = me.id` regardless of the body. The RLS `WITH CHECK` would refuse a
foreign owner anyway, but a 403 from the database reads as a bug, while the
route doing it reads as the rule it is.

- [ ] **Step 4: Write the route-shape guard**

`app/api/leads/route-shape.test.ts`, modelled on the employees one: both
handlers check the right before `serviceClient(`, `POST` is gated on
`create_leads` and `PATCH` on `edit_leads`, the route strips privilege columns,
and it forces `owner_id` when `assign_leads` is absent
(`expect(src).toContain("assign_leads")`).

Run it, then break the guard order to watch it fail, and revert.

- [ ] **Step 5: Write the form**

`lead-form.tsx`, one component for add and edit, shaped like Phase 1's
`employee-form.tsx`: fields grouped as Business (name, company, contact person,
phone, email), Qualification (status, source, industry, estimated value,
expected close, next follow-up), Address (address, area, city, state, country,
pincode) and Notes. Owner is a dropdown of active `partner_employees`, shown
only when `canAssign`; otherwise it is hidden and the route sets it.

`new/page.tsx` gates on `create_leads`; `[id]/page.tsx` gates on `edit_leads`,
reads the lead through the caller's own session so RLS decides whether it is
theirs, and `notFound()`s when it is not.

- [ ] **Step 6: Gates and commit**

```bash
npx tsc --noEmit && npx vitest run && npx next build
git add -A && git commit -m "feat: add and edit a lead"
```

---

## Task 6: CSV import

**Files:**
- Create: `lib/leads/csv.ts`, `app/(portal)/leads/import/page.tsx`, `app/(portal)/leads/import/import-client.tsx`, `app/api/leads/import/route.ts`
- Test: `lib/leads/csv.test.ts`, `app/api/leads/import/route-shape.test.ts`

**Interfaces:**
- Consumes: `validateLeadInput` (Task 5), masters (Task 3).
- Produces:
  - `LEAD_CSV_HEADERS: readonly string[]`
  - `parseLeadCsv(text: string): { rows: ParsedLeadRow[]; errors: { line: number; message: string }[] }`
  - `type ParsedLeadRow = { line: number; values: Record<string, string> }`

- [ ] **Step 1: Write the failing parser test**

```ts
import { describe, expect, it } from "vitest";
import { LEAD_CSV_HEADERS, parseLeadCsv } from "./csv";

describe("parseLeadCsv()", () => {
  it("reads a simple file", () => {
    const { rows, errors } = parseLeadCsv("Name,Phone\nShah Traders,9876543210");
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ line: 2, values: { Name: "Shah Traders", Phone: "9876543210" } }]);
  });

  it("handles quoted fields containing commas", () => {
    // An address is the field that always has a comma in it.
    const { rows } = parseLeadCsv('Name,Address\n"Shah Traders","12, MG Road"');
    expect(rows[0].values.Address).toBe("12, MG Road");
  });

  it("handles escaped quotes inside a quoted field", () => {
    const { rows } = parseLeadCsv('Name\n"Shah ""Bros"" Traders"');
    expect(rows[0].values.Name).toBe('Shah "Bros" Traders');
  });

  it("survives CRLF, which is what Excel writes on Windows", () => {
    const { rows, errors } = parseLeadCsv("Name\r\nShah Traders\r\n");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].values.Name).toBe("Shah Traders");
  });

  it("strips a UTF-8 BOM, which Excel also writes", () => {
    // Without this the first header reads "\uFEFFName" and nothing maps.
    const { rows } = parseLeadCsv("\uFEFFName\nShah Traders");
    expect(rows[0].values.Name).toBe("Shah Traders");
  });

  it("ignores blank lines rather than importing empty leads", () => {
    const { rows } = parseLeadCsv("Name\nShah Traders\n\n   \n");
    expect(rows).toHaveLength(1);
  });

  it("reports a row with more cells than headers, and keeps going", () => {
    const { rows, errors } = parseLeadCsv("Name,Phone\nA,1,extra\nB,2");
    expect(errors).toEqual([{ line: 2, message: "This row has 3 values but there are 2 columns." }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].values.Name).toBe("B");
  });

  it("refuses a file with no recognised header", () => {
    const { rows, errors } = parseLeadCsv("Zip,Zap\n1,2");
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/column/i);
  });

  it("offers Name among its headers, since it is the only required one", () => {
    expect(LEAD_CSV_HEADERS).toContain("Name");
  });
});
```

- [ ] **Step 2: Run it to watch it fail, then write `lib/leads/csv.ts`**

Hand-written parser, no new dependency: a character-wise scan handling quotes,
escaped quotes, CRLF and the BOM. `LEAD_CSV_HEADERS` lists the importable
columns using the same labels the table shows (Name, Company, Contact Person,
Phone, Email, Status, Source, Industry, Estimated Value, Address, Area, City,
State, Country, Pincode, Notes).

Run again — expect PASS, nine cases.

- [ ] **Step 3: Write the import route**

`app/api/leads/import/route.ts`, `POST` only, gated on
`requirePartnerRight("import_leads")` before `serviceClient()`.

It takes the parsed rows as JSON (the file is parsed in the browser, so a bad
file never reaches the server) and:

- maps each row through `validateLeadInput`, collecting failures by line rather
  than aborting;
- **skips duplicates by phone number** against existing `partner_leads` within
  the caller's scope, matching on digits only so `+91 98765 43210` and
  `9876543210` are the same number;
- sets `owner_id` to the chosen owner, or to `me.id` when the caller lacks
  `assign_leads`;
- inserts the survivors in **chunks of 500**;
- returns `{ created: number; skipped: number; failed: { line: number; message: string }[] }`.

A partly-successful import is reported, not rolled back: on a 2,000-row file
the user wants the 1,950 good rows and a list of the 50 bad ones.

- [ ] **Step 4: Write the route-shape guard**

`app/api/leads/import/route-shape.test.ts`: the right is checked before
`serviceClient(`, it is `import_leads`, duplicates are skipped by phone
(`expect(src).toContain("skipped")`), and the insert is chunked
(`expect(src).toContain("500")`).

- [ ] **Step 5: Write the import screen**

Three steps on one page: choose a file → a preview table of the first 20 rows
with any parse errors listed by line, and a count of how many will be created
and how many skipped → Import. Afterwards show the result counts and a link
back to Leads. A downloadable sample CSV, built from `LEAD_CSV_HEADERS`, is a
link on the first step — people will otherwise guess the headers.

- [ ] **Step 6: Gates and commit**

```bash
npx tsc --noEmit && npx vitest run && npx next build
git add -A && git commit -m "feat: import leads from a CSV"
```

---

## Task 7: Prove it with a second person

This is the verification the founder deferred in Phase 1. It cannot be done
with one account, and scoping is the whole point of the module.

**Files:** none. This task changes no code; it finds out whether the code works.

- [ ] **Step 1: Push and let it deploy**

```bash
git push origin main
```

Wait for the Vercel deployment to finish.

- [ ] **Step 2: Create a second employee**

As the founder, on `https://partner.ozzo.co.in/employees`, add **Test Exec**
with the role **Sales Executive** and no reporting manager. Keep the password
shown.

- [ ] **Step 3: Create leads owned by each person**

As the founder, add two leads owned by himself and two owned by Test Exec
(the owner dropdown appears because Super Admin holds `assign_leads`).

- [ ] **Step 4: Check what the founder sees**

`/leads` shows all four. The filter row filters. Manage Columns adds and
removes columns and the choice survives a reload. A saved view can be created,
reloaded into, and deleted. Export downloads a CSV of the visible columns.
Print produces an A4 list.

- [ ] **Step 5: Check what the executive sees — the real test**

Sign in as Test Exec in a private window.

Expected, and each one is a separate pass/fail:
1. The sidebar shows Dashboard, Leads and Settings only — **not** Employees,
   Employee Roles, Invoices, Renewals, Forecast, Lead Discovery or WhatsApp
   Sender. (Settings appears only if the seeded Sales Executive role holds
   `manage_settings`; it does not, so Settings should be absent too — if it is
   present, the seed and the registry disagree and that is a finding.)
2. `/leads` shows **two** leads, their own.
3. `/employees` returns 404, with no flash of the page first.
4. Adding a lead offers no owner dropdown, and the lead is created owned by
   them.
5. The City filter offers only cities from their own two leads.
6. Their saved views do not appear in the founder's account, and the founder's
   do not appear in theirs.

- [ ] **Step 6: Deactivate the test account**

Back as the founder, deactivate Test Exec. Confirm they can no longer sign in.
Their two leads remain, still owned by them, and still visible to the founder —
which is why deactivation is not deletion.

- [ ] **Step 7: Record what was found**

Write the results into
`docs/superpowers/plans/2026-11-20-partner-portal-phase-2a.md` under a "What
execution found" heading, the way Phase 1's plan records its deviations. Say
plainly which of the six checks in Step 5 passed and which did not.

---

## Phase 2A is done when

All of these hold on `https://partner.ozzo.co.in`:

1. A lead can be created, edited, filtered, exported, printed, moved to
   inactive and re-activated.
2. A CSV of leads imports, reporting created / skipped / failed by line.
3. Manage Columns and saved views both work, and both survive a reload.
4. An executive sees only their own leads, in the list and in the filters, and
   404s on `/employees`.
5. The master lists are editable in Settings, and a new status appears in the
   lead form and in the Leads filter row.
6. `npx tsc --noEmit`, `npx vitest run` and `npx next build` all pass, and
   `bash scripts/run-db-tests.sh` reports all scenarios passed with no jump in
   the migration error count.

Phase 2B — Customers, convert-lead-to-customer, and My Activity — gets its own
plan, written when this one is live.

---

## What execution found (2026-11-21/22)

Tasks 1–6 are built, committed and pushed. Task 7 (verification with a second
account) is blocked on the migration being applied to production.

**Things the plan got wrong, found while building:**

- **The unseen-row highlight needs TWO tables, not one.** `use-record-views`
  imports `useViewBaseline`, which reads a baselines table — the high-water
  mark that stops a new joiner seeing every existing lead marked unread on
  their first visit. The plan created only `partner_record_views`.
  `partner_record_view_baselines` was added to the migration rather than
  crippling the feature.
- **The ported hooks depend on the CRM's `useAuth`**, which carries a profile,
  an account and a plan — none of which exist here. A stub returning nulls
  would have silently disabled saved views rather than failing, because both
  hooks guard on `!accountId`. Replaced with `usePartnerSession`, and every
  `account_id` removed from both hooks.
- **`apply-filters.ts` drags in the custom-fields engine.** Only
  `isEmptyFilterValue` was needed; the four custom-field and
  assigned-employee helpers were cut with a comment saying where to get them
  if custom fields ever arrive.
- **`PageHeader` could not simply be copied.** The CRM's deprecated
  `subtitle` and does not render it; every Phase 1 screen here passes one and
  shows it. This app's header was kept and given the toolbar slot instead.
- **`ColumnDef.valueSource` carried an `idSpace` discriminator** for the CRM's
  two id spaces. This portal has one, so it was removed rather than carried
  as a constant that could only be got wrong.
- **The plan's file list missed `public/brand/`** — not Phase 2A, but the same
  class of omission as Phase 1's.

**The database harness earned its keep twice:**

1. First run: four scenarios failed. The cause was the **tests**, not the SQL.
   An `INSERT … SELECT` whose sub-query matches no row, and an `UPDATE` or
   `DELETE` that matches no row, raise nothing in Postgres — so three
   "must be refused" checks were passing without the policy under test ever
   being consulted. L6b's own comment warned about exactly this and L6 did it
   anyway.
2. Correcting them introduced a second bug: the replacement captured exec2's
   id with `\gset` *after* `SET ROLE authenticated`, where RLS hides that row
   and `\gset` errors with "no rows returned". Moved above the role switch.

**Still outstanding:**

- The migration has **not been applied to production**. The paste doc carries
  a warning at the top.
- Task 7 has not run: nobody has yet seen an executive's view of Leads, the
  filter row, Manage Columns or saved views working against real data.
- Soft delete lives on the lead's own screen, not in a row menu. The ported
  DataTable's row-actions slot is wired to the CRM's rights registry and
  repointing it is Phase 2B work.
