# RUN THIS IN SUPABASE — Leads, matched to your CRM

**Run this after** `RUN-THIS-SQL-partner-phase2.md`. It is the database half
of the changes you asked for after opening the lead form.

**What it does:**

- Adds **WhatsApp** and **Collaborators** to a lead.
- Lets a **collaborator open a lead they do not own** — without being able to
  edit or delete it.
- Removes **estimated value, expected close and next follow-up**. Your CRM's
  Leads module has none of them.
- Makes **Company a mirror of the lead name**, kept by the database, so you
  never type the business name twice. The column still works in Manage
  Columns and in exports.
- Adds the **timeline** table behind a lead's history.
- Adds **Convert to Customer** as a single database function, so a half-done
  conversion cannot exist.
- Adds **country** to the searchable filter lists.
- Also creates `partner_record_view_baselines`, which the Phase 2 page was
  missing. Safe whether or not you already added it.

**What it does NOT touch:** nothing outside the partner portal. No tenant
table, column, policy or function.

**Where:** Supabase dashboard -> Mumbai project (`ltigfpywdbfilsagtpyd`) ->
SQL Editor -> paste -> Run.

It is wrapped in `begin; ... commit;`, so if any part fails none of it
applies. Safe to run twice.

> **There are no leads yet**, so dropping those three columns loses nothing.
> If you have created leads since, tell me before running this — the columns
> go, and whatever is in them goes with them.

---

## 1. Paste and run this

