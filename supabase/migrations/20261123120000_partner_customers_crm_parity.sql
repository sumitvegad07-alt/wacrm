-- =====================================================================
-- Partner Portal: bring partner_customers into line with the CRM's
-- Contacts module, before the Customers screens are built on top of it.
--
-- THE FIND THAT DROVE THIS. In the CRM, a contact's `name` is the contact
-- PERSON and `company` is the BUSINESS — the opposite way round from leads,
-- where `name` is the business and `company` mirrors it. From
-- wacrm-web/src/components/ui/data-table/data-table-types.ts, verbatim:
--
--   "The customers table is the case that exposed this: its company column
--    has id "name" but renders contact.company, so it picked up the label
--    for system_key 'name' — "Contact Person"."
--
-- partner_customers was built with `business_name` and `contact_person`,
-- which matches neither table. Renaming now, while the Customers screens do
-- not yet exist and almost nothing reads these columns, is far cheaper than
-- discovering the mismatch once a hundred customers are filed under their
-- shopkeeper's name.
--
-- The CRM's contact field list, for reference:
--   name, company, phone, whatsapp, email, address, area, city, state,
--   country, pincode, hierarchy_level
--
-- ---------------------------------------------------------------------
-- THE FIVE QUESTIONS (working agreement, 2026-11-06)
-- ---------------------------------------------------------------------
-- 1. A SECOND foreign key between two tables that already have one?
--    No new foreign keys. collaborator_ids is a uuid ARRAY, which cannot
--    carry one — the same choice, for the same reason, as partner_leads.
--
-- 2. Does a touched column appear in a .select() string in either repo?
--    This migration RENAMES two columns, so this is the question that
--    matters. MEASURED on 2026-11-22:
--      grep -rn "business_name" ozzo-partner --include=*.ts --include=*.tsx
--        -> no matches at all
--      grep -rn "contact_person" ozzo-partner --include=*.ts --include=*.tsx
--        -> 14 matches, EVERY ONE on partner_LEADS (lead-form, leads-client,
--           lead-detail, columns, types, the two lead API routes).
--           partner_leads.contact_person is NOT touched here.
--      grep -rn "partner_customers" wacrm-web/src wacrm-mobile ozzo-dms
--        -> nothing
--    The ONE live reader of these two columns is
--    public.partner_convert_lead_to_customer, which inserts them by name.
--    It is replaced in this same transaction (section 4), so there is no
--    moment at which it refers to a column that does not exist.
--
-- 3. New trigger / policy / constraint on a table that gets written?
--    Yes: partner_customers_select is REPLACED so a collaborator can read a
--    customer they do not own — a WIDENING, which is the direction that
--    leaks, so 83_partner_customers.sql proves a collaborator reads the one
--    customer and not the owner's others, and still cannot edit it.
--    `company` also becomes NOT NULL.
--
-- 4. Can an existing row fail the new rule?
--    `company` NOT NULL is the risk. It was `business_name`, already NOT
--    NULL, so every existing row satisfies it by construction. Any row
--    created by the convert function always had one. Verified by the check
--    in the paste doc before the constraint is relied on.
--
-- 5. What happens to a tenant who has not configured this?
--    Nothing. Only partner_* objects are touched.
-- =====================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. The rename, and the fields the CRM has that this table lacked
-- ─────────────────────────────────────────────────────────────────────

-- Guarded so the migration can be run twice: the second run finds the new
-- names already in place and does nothing.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'partner_customers'
                and column_name = 'business_name') then
    execute 'alter table public.partner_customers rename column business_name to company';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'partner_customers'
                and column_name = 'contact_person') then
    execute 'alter table public.partner_customers rename column contact_person to name';
  end if;
end $$;

alter table public.partner_customers
  add column if not exists whatsapp text,
  add column if not exists address text,
  add column if not exists area text,
  add column if not exists country text,
  add column if not exists pincode text,
  add column if not exists collaborator_ids uuid[] not null default '{}'::uuid[];

create index if not exists ix_partner_customers_collaborators
  on public.partner_customers using gin (collaborator_ids);

-- A customer must have a business name. The contact person is optional,
-- because a shop is often just a shop until somebody asks who runs it.
alter table public.partner_customers alter column company set not null;

comment on column public.partner_customers.company is
  'The BUSINESS. Matches contacts.company in the CRM.';
comment on column public.partner_customers.name is
  'The contact PERSON, and optional. Matches contacts.name in the CRM, which is the opposite way round from partner_leads.name.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. A collaborator can read the customer
--
-- Read only, exactly as for leads. Editing and deleting stay with the
-- owner's scope, so the other three policies are untouched.
-- ─────────────────────────────────────────────────────────────────────

drop policy if exists partner_customers_select on public.partner_customers;
create policy partner_customers_select on public.partner_customers
  for select to authenticated
  using (
    public.partner_has_right('view_customers')
    and (
      owner_id in (select public.partner_scope_ids())
      or public.partner_me() = any (collaborator_ids)
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 3. Filter values for the Customers table
--
-- Explicit branches, not format(). A dynamic version needs four levels of
-- quote escaping to express an empty string, inside a security definer
-- function — a bug waiting to happen for the sake of twenty fewer lines.
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
    elsif p_column = 'country' then
      return query select distinct l.country from partner_leads l
        where l.owner_id in (select partner_scope_ids())
          and nullif(btrim(l.country), '') is not null
        order by 1 limit 500;
      return;
    end if;

  elsif p_module = 'customer' then
    if p_column = 'company' then
      return query select distinct c.company from partner_customers c
        where c.owner_id in (select partner_scope_ids())
          and nullif(btrim(c.company), '') is not null
        order by 1 limit 500;
      return;
    elsif p_column = 'city' then
      return query select distinct c.city from partner_customers c
        where c.owner_id in (select partner_scope_ids())
          and nullif(btrim(c.city), '') is not null
        order by 1 limit 500;
      return;
    elsif p_column = 'state' then
      return query select distinct c.state from partner_customers c
        where c.owner_id in (select partner_scope_ids())
          and nullif(btrim(c.state), '') is not null
        order by 1 limit 500;
      return;
    elsif p_column = 'area' then
      return query select distinct c.area from partner_customers c
        where c.owner_id in (select partner_scope_ids())
          and nullif(btrim(c.area), '') is not null
        order by 1 limit 500;
      return;
    elsif p_column = 'country' then
      return query select distinct c.country from partner_customers c
        where c.owner_id in (select partner_scope_ids())
          and nullif(btrim(c.country), '') is not null
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
-- 4. Converting, with the columns the right way round
--
-- The previous version inserts business_name and contact_person. After the
-- rename those columns do not exist and every conversion fails, so it is
-- replaced here rather than in a later migration.
--
-- THE LINE TO GET RIGHT: a lead's `name` IS the business, so it becomes the
-- customer's `company`. The lead's `contact_person` becomes the customer's
-- `name`. Swapping this pair files every converted shop under its
-- shopkeeper, and nothing downstream would notice.
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

  -- The customer's timeline starts with where it came from, so its own page
  -- is never blank and the origin is never a mystery.
  insert into partner_module_activities (user_id, module_name, record_id, action, message)
  values (auth.uid(), 'customer', v_customer, 'created',
          'Created by converting the lead ' || v_lead.name);

  return v_customer;
end;
$$;

revoke all on function public.partner_convert_lead_to_customer(uuid) from public, anon;
grant execute on function public.partner_convert_lead_to_customer(uuid) to authenticated;

commit;
