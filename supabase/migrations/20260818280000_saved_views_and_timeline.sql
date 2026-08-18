-- Saved Data Browser views + customer timeline.
-- Applied to production 2026-08-18.

-- ------------------------------------------------------------
-- 1. Saved views
-- ------------------------------------------------------------
-- Personal to the superadmin who created them. No sharing in v1: a shared view
-- would need its own permission model, and there is currently one superadmin.

create table if not exists public.admin_saved_views (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  table_name  text not null,
  filters     jsonb not null default '[]'::jsonb,
  sort        text,
  dir         text,
  account_id  uuid,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);

alter table public.admin_saved_views enable row level security;

drop policy if exists admin_saved_views_owner on public.admin_saved_views;
create policy admin_saved_views_owner on public.admin_saved_views
  for select using (owner_id = auth.uid() and is_superadmin());

revoke insert, update, delete on public.admin_saved_views from authenticated, anon;

-- ------------------------------------------------------------
-- 2. Customer timeline
-- ------------------------------------------------------------
-- One chronological view of what happened to a tenant, assembled from records
-- that already exist rather than a new event log. Nothing new is written, so
-- the timeline is correct for history that predates this feature — a fresh
-- event table would have started empty and been useless for exactly the
-- "something broke yesterday" question it exists to answer.

create or replace function public.admin_account_timeline(p_account_id uuid)
returns table (
  occurred_at timestamptz,
  category    text,
  summary     text,
  detail      jsonb
)
language sql
security definer
set search_path to 'public'
as $$
  select a.created_at, 'account', 'Company created', jsonb_build_object('plan', a.subscription_plan)
    from accounts a where a.id = p_account_id

  union all
  select a.deleted_at, 'account', 'Company deleted', jsonb_build_object('purge_after', a.purge_after)
    from accounts a where a.id = p_account_id and a.deleted_at is not null

  union all
  select p.created_at, 'user', 'User added: ' || coalesce(p.full_name, p.email),
         jsonb_build_object('role', p.account_role)
    from profiles p where p.account_id = p_account_id

  union all
  -- Superadmin actions against this tenant. Plan changes, module toggles,
  -- deletes and restores all appear here, because the admin console records
  -- every one of them with before/after.
  select l.created_at, 'admin', l.action || coalesce(' by ' || l.actor_email, ''), l.filters
    from superadmin_audit_log l where l.target_account_id = p_account_id

  union all
  -- Commercial activity, bucketed by day so a busy tenant does not drown the
  -- timeline in one row per order.
  select date_trunc('day', o.created_at), 'orders',
         count(*) || ' order(s) created', jsonb_build_object('count', count(*))
    from orders o where o.account_id = p_account_id
    group by 1

  union all
  select date_trunc('day', pm.created_at), 'payments',
         count(*) || ' payment(s) recorded',
         jsonb_build_object('count', count(*), 'total', sum(pm.amount))
    from payments pm where pm.account_id = p_account_id
    group by 1

  union all
  select t.created_at, 'announcement', 'Announcement: ' || t.title, '{}'::jsonb
    from tenant_announcements t where t.account_id = p_account_id

  order by 1 desc
  limit 300;
$$;

revoke execute on function public.admin_account_timeline(uuid) from public, anon, authenticated;
grant execute on function public.admin_account_timeline(uuid) to service_role;
