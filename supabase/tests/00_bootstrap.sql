-- ============================================================
-- Supabase primitives a bare PostgreSQL has not got.
--
-- Run this ONCE, on an empty database, BEFORE applying supabase/migrations/*.
-- It was reconstructed on 2026-11-05 from the recipe in README.md, which
-- described these steps in prose but shipped no file — so every run of the
-- suite started by rebuilding them by hand. It is committed now so the suite
-- is reproducible.
--
-- auth.uid() reads current_setting('test.uid'), which is how a test "logs in"
-- as somebody: SELECT set_config('test.uid', '<uuid>', false).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- The three roles every Supabase policy names.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Only the columns the migrations actually reference.
CREATE TABLE IF NOT EXISTS auth.users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(nullif(current_setting('test.role', true), ''), 'authenticated');
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb;
$$;

-- Storage and realtime are referenced by a handful of migrations that this
-- suite does not test. Stubbed so the chain applies; failures against these
-- are the "storage/realtime/publication noise" the README mentions.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA storage, realtime, extensions TO anon, authenticated, service_role;

-- README trap: `authenticated` must be able to read profiles and territories,
-- because contacts_select carries an inline sub-query that runs as the caller.
-- Applied again after the migrations in run-db-tests.sh, once the tables exist.
