-- ============================================================
-- Geo-Fencing for Visit Check-In / Check-Out  (V1)
--
-- Adds the server-side backstop for the geo-fence feature. The mobile app
-- blocks out-of-range check-in/out in real time; this trigger independently
-- re-checks on the database so a client that bypasses the app cannot save an
-- out-of-range (or mock-location) visit.
--
-- Per-account config lives in accounts.settings -> 'geo_fencing':
--   { "enabled": bool, "enforce_check_in": bool, "enforce_check_out": bool,
--     "radius_m": 50|100|250|500|1000 }
-- Absent object == disabled. No tenant is backfilled; the trigger is a pure
-- no-op for every account until an admin turns geo-fencing on.
--
-- Only Customer visits (target_type = 'Customer') are fenced. The customer's
-- saved coordinates live on contacts.latitude/longitude.
-- ============================================================

-- 1. Columns on site_visits ---------------------------------------------------
-- accuracy_*  : device-reported GPS accuracy, so the server can apply the SAME
--               radius+accuracy tolerance the client applied (otherwise the
--               server could reject a visit the client legitimately allowed).
-- distance_*  : server-computed distance from the customer, stamped for
--               transparency / future reporting.
alter table public.site_visits
  add column if not exists check_in_accuracy_m  double precision,
  add column if not exists check_out_accuracy_m double precision,
  add column if not exists check_in_distance_m  double precision,
  add column if not exists check_out_distance_m double precision;

-- 2. Enforcement trigger function --------------------------------------------
-- SECURITY INVOKER: runs as the inserting rep, so RLS applies and it can only
-- read its own tenant's accounts + contacts rows. Never SECURITY DEFINER here.
create or replace function public.enforce_site_visit_geofence()
returns trigger
language plpgsql
security invoker
as $$
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
  -- Ceiling on how much the device's reported accuracy may widen the fence,
  -- so a device cannot claim a huge accuracy to defeat the fence. Must match
  -- the mobile client's accuracyCapM default.
  v_cap constant double precision := 100;
begin
  -- Which event is this? Check-in = INSERT with a check_in_at;
  -- check-out = the UPDATE that first sets check_out_at.
  if tg_op = 'INSERT' then
    v_is_checkin := (new.check_in_at is not null);
  elsif tg_op = 'UPDATE' then
    v_is_checkout := (new.check_out_at is not null and old.check_out_at is null);
  end if;

  if not v_is_checkin and not v_is_checkout then
    return new;
  end if;

  -- Only Customer visits are fenced (leads are never blocked in V1).
  if new.target_type is distinct from 'Customer' then
    return new;
  end if;

  -- Read the account's geo-fencing config. Absent -> disabled -> no-op.
  select coalesce(settings -> 'geo_fencing', '{}'::jsonb)
    into v_gf
  from public.accounts
  where id = new.account_id;

  if not coalesce((v_gf ->> 'enabled')::boolean, false) then
    return new;
  end if;

  if v_is_checkin and not coalesce((v_gf ->> 'enforce_check_in')::boolean, false) then
    return new;
  end if;
  if v_is_checkout and not coalesce((v_gf ->> 'enforce_check_out')::boolean, false) then
    return new;
  end if;

  v_radius := coalesce((v_gf ->> 'radius_m')::double precision, 50);

  -- Resolve the customer's saved location (the fence anchor).
  select latitude, longitude
    into v_anchor_lat, v_anchor_lng
  from public.contacts
  where id = coalesce(new.contact_id, new.target_id)
  limit 1;

  -- No coordinates on file -> allow (no-coordinates fallback; the app captures
  -- the rep's location client-side on the first visit).
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

  -- Fencing is on but we have no device position to verify against -> reject.
  if v_dev_lat is null or v_dev_lng is null then
    raise exception 'You are not in customer Range';
  end if;

  -- A mock/spoofed location is a violation when fencing is on.
  if v_mocked then
    raise exception 'You are not in customer Range';
  end if;

  -- Great-circle (Haversine) distance in metres. Earth radius 6371000 m.
  -- Must stay identical to the client's src/lib/geo/geofence.ts implementation.
  v_dist := 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(v_dev_lat - v_anchor_lat) / 2), 2) +
      cos(radians(v_anchor_lat)) * cos(radians(v_dev_lat)) *
      power(sin(radians(v_dev_lng - v_anchor_lng) / 2), 2)
    )
  );

  -- Stamp the verified distance before any reject (rolled back on reject anyway).
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
$$;

-- 3. Attach the trigger -------------------------------------------------------
drop trigger if exists trg_enforce_site_visit_geofence on public.site_visits;
create trigger trg_enforce_site_visit_geofence
  before insert or update on public.site_visits
  for each row execute function public.enforce_site_visit_geofence();
