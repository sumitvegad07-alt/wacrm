-- Orders list: search and filter in the database instead of in the browser.
--
-- The Orders screen downloaded every order in the account (`select *` with no
-- limit), joined contacts/leads/profiles client-side to work out a customer and
-- salesman name, pulled every order_custom_values row, and then searched and
-- filtered the lot in JavaScript. Fine at 200 orders, fatal at 200,000 —
-- docs/engineering/WEB_PERFORMANCE_RESEARCH_2026-10-12.md has the measurements.
--
-- Moving that to the server needs three things the row did not have:
--
--   customer_name  the name the screen shows and filters on, from contacts or
--                  (for an order raised against a lead) from leads
--   salesman_name  from profiles. NOTE orders.user_id is the AUTH uid, i.e.
--                  profiles.user_id, NOT profiles.id. Keying by profiles.id
--                  made every salesman read "Unknown" once before.
--   search_text    one lowercase haystack: order number + both names + every
--                  SEARCHABLE custom field value, so the screen's single
--                  search box is one indexed `ilike` instead of a download.
--
-- Denormalised rather than joined because PostgREST cannot express "my own
-- order number OR the customer's company name" in one `.or()`, and because a
-- per-column filter on customerName has to hit a real column.

create extension if not exists pg_trgm;

alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists salesman_name text;
alter table public.orders add column if not exists search_text text;

