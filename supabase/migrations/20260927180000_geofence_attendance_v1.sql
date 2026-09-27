-- ============================================================
-- Geo-Fenced Punch In / Punch Out  (Attendance Geo-Fencing V1)
--
-- Blocks a rep from marking attendance unless they are standing at a work
-- location the admin pinned. Sibling of the visit fence
-- (20260910140000_geofence_visits_v1.sql); the difference is the anchor -- a
-- visit is fenced around the CUSTOMER, a punch around an admin-created
-- ATTENDANCE LOCATION (office / branch / plant / warehouse).
--
-- Per-account config lives in accounts.settings -> 'geo_fencing':
--   { "enabled": bool,              -- parent switch (already live for visits)
--     "visit_enabled": bool,        -- NEW, absent == true (preserves today's behaviour)
--     "attendance_enabled": bool,   -- NEW, absent == false (nothing changes on deploy)
--     "enforce_check_in": bool, "enforce_check_out": bool, "radius_m": int }
--
-- Nothing is backfilled and no tenant gains a fence from this migration: the
-- attendance trigger is a pure no-op until an admin turns attendance fencing on
-- AND creates locations, and the visit trigger keeps behaving exactly as before
-- because visit_enabled defaults to true when the key is absent.
--
-- The resolution rule below is mirrored EXACTLY by the client in
-- wacrm-mobile/src/lib/geo/attendance-fence.ts (unit-tested there). Change both
-- or neither.
-- ============================================================

begin;

-- 1. The master: attendance locations ----------------------------------------
-- radius_m is constrained to the same five presets the visit fence offers, so
-- the admin cannot store a value the UI cannot show or the client cannot expect.
-- fence_scope is per LOCATION, not per account: some tenants want reps at the
-- office to START the day, some to CLOSE it, some both.
create table if not exists public.attendance_locations (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  name           text not null,
  address        text,
  latitude       double precision not null check (latitude between -90 and 90),
  longitude      double precision not null check (longitude between -180 and 180),
  radius_m       integer not null default 100 check (radius_m in (50, 100, 250, 500, 1000)),
  fence_scope    text not null default 'both' check (fence_scope in ('punch_in', 'punch_out', 'both')),
  -- applies_to_all is the single-office shortcut: the tenant never touches the
  -- per-user list. When false, attendance_location_users decides.
  applies_to_all boolean not null default false,
  status         text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null
);

create index if not exists idx_attendance_locations_account
  on public.attendance_locations(account_id) where status = 'Active';

-- No two locations in one tenant may share a name: the admin picks them from a
-- list and two "Head Office" rows are indistinguishable there.
create unique index if not exists uq_attendance_locations_account_name
  on public.attendance_locations(account_id, lower(name));

-- 2. Who may punch where -----------------------------------------------------
-- Keyed on profiles.id (NOT the auth user id) to match how every other
-- assignment in this schema works (route plan assignees, task assignees). The
-- trigger below resolves profiles.id from tracking_sessions.user_id, which IS
-- an auth user id -- those two id spaces have caused real bugs here before.
create table if not exists public.attendance_location_users (
  location_id uuid not null references public.attendance_locations(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (location_id, profile_id)
);

create index if not exists idx_attendance_location_users_profile
  on public.attendance_location_users(profile_id);
create index if not exists idx_attendance_location_users_account
  on public.attendance_location_users(account_id);

-- 3. RLS ----------------------------------------------------------------------
alter table public.attendance_locations      enable row level security;
alter table public.attendance_location_users enable row level security;

-- SELECT on locations is open to every member of the tenant, deliberately flat:
-- the punch trigger runs SECURITY INVOKER as the rep, and a policy that
-- referenced attendance_location_users here would nest one RLS check inside
-- another. Office coordinates are not sensitive; who is assigned to them is
-- gated separately below.
drop policy if exists attendance_locations_select on public.attendance_locations;
create policy attendance_locations_select on public.attendance_locations
  for select to authenticated
  using (public.is_account_member(account_id));

drop policy if exists attendance_locations_insert on public.attendance_locations;
create policy attendance_locations_insert on public.attendance_locations
  for insert to authenticated
  with check (
    public.is_account_member(account_id, 'agent'::account_role_enum)
    and public.has_permission((select auth.uid()), account_id, 'create_attendance_locations')
  );

drop policy if exists attendance_locations_update on public.attendance_locations;
create policy attendance_locations_update on public.attendance_locations
  for update to authenticated
  using (
    public.is_account_member(account_id, 'agent'::account_role_enum)
    and public.has_permission((select auth.uid()), account_id, 'edit_attendance_locations')
  );

drop policy if exists attendance_locations_delete on public.attendance_locations;
create policy attendance_locations_delete on public.attendance_locations
  for delete to authenticated
  using (
    public.is_account_member(account_id, 'agent'::account_role_enum)
    and public.has_permission((select auth.uid()), account_id, 'delete_attendance_locations')
  );

-- A rep may read their OWN assignment rows (the app needs them to apply the
-- fence offline); seeing the whole roster of who punches where needs the edit
-- right. The profiles sub-select resolves the caller's own profile row, which
-- their own profiles RLS policy already allows.
drop policy if exists attendance_location_users_select on public.attendance_location_users;
create policy attendance_location_users_select on public.attendance_location_users
  for select to authenticated
  using (
    public.is_account_member(account_id)
    and (
      public.has_permission((select auth.uid()), account_id, 'edit_attendance_locations')
      or profile_id in (
        select p.id from public.profiles p where p.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists attendance_location_users_insert on public.attendance_location_users;
create policy attendance_location_users_insert on public.attendance_location_users
  for insert to authenticated
  with check (
    public.is_account_member(account_id, 'agent'::account_role_enum)
    and public.has_permission((select auth.uid()), account_id, 'edit_attendance_locations')
  );

drop policy if exists attendance_location_users_delete on public.attendance_location_users;
create policy attendance_location_users_delete on public.attendance_location_users
  for delete to authenticated
  using (
    public.is_account_member(account_id, 'agent'::account_role_enum)
    and public.has_permission((select auth.uid()), account_id, 'edit_attendance_locations')
  );

-- 4. Punch position + verdict on the session ---------------------------------
-- The punch coordinates ALSO go to location_pings (source punch_in/punch_out),
-- but a ping is a separate INSERT that lands after the session row: the server
-- cannot verify a punch it has not been told about yet. Stamping the position on
-- the session itself is what makes the backstop possible, and it travels through
-- the mobile offline queue with the row it guards.
-- distance_m / location_id are stamped for the admin (how far off, which site).
alter table public.tracking_sessions
  add column if not exists punch_in_lat          double precision,
  add column if not exists punch_in_lng          double precision,
  add column if not exists punch_in_accuracy_m   double precision,
  add column if not exists punch_in_is_mocked    boolean,
  add column if not exists punch_in_distance_m   double precision,
  add column if not exists punch_in_location_id  uuid references public.attendance_locations(id) on delete set null,
  add column if not exists punch_out_lat         double precision,
  add column if not exists punch_out_lng         double precision,
  add column if not exists punch_out_accuracy_m  double precision,
  add column if not exists punch_out_is_mocked   boolean,
  add column if not exists punch_out_distance_m  double precision,
  add column if not exists punch_out_location_id uuid references public.attendance_locations(id) on delete set null;

-- 5. Enforcement trigger ------------------------------------------------------
-- SECURITY INVOKER: runs as the punching rep, so RLS applies and it can only
-- read its own tenant's rows. Never SECURITY DEFINER here.
create or replace function public.enforce_tracking_session_geofence()
returns trigger
language plpgsql
security invoker
as $fn$
declare
  v_gf         jsonb;
  v_event      text;
  v_profile_id uuid;
  v_lat        double precision;
  v_lng        double precision;
  v_acc        double precision;
  v_mocked     boolean;
  v_applicable integer := 0;
  v_dist       double precision;
  v_eff        double precision;
  v_short      double precision;
  v_best_dist  double precision;
  v_best_short double precision;
  v_best_rad   integer;
  v_best_id    uuid;
  r            record;
  -- Ceiling on how much the device's reported accuracy may widen the fence, so
  -- a device cannot claim a huge accuracy to defeat it. Must match
  -- ACCURACY_CAP_M in the mobile client.
  v_cap constant double precision := 100;
begin
  -- Which event is this? Punch-in = the INSERT. Punch-out = the UPDATE that
  -- first sets ended_at, and ONLY when the rep chose it: a session closed by the
  -- timeout sweep, a killed app, a logout or the midnight roll carries no
  -- position and must never be blocked, or the shift could never close.
  if tg_op = 'INSERT' then
    v_event := 'punch_in';
  elsif tg_op = 'UPDATE'
    and new.ended_at is not null and old.ended_at is null
    and coalesce(new.end_reason, 'manual') = 'manual' then
    v_event := 'punch_out';
  else
    return new;
  end if;

  -- Read the account's geo-fencing config. Parent switch off, or attendance
  -- fencing off (the default), -> no-op.
  select coalesce(settings -> 'geo_fencing', '{}'::jsonb)
    into v_gf
  from public.accounts
  where id = new.account_id;

  if not coalesce((v_gf ->> 'enabled')::boolean, false) then
    return new;
  end if;
  if not coalesce((v_gf ->> 'attendance_enabled')::boolean, false) then
    return new;
  end if;

  -- tracking_sessions.user_id is an AUTH user id; assignments key on profiles.id.
  select p.id into v_profile_id
  from public.profiles p
  where p.user_id = new.user_id
    and p.account_id = new.account_id
  limit 1;

  -- How many of this rep's locations fence THIS event?
  select count(*)
    into v_applicable
  from public.attendance_locations l
  where l.account_id = new.account_id
    and l.status = 'Active'
    and (l.fence_scope = 'both' or l.fence_scope = v_event)
    and (
      l.applies_to_all
      or (v_profile_id is not null and exists (
            select 1
            from public.attendance_location_users u
            where u.location_id = l.id
              and u.profile_id = v_profile_id
         ))
    );

  -- None -> unfenced: this rep may punch from anywhere. Fail-open on purpose, so
  -- enabling the feature before pinning locations cannot lock a workforce out of
  -- its own attendance.
  if v_applicable = 0 then
    return new;
  end if;

  if v_event = 'punch_in' then
    v_lat    := new.punch_in_lat;
    v_lng    := new.punch_in_lng;
    v_acc    := new.punch_in_accuracy_m;
    v_mocked := coalesce(new.punch_in_is_mocked, false);
  else
    v_lat    := new.punch_out_lat;
    v_lng    := new.punch_out_lng;
    v_acc    := new.punch_out_accuracy_m;
    v_mocked := coalesce(new.punch_out_is_mocked, false);
  end if;

  -- Fence applies but no position was sent. Distinct message from "out of
  -- range": this is what an app too old to send coordinates looks like, and
  -- support must be able to tell the two apart.
  if v_lat is null or v_lng is null then
    raise exception 'Location not captured - update the app and allow location access to mark attendance';
  end if;

  -- A mock/spoofed location is a violation when the fence is on.
  if v_mocked then
    raise exception 'You are not in range - a mock location was detected';
  end if;

  for r in
    select l.id, l.latitude, l.longitude, l.radius_m
    from public.attendance_locations l
    where l.account_id = new.account_id
      and l.status = 'Active'
      and (l.fence_scope = 'both' or l.fence_scope = v_event)
      and (
        l.applies_to_all
        or (v_profile_id is not null and exists (
              select 1
              from public.attendance_location_users u
              where u.location_id = l.id
                and u.profile_id = v_profile_id
           ))
      )
  loop
    -- Great-circle (Haversine) distance in metres, Earth radius 6371000 m. Must
    -- stay identical to haversineMeters() in the mobile client.
    v_dist := 2 * 6371000 * asin(
      sqrt(
        power(sin(radians(v_lat - r.latitude) / 2), 2) +
        cos(radians(r.latitude)) * cos(radians(v_lat)) *
        power(sin(radians(v_lng - r.longitude) / 2), 2)
      )
    );
    v_eff := r.radius_m + least(coalesce(v_acc, 0), v_cap);

    if v_dist <= v_eff then
      -- Inside this one: allowed. Stamp which site and how far off centre.
      if v_event = 'punch_in' then
        new.punch_in_distance_m  := v_dist;
        new.punch_in_location_id := r.id;
      else
        new.punch_out_distance_m  := v_dist;
        new.punch_out_location_id := r.id;
      end if;
      return new;
    end if;

    -- Rank the misses by how far SHORT of the fence they are, not by raw
    -- distance: 700 m from a 500 m site is nearer to punching in than 400 m from
    -- a 100 m one.
    v_short := v_dist - v_eff;
    if v_best_short is null or v_short < v_best_short then
      v_best_short := v_short;
      v_best_dist  := v_dist;
      v_best_rad   := r.radius_m;
      v_best_id    := r.id;
    end if;
  end loop;

  -- Outside every applicable fence. Stamped before the raise for the record's
  -- sake (rolled back with it anyway) and reported without naming the site.
  if v_event = 'punch_in' then
    new.punch_in_distance_m  := v_best_dist;
    new.punch_in_location_id := v_best_id;
  else
    new.punch_out_distance_m  := v_best_dist;
    new.punch_out_location_id := v_best_id;
  end if;

  raise exception 'You are not in range - you are % m from your work location. Move within % m to mark attendance',
    round(v_best_dist)::text, v_best_rad::text;
end;
$fn$;

drop trigger if exists trg_enforce_tracking_session_geofence on public.tracking_sessions;
create trigger trg_enforce_tracking_session_geofence
  before insert or update on public.tracking_sessions
  for each row execute function public.enforce_tracking_session_geofence();

-- 6. Visit fence now answers to its own sub-switch ----------------------------
-- Identical to 20260910140000 except for the visit_enabled gate. Absent key ==
-- true, so every tenant that has visit fencing on today keeps it on.
create or replace function public.enforce_site_visit_geofence()
returns trigger
language plpgsql
security invoker
as $fn$
declare
  v_gf          jsonb;
  v_radius      double precision;
  v_anchor_lat  double precision;
  v_anchor_lng  double precision;
  v_dev_lat     double precision;
  v_dev_lng     double precision;
  v_acc         double precision;
  v_mocked      boolean;
  v_is_checkin  boolean := false;
  v_is_checkout boolean := false;
  v_dist        double precision;
  v_eff         double precision;
  v_cap constant double precision := 100;
begin
  if tg_op = 'INSERT' then
    v_is_checkin := (new.check_in_at is not null);
  elsif tg_op = 'UPDATE' then
    v_is_checkout := (new.check_out_at is not null and old.check_out_at is null);
  end if;

  if not v_is_checkin and not v_is_checkout then
    return new;
  end if;

  if new.target_type is distinct from 'Customer' then
    return new;
  end if;

  select coalesce(settings -> 'geo_fencing', '{}'::jsonb)
    into v_gf
  from public.accounts
  where id = new.account_id;

  if not coalesce((v_gf ->> 'enabled')::boolean, false) then
    return new;
  end if;

  -- NEW: the Visit sub-switch. Absent -> true, so existing tenants are unchanged.
  if not coalesce((v_gf ->> 'visit_enabled')::boolean, true) then
    return new;
  end if;

  if v_is_checkin and not coalesce((v_gf ->> 'enforce_check_in')::boolean, false) then
    return new;
  end if;
  if v_is_checkout and not coalesce((v_gf ->> 'enforce_check_out')::boolean, false) then
    return new;
  end if;

  v_radius := coalesce((v_gf ->> 'radius_m')::double precision, 50);

  select latitude, longitude
    into v_anchor_lat, v_anchor_lng
  from public.contacts
  where id = coalesce(new.contact_id, new.target_id)
  limit 1;

  if v_anchor_lat is null or v_anchor_lng is null then
    return new;
  end if;

  if v_is_checkin then
    v_dev_lat := new.check_in_lat;
    v_dev_lng := new.check_in_lng;
    v_acc     := new.check_in_accuracy_m;
    v_mocked  := coalesce(new.check_in_is_mocked, false);
  else
    v_dev_lat := new.check_out_lat;
    v_dev_lng := new.check_out_lng;
    v_acc     := new.check_out_accuracy_m;
    v_mocked  := coalesce(new.check_out_is_mocked, false);
  end if;

  if v_dev_lat is null or v_dev_lng is null then
    raise exception 'You are not in customer Range';
  end if;

  if v_mocked then
    raise exception 'You are not in customer Range';
  end if;

  v_dist := 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(v_dev_lat - v_anchor_lat) / 2), 2) +
      cos(radians(v_anchor_lat)) * cos(radians(v_dev_lat)) *
      power(sin(radians(v_dev_lng - v_anchor_lng) / 2), 2)
    )
  );

  if v_is_checkin then
    new.check_in_distance_m := v_dist;
  else
    new.check_out_distance_m := v_dist;
  end if;

  v_eff := v_radius + least(coalesce(v_acc, 0), v_cap);

  if v_dist > v_eff then
    raise exception 'You are not in customer Range';
  end if;

  return new;
end;
$fn$;

-- 7. updated_at housekeeping --------------------------------------------------
create or replace function public.touch_attendance_location()
returns trigger
language plpgsql
security invoker
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_touch_attendance_location on public.attendance_locations;
create trigger trg_touch_attendance_location
  before update on public.attendance_locations
  for each row execute function public.touch_attendance_location();

commit;
