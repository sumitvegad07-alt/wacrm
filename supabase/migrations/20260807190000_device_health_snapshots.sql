-- Tracking Health & Diagnostics v1 — device health heartbeat
-- Spec: docs/engineering/specifications/tracking-health-diagnostics-v1.md
--
-- A point-in-time self-report from the device (permissions, battery, power mode, location
-- services, app/OS identity, battery-optimization). Powers the admin "why isn't this agent
-- tracking?" report. Append-only; same idempotency pattern as location_pings — server-assigned
-- bigint id, client_snapshot_id for offline replay. Additive & safe.

CREATE TABLE IF NOT EXISTS device_health_snapshots (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id               uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id               uuid REFERENCES tracking_sessions(id) ON DELETE SET NULL,
  user_id                  uuid NOT NULL,
  recorded_at              timestamptz NOT NULL,             -- device capture time
  received_at              timestamptz NOT NULL DEFAULT now(),
  client_snapshot_id       uuid,                             -- offline idempotency (not the PK)
  reason                   text,                             -- punch_in | foreground | ping | punch_out
  -- app / device identity
  app_version              text,
  os_version               text,
  android_api_level        integer,
  manufacturer             text,
  model                    text,
  -- power
  battery_pct              smallint,
  is_charging              boolean,
  low_power_mode           boolean,                          -- battery saver on
  battery_optimization_on  boolean,                          -- NULL when the device lib can't report it
  -- location / permissions ('granted' | 'denied' | 'undetermined')
  location_services_on     boolean,
  fg_location_permission   text,
  bg_location_permission   text,
  notification_permission  text,                             -- NULL if not collected (v1)
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS device_health_client_id_uidx
  ON device_health_snapshots (account_id, client_snapshot_id) WHERE client_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS device_health_user_recorded_idx
  ON device_health_snapshots (account_id, user_id, recorded_at DESC);

ALTER TABLE device_health_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_health_insert ON device_health_snapshots;
CREATE POLICY device_health_insert ON device_health_snapshots FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS device_health_select ON device_health_snapshots;
CREATE POLICY device_health_select ON device_health_snapshots FOR SELECT
  USING (user_id = auth.uid() OR is_account_member(account_id, 'agent'::account_role_enum));