-- ───────────────────────────────────────────────────────────────────────────
-- The custom-field half of the haystack.
--
-- Only fields the admin marked searchable, matching what
-- matchesSearchableCustomFields() did in the browser: it skipped
-- is_searchable = false and is_active = false.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.orders_custom_search_text(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(string_agg(lower(v.value), ' '), '')
  from public.order_custom_values v
  join public.custom_fields f on f.id = v.custom_field_id
  where v.order_id = p_order_id
    and coalesce(f.is_searchable, true)
    and coalesce(f.is_active, true)
    and v.value is not null
    and v.value <> '';
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- BEFORE trigger on orders: fills the three columns on the row being written.
--
-- Listed on `update of` the source columns only, so the set-based refreshes
-- further down (which write customer_name / salesman_name / search_text) do
-- not re-fire it. That is what keeps this from recursing.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.orders_fill_search_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer text;
  v_salesman text;
begin
  select coalesce(nullif(c.company, ''), c.name)
    into v_customer
    from public.contacts c
   where c.id = new.contact_id;

  if v_customer is null and new.lead_id is not null then
    select coalesce(nullif(l.company, ''), l.name)
      into v_customer
      from public.leads l
     where l.id = new.lead_id;
  end if;

  select p.full_name
    into v_salesman
    from public.profiles p
   where p.user_id = new.user_id
   limit 1;

  new.customer_name := v_customer;
  new.salesman_name := v_salesman;
  new.search_text := trim(regexp_replace(
    lower(
      coalesce(new.order_number, '') || ' ' ||
      coalesce(v_customer, '') || ' ' ||
      coalesce(v_salesman, '') || ' ' ||
      public.orders_custom_search_text(new.id)
    ),
    '\s+', ' ', 'g'));

  return new;
end;
$$;

drop trigger if exists orders_search_columns on public.orders;
create trigger orders_search_columns
  before insert or update of order_number, contact_id, lead_id, user_id
  on public.orders
  for each row execute function public.orders_fill_search_columns();

-- ───────────────────────────────────────────────────────────────────────────
-- Keep the haystack current when the things it copied change.
--
-- These write only the derived columns, so the BEFORE trigger above (which
-- watches the source columns) does not fire again.
-- ───────────────────────────────────────────────────────────────────────────

-- A custom value was added, edited or cleared.
create or replace function public.orders_refresh_from_custom_value()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
     set search_text = trim(regexp_replace(
           lower(
             coalesce(o.order_number, '') || ' ' ||
             coalesce(o.customer_name, '') || ' ' ||
             coalesce(o.salesman_name, '') || ' ' ||
             public.orders_custom_search_text(o.id)
           ), '\s+', ' ', 'g'))
   where o.id = v_order_id;
  return null;
end;
$$;

drop trigger if exists order_custom_values_refresh_search on public.order_custom_values;
create trigger order_custom_values_refresh_search
  after insert or update or delete on public.order_custom_values
  for each row execute function public.orders_refresh_from_custom_value();

-- A customer was renamed. Without this, searching for the new name would not
-- find orders raised before the rename.
create or replace function public.orders_refresh_from_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.orders o
     set customer_name = coalesce(nullif(new.company, ''), new.name),
         search_text = trim(regexp_replace(
           lower(
             coalesce(o.order_number, '') || ' ' ||
             coalesce(coalesce(nullif(new.company, ''), new.name), '') || ' ' ||
             coalesce(o.salesman_name, '') || ' ' ||
             public.orders_custom_search_text(o.id)
           ), '\s+', ' ', 'g'))
   where o.contact_id = new.id;
  return null;
end;
$$;

drop trigger if exists contacts_refresh_order_search on public.contacts;
create trigger contacts_refresh_order_search
  after update of name, company on public.contacts
  for each row
  when (old.name is distinct from new.name or old.company is distinct from new.company)
  execute function public.orders_refresh_from_contact();

-- An employee was renamed.
create or replace function public.orders_refresh_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.orders o
     set salesman_name = new.full_name,
         search_text = trim(regexp_replace(
           lower(
             coalesce(o.order_number, '') || ' ' ||
             coalesce(o.customer_name, '') || ' ' ||
             coalesce(new.full_name, '') || ' ' ||
             public.orders_custom_search_text(o.id)
           ), '\s+', ' ', 'g'))
   where o.user_id = new.user_id;
  return null;
end;
$$;

drop trigger if exists profiles_refresh_order_search on public.profiles;
create trigger profiles_refresh_order_search
  after update of full_name on public.profiles
  for each row
  when (old.full_name is distinct from new.full_name)
  execute function public.orders_refresh_from_profile();

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill.
--
-- NOT by touching order_number to make the trigger fire. `orders` carries
-- three triggers that are NOT scoped to a column list and would all run on a
-- no-op write:
--
--   set_updated_at                       BEFORE UPDATE, unscoped. Would stamp
--                                        now() on every order in the database.
--                                        Mobile's offline sync pages by
--                                        updated_at, so that would look like
--                                        every order had just been edited.
--   trg_enforce_order_credit_limit       BEFORE INSERT OR UPDATE, unscoped, and
--                                        it RAISES. Any customer currently over
--                                        their limit would abort the backfill.
--   trg_enforce_order_status_transition  BEFORE UPDATE, unscoped.
--
-- So: disable exactly those three, write the derived columns directly, put them
-- back. ALTER ... DISABLE TRIGGER takes an ACCESS EXCLUSIVE lock, which is the
-- point — concurrent writers wait rather than slipping past credit enforcement.
-- It is transactional, so a failure anywhere here rolls the disabling back too.
--
-- The new orders_search_columns trigger is left enabled on purpose: it watches
-- order_number / contact_id / lead_id / user_id, none of which this writes, so
-- it does not fire and does not fight the statement below.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.orders disable trigger set_updated_at;
alter table public.orders disable trigger trg_enforce_order_credit_limit;
alter table public.orders disable trigger trg_enforce_order_status_transition;

update public.orders o
   set customer_name = d.customer_name,
       salesman_name = d.salesman_name,
       search_text = trim(regexp_replace(
         lower(
           coalesce(o.order_number, '') || ' ' ||
           coalesce(d.customer_name, '') || ' ' ||
           coalesce(d.salesman_name, '') || ' ' ||
           public.orders_custom_search_text(o.id)
         ), '\s+', ' ', 'g'))
  from (
    select o2.id,
           coalesce(
             (select coalesce(nullif(c.company, ''), c.name)
                from public.contacts c where c.id = o2.contact_id),
             (select coalesce(nullif(l.company, ''), l.name)
                from public.leads l where l.id = o2.lead_id)
           ) as customer_name,
           (select p.full_name
              from public.profiles p where p.user_id = o2.user_id limit 1) as salesman_name
      from public.orders o2
  ) d
 where d.id = o.id
   and o.search_text is null;

alter table public.orders enable trigger trg_enforce_order_status_transition;
alter table public.orders enable trigger trg_enforce_order_credit_limit;
alter table public.orders enable trigger set_updated_at;

-- ───────────────────────────────────────────────────────────────────────────
-- Indexes.
--
-- The trigram GIN index is what makes `search_text ilike '%x%'` an index scan;
-- a plain btree cannot serve a leading-wildcard match at all. The composite
-- index serves the list's own shape: this account's orders, newest first.
-- ───────────────────────────────────────────────────────────────────────────
create index if not exists orders_search_text_trgm
  on public.orders using gin (search_text gin_trgm_ops);

create index if not exists orders_account_created_idx
  on public.orders (account_id, created_at desc);

create index if not exists orders_customer_name_trgm
  on public.orders using gin (customer_name gin_trgm_ops);

create index if not exists orders_salesman_name_trgm
  on public.orders using gin (salesman_name gin_trgm_ops);
