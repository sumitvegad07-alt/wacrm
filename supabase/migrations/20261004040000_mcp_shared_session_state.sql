-- ============================================================
-- Share the admin's live Supabase session across serverless instances.
--
-- Why: a Supabase refresh token is invalidated the moment it is used. The
-- connector refreshed on every cold start and serialised that in process
-- memory, which protects one instance and nothing else. Two Vercel instances
-- refreshing the same stored token race; one fails, and a lost write can
-- leave an already-spent token stored for everyone — the connection then
-- dies permanently and the admin has to reconnect.
--
-- Holding the live access token here means instances share it and refresh at
-- most once an hour, and sb_refresh_lock_at lets exactly one instance claim
-- the refresh through a conditional UPDATE.
-- ============================================================
ALTER TABLE mcp_connections
  ADD COLUMN IF NOT EXISTS sb_access_encrypted   text,
  ADD COLUMN IF NOT EXISTS sb_access_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS sb_refresh_lock_at    timestamptz;

COMMENT ON COLUMN mcp_connections.sb_access_encrypted IS
  'The admin''s live Supabase ACCESS token, AES-GCM encrypted. Shared across serverless instances so they do not each redeem the single-use refresh token.';
COMMENT ON COLUMN mcp_connections.sb_refresh_lock_at IS
  'Set by the instance currently refreshing. A conditional UPDATE on this column elects one refresher; the others re-read the stored access token.';