```sql
-- =====================================================================
-- Partner Portal: bring Leads into line with the CRM's Leads module.
--
-- The founder opened the lead form on the live portal and listed what did
-- not match. Every point was correct, and this migration is the database
-- half of the answer. Checked against wacrm-web rather than guessed:
--
--   src/components/leads/lead-form.tsx line 344 says, verbatim:
--     "Business / Lead Name IS the company for a lead, so the separate
--      'Company' field is dropped from the form (a DB trigger keeps
--      leads.company mirrored to leads.name)."
--
--   the seeded field list for module 'lead' is exactly:
--     name, contact_person, phone, whatsapp, email, source, industry,
--     status, address, area, city, state, country, pincode
--
-- So: whatsapp and collaborators arrive, the three fields the CRM does not
-- have leave, and company becomes a mirror of name rather than a field
-- anybody types into.
--
-- Also folds in partner_record_view_baselines, which the Phase 2 paste doc
-- was missing — safe to run whether or not it already exists.
--
-- ---------------------------------------------------------------------
-- THE FIVE QUESTIONS (working agreement, 2026-11-06)
-- ---------------------------------------------------------------------
-- 1. A SECOND foreign key between two tables that already have one?
--    No new foreign keys at all. `collaborator_ids` is a uuid ARRAY, not a
--    reference — the same shape as leads.collaborator_ids in the CRM, and
--    for the same reason: an array cannot carry a foreign key, so it cannot
--    create a second relationship between leads and employees and cannot
--    make a PostgREST embed ambiguous. partner_module_activities references
--    auth.users once and nothing else.
--
-- 2. Does a touched column appear in a .select() string in either repo?
--    Yes — this is the risky question here, and the answer is that the three
--    DROPPED columns appear in ozzo-partner only, in files changed in the
--    same commit:
--      seven files, all changed in the same commit as this migration:
--        lib/leads/types.ts        lib/leads/columns.tsx
--        lib/leads/validate.ts     lib/leads/validate.test.ts
--        app/(portal)/leads/lead-form.tsx
--        app/api/leads/route.ts    app/api/leads/import/route.ts
--    `select("*")` in app/(portal)/leads/[id] and leads-client is unaffected
--    by a dropped column. Nothing in wacrm-web, wacrm-mobile or ozzo-dms
--    mentions partner_leads at all. Verified:
--      grep -rn "est_value\|expected_close\|next_follow_up" wacrm-web/src \
--        wacrm-mobile ozzo-dms   ->  no partner_leads hits
--
-- 3. New trigger / policy / constraint on a table that gets written?
--    Yes:
--      - trg_partner_leads_mirror_company, BEFORE INSERT OR UPDATE, keeps
--        company = name (the CRM's behaviour).
--      - partner_leads_select is REPLACED so a collaborator can read a lead
--        they do not own. That widens visibility, so it is the one to get
--        wrong: it is exercised by 82_partner_lead_parity.sql, which proves
--        a collaborator reads it, a stranger still does not, and a
--        collaborator still cannot edit or delete it.
--      - partner_module_activities gets 2 policies.
--
-- 4. Can an existing row fail the new rule?
--    There are no leads yet (the founder has created none). Even so, the
--    company mirror is written as a BEFORE trigger with no constraint, so an
--    existing row could not fail it, and the backfill below is idempotent.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing. Only partner_* objects are touched. No tenant table, column,
--    policy or function is referenced.
-- =====================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 0. The table the Phase 2 paste doc was missing
--
-- Generated before the port added it, so the block the founder ran created
-- eight tables rather than nine. Idempotent either way.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.partner_record_view_baselines (
  user_id     uuid not null references auth.users(id) on delete cascade,
  module_name text not null,
  baseline_at timestamptz not null default now(),
  primary key (user_id, module_name)
);

alter table public.partner_record_view_baselines enable row level security;

drop policy if exists partner_record_view_baselines_own
  on public.partner_record_view_baselines;
create policy partner_record_view_baselines_own
  on public.partner_record_view_baselines
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- 1. The fields the CRM has, and the ones it does not
-- ─────────────────────────────────────────────────────────────────────

alter table public.partner_leads
  add column if not exists whatsapp text,
  -- partner_employees.id values. An array, not a join table, because that is
  -- what leads.collaborator_ids is in the CRM and the screens are copied.
  add column if not exists collaborator_ids uuid[] not null default '{}'::uuid[];

create index if not exists ix_partner_leads_collaborators
  on public.partner_leads using gin (collaborator_ids);

-- The CRM's Leads module has none of these three. They were invented for
-- this portal, the founder flagged them, and there are no leads yet — so
-- they go now rather than becoming columns nobody fills in.
alter table public.partner_leads
  drop column if exists est_value,
  drop column if exists expected_close,
  drop column if exists next_follow_up;

comment on column public.partner_leads.company is
  'Mirror of name, kept by trg_partner_leads_mirror_company. Not a form field: for a lead, the business name IS the company. Same rule as the CRM.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Company mirrors name
--
-- The CRM keeps leads.company in step with leads.name by trigger and drops
-- Company from the form. Doing the same here means the Company column in
-- Manage Columns still works, exports still carry it, and nobody is asked to
-- type a business name twice.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_leads_mirror_company()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  NEW.company := NEW.name;
  return NEW;
end;
$$;

drop trigger if exists trg_partner_leads_mirror_company on public.partner_leads;
create trigger trg_partner_leads_mirror_company
  before insert or update of name, company on public.partner_leads
  for each row execute function public.partner_leads_mirror_company();

update public.partner_leads set company = name
 where company is distinct from name;

-- ─────────────────────────────────────────────────────────────────────
-- 3. A collaborator can read the lead
--
-- In the CRM a collaborator is somebody brought onto a lead who does not own
-- it. Without this they would be named on a lead they cannot open.
--
-- Read only. Editing and deleting stay with the owner's scope, which is why
-- the other three policies are untouched.
-- ─────────────────────────────────────────────────────────────────────

drop policy if exists partner_leads_select on public.partner_leads;
create policy partner_leads_select on public.partner_leads
  for select to authenticated
  using (
    public.partner_has_right('view_leads')
    and (
      owner_id in (select public.partner_scope_ids())
      or public.partner_me() = any (collaborator_ids)
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 4. The timeline
--
-- Same shape as the CRM's module_activities, minus account_id. It is what
-- the lead detail page reads to show what happened and when.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.partner_module_activities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  module_name text not null,
  record_id   uuid not null,
  action      text not null,
  message     text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ix_partner_module_activities_record
  on public.partner_module_activities (module_name, record_id, created_at desc);

alter table public.partner_module_activities enable row level security;

-- Anybody in the portal may read and append. The entries are about records
-- the reader can already see — a timeline is only ever fetched for one
-- record id, and the record itself is behind its own policy, so there is
-- nothing here to leak that the record does not leak first.
drop policy if exists partner_module_activities_select on public.partner_module_activities;
create policy partner_module_activities_select on public.partner_module_activities
  for select to authenticated
  using (public.partner_me() is not null);

drop policy if exists partner_module_activities_insert on public.partner_module_activities;
create policy partner_module_activities_insert on public.partner_module_activities
  for insert to authenticated
  with check (public.partner_me() is not null and user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- 5. Convert a lead to a customer
--
-- One function rather than three statements in the browser, so a half-done
-- conversion cannot exist: either the customer row, the lead's two columns
-- and the timeline entry all land, or none of them do.
--
-- SECURITY INVOKER on purpose. It runs as the caller, so the policies decide
-- whether this person may read the lead and create a customer; a definer
-- function would quietly let anybody convert anything.
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
    business_name, contact_person, phone, email, city, state,
    owner_id, became_customer_on, source_lead_id, notes, created_by
  ) values (
    v_lead.name, v_lead.contact_person, v_lead.phone, v_lead.email,
    v_lead.city, v_lead.state, v_lead.owner_id, current_date, v_lead.id,
    v_lead.notes, v_me
  )
  returning id into v_customer;

  update partner_leads
     set converted_customer_id = v_customer,
         converted_at = now(),
         status = coalesce(
           (select name from partner_lead_statuses
             where lower(name) = 'won' and is_active limit 1),
           status),
         updated_at = now()
   where id = p_lead_id;

  insert into partner_module_activities (user_id, module_name, record_id, action, message)
  values (auth.uid(), 'lead', p_lead_id, 'converted',
          'Converted to customer ' || v_lead.name);

  return v_customer;
end;
$$;

revoke all on function public.partner_convert_lead_to_customer(uuid) from public, anon;
grant execute on function public.partner_convert_lead_to_customer(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Country joins the filter-value allowlist
--
-- The reworked lead form offers searchable dropdowns for area, city, state
-- AND country, built from values already used on leads this person can see.
-- The Phase 2 function allowed the first three; asking it for country raised
-- "Unknown filter source lead.country" and the dropdown showed an error
-- where a list belongs.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.partner_distinct_values(p_module text, p_column text)
returns setof text
language plpgsql stable security definer set search_path = public
as $$
begin
  -- Written as explicit branches rather than one format()-built query. The
  -- dynamic version needed four nested levels of quote escaping to express an
  -- empty string, which is a bug waiting to happen in a security definer
  -- function. Repetition is the cheaper risk.
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
    elsif p_column = 'country' then
      return query select distinct l.country from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.country), '') is not null
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

commit;
```

