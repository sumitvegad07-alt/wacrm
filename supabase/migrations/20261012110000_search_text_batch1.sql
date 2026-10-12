-- Server-side search for the four biggest list screens after Orders:
-- site_visits (24,310 rows), order_dispatches (5,312), expenses (3,267),
-- payments (2,327).
--
-- Same shape as 20261012100000_orders_search_text.sql: the names each screen
-- searches and filters on are denormalised onto the row, `search_text` is one
-- lowercase haystack of everything its search box covers, and a pg_trgm GIN
-- index makes `ilike '%x%'` an index scan instead of a full download plus a
-- JavaScript scan.
--
-- Id spaces were checked against the data rather than assumed, because they
-- genuinely differ per table:
--   expenses.employee_id      -> profiles.id        (3267/3267)
--   site_visits.user_id       -> profiles.user_id   (24310/24310)
--   payments.user_id          -> profiles.user_id   (2327/2327)
--
-- Each backfill disables that table's BEFORE UPDATE triggers that carry no
-- column list, then puts them back. Those triggers restamp updated_at (mobile
-- offline sync pages by it) or raise on validation, and would otherwise either
-- corrupt sync state or abort the migration.

create extension if not exists pg_trgm;

-- ════════════════════════════════════════════════════════════════════════════
-- site_visits — Location Tracking > Visits
-- Searched by: customer/lead name, and who made the visit.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.site_visits add column if not exists customer_name text;
alter table public.site_visits add column if not exists visited_by_name text;
alter table public.site_visits add column if not exists search_text text;

/**
 * target_id is the real link and is always populated; it points at a contact
 * (24,301 rows) or a lead (6). target_type is unreliable — it holds both
 * 'customer' and 'Customer' — so resolve by lookup instead of by its value.
 * contact_id only resolves legacy rows.
 */
create or replace function public.site_visits_fill_search_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer text;
  v_visited_by text;
