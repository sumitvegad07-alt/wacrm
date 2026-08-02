-- 109_route_execution.sql
-- Route Management V1 — execution tables (Phase 1a).
-- Spec: docs/engineering/specifications/route-management.md (Revision 3).
-- Depends on: 108_route_management_core, site_visits, tracking_sessions.
-- Execution reuses site_visits (a completed stop creates a site_visit linked back here).
-- Field-owned rows use user_id = auth.uid() (mirrors site_visits/tracking_sessions).

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- 1.1 route_executions — a salesman running a route on a given day ------------
create table if not exists public.route_executions (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  route_id            uuid not null references public.routes(id) on delete cascade,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  execution_date      date not null default current_date,
  status              text not null default 'in_progress'
                        check (status in ('in_progress','completed','abandoned')),
  started_at          timestamptz,
  completed_at        timestamptz,
  tracking_session_id uuid references public.tracking_sessions(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_route_exec_per_day unique (route_id, user_id, execution_date)
);
create index if not exists idx_route_exec_user_date
  on public.route_executions(account_id, user_id, execution_date);

-- 1.2 route_execution_stops — one per customer in an execution ----------------
--     planned_sequence NULL = an unplanned stop added mid-round ("Add Customer").
create table if not exists public.route_execution_stops (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  execution_id      uuid not null references public.route_executions(id) on delete cascade,
  contact_id        uuid not null references public.contacts(id) on delete cascade,
  planned_sequence  integer,
  actual_sequence   integer,
  status            text not null default 'pending'
                      check (status in ('pending','completed','skipped')),
  skip_reason       text,
  site_visit_id     uuid references public.site_visits(id) on delete set null,
  visited_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_route_exec_stops_exec
  on public.route_execution_stops(execution_id, status);

-- 1.3 site_visits route attribution (minimal additive ALTER) ------------------
alter table public.site_visits
  add column if not exists route_execution_id uuid references public.route_executions(id) on delete set null;
create index if not exists idx_site_visits_route_exec
  on public.site_visits(route_execution_id);

-- ============================================================================
-- 2. updated_at TRIGGERS
-- ============================================================================
drop trigger if exists trg_route_exec_updated_at on public.route_executions;
create trigger trg_route_exec_updated_at before update on public.route_executions
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_route_exec_stops_updated_at on public.route_execution_stops;
create trigger trg_route_exec_stops_updated_at before update on public.route_execution_stops
  for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 3. ROW LEVEL SECURITY (field-owned: admin sees all, salesman sees own)
-- ============================================================================
alter table public.route_executions      enable row level security;
alter table public.route_execution_stops enable row level security;

drop policy if exists route_exec_select on public.route_executions;
create policy route_exec_select on public.route_executions for select
  using (is_account_member(account_id) and (is_account_member(account_id, 'admin') or user_id = auth.uid()));

drop policy if exists route_exec_insert on public.route_executions;
create policy route_exec_insert on public.route_executions for insert
  with check (is_account_member(account_id) and user_id = auth.uid());

drop policy if exists route_exec_update on public.route_executions;
create policy route_exec_update on public.route_executions for update
  using (is_account_member(account_id) and (is_account_member(account_id, 'admin') or user_id = auth.uid()));

drop policy if exists route_exec_stops_select on public.route_execution_stops;
create policy route_exec_stops_select on public.route_execution_stops for select
  using (
    is_account_member(account_id) and exists (
      select 1 from public.route_executions e
      where e.id = execution_id and (is_account_member(e.account_id, 'admin') or e.user_id = auth.uid())
    )
  );

drop policy if exists route_exec_stops_write on public.route_execution_stops;
create policy route_exec_stops_write on public.route_execution_stops for all
  using (
    is_account_member(account_id) and exists (
      select 1 from public.route_executions e where e.id = execution_id and e.user_id = auth.uid()
    )
  )
  with check (
    is_account_member(account_id) and exists (
      select 1 from public.route_executions e where e.id = execution_id and e.user_id = auth.uid()
    )
  );
