-- ============================================================
-- 043_mobile_app_support.sql
-- Adds missing columns and RPC for mobile field force app.
-- ============================================================

-- 1. Add check-out location columns to site_visits
ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS check_out_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_out_lng DOUBLE PRECISION;

-- 2. Add punch-out photo URL (for future selfie-at-punch-out)
ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS punch_out_photo_url TEXT;

-- 3. RPC for computing daily distance from GPS pings (Haversine)
-- Calculates total KMs travelled by a user on a given date.
CREATE OR REPLACE FUNCTION compute_daily_distance(
  p_user_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
) RETURNS DOUBLE PRECISION
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_km DOUBLE PRECISION := 0;
  prev_lat DOUBLE PRECISION;
  prev_lng DOUBLE PRECISION;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT lat, lng
    FROM location_pings
    WHERE user_id = p_user_id
      AND recorded_at::date = p_date
    ORDER BY recorded_at ASC
  LOOP
    IF prev_lat IS NOT NULL THEN
      -- Haversine formula (returns KM)
      total_km := total_km + (
        6371 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(rec.lat - prev_lat) / 2), 2) +
          COS(RADIANS(prev_lat)) * COS(RADIANS(rec.lat)) *
          POWER(SIN(RADIANS(rec.lng - prev_lng) / 2), 2)
        ))
      );
    END IF;
    prev_lat := rec.lat;
    prev_lng := rec.lng;
  END LOOP;
  RETURN ROUND(total_km::NUMERIC, 2)::DOUBLE PRECISION;
END;
$$;

ALTER FUNCTION compute_daily_distance(UUID, DATE) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION compute_daily_distance(UUID, DATE) TO authenticated, service_role;

-- 4. Enable realtime on location tables for admin dashboard updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'location_pings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE location_pings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'site_visits'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE site_visits;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tracking_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tracking_sessions;
  END IF;
END $$;
