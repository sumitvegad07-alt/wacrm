-- ============================================================
-- A customer can be added to a route for ONE day without losing their own route.
--
-- Why: the founder hit the raw Postgres message
--   duplicate key value violates unique constraint "uq_route_customers_one_active_route"
-- while adding customers to "150 Feet Ring Road". That index (migration 108) is the
-- one-customer-one-active-route rule, and it was doing its job — the customer was
-- already on another route. The dialog simply offered a "+ Add" button that the
-- database was always going to refuse, and showed the constraint name to the user.
--
-- The decision (2026-11-02) is that adding such a customer is allowed, after asking,
-- and the admin then chooses between two things:
--
--   * keep them here ALWAYS   → a real move: the old route's row goes, this one stays
--   * keep them here ONE TIME → this route visits them on one date only, and their
--                               own route is left exactly as it was
--
-- The second case is what this migration makes possible. A one-time row carries the
-- date it applies to and is deliberately OUTSIDE the one-active-route rule, because
-- the whole point is that it does not take the customer away from their home route.
-- ============================================================

ALTER TABLE public.route_customers
  ADD COLUMN IF NOT EXISTS one_time_date date NULL;

COMMENT ON COLUMN public.route_customers.one_time_date IS
  'NULL = a permanent member of this route (the normal case). A date = this route visits '
  'this customer on that date only, without removing them from the route they belong to. '
  'Day reads must include a one-time row only when its date is the day being asked about.';

-- One customer belongs to at most one *non-archived*, *permanent* route. One-time rows
-- are excluded: a customer parked on another route for a day still belongs to their own.
DROP INDEX IF EXISTS public.uq_route_customers_one_active_route;
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_customers_one_active_route
  ON public.route_customers (account_id, contact_id)
  WHERE archived_at IS NULL AND one_time_date IS NULL;

-- "A customer appears at most once within a route" has to become "…once as a permanent
-- member, and at most once per one-time date" — otherwise a route could never host the
-- same customer on two different days.
ALTER TABLE public.route_customers
  DROP CONSTRAINT IF EXISTS uq_route_customers_route_contact;

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_customers_route_contact_permanent
  ON public.route_customers (route_id, contact_id)
  WHERE one_time_date IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_customers_route_contact_one_time
  ON public.route_customers (route_id, contact_id, one_time_date)
  WHERE one_time_date IS NOT NULL;

-- Day reads filter on it, so give them an index.
CREATE INDEX IF NOT EXISTS route_customers_one_time_date_idx
  ON public.route_customers (one_time_date)
  WHERE one_time_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- get_route_for is THE resolver for "which route runs today" (migration 111), so
-- it is the one place that has to know a one-time stop belongs to one date. Without
-- this the stop would show up on every run of the route, which is the opposite of
-- what the admin asked for. Unchanged apart from that single WHERE clause.
-- ---------------------------------------------------------------------------
create or replace function public.get_route_for(p_assignee_id uuid, p_date date default current_date)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_account uuid;
  v_dow smallint;
  v_assign public.route_plan_assignments;
  v_route public.routes;
  v_customers jsonb;
begin
  v_account := (select account_id from public.profiles where id = p_assignee_id);
  if v_account is null
     or not coalesce((select (module_settings->>'route')::boolean from public.accounts where id = v_account), false) then
    return null;  -- module off / unknown assignee → no route
  end if;

  v_dow := extract(isodow from p_date)::smallint;
  select * into v_assign
    from public.route_plan_assignments
    where assignee_id = p_assignee_id and day_of_week = v_dow and is_active
      and (start_date is null or start_date <= p_date)
      and (end_date is null or end_date >= p_date)
    order by (end_date is not null) desc   -- date-bounded (temporary) wins over open-ended default
    limit 1;
  if not found then return null; end if;

  select * into v_route from public.routes where id = v_assign.route_id;
  if not found or v_route.status <> 'active' then return null; end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'contact_id', rc.contact_id, 'sequence', rc.sequence,
             'company', c.company, 'name', c.name,
             'latitude', c.latitude, 'longitude', c.longitude, 'address', c.address
           ) order by rc.sequence), '[]'::jsonb)
    into v_customers
    from public.route_customers rc
    join public.contacts c on c.id = rc.contact_id
    where rc.route_id = v_route.id and rc.archived_at is null
      -- Permanent members always; a one-time stop only on the day it was added for.
      and (rc.one_time_date is null or rc.one_time_date = p_date);

  return jsonb_build_object('route', to_jsonb(v_route), 'customers', v_customers, 'assignment_id', v_assign.id);
end;
$$;