begin
  select coalesce(nullif(c.company, ''), c.name) into v_customer
    from public.contacts c where c.id = coalesce(new.target_id, new.contact_id);

  if v_customer is null then
    select coalesce(nullif(l.company, ''), l.name) into v_customer
      from public.leads l where l.id = new.target_id;
  end if;

  select p.full_name into v_visited_by
    from public.profiles p where p.user_id = new.user_id limit 1;

  new.customer_name := v_customer;
  new.visited_by_name := v_visited_by;
  new.search_text := trim(regexp_replace(
    lower(coalesce(v_customer, '') || ' ' || coalesce(v_visited_by, '')),
    '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists site_visits_search_columns on public.site_visits;
create trigger site_visits_search_columns
  before insert or update of target_id, contact_id, user_id
  on public.site_visits
  for each row execute function public.site_visits_fill_search_columns();

alter table public.site_visits disable trigger trg_enforce_site_visit_geofence;

update public.site_visits v
   set customer_name = d.customer_name,
       visited_by_name = d.visited_by_name,
       search_text = trim(regexp_replace(
         lower(coalesce(d.customer_name, '') || ' ' || coalesce(d.visited_by_name, '')),
         '\s+', ' ', 'g'))
  from (
    select v2.id,
           coalesce(
             (select coalesce(nullif(c.company, ''), c.name) from public.contacts c
               where c.id = coalesce(v2.target_id, v2.contact_id)),
             (select coalesce(nullif(l.company, ''), l.name) from public.leads l
               where l.id = v2.target_id)
           ) as customer_name,
           (select p.full_name from public.profiles p where p.user_id = v2.user_id limit 1) as visited_by_name
      from public.site_visits v2
  ) d
 where d.id = v.id and v.search_text is null;

alter table public.site_visits enable trigger trg_enforce_site_visit_geofence;

create index if not exists site_visits_search_text_trgm
  on public.site_visits using gin (search_text gin_trgm_ops);
create index if not exists site_visits_customer_name_trgm
  on public.site_visits using gin (customer_name gin_trgm_ops);
create index if not exists site_visits_visited_by_trgm
  on public.site_visits using gin (visited_by_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- order_dispatches — Dispatches
-- Searched by: dispatch number, the order's number, customer, custom fields.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.order_dispatches add column if not exists order_number text;
alter table public.order_dispatches add column if not exists customer_name text;
alter table public.order_dispatches add column if not exists search_text text;

create or replace function public.order_dispatches_custom_search_text(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.dispatch_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.dispatch_id = p_id
    and coalesce(f.is_searchable, true) and coalesce(f.is_active, true)
    and v.value is not null and v.value <> '';
$$;

create or replace function public.order_dispatches_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order_number text;
  v_customer text;
begin
  -- orders already carries customer_name from migration 20261012100000.
  select o.order_number, o.customer_name into v_order_number, v_customer
    from public.orders o where o.id = new.order_id;

  new.order_number := v_order_number;
  new.customer_name := v_customer;
  new.search_text := trim(regexp_replace(
    lower(
      coalesce(new.dispatch_number, '') || ' ' ||
      coalesce(v_order_number, '') || ' ' ||
      coalesce(v_customer, '') || ' ' ||
      public.order_dispatches_custom_search_text(new.id)
    ), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists order_dispatches_search_columns on public.order_dispatches;
create trigger order_dispatches_search_columns
  before insert or update of dispatch_number, order_id
  on public.order_dispatches
  for each row execute function public.order_dispatches_fill_search_columns();

create or replace function public.order_dispatches_refresh_from_custom_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(new.dispatch_id, old.dispatch_id);
begin
  update public.order_dispatches d
     set search_text = trim(regexp_replace(
           lower(
             coalesce(d.dispatch_number, '') || ' ' ||
             coalesce(d.order_number, '') || ' ' ||
             coalesce(d.customer_name, '') || ' ' ||
             public.order_dispatches_custom_search_text(d.id)
           ), '\s+', ' ', 'g'))
   where d.id = v_id;
  return null;
end;
$$;

drop trigger if exists dispatch_custom_values_refresh_search on public.dispatch_custom_values;
create trigger dispatch_custom_values_refresh_search
  after insert or update or delete on public.dispatch_custom_values
  for each row execute function public.order_dispatches_refresh_from_custom_value();

-- order_dispatches has no unscoped BEFORE UPDATE trigger, so nothing to disable.
update public.order_dispatches d
   set order_number = o.order_number,
       customer_name = o.customer_name,
       search_text = trim(regexp_replace(
         lower(
           coalesce(d.dispatch_number, '') || ' ' ||
           coalesce(o.order_number, '') || ' ' ||
           coalesce(o.customer_name, '') || ' ' ||
           public.order_dispatches_custom_search_text(d.id)
         ), '\s+', ' ', 'g'))
  from public.orders o
 where o.id = d.order_id and d.search_text is null;

-- A dispatch whose order row is missing would be skipped by the join above and
-- keep a NULL search_text, which `ilike` never matches - i.e. it would vanish
-- from search entirely. Give those their own number at least.
update public.order_dispatches d
   set search_text = trim(regexp_replace(
         lower(coalesce(d.dispatch_number, '') || ' ' ||
               public.order_dispatches_custom_search_text(d.id)), '\s+', ' ', 'g'))
 where d.search_text is null;

create index if not exists order_dispatches_search_text_trgm
  on public.order_dispatches using gin (search_text gin_trgm_ops);
create index if not exists order_dispatches_customer_name_trgm
  on public.order_dispatches using gin (customer_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- expenses — Expenses
-- Searched by: employee, expense type, custom fields.
-- NOTE employee_id is a profiles.id here, not an auth uid.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.expenses add column if not exists employee_name text;
alter table public.expenses add column if not exists expense_type_name text;
alter table public.expenses add column if not exists search_text text;

create or replace function public.expenses_custom_search_text(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.expense_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.expense_id = p_id
    and coalesce(f.is_searchable, true) and coalesce(f.is_active, true)
    and v.value is not null and v.value <> '';
$$;

create or replace function public.expenses_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_employee text;
  v_type text;
begin
  select p.full_name into v_employee
    from public.profiles p where p.id = new.employee_id;
  select t.expense_name into v_type
    from public.expense_types t where t.id = new.expense_type_id;

  new.employee_name := v_employee;
  new.expense_type_name := v_type;
  new.search_text := trim(regexp_replace(
    lower(
      coalesce(v_employee, '') || ' ' ||
      coalesce(v_type, '') || ' ' ||
      public.expenses_custom_search_text(new.id)
    ), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists expenses_search_columns on public.expenses;
create trigger expenses_search_columns
  before insert or update of employee_id, expense_type_id
  on public.expenses
  for each row execute function public.expenses_fill_search_columns();

create or replace function public.expenses_refresh_from_custom_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(new.expense_id, old.expense_id);
begin
  update public.expenses e
     set search_text = trim(regexp_replace(
           lower(
             coalesce(e.employee_name, '') || ' ' ||
             coalesce(e.expense_type_name, '') || ' ' ||
             public.expenses_custom_search_text(e.id)
           ), '\s+', ' ', 'g'))
   where e.id = v_id;
  return null;
end;
$$;

drop trigger if exists expense_custom_values_refresh_search on public.expense_custom_values;
create trigger expense_custom_values_refresh_search
  after insert or update or delete on public.expense_custom_values
  for each row execute function public.expenses_refresh_from_custom_value();

alter table public.expenses disable trigger set_expenses_updated_at;

update public.expenses e
   set employee_name = d.employee_name,
       expense_type_name = d.expense_type_name,
       search_text = trim(regexp_replace(
         lower(
           coalesce(d.employee_name, '') || ' ' ||
           coalesce(d.expense_type_name, '') || ' ' ||
           public.expenses_custom_search_text(e.id)
         ), '\s+', ' ', 'g'))
  from (
    select e2.id,
           (select p.full_name from public.profiles p where p.id = e2.employee_id) as employee_name,
           (select t.expense_name from public.expense_types t where t.id = e2.expense_type_id) as expense_type_name
      from public.expenses e2
  ) d
 where d.id = e.id and e.search_text is null;

alter table public.expenses enable trigger set_expenses_updated_at;

create index if not exists expenses_search_text_trgm
  on public.expenses using gin (search_text gin_trgm_ops);
create index if not exists expenses_employee_name_trgm
  on public.expenses using gin (employee_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- payments — Payments
-- Searched by: payment number (own), customer, reference number (own),
-- custom fields. Payment type is a column filter.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.payments add column if not exists customer_name text;
alter table public.payments add column if not exists payment_type_name text;
alter table public.payments add column if not exists search_text text;

create or replace function public.payments_custom_search_text(p_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.payment_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.payment_id = p_id
    and coalesce(f.is_searchable, true) and coalesce(f.is_active, true)
    and v.value is not null and v.value <> '';
$$;

create or replace function public.payments_fill_search_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_customer text;
  v_type text;
begin
  select coalesce(nullif(c.company, ''), c.name) into v_customer
    from public.contacts c where c.id = new.contact_id;
  select t.name into v_type
    from public.payment_types t where t.id = new.payment_type_id;

  new.customer_name := v_customer;
  new.payment_type_name := v_type;
  new.search_text := trim(regexp_replace(
    lower(
      coalesce(new.payment_number, '') || ' ' ||
      coalesce(v_customer, '') || ' ' ||
      coalesce(new.reference_number, '') || ' ' ||
      public.payments_custom_search_text(new.id)
    ), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists payments_search_columns on public.payments;
create trigger payments_search_columns
  before insert or update of payment_number, reference_number, contact_id, payment_type_id
  on public.payments
  for each row execute function public.payments_fill_search_columns();

create or replace function public.payments_refresh_from_custom_value()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(new.payment_id, old.payment_id);
begin
  update public.payments p
     set search_text = trim(regexp_replace(
           lower(
             coalesce(p.payment_number, '') || ' ' ||
             coalesce(p.customer_name, '') || ' ' ||
             coalesce(p.reference_number, '') || ' ' ||
             public.payments_custom_search_text(p.id)
           ), '\s+', ' ', 'g'))
   where p.id = v_id;
  return null;
end;
$$;

drop trigger if exists payment_custom_values_refresh_search on public.payment_custom_values;
create trigger payment_custom_values_refresh_search
  after insert or update or delete on public.payment_custom_values
  for each row execute function public.payments_refresh_from_custom_value();

alter table public.payments disable trigger trg_payment_attachment_on_approval;
alter table public.payments disable trigger trg_payment_required_fields;
alter table public.payments disable trigger trg_payment_status_transition;
alter table public.payments disable trigger update_payments_updated_at;

update public.payments p
   set customer_name = d.customer_name,
       payment_type_name = d.payment_type_name,
       search_text = trim(regexp_replace(
         lower(
           coalesce(p.payment_number, '') || ' ' ||
           coalesce(d.customer_name, '') || ' ' ||
           coalesce(p.reference_number, '') || ' ' ||
           public.payments_custom_search_text(p.id)
         ), '\s+', ' ', 'g'))
  from (
    select p2.id,
           (select coalesce(nullif(c.company, ''), c.name) from public.contacts c where c.id = p2.contact_id) as customer_name,
           (select t.name from public.payment_types t where t.id = p2.payment_type_id) as payment_type_name
      from public.payments p2
  ) d
 where d.id = p.id and p.search_text is null;

alter table public.payments enable trigger update_payments_updated_at;
alter table public.payments enable trigger trg_payment_status_transition;
alter table public.payments enable trigger trg_payment_required_fields;
alter table public.payments enable trigger trg_payment_attachment_on_approval;

create index if not exists payments_search_text_trgm
  on public.payments using gin (search_text gin_trgm_ops);
create index if not exists payments_customer_name_trgm
  on public.payments using gin (customer_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- Keep the denormalised customer names current when a customer is renamed.
-- One trigger on contacts refreshing all four tables, rather than four.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.refresh_denormalised_customer_names()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := coalesce(nullif(new.company, ''), new.name);
begin
  update public.site_visits v
     set customer_name = v_name,
         search_text = trim(regexp_replace(
           lower(coalesce(v_name, '') || ' ' || coalesce(v.visited_by_name, '')), '\s+', ' ', 'g'))
   where coalesce(v.target_id, v.contact_id) = new.id;

  update public.payments p
     set customer_name = v_name,
         search_text = trim(regexp_replace(
           lower(
             coalesce(p.payment_number, '') || ' ' || coalesce(v_name, '') || ' ' ||
             coalesce(p.reference_number, '') || ' ' || public.payments_custom_search_text(p.id)
           ), '\s+', ' ', 'g'))
   where p.contact_id = new.id;

  update public.order_dispatches d
     set customer_name = v_name,
         search_text = trim(regexp_replace(
           lower(
             coalesce(d.dispatch_number, '') || ' ' || coalesce(d.order_number, '') || ' ' ||
             coalesce(v_name, '') || ' ' || public.order_dispatches_custom_search_text(d.id)
           ), '\s+', ' ', 'g'))
   where d.order_id in (select o.id from public.orders o where o.contact_id = new.id);

  return null;
end;
$$;

drop trigger if exists contacts_refresh_denormalised_names on public.contacts;
create trigger contacts_refresh_denormalised_names
  after update of name, company on public.contacts
  for each row
  when (old.name is distinct from new.name or old.company is distinct from new.company)
  execute function public.refresh_denormalised_customer_names();
