-- ============================================================
-- 035_field_staff_location.sql
-- Adds tables for tracking field staff location, shifts, and visits.
-- ============================================================

-- Consent, one row per staff member, versioned
CREATE TABLE location_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ,          -- NULL = not yet consented / revoked
  revoked_at TIMESTAMPTZ,
  UNIQUE(account_id, user_id)
);

-- A shift/session — tracking is only active inside one of these
CREATE TABLE tracking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,              -- NULL = currently active
  device_id TEXT NOT NULL,           -- app-generated UUID, not IMEI/hardware id
  end_reason TEXT CHECK (end_reason IN ('manual','timeout','app_killed','logout'))
);
CREATE INDEX idx_tracking_sessions_active ON tracking_sessions(account_id, user_id) WHERE ended_at IS NULL;

-- Raw pings — high volume, short retention, no FK cascade needed to keep inserts cheap
CREATE TABLE location_pings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m REAL,                   -- device-reported GPS accuracy; filter noisy pings client-side
  speed_mps REAL,
  battery_pct SMALLINT,
  recorded_at TIMESTAMPTZ NOT NULL,  -- device clock, when it was captured
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- server clock, when synced (may lag if offline)
  UNIQUE(session_id, recorded_at)
);
CREATE INDEX idx_location_pings_session_time ON location_pings(session_id, recorded_at);
CREATE INDEX idx_location_pings_account_time ON location_pings(account_id, recorded_at);

-- Optional: geofenced customer sites, for auto check-in/out
CREATE TABLE geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 100
);

-- Visit / check-in records — this is what admins actually want to see and report on
CREATE TABLE site_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  geofence_id UUID REFERENCES geofences(id) ON DELETE SET NULL,
  check_in_at TIMESTAMPTZ NOT NULL,
  check_out_at TIMESTAMPTZ,
  check_in_method TEXT CHECK (check_in_method IN ('geofence_auto','manual','qr_scan')),
  check_in_lat DOUBLE PRECISION,
  check_in_lng DOUBLE PRECISION,
  notes TEXT
);

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE location_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;

-- location_consents
CREATE POLICY location_consents_insert ON location_consents FOR INSERT WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));
CREATE POLICY location_consents_update ON location_consents FOR UPDATE USING (user_id = auth.uid() AND is_account_member(account_id));
CREATE POLICY location_consents_select ON location_consents FOR SELECT USING (user_id = auth.uid() OR is_account_member(account_id, 'admin'));

-- tracking_sessions
CREATE POLICY tracking_sessions_insert ON tracking_sessions FOR INSERT WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));
CREATE POLICY tracking_sessions_update ON tracking_sessions FOR UPDATE USING (user_id = auth.uid() AND is_account_member(account_id));
CREATE POLICY tracking_sessions_select ON tracking_sessions FOR SELECT USING (user_id = auth.uid() OR is_account_member(account_id, 'agent'));

-- location_pings
-- Staff can insert their own pings during an active session they own
CREATE POLICY location_pings_insert ON location_pings FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

-- Only agent+ can read pings for OTHERS; everyone can read their own
CREATE POLICY location_pings_select ON location_pings FOR SELECT
  USING (
    user_id = auth.uid()
    OR is_account_member(account_id, 'agent')
  );

-- geofences
CREATE POLICY geofences_insert ON geofences FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY geofences_update ON geofences FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY geofences_delete ON geofences FOR DELETE USING (is_account_member(account_id, 'admin'));
CREATE POLICY geofences_select ON geofences FOR SELECT USING (is_account_member(account_id));

-- site_visits
CREATE POLICY site_visits_insert ON site_visits FOR INSERT WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));
CREATE POLICY site_visits_update ON site_visits FOR UPDATE USING (user_id = auth.uid() AND is_account_member(account_id));
CREATE POLICY site_visits_select ON site_visits FOR SELECT USING (user_id = auth.uid() OR is_account_member(account_id, 'agent'));
CREATE POLICY site_visits_delete ON site_visits FOR DELETE USING (is_account_member(account_id, 'admin'));
