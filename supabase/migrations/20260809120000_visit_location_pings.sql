-- Visit check-in / check-out locations become real track points.
--
-- Until now a visit's GPS fix was written only to site_visits.check_in_lat/lng, so it appeared
-- on the Customer Visits screen and NOWHERE else: All Locations, Track Report, Overview and the
-- Live Feed all read location_pings. The single most meaningful location of a rep's day was
-- missing from every location screen. Mobile now also writes a location_ping for each check-in
-- and check-out; this migration makes that storable and labelled.
--
-- 1. session_id becomes nullable. A rep can start a visit without having punched in (we prompt,
--    but "I'll do it later" is allowed), and a captured location must never be silently dropped
--    just because there is no shift to attach it to.
-- 2. `source` records what produced the point, so the UI can distinguish an automatic breadcrumb
--    from a deliberate check-in and mark it differently on the map/table.

alter table public.location_pings
  alter column session_id drop not null;

alter table public.location_pings
  add column if not exists source text not null default 'auto';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'location_pings_source_check'
  ) then
    alter table public.location_pings
      add constraint location_pings_source_check
      check (source in ('auto', 'punch_in', 'punch_out', 'visit_check_in', 'visit_check_out'));
  end if;
end $$;

comment on column public.location_pings.session_id is
  'Tracking session this point belongs to. NULL when the point was captured outside a punch-in session (e.g. a visit check-in by a rep who has not punched in).';
comment on column public.location_pings.source is
  'What produced this point: auto (background interval), punch_in/punch_out, or visit_check_in/visit_check_out.';

-- Points that came from a visit are queried by user+day alongside automatic ones; the existing
-- (user_id, recorded_at) access pattern already covers this, so no new index is needed.
