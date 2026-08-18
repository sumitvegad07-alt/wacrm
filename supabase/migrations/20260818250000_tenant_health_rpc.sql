-- Per-tenant health for the superadmin command centre.
-- Applied to production 2026-08-18.
--
-- One round trip for every tenant rather than N queries from the route: the
-- panel needs the whole fleet at once, and issuing ~10 counts per tenant from
-- JS would be 170 queries for 17 tenants.
--
-- EXECUTE is service_role only, matching the other admin_* introspection
-- functions. The guarded /api/admin routes verify superadmin before calling.

create or replace function public.admin_tenant_health()
returns table (
  account_id           uuid,
  name                 text,
  subscription_plan    text,
  subscription_status  text,
  created_at           timestamptz,
  user_count           bigint,
  last_login_at        timestamptz,
  contacts             bigint,
  orders               bigint,
  payments             bigint,
  payments_total       numeric,
  records_last_7d      bigint,
  last_ping_at         timestamptz,
  open_sessions        bigint,
  last_device_report   timestamptz,
  failed_automations   bigint,
  stalled_flows        bigint
)
language sql
security definer
set search_path to 'public'
as $$
  select
    a.id,
    a.name,
    a.subscription_plan,
    a.subscription_status,
    a.created_at,
    (select count(*) from profiles p where p.account_id = a.id),
    (select max(u.last_sign_in_at)
       from profiles p join auth.users u on u.id = p.user_id
      where p.account_id = a.id),
    (select count(*) from contacts c where c.account_id = a.id),
    (select count(*) from orders o where o.account_id = a.id),
    (select count(*) from payments pm where pm.account_id = a.id),
    coalesce((select sum(pm.amount) from payments pm where pm.account_id = a.id), 0),
    -- Activity proxy: new orders + contacts in the last week. A tenant with a
    -- login but no records is quietly churning, which a login date alone hides.
    (select count(*) from orders o
      where o.account_id = a.id and o.created_at > now() - interval '7 days')
    + (select count(*) from contacts c
        where c.account_id = a.id and c.created_at > now() - interval '7 days'),
    (select max(lp.recorded_at) from location_pings lp where lp.account_id = a.id),
    (select count(*) from tracking_sessions ts
      where ts.account_id = a.id and ts.ended_at is null),
    (select max(d.received_at) from device_health_snapshots d where d.account_id = a.id),
    (select count(*) from automation_logs al
      where al.account_id = a.id and al.status = 'failed'
        and al.created_at > now() - interval '7 days'),
    -- A flow that started but never ended and has not advanced in a day is stuck.
    (select count(*) from flow_runs fr
      where fr.account_id = a.id and fr.ended_at is null
        and fr.last_advanced_at < now() - interval '1 day')
  from accounts a
  order by a.name;
$$;

revoke execute on function public.admin_tenant_health() from public, anon, authenticated;
grant execute on function public.admin_tenant_health() to service_role;
