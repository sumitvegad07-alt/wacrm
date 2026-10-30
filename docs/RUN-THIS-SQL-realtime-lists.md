# Run this one SQL block in Supabase

**Why:** your lists (Orders, Payments, Customers, Leads, Expenses, Tasks and the rest)
were supposed to refresh themselves whenever a row changed — for example when a
salesman books an order on his phone while you have the Orders page open.

The apps ask the database to notify them. But a Postgres database only sends those
notifications for tables that have been explicitly added to a list called a
*publication*, and none of your business tables were ever added to it. Ten unrelated
tables were (chat messages, location pings and so on). Orders, Payments, Customers,
Leads, Expenses, Tasks, Deals, Quotations, Products and Schemes were not.

So every one of those "watch this table" requests connected, reported success, and
then never fired. The entry was in the database the whole time. The screen simply
had no way of learning about it.

This block adds the thirteen tables the apps already watch. It is safe to run twice,
and it skips any table that is not in this database.

## How to run it

1. Open <https://supabase.com/dashboard/project/ltigfpywdbfilsagtpyd/sql/new>
2. Paste the whole block below.
3. Press **Run**.
4. You should see a list of `realtime: added public.<table>` notices. Any line saying
   `already published` is fine — it just means that table was already on the list.

Nothing breaks if you don't run it: the apps also re-read a list whenever you come
back to the tab after being away, which shipped in commit `988f31f`. Running this is
what makes a list update *instantly*, without you doing anything.

## The SQL

```sql
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'contacts',
    'leads',
    'deals',
    'quotations',
    'orders',
    'payments',
    'expenses',
    'tasks',
    'products',
    'schemes',
    'scheme_slabs',
    'scheme_products',
    'scheme_customers'
  ])
  loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise notice 'realtime: skipping public.% (table not present)', t;
      continue;
    end if;

    if exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      raise notice 'realtime: public.% already published', t;
      continue;
    end if;

    execute format('alter publication supabase_realtime add table public.%I', t);
    raise notice 'realtime: added public.%', t;
  end loop;
end
$$;
```

## How to check it worked

Run this afterwards. You should get thirteen rows back plus the ten that were
already there:

```sql
select tablename
from pg_catalog.pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
```

## One thing it deliberately does not do

It leaves each table's *replica identity* alone. That means a **deleted** row may not
be announced instantly — it disappears the next time the list is read instead. The
alternative makes the database write a full copy of every changed row to its
replication log, which costs write performance on your busiest tables to deliver old
values nothing reads. Adds and edits — which is what you were missing — are announced
either way.

---

Same content as `supabase/migrations/20261030120000_realtime_core_list_tables.sql`,
which is the copy kept in the repository.
