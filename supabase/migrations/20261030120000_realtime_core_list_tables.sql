-- ============================================================
-- Put the core business tables on the realtime publication.
--
-- The bug this fixes:
--   Both apps call `useRealtimeRefresh(<table>, reload)` so a list refreshes
--   itself when a row is added or changed somewhere else — a rep booking an
--   order on the phone, a second browser tab, an import finishing. The hook is
--   wired correctly in fourteen screens and its callback is the table's own
--   reload.
--
--   But Postgres only streams changes for tables that belong to the
--   `supabase_realtime` publication, and only ten tables were ever added to it
--   (messages, conversations, message_reactions, flow_runs, member_presence,
--   location_pings, site_visits, tracking_sessions, import_jobs,
--   notifications). None of the list tables were. So every one of those
--   subscriptions connected, succeeded, and then never fired: the entry existed
--   in the database and simply never appeared on screen until someone reloaded
--   the page by hand.
--
-- Scope: exactly the tables the two clients already subscribe to. site_visits
-- is deliberately absent — migration 043 added it years ago.
--
-- Replica identity is left at DEFAULT (primary key). The subscribers only need
-- to know *that* something changed, and they re-query for themselves; FULL
-- would multiply WAL volume on these tables to deliver old row values nobody
-- reads. One consequence worth knowing: with DEFAULT, a DELETE carries only the
-- key, so RLS cannot be evaluated on it and that event may not be delivered —
-- a deleted row disappears on the next load rather than instantly.
--
-- Idempotent: safe to run twice, and safe if some table was added by hand in
-- the dashboard in the meantime.
-- ============================================================

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
    -- Skip a table that does not exist in this database rather than failing the
    -- whole migration: the scheme_* tables arrived with the scheme engine and a
    -- branch database may not have them yet.
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
