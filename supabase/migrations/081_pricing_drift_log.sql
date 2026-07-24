-- ============================================================
-- 081_pricing_drift_log.sql
-- Diagnostic table for TS-mirror-vs-SQL drift.
--
-- When an ONLINE order is created, the mobile/web client has already
-- computed a price breakdown with the TypeScript mirror (for instant
-- display as the rep types), and create_order recomputes with the SQL
-- function on the SAME fresh data. If those two disagree, it is a real
-- mirror bug, not staleness — because the inputs were identical. Every
-- such event is logged here.
--
-- There is deliberately NO UI. Drift should never happen; a screen for it
-- is premature. The founder queries this table directly. It therefore has
-- to be diagnosable from cold: the exact inputs, both full breakdowns,
-- both engine versions, and which platform produced it.
--
-- Additive, tiny, no impact on existing data.
-- ============================================================

CREATE TABLE IF NOT EXISTS pricing_drift_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  order_id              UUID,                       -- the order that triggered it (no FK: keep the log even if the order is later deleted)
  platform              TEXT,                       -- 'web' | 'mobile'
  app_version           TEXT,                       -- client build, if the client passed one
  engine_version        INTEGER,                    -- the TS mirror's engine_version
  server_engine_version INTEGER,                    -- the SQL function's engine_version
  client_total          NUMERIC(15, 2),
  server_total          NUMERIC(15, 2),
  inputs                JSONB,                      -- exact p_lines + p_order_discount + p_contact_id that produced it
  client_breakdown      JSONB,                      -- full breakdown the client computed
  server_breakdown      JSONB,                      -- full breakdown the SQL computed
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_drift_log_account ON pricing_drift_log(account_id, created_at DESC);

ALTER TABLE pricing_drift_log ENABLE ROW LEVEL SECURITY;

-- Any account member may INSERT: create_order runs SECURITY INVOKER (as the
-- rep), so the rep must be able to write the log row.
DROP POLICY IF EXISTS "pricing_drift_log_insert" ON pricing_drift_log;
CREATE POLICY pricing_drift_log_insert ON pricing_drift_log FOR INSERT
  WITH CHECK (is_account_member(account_id));

-- Only admins read it — it's a diagnostic, not rep-facing.
DROP POLICY IF EXISTS "pricing_drift_log_select" ON pricing_drift_log;
CREATE POLICY pricing_drift_log_select ON pricing_drift_log FOR SELECT
  USING (is_account_member(account_id, 'admin'));
