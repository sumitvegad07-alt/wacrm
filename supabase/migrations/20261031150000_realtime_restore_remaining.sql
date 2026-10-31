-- Put the rest of the subscribed tables back on the realtime publication.
--
-- How this was found: after running 20261030120000 (the thirteen list tables),
-- the founder read back the publication and it contained those thirteen and
-- nothing else. Not one of the ten tables that earlier migrations had added —
-- messages and conversations (001), message_reactions (009), flow_runs (010),
-- member_presence (024), location_pings / site_visits / tracking_sessions
-- (043), import_jobs (universal import), notifications
-- (20260918120000_notifications_foundation) — was there.
--
-- Those migrations all ran. The publication was emptied afterwards, which
-- points squarely at the move to Mumbai: a dump and restore recreates
-- `supabase_realtime` but does not necessarily carry its membership across, and
-- nothing in the app complains when a subscription quietly never fires. So
-- every realtime feature in both apps has been dead since that move, silently:
--
--   * the WhatsApp Inbox has not shown an incoming message until the page was
--     reloaded (messages, conversations),
--   * the unread badge has not moved on its own (conversations),
--   * the notification bell has not updated (notifications),
--   * reactions have not appeared live in a thread (message_reactions),
--   * the live field map has not drawn a rep's pings as they arrive
--     (location_pings),
--   * the who-is-online dots have not changed (member_presence),
--   * an import has not announced its own completion (import_jobs),
--   * and on mobile, a permission or role change has not propagated to a
--     device until the app was restarted (profiles, employee_roles, accounts),
--     nor have pipeline, quotation or announcement changes.
--
-- Scope: exactly the tables one of the two apps subscribes to with
-- `postgres_changes` today, enumerated from the source rather than from the old
-- migrations. Three tables the old migrations published have deliberately NOT
-- been restored, because nothing listens to them any more and an unlistened
-- publication is pure write cost: site_visits (26k rows), tracking_sessions
-- (6k) and flow_runs. Add them back the day something subscribes.
--
-- Worth knowing about two of these. `location_pings` is the highest-write table
-- in the schema — every rep, every minute — so publishing it is a real, ongoing
-- replication cost, accepted here because the live field map is the feature it
-- pays for. And `profiles` / `accounts` carry tenant data, so their safety on
-- the realtime stream rests entirely on their RLS policies being correct; those
-- are the policies the October 2026 cross-tenant fixes rewrote, and realtime
-- applies them per subscriber exactly as a SELECT would.
--
-- Idempotent, and skips a table that is not present in this database.

do $$
declare
  t text;
begin
  for t in select unnest(array[
    -- Web
    'conversations',
    'messages',
    'message_reactions',
    'notifications',
    'import_jobs',
    'location_pings',
    'member_presence',
    -- Mobile
    'accounts',
    'employee_roles',
    'pipelines',
    'profiles',
    'tenant_announcements'
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
