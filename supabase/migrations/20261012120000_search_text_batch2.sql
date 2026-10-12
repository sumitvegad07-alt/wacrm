-- Server-side search for the remaining list screens: leads, tasks, contacts,
-- products, quotations, deals.
--
-- Same shape as 20261012100000 (orders) and 20261012110000 (batch 1): the names
-- each screen searches and filters on are denormalised onto the row,
-- `search_text` is one lowercase haystack of everything its search box covers,
-- and a pg_trgm GIN index makes `ilike '%x%'` an index scan.
--
-- Id spaces checked against the data, not assumed:
--   tasks.assigned_user_id -> profiles.id   (1437/1437)
--   quotations.user_id     -> profiles.user_id (469/469)
--   deals.user_id          -> profiles.user_id (572/572)
--
-- Each backfill disables that table's BEFORE UPDATE triggers that carry no
-- column list, then puts them back. contacts has five of them, including
-- protect_outstanding_balance and two permission checks that raise.

create extension if not exists pg_trgm;

-- ════════════════════════════════════════════════════════════════════════════
-- leads — searched by name, whatsapp, custom fields
-- ════════════════════════════════════════════════════════════════════════════
alter table public.leads add column if not exists search_text text;

create or replace function public.leads_custom_search_text(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.lead_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.lead_id = p_id
    and coalesce(f.is_searchable, true) and coalesce(f.is_active, true)
    and v.value is not null and v.value <> '';
$$;

create or replace function public.leads_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.search_text := trim(regexp_replace(
    lower(coalesce(new.name, '') || ' ' || coalesce(new.whatsapp, '') || ' ' ||
          public.leads_custom_search_text(new.id)), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists leads_search_columns on public.leads;
create trigger leads_search_columns
  before insert or update of name, whatsapp on public.leads
  for each row execute function public.leads_fill_search_columns();

create or replace function public.leads_refresh_from_custom_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(new.lead_id, old.lead_id);
begin
  update public.leads l
     set search_text = trim(regexp_replace(
           lower(coalesce(l.name, '') || ' ' || coalesce(l.whatsapp, '') || ' ' ||
                 public.leads_custom_search_text(l.id)), '\s+', ' ', 'g'))
   where l.id = v_id;
  return null;
end;
$$;

drop trigger if exists lead_custom_values_refresh_search on public.lead_custom_values;
create trigger lead_custom_values_refresh_search
  after insert or update or delete on public.lead_custom_values
  for each row execute function public.leads_refresh_from_custom_value();

alter table public.leads disable trigger set_updated_at;
alter table public.leads disable trigger trg_leads_sync_company;

update public.leads l
   set search_text = trim(regexp_replace(
         lower(coalesce(l.name, '') || ' ' || coalesce(l.whatsapp, '') || ' ' ||
               public.leads_custom_search_text(l.id)), '\s+', ' ', 'g'))
 where l.search_text is null;

alter table public.leads enable trigger trg_leads_sync_company;
alter table public.leads enable trigger set_updated_at;

create index if not exists leads_search_text_trgm
  on public.leads using gin (search_text gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- tasks — searched by title, description, custom fields.
-- assignee_name and linked_text back the two column filters.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.tasks add column if not exists assignee_name text;
alter table public.tasks add column if not exists linked_text text;
alter table public.tasks add column if not exists search_text text;

create or replace function public.tasks_custom_search_text(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.task_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.task_id = p_id
    and coalesce(f.is_searchable, true) and coalesce(f.is_active, true)
    and v.value is not null and v.value <> '';
$$;

create or replace function public.tasks_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_assignee text;
  v_contact text;
  v_deal text;
begin
  -- assigned_user_id is a profiles.id here, not an auth uid.
  select coalesce(p.full_name, p.email) into v_assignee
    from public.profiles p where p.id = new.assigned_user_id;
  select c.name into v_contact from public.contacts c where c.id = new.contact_id;
  select d.title into v_deal from public.deals d where d.id = new.deal_id;

  new.assignee_name := coalesce(v_assignee, 'Unassigned');
  new.linked_text := trim(coalesce(v_contact, '') || ' ' || coalesce(v_deal, ''));
  new.search_text := trim(regexp_replace(
    lower(coalesce(new.title, '') || ' ' || coalesce(new.description, '') || ' ' ||
          public.tasks_custom_search_text(new.id)), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists tasks_search_columns on public.tasks;
create trigger tasks_search_columns
  before insert or update of title, description, assigned_user_id, contact_id, deal_id
  on public.tasks
  for each row execute function public.tasks_fill_search_columns();

create or replace function public.tasks_refresh_from_custom_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(new.task_id, old.task_id);
begin
  update public.tasks t
     set search_text = trim(regexp_replace(
           lower(coalesce(t.title, '') || ' ' || coalesce(t.description, '') || ' ' ||
                 public.tasks_custom_search_text(t.id)), '\s+', ' ', 'g'))
   where t.id = v_id;
  return null;
end;
$$;

drop trigger if exists task_custom_values_refresh_search on public.task_custom_values;
create trigger task_custom_values_refresh_search
  after insert or update or delete on public.task_custom_values
  for each row execute function public.tasks_refresh_from_custom_value();

alter table public.tasks disable trigger set_updated_at;

update public.tasks t
   set assignee_name = coalesce(d.assignee_name, 'Unassigned'),
       linked_text = trim(coalesce(d.contact_name, '') || ' ' || coalesce(d.deal_title, '')),
       search_text = trim(regexp_replace(
         lower(coalesce(t.title, '') || ' ' || coalesce(t.description, '') || ' ' ||
               public.tasks_custom_search_text(t.id)), '\s+', ' ', 'g'))
  from (
    select t2.id,
           (select coalesce(p.full_name, p.email) from public.profiles p where p.id = t2.assigned_user_id) as assignee_name,
           (select c.name from public.contacts c where c.id = t2.contact_id) as contact_name,
           (select dl.title from public.deals dl where dl.id = t2.deal_id) as deal_title
      from public.tasks t2
  ) d
 where d.id = t.id and t.search_text is null;

alter table public.tasks enable trigger set_updated_at;

create index if not exists tasks_search_text_trgm
  on public.tasks using gin (search_text gin_trgm_ops);
create index if not exists tasks_assignee_name_trgm
  on public.tasks using gin (assignee_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- contacts — searched by company, name, phone, email, custom fields.
-- territory_name backs the territory column filter.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.contacts add column if not exists territory_name text;
alter table public.contacts add column if not exists search_text text;

create or replace function public.contacts_custom_search_text(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.contact_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.contact_id = p_id
    and coalesce(f.is_searchable, true) and coalesce(f.is_active, true)
    and v.value is not null and v.value <> '';
$$;

create or replace function public.contacts_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_territory text;
begin
  select tr.name into v_territory from public.territories tr where tr.id = new.territory_id;
  new.territory_name := v_territory;
  -- phone is matched case-sensitively today (it is digits), but lowering it is
  -- harmless and keeps one haystack.
  new.search_text := trim(regexp_replace(
    lower(coalesce(new.company, '') || ' ' || coalesce(new.name, '') || ' ' ||
          coalesce(new.phone, '') || ' ' || coalesce(new.email, '') || ' ' ||
          public.contacts_custom_search_text(new.id)), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists contacts_search_columns on public.contacts;
create trigger contacts_search_columns
  before insert or update of company, name, phone, email, territory_id
  on public.contacts
  for each row execute function public.contacts_fill_search_columns();

create or replace function public.contacts_refresh_from_custom_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(new.contact_id, old.contact_id);
begin
  update public.contacts c
     set search_text = trim(regexp_replace(
           lower(coalesce(c.company, '') || ' ' || coalesce(c.name, '') || ' ' ||
                 coalesce(c.phone, '') || ' ' || coalesce(c.email, '') || ' ' ||
                 public.contacts_custom_search_text(c.id)), '\s+', ' ', 'g'))
   where c.id = v_id;
  return null;
end;
$$;

drop trigger if exists contact_custom_values_refresh_search on public.contact_custom_values;
create trigger contact_custom_values_refresh_search
  after insert or update or delete on public.contact_custom_values
  for each row execute function public.contacts_refresh_from_custom_value();

alter table public.contacts disable trigger protect_outstanding_balance;
alter table public.contacts disable trigger set_updated_at;
alter table public.contacts disable trigger trg_contacts_sync_geo;
alter table public.contacts disable trigger trg_enforce_contact_credit_permissions;
alter table public.contacts disable trigger trg_enforce_contact_hierarchy_level;

update public.contacts c
   set territory_name = (select tr.name from public.territories tr where tr.id = c.territory_id),
       search_text = trim(regexp_replace(
         lower(coalesce(c.company, '') || ' ' || coalesce(c.name, '') || ' ' ||
               coalesce(c.phone, '') || ' ' || coalesce(c.email, '') || ' ' ||
               public.contacts_custom_search_text(c.id)), '\s+', ' ', 'g'))
 where c.search_text is null;

alter table public.contacts enable trigger trg_enforce_contact_hierarchy_level;
alter table public.contacts enable trigger trg_enforce_contact_credit_permissions;
alter table public.contacts enable trigger trg_contacts_sync_geo;
alter table public.contacts enable trigger set_updated_at;
alter table public.contacts enable trigger protect_outstanding_balance;

create index if not exists contacts_search_text_trgm
  on public.contacts using gin (search_text gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- products — searched by name, sku, custom fields. category_name backs a filter.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.products add column if not exists category_name text;
alter table public.products add column if not exists search_text text;

create or replace function public.products_custom_search_text(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.product_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.product_id = p_id
    and coalesce(f.is_searchable, true) and coalesce(f.is_active, true)
    and v.value is not null and v.value <> '';
$$;

create or replace function public.products_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_category text;
begin
  select pc.name into v_category from public.product_categories pc where pc.id = new.category_id;
  new.category_name := v_category;
  new.search_text := trim(regexp_replace(
    lower(coalesce(new.name, '') || ' ' || coalesce(new.sku, '') || ' ' ||
          public.products_custom_search_text(new.id)), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists products_search_columns on public.products;
create trigger products_search_columns
  before insert or update of name, sku, category_id on public.products
  for each row execute function public.products_fill_search_columns();

create or replace function public.products_refresh_from_custom_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p
     set search_text = trim(regexp_replace(
           lower(coalesce(p.name, '') || ' ' || coalesce(p.sku, '') || ' ' ||
                 public.products_custom_search_text(p.id)), '\s+', ' ', 'g'))
   where p.id = v_id;
  return null;
end;
$$;

drop trigger if exists product_custom_values_refresh_search on public.product_custom_values;
create trigger product_custom_values_refresh_search
  after insert or update or delete on public.product_custom_values
  for each row execute function public.products_refresh_from_custom_value();

alter table public.products disable trigger set_updated_at;

update public.products p
   set category_name = (select pc.name from public.product_categories pc where pc.id = p.category_id),
       search_text = trim(regexp_replace(
         lower(coalesce(p.name, '') || ' ' || coalesce(p.sku, '') || ' ' ||
               public.products_custom_search_text(p.id)), '\s+', ' ', 'g'))
 where p.search_text is null;

alter table public.products enable trigger set_updated_at;

create index if not exists products_search_text_trgm
  on public.products using gin (search_text gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- quotations — searched by number, contact name, lead name, custom fields.
-- creator_name backs a column filter. user_id is an auth uid here.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.quotations add column if not exists customer_name text;
alter table public.quotations add column if not exists creator_name text;
alter table public.quotations add column if not exists search_text text;

create or replace function public.quotations_custom_search_text(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.quotation_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.quotation_id = p_id
    and coalesce(f.is_searchable, true) and coalesce(f.is_active, true)
    and v.value is not null and v.value <> '';
$$;

create or replace function public.quotations_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_customer text;
  v_creator text;
begin
  select c.name into v_customer from public.contacts c where c.id = new.contact_id;
  if v_customer is null then
    select l.name into v_customer from public.leads l where l.id = new.lead_id;
  end if;
  select p.full_name into v_creator from public.profiles p where p.user_id = new.user_id limit 1;

  new.customer_name := v_customer;
  new.creator_name := v_creator;
  new.search_text := trim(regexp_replace(
    lower(coalesce(new.quotation_number, '') || ' ' || coalesce(v_customer, '') || ' ' ||
          public.quotations_custom_search_text(new.id)), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists quotations_search_columns on public.quotations;
create trigger quotations_search_columns
  before insert or update of quotation_number, contact_id, lead_id, user_id
  on public.quotations
  for each row execute function public.quotations_fill_search_columns();

create or replace function public.quotations_refresh_from_custom_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(new.quotation_id, old.quotation_id);
begin
  update public.quotations q
     set search_text = trim(regexp_replace(
           lower(coalesce(q.quotation_number, '') || ' ' || coalesce(q.customer_name, '') || ' ' ||
                 public.quotations_custom_search_text(q.id)), '\s+', ' ', 'g'))
   where q.id = v_id;
  return null;
end;
$$;

drop trigger if exists quotation_custom_values_refresh_search on public.quotation_custom_values;
create trigger quotation_custom_values_refresh_search
  after insert or update or delete on public.quotation_custom_values
  for each row execute function public.quotations_refresh_from_custom_value();

alter table public.quotations disable trigger set_updated_at;

update public.quotations q
   set customer_name = d.customer_name,
       creator_name = d.creator_name,
       search_text = trim(regexp_replace(
         lower(coalesce(q.quotation_number, '') || ' ' || coalesce(d.customer_name, '') || ' ' ||
               public.quotations_custom_search_text(q.id)), '\s+', ' ', 'g'))
  from (
    select q2.id,
           coalesce(
             (select c.name from public.contacts c where c.id = q2.contact_id),
             (select l.name from public.leads l where l.id = q2.lead_id)
           ) as customer_name,
           (select p.full_name from public.profiles p where p.user_id = q2.user_id limit 1) as creator_name
      from public.quotations q2
  ) d
 where d.id = q.id and q.search_text is null;

alter table public.quotations enable trigger set_updated_at;

create index if not exists quotations_search_text_trgm
  on public.quotations using gin (search_text gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- deals — the Pipelines board has no global search box, only column filters on
-- title (own), contact name, contact phone, assignee name and custom fields.
-- user_id is an auth uid here.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.deals add column if not exists contact_name text;
alter table public.deals add column if not exists contact_phone text;
alter table public.deals add column if not exists assignee_name text;

create or replace function public.deals_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
  v_phone text;
  v_assignee text;
begin
  select c.name, c.phone into v_name, v_phone
    from public.contacts c where c.id = new.contact_id;
  select p.full_name into v_assignee
    from public.profiles p where p.user_id = new.user_id limit 1;

  new.contact_name := v_name;
  new.contact_phone := v_phone;
  new.assignee_name := v_assignee;
  return new;
end;
$$;

drop trigger if exists deals_search_columns on public.deals;
create trigger deals_search_columns
  before insert or update of contact_id, user_id on public.deals
  for each row execute function public.deals_fill_search_columns();

alter table public.deals disable trigger set_updated_at;

update public.deals dl
   set contact_name = d.contact_name,
       contact_phone = d.contact_phone,
       assignee_name = d.assignee_name
  from (
    select d2.id,
           (select c.name from public.contacts c where c.id = d2.contact_id) as contact_name,
           (select c.phone from public.contacts c where c.id = d2.contact_id) as contact_phone,
           (select p.full_name from public.profiles p where p.user_id = d2.user_id limit 1) as assignee_name
      from public.deals d2
  ) d
 where d.id = dl.id and dl.contact_name is null and dl.assignee_name is null;

alter table public.deals enable trigger set_updated_at;

create index if not exists deals_contact_name_trgm
  on public.deals using gin (contact_name gin_trgm_ops);
create index if not exists deals_assignee_name_trgm
  on public.deals using gin (assignee_name gin_trgm_ops);