---

## 2. Then run these checks

```sql
-- 1. The field changes landed.
select
  (select count(*) from information_schema.columns
    where table_name = 'partner_leads'
      and column_name in ('whatsapp','collaborator_ids'))                 as added,
  (select count(*) from information_schema.columns
    where table_name = 'partner_leads'
      and column_name in ('est_value','expected_close','next_follow_up')) as removed;
-- Expect added = 2, removed = 0.
```

```sql
-- 2. Company mirrors the lead name.
select name, company, (name = company) as mirrored
from public.partner_leads limit 5;
-- Expect mirrored = true on every row. No rows yet is also fine.
```

```sql
-- 3. The new pieces exist.
select
  (select count(*) from pg_class where relname = 'partner_module_activities')      as timeline_table,
  (select count(*) from pg_class where relname = 'partner_record_view_baselines')  as baselines_table,
  (select count(*) from pg_proc  where proname = 'partner_convert_lead_to_customer') as convert_fn;
-- Expect 1, 1, 1.
```

```sql
-- 4. Country is now an allowed filter, and an unlisted column still is not.
select public.partner_distinct_values('lead', 'country');
-- Fine — empty until leads have a country.

select public.partner_distinct_values('lead', 'notes');
-- MUST fail with: Unknown filter source lead.notes
-- A red error here is the PASS.
```
