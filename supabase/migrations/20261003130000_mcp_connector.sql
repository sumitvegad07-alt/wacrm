-- ============================================================
-- MCP AI connector. Lets an account Admin connect their own AI tool
-- (Claude / ChatGPT / Perplexity) to OZZO, read-only, over OAuth 2.1.
--
-- Why a stored Supabase session rather than a service-role client:
-- execute_report is SECURITY INVOKER and must stay so, which means it
-- needs a real logged-in user. Storing the admin's own session makes
-- every AI query run as that admin, so RLS enforces tenant isolation
-- at the database instead of relying on an explicit filter in code.
-- ============================================================

-- Dynamically registered OAuth clients (RFC 7591). One row per AI tool
-- installation that introduces itself. Not secret.
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id     text PRIMARY KEY,
  client_name   text NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Short-lived, single-use authorization codes with their PKCE challenge.
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code                  text PRIMARY KEY,
  client_id             text NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  redirect_uri          text NOT NULL,
  code_challenge        text NOT NULL,
  code_challenge_method text NOT NULL,
  -- The admin's Supabase refresh token, AES-GCM encrypted. Moves to
  -- mcp_connections on exchange and is deleted with the code.
  sb_refresh_encrypted  text NOT NULL,
  expires_at            timestamptz NOT NULL,
  consumed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expires_idx ON mcp_oauth_codes (expires_at);

-- One row per connected AI tool.
CREATE TABLE IF NOT EXISTS mcp_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id            text NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  client_name          text NOT NULL,
  -- SHA-256 of the bearer tokens we issue. Plaintext is never stored,
  -- same discipline as api_keys (see migration 026).
  access_token_hash    text NOT NULL UNIQUE,
  refresh_token_hash   text NOT NULL UNIQUE,
  -- The admin's Supabase refresh token, AES-GCM encrypted. Rotates on use.
  sb_refresh_encrypted text NOT NULL,
  access_expires_at    timestamptz NOT NULL,
  last_used_at         timestamptz,
  revoked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_connections_account_idx ON mcp_connections (account_id);
CREATE INDEX IF NOT EXISTS mcp_connections_access_hash_idx ON mcp_connections (access_token_hash);
CREATE INDEX IF NOT EXISTS mcp_connections_refresh_hash_idx ON mcp_connections (refresh_token_hash);

-- Audit. Every tool call writes exactly one row. This is the only way a
-- leaked token would ever be noticed, and it is also the demand data that
-- decides which module to expose next.
CREATE TABLE IF NOT EXISTS mcp_call_log (
  id            bigserial PRIMARY KEY,
  connection_id uuid REFERENCES mcp_connections(id) ON DELETE SET NULL,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  client_name   text,
  tool          text NOT NULL,
  data_set      text,
  row_count     integer,
  truncated     boolean NOT NULL DEFAULT false,
  duration_ms   integer,
  error_code    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_call_log_account_created_idx ON mcp_call_log (account_id, created_at DESC);

ALTER TABLE mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_call_log      ENABLE ROW LEVEL SECURITY;

-- No policies on mcp_oauth_clients / mcp_oauth_codes: only the server-side
-- OAuth routes touch them, through the service-role client. RLS on with no
-- policy = deny all for every normal role, which is what we want.

-- Admins see their own account's connections and audit rows (read-only;
-- disconnect goes through a server action, not a direct client write).
DROP POLICY IF EXISTS mcp_connections_select ON mcp_connections;
CREATE POLICY mcp_connections_select ON mcp_connections FOR SELECT
  USING (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS mcp_call_log_select ON mcp_call_log;
CREATE POLICY mcp_call_log_select ON mcp_call_log FOR SELECT
  USING (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = (SELECT auth.uid())
  ));

COMMENT ON TABLE mcp_connections IS
  'One connected AI tool per row. sb_refresh_encrypted holds the connecting admin''s Supabase refresh token so every AI query runs as that admin and RLS applies.';
