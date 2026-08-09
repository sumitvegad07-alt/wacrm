-- Dense GPS trace, so travelled distance can be trusted to within ~5%.
--
-- WHY: distance was summed from pings persisted every 10 minutes. At 40 km/h that is ~6.7 km
-- between consecutive points, and the road actually driven between them is unrecoverable — the
-- straight line under-reports by 40%+ (observed: 15.67 km straight vs 27.9 km by road for the
-- same day). No post-processing fixes that; the information was never captured.
--
-- The OS was already handing us a fix every 30 seconds and we threw away 19 of every 20. Those
-- fixes now persist as `source = 'trace'` rows and become the basis for distance, while the
-- 10-minute 'auto' pings stay exactly as they were for display and coverage scoring.
--
-- Trace rows are high-volume and machine-facing: they must never appear in All Locations, the
-- Live Feed markers, or Tracking Health's coverage maths, all of which filter on `source`.

alter table public.location_pings
  drop constraint if exists location_pings_source_check;

alter table public.location_pings
  add constraint location_pings_source_check
  check (source in ('auto', 'punch_in', 'punch_out', 'visit_check_in', 'visit_check_out', 'trace'));

comment on column public.location_pings.source is
  'What produced this point: auto (display ping at the configured interval), punch_in/punch_out, visit_check_in/visit_check_out, or trace (dense fix used only for distance).';

-- Distance queries scan one user over one day; display queries additionally filter out 'trace'.
create index if not exists location_pings_user_recorded_idx
  on public.location_pings (user_id, recorded_at);

create index if not exists location_pings_user_source_recorded_idx
  on public.location_pings (user_id, source, recorded_at);
