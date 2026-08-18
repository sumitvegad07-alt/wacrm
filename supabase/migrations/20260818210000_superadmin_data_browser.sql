-- Superadmin data browser: audit trail + schema introspection.
-- Applied to production 2026-08-18. Recorded here so the repo reproduces prod.

-- ------------------------------------------------------------
-- 1. Audit trail
-- ------------------------------------------------------------
-- Every READ through the browser lands here, not just writes: the browser is a
-- privileged cross-tenant access tool, so "who looked at which tenant's data,
-- with what filter, when" is the thing that needs an answer later.

create table if not exists public.superadmin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_email   text,
  action        text not null,
  table_name    text,
  -- Tenant whose data was touched. Null when the read spans tenants
  -- (an unfiltered browse), which is itself worth being able to search for.
  target_account_id uuid,
  filters       jsonb not null default '{}'::jsonb,
  row_count     integer,
  created_at    timestamptz not null default now()
);

create index if not exists superadmin_audit_log_created_at_idx
  on public.superadmin_audit_log (created_at desc);
create index if not exists superadmin_audit_log_actor_idx
  on public.superadmin_audit_log (actor_user_id, created_at desc);
create index if not exists superadmin_audit_log_target_idx
  on public.superadmin_audit_log (target_account_id, created_at desc);

alter table public.superadmin_audit_log enable row level security;

-- Readable by superadmins only. There is deliberately no INSERT/UPDATE/DELETE
-- policy: writes come from the service-role client inside the guarded routes,
-- which bypasses RLS. That also means an actor cannot erase their own trail.
drop policy if exists superadmin_audit_log_select on public.superadmin_audit_log;
create policy superadmin_audit_log_select on public.superadmin_audit_log
  for select using (is_superadmin());

revoke insert, update, delete on public.superadmin_audit_log from authenticated, anon;

-- ------------------------------------------------------------
-- 2. Schema introspection
-- ------------------------------------------------------------
-- PostgREST cannot read information_schema directly, so the browser needs these.
--
-- EXECUTE is granted to service_role ONLY. A SECURITY DEFINER function that
-- authenticated could call would be a schema-disclosure hole; the guarded
-- /api/admin routes verify superadmin first and then call these through the
-- service-role client.

create or replace function public.admin_list_tables()
returns table (table_name text, row_estimate bigint, has_account_id boolean)
language sql
security definer
set search_path to 'public'
as $$
  select
    c.relname::text,
    greatest(c.reltuples, 0)::bigint,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'account_id' and a.attnum > 0
        and not a.attisdropped
    )
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind = 'r'
  order by c.relname;
$$;

create or replace function public.admin_table_columns(p_table text)
returns table (column_name text, data_type text, is_nullable boolean, ordinal_position integer)
language sql
security definer
set search_path to 'public'
as $$
  select
    a.attname::text,
    format_type(a.atttypid, a.atttypmod)::text,
    not a.attnotnull,
    a.attnum::integer
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace
    and c.relkind = 'r'
    and c.relname = p_table
    and a.attnum > 0
    and not a.attisdropped
  order by a.attnum;
$$;

revoke execute on function public.admin_list_tables() from public, anon, authenticated;
revoke execute on function public.admin_table_columns(text) from public, anon, authenticated;
grant execute on function public.admin_list_tables() to service_role;
grant execute on function public.admin_table_columns(text) to service_role;
