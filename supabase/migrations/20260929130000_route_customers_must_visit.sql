-- ============================================================
-- "Must visit" customers on a route.
--
-- A route already carries an ORDER (route_customers.sequence) -- the sequence the
-- rep is asked to work through. That says what to do first; it does not say what
-- cannot be missed. Admins asked to be able to mark the handful of customers on a
-- route that have to be visited that day, so the rep can see them at a glance and
-- is asked to account for any they skip.
--
-- Deliberately a plain boolean, not a priority scale: the question being answered
-- is yes/no, and every route that exists today answers "no" for every customer,
-- which is exactly the default. A route with none marked shows no badge anywhere
-- and behaves precisely as it does now.
--
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.route_customers
  add column if not exists must_visit boolean not null default false;

comment on column public.route_customers.must_visit is
  'Admin marked this stop as one the rep must not skip. Shown highlighted on mobile; skipping one is warned about (never blocked) when the route is completed.';

-- Only the marked rows are ever looked up, and they are a small minority of a
-- route''s stops, so a partial index keeps this cheap.
create index if not exists idx_route_customers_must_visit
  on public.route_customers (route_id)
  where must_visit and archived_at is null;
