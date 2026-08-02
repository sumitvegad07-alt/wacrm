-- 108_route_management_core.sql
-- Route Management V1 — core configuration tables (Phase 1a).
-- Spec: docs/engineering/specifications/route-management.md (Revision 3).
-- Depends on: 101 territory_master, 106 reporting_hierarchy, 107 area_visibility.
-- Tables: routes, route_customers, route_plan_assignments, route_schedules (dormant).
-- Also: module toggle `route` (default OFF) + default `route_settings` on accounts.
-- All UPDATEs are WHERE-qualified (pg_safeupdate). Trigger fn: update_updated_at_column().

-- ============================================================================
-- 1. TABLES (create all first so cross-referencing RLS policies resolve)
-- ============================================================================

-- 1.1 routes -----------------------------------------------------------------
create table if not exists public.routes (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  name                text not null,
  description         text,
  -- primary_assignee_id: the primary assigned salesman (profiles.id). Renamed from
  -- "owner" per CTO final review — "owner" misleads once routes are shared/reassigned.
  primary_assignee_id uuid references public.profiles(id) on delete set null,
  status              text not null default 'draft'
                        check (status in ('draft','pending_approval','active','rejected','archived')),
  created_by          uuid not null default auth.uid(),   -- auth.users id (auth.uid())
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 1.2 route_customers --------------------------------------------------------
create table if not exists public.route_customers (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  route_id     uuid not null references public.routes(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  sequence     integer not null,
  -- archived_at mirrors the parent route's archive state (maintained by the archive/
  -- restore RPCs) so the one-customer-one-route rule ignores archived routes and does
  -- not permanently trap a customer. Future template/instance split can reuse this.
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- a customer appears at most once within a route
  constraint uq_route_customers_route_contact unique (route_id, contact_id)
);
-- one customer belongs to at most one *non-archived* route (partial unique index)
create unique index if not exists uq_route_customers_one_active_route
  on public.route_customers(account_id, contact_id)
  where archived_at is null;

-- 1.3 route_plan_assignments — weekly Planner (V1 live schedule) --------------
create table if not exists public.route_plan_assignments (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  route_id     uuid not null references public.routes(id) on delete cascade,
  assignee_id  uuid not null references public.profiles(id) on delete cascade,  -- profiles.id
  day_of_week  smallint not null check (day_of_week between 1 and 7),           -- ISO 1=Mon..7=Sun
  start_date   date,
  end_date     date,
  is_active    boolean not null default true,
  paused_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- one PERMANENT (open-ended, active) route per salesman per weekday. The predicate is
-- deliberate future-proofing: a future temporary (date-bounded) reassignment can coexist
-- with the permanent slot without a live-constraint migration.
create unique index if not exists uq_route_plan_perm_slot
  on public.route_plan_assignments(account_id, assignee_id, day_of_week)
  where end_date is null and is_active;

-- 1.4 route_schedules — richer patterns, DORMANT in V1 (no UI reads/writes) ----
create table if not exists public.route_schedules (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  route_id       uuid not null references public.routes(id) on delete cascade,
  repeat_pattern text not null default 'weekly'
                   check (repeat_pattern in ('weekly','every_x_days','monthly','custom')),
  days_of_week   smallint[],
  interval_days  integer,
  day_of_month   integer,
  start_date     date,
  end_date       date,
  is_active      boolean not null default true,
  paused_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
create index if not exists idx_routes_account          on public.routes(account_id);
create index if not exists idx_routes_primary_assignee on public.routes(primary_assignee_id);
create index if not exists idx_routes_status           on public.routes(account_id, status);
create index if not exists idx_route_customers_route   on public.route_customers(route_id);
create index if not exists idx_route_plan_route        on public.route_plan_assignments(route_id);
create index if not exists idx_route_plan_assignee_dow on public.route_plan_assignments(account_id, assignee_id, day_of_week);
create index if not exists idx_route_schedules_route   on public.route_schedules(route_id);

-- ============================================================================
-- 3. updated_at TRIGGERS
-- ============================================================================
drop trigger if exists trg_routes_updated_at on public.routes;
create trigger trg_routes_updated_at before update on public.routes
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_route_customers_updated_at on public.route_customers;
create trigger trg_route_customers_updated_at before update on public.route_customers
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_route_plan_updated_at on public.route_plan_assignments;
create trigger trg_route_plan_updated_at before update on public.route_plan_assignments
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_route_schedules_updated_at on public.route_schedules;
create trigger trg_route_schedules_updated_at before update on public.route_schedules
  for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================
alter table public.routes                enable row level security;
alter table public.route_customers       enable row level security;
alter table public.route_plan_assignments enable row level security;
alter table public.route_schedules       enable row level security;

-- 4.1 routes: admins see all; others see routes they created, are primary assignee of,
--     or are assigned to in the Planner (so a salesman can load today's route).
drop policy if exists routes_select on public.routes;
create policy routes_select on public.routes for select
  using (
    is_account_member(account_id) and (
      is_account_member(account_id, 'admin')
      or created_by = auth.uid()
      or primary_assignee_id in (select id from public.profiles where user_id = auth.uid())
      or exists (
        select 1 from public.route_plan_assignments rpa
        join public.profiles p on p.id = rpa.assignee_id
        where rpa.route_id = routes.id and p.user_id = auth.uid()
      )
    )
  );

drop policy if exists routes_insert on public.routes;
create policy routes_insert on public.routes for insert
  with check (is_account_member(account_id, 'agent') and created_by = auth.uid());

-- UPDATE/DELETE: admin, or the route's creator / primary assignee ("own"). Granular
-- add/edit/delete permission keys are enforced additionally inside the RPCs.
drop policy if exists routes_update on public.routes;
create policy routes_update on public.routes for update
  using (
    is_account_member(account_id) and (
      is_account_member(account_id, 'admin')
      or created_by = auth.uid()
      or primary_assignee_id in (select id from public.profiles where user_id = auth.uid())
    )
  );

drop policy if exists routes_delete on public.routes;
create policy routes_delete on public.routes for delete
  using (
    is_account_member(account_id) and (
      is_account_member(account_id, 'admin')
      or created_by = auth.uid()
    )
  );

-- 4.2 route_customers: visible for visible routes; writable when the parent route is
--     editable by the caller (admin / creator / primary assignee).
drop policy if exists route_customers_select on public.route_customers;
create policy route_customers_select on public.route_customers for select
  using (
    is_account_member(account_id)
    and exists (select 1 from public.routes r where r.id = route_id)
  );

drop policy if exists route_customers_write on public.route_customers;
create policy route_customers_write on public.route_customers for all
  using (
    is_account_member(account_id) and exists (
      select 1 from public.routes r where r.id = route_id and (
        is_account_member(r.account_id, 'admin')
        or r.created_by = auth.uid()
        or r.primary_assignee_id in (select id from public.profiles where user_id = auth.uid())
      )
    )
  )
  with check (
    is_account_member(account_id) and exists (
      select 1 from public.routes r where r.id = route_id and (
        is_account_member(r.account_id, 'admin')
        or r.created_by = auth.uid()
        or r.primary_assignee_id in (select id from public.profiles where user_id = auth.uid())
      )
    )
  );

-- 4.3 route_plan_assignments: all members read the planner; writes at agent+ (granular
--     assign / manage_route_schedule perms enforced in the RPC).
drop policy if exists route_plan_select on public.route_plan_assignments;
create policy route_plan_select on public.route_plan_assignments for select
  using (is_account_member(account_id));

drop policy if exists route_plan_write on public.route_plan_assignments;
create policy route_plan_write on public.route_plan_assignments for all
  using (is_account_member(account_id, 'agent'))
  with check (is_account_member(account_id, 'agent'));

-- 4.4 route_schedules: dormant; read by members, write admin-only (no V1 UI).
drop policy if exists route_schedules_select on public.route_schedules;
create policy route_schedules_select on public.route_schedules for select
  using (is_account_member(account_id));

drop policy if exists route_schedules_write on public.route_schedules;
create policy route_schedules_write on public.route_schedules for all
  using (is_account_member(account_id, 'admin'))
  with check (is_account_member(account_id, 'admin'));

-- ============================================================================
-- 5. MODULE TOGGLE + DEFAULT SETTINGS (route is OFF by default)
-- ============================================================================
-- Add module_settings.route = false where absent (mirrors reporting_hierarchy default-OFF).
update public.accounts
set module_settings = jsonb_set(module_settings, '{route}', 'false'::jsonb, true)
where not (module_settings ? 'route');

-- Seed a default route_settings block where absent.
update public.accounts
set settings = jsonb_set(
      coalesce(settings, '{}'::jsonb),
      '{route_settings}',
      '{"execution":{"skip_allowed":true,"skip_reason_mandatory":true,"out_of_sequence_allowed":true},"capacity":{"max_customers":50,"enforcement":"warn"},"validation":{"warn_duplicate_name":true,"warn_schedule_conflict":true},"approval_mode":"none"}'::jsonb,
      true)
where not (coalesce(settings, '{}'::jsonb) ? 'route_settings');
