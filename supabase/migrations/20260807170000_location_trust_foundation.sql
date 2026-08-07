-- Location Trust Foundation v1
-- Spec: docs/engineering/specifications/location-trust-foundation-v1.md
--
-- Purpose: make location DATA trustworthy before building features on top of it.
--   P1  Ping pipeline: add client_ping_id (offline-replay idempotency) so the app can
--       STOP sending the server-assigned bigint id (which was breaking every ping insert).
--   P2  Trustworthy distance: rewrite compute_daily_distance to exclude low-accuracy pings
--       and impossible GPS jumps, matching the shared TS util in src/lib/location/distance.ts.
--   P3  Fake-GPS: is_mocked on pings + check-in/out mock flags on site_visits.
--   P4  Went-dark visibility: tracking_events signal log.
--
-- All changes are additive and safe for existing rows. Never drops a live column.

-- ============================================================
-- P1 + P3 — location_pings columns
-- ============================================================
ALTER TABLE location_pings
  ADD COLUMN IF NOT EXISTS is_mocked      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_ping_id uuid;

-- Offline-replay idempotency: a re-flushed ping (same app-generated token) cannot
-- double-insert. id stays server-assigned (bigint identity ALWAYS) — unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS location_pings_client_ping_id_uidx
  ON location_pings (account_id, client_ping_id)
  WHERE client_ping_id IS NOT NULL;

-- ============================================================
-- P3 — site_visits mock flags on the check-in / check-out GPS snapshots
-- ============================================================
ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS check_in_is_mocked  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS check_out_is_mocked boolean NOT NULL DEFAULT false;

-- ============================================================
-- P4 — tracking_events: honest "agent went dark" signal log
-- Append-only. Follows the ping pattern deliberately: server-assigned bigint id,
-- client_event_id for offline idempotency (so the same lesson/path applies).
-- ============================================================
CREATE TABLE IF NOT EXISTS tracking_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id      uuid REFERENCES tracking_sessions(id) ON DELETE SET NULL,
  user_id         uuid NOT NULL,
  event_type      text NOT NULL CHECK (event_type IN
                    ('gps_disabled','gps_enabled','permission_revoked','permission_restored')),
  battery_pct     smallint,
  recorded_at     timestamptz NOT NULL,            -- device capture time, not sync time
  received_at     timestamptz NOT NULL DEFAULT now(),
  client_event_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tracking_events_client_event_id_uidx
  ON tracking_events (account_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tracking_events_session_idx
  ON tracking_events (session_id);

CREATE INDEX IF NOT EXISTS tracking_events_account_recorded_idx
  ON tracking_events (account_id, recorded_at DESC);

ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;

-- Mirror location_pings policies exactly: a user inserts their own events during a
-- session they own; agent-and-above members can read the whole account (admin dashboards).
DROP POLICY IF EXISTS tracking_events_insert ON tracking_events;
CREATE POLICY tracking_events_insert ON tracking_events FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS tracking_events_select ON tracking_events;
CREATE POLICY tracking_events_select ON tracking_events FOR SELECT
  USING (user_id = auth.uid() OR is_account_member(account_id, 'agent'::account_role_enum));

-- ============================================================
-- P2 — compute_daily_distance: accuracy + impossible-jump filtering
-- MUST stay behaviourally identical to src/lib/location/distance.ts:
--   MAX_ACCURACY_M = 100        (exclude NULL or > 100 m accuracy pings)
--   MAX_PLAUSIBLE_SPEED_MPS = 55 (~200 km/h; drop segments faster than this = GPS teleport)
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_daily_distance(
  p_user_id uuid,
  p_date date DEFAULT CURRENT_DATE
) RETURNS double precision
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  total_km  double precision := 0;
  seg_km    double precision;
  dt        double precision;
  prev_lat  double precision;
  prev_lng  double precision;
  prev_time timestamptz;
  rec       RECORD;
BEGIN
  FOR rec IN
    SELECT lat, lng, recorded_at
    FROM location_pings
    WHERE user_id = p_user_id
      AND recorded_at::date = p_date
      AND lat IS NOT NULL AND lng IS NOT NULL
      -- MAX_ACCURACY_M: a NULL or > 100 m reading is too unreliable to trust for distance
      AND accuracy_m IS NOT NULL AND accuracy_m <= 100
    ORDER BY recorded_at ASC
  LOOP
    IF prev_lat IS NOT NULL THEN
      -- Haversine (KM)
      seg_km := 6371 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS(rec.lat - prev_lat) / 2), 2) +
        COS(RADIANS(prev_lat)) * COS(RADIANS(rec.lat)) *
        POWER(SIN(RADIANS(rec.lng - prev_lng) / 2), 2)
      ));
      dt := EXTRACT(EPOCH FROM (rec.recorded_at - prev_time));
      -- Only count the segment when the implied speed is physically plausible.
      -- dt <= 0 (same/duplicate timestamp) is dropped: cannot validate an instantaneous jump.
      IF dt > 0 AND (seg_km * 1000.0 / dt) <= 55 THEN
        total_km := total_km + seg_km;
      END IF;
    END IF;
    prev_lat  := rec.lat;
    prev_lng  := rec.lng;
    prev_time := rec.recorded_at;
  END LOOP;
  RETURN ROUND(total_km::numeric, 2)::double precision;
END;
$function$;

ALTER FUNCTION public.compute_daily_distance(uuid, date) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.compute_daily_distance(uuid, date) TO authenticated, service_role;
