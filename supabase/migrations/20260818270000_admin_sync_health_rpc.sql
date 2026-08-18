-- Sync + error inspector for the superadmin console.
-- Applied to production 2026-08-18.
--
-- Answers "the order didn't sync / the automation didn't fire" without SQL.
-- Aggregates the queues that can silently stall:
--   * automation_events              — the business-event queue
--   * automation_pending_executions  — scheduled follow-up steps
--   * orders.pricing_status='review' — offline sync price drift
--
-- The `stuck` count is the important one: events enqueued but never attempted.
-- A failure at least leaves an error; an event with attempts = 0 sitting for
-- days means nothing is consuming the queue at all, which produces no error
-- anywhere and is invisible without this. On first run against production it
-- reported 39 such events across 3 tenants, none ever processed.

create or replace function public.admin_sync_health()
returns table (
  account_id         uuid,
  name               text,
  events_pending     bigint,
  events_failed      bigint,
  events_done        bigint,
  events_stuck       bigint,
  last_event_at      timestamptz,
  last_processed_at  timestamptz,
  pending_steps      bigint,
  orders_in_review   bigint,
  deliveries_failed  bigint
)
language sql
security definer
set search_path to 'public'
as $$
  select
    a.id,
    a.name,
    (select count(*) from automation_events e
      where e.account_id = a.id and e.status = 'pending'),
    (select count(*) from automation_events e
      where e.account_id = a.id and e.status = 'failed'),
    (select count(*) from automation_events e
      where e.account_id = a.id and e.status in ('processed', 'skipped')),
    (select count(*) from automation_events e
      where e.account_id = a.id
        and e.status = 'pending'
        and coalesce(e.attempts, 0) = 0
        and e.occurred_at < now() - interval '1 hour'),
    (select max(e.occurred_at) from automation_events e where e.account_id = a.id),
    (select max(e.processed_at) from automation_events e where e.account_id = a.id),
    (select count(*) from automation_pending_executions pe
      where pe.account_id = a.id and pe.status = 'pending'),
    (select count(*) from orders o
      where o.account_id = a.id and o.pricing_status = 'review'),
    (select count(*) from automation_event_deliveries d
      where d.account_id = a.id and d.status = 'failed')
  from accounts a
  where a.deleted_at is null
  order by a.name;
$$;

revoke execute on function public.admin_sync_health() from public, anon, authenticated;
grant execute on function public.admin_sync_health() to service_role;
