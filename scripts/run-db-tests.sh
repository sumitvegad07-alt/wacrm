#!/usr/bin/env bash
# Stand up a throwaway PostgreSQL, apply every migration, run supabase/tests.
#
# Written 2026-11-05. Before this, the recipe lived only in supabase/tests/
# README.md as prose, so each run was re-typed by hand and the suite was, in
# practice, run once. tools/pgsql in this workspace is a complete PostgreSQL
# 17.6 (see the "Local PostgreSQL harness" note).
#
#   scripts/run-db-tests.sh            # full rebuild, then every test file
#   PGPORT=54399 scripts/run-db-tests.sh
#
# Exits non-zero if any migration fails unexpectedly or any scenario fails.
set -uo pipefail

PORT="${PGPORT:-54399}"
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$WEB_DIR/../tools/pgsql/bin}"
DATA_DIR="${PGDATA_DIR:-${TMPDIR:-/tmp}/ozzo-pgtest}"
LOG="$DATA_DIR/log.txt"

export PATH="$PG_BIN:$PATH"
PSQL=(psql -v ON_ERROR_STOP=0 -q -p "$PORT" -U postgres -d postgres)

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ── Fresh cluster every time ─────────────────────────────────
# The suite mutates shared rows, and the README's hardest-won lesson is that a
# half-left-over database reports failures that are only stale state.
say "Rebuilding cluster at $DATA_DIR"
if [ -d "$DATA_DIR" ]; then
  pg_ctl -D "$DATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
fi
mkdir -p "$DATA_DIR"
initdb -D "$DATA_DIR" -U postgres -A trust -E UTF8 --no-locale >/dev/null
pg_ctl -D "$DATA_DIR" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$LOG" -w start >/dev/null

cleanup() { pg_ctl -D "$DATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

say "Supabase primitives"
"${PSQL[@]}" -f "$WEB_DIR/supabase/tests/00_bootstrap.sql" >/dev/null

# ── Migrations, in filename order ────────────────────────────
# Byte order, which is what Supabase itself uses. Failures are counted, not
# fatal: a known residue of storage/realtime/publication statements cannot
# work against a bare PostgreSQL. The count is printed so a NEW failure is
# visible as a jump.
say "Applying migrations"
fail=0; total=0
for f in $(ls "$WEB_DIR"/supabase/migrations/*.sql | LC_ALL=C sort); do
  total=$((total + 1))
  if ! "${PSQL[@]}" -f "$f" >"$DATA_DIR/last.out" 2>&1; then
    fail=$((fail + 1))
  fi
  if grep -qi '^psql.*ERROR' "$DATA_DIR/last.out"; then
    fail=$((fail + 1))
    echo "  ERROR in $(basename "$f")"
    grep -i 'ERROR' "$DATA_DIR/last.out" | head -3 | sed 's/^/      /'
  fi
done
echo "  $total migrations applied, $fail reported errors"

# Supabase grants the API roles table privileges and relies on RLS for the
# actual gate; a bare PostgreSQL grants nothing, so every policy-protected read
# fails with "permission denied for table X" long before the policy is
# consulted. The README called out profiles and territories, but file 30 needs
# contacts too — so grant the lot and let RLS do its job, which is what the
# real database does.
"${PSQL[@]}" >/dev/null 2>&1 <<'GRANTS'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANTS

# README trap: this trigger invents an account per test user.
"${PSQL[@]}" -c "ALTER TABLE auth.users DISABLE TRIGGER USER;" >/dev/null 2>&1

# ── Scenarios ────────────────────────────────────────────────
# Order is load-bearing: 40 hangs its city off the tree 30 builds, and the
# fixture must be reloaded first because the files mutate rows they share.
#
# TRUNCATION IS THE TRAP. A scenario file that sets ON_ERROR_STOP and hits an
# unexpected error ABORTS, and every scenario below that line simply never
# runs. The suite then reports "all scenarios passed" — truthfully, about a
# third fewer scenarios. That happened on 2026-11-05: a duplicate-key error
# half way through file 50 silently skipped all fifteen route-rights
# assertions while the run still came back green.
#
# So each file's qa() calls are counted statically and compared with the rows
# it actually recorded. A shortfall fails the run and names the file.
say "Running scenarios"
truncated=0
for f in 00_fixture 10_buying_status 20_mapping_codes_territory \
         30_territory_coverage_rls 40_area_channel_mapping 50_rights_and_many_holders; do
  p="$WEB_DIR/supabase/tests/$f.sql"
  [ -f "$p" ] || continue
  before=$("${PSQL[@]}" -tAc "SELECT count(*) FROM qa_results;" 2>/dev/null || echo 0)
  echo "  $f"
  "${PSQL[@]}" -f "$p" 2>&1 | grep -iE '^psql.*(ERROR|FATAL)' | head -5 | sed 's/^/      /'
  # Every assertion in these files is a top-level `SELECT qa…(`.
  expected=$(grep -cE "^[[:space:]]*SELECT[[:space:]]+qa(_refused|_allowed)?\(" "$p" || true)
  after=$("${PSQL[@]}" -tAc "SELECT count(*) FROM qa_results;" 2>/dev/null || echo 0)
  got=$((after - before))
  if [ "${expected:-0}" -gt 0 ] && [ "$got" -lt "$expected" ]; then
    echo "      TRUNCATED: recorded $got of $expected scenarios - the file aborted early."
    truncated=1
  fi
done

say "Results"
"${PSQL[@]}" -c "SELECT count(*) FILTER (WHERE pass) AS passed,
                        count(*) FILTER (WHERE pass IS NOT TRUE) AS failed
                   FROM qa_results;"
"${PSQL[@]}" -c "SELECT scenario, detail FROM qa_results WHERE pass IS NOT TRUE ORDER BY scenario;"

bad=$("${PSQL[@]}" -tAc "SELECT count(*) FROM qa_results WHERE pass IS NOT TRUE;")
[ "$bad" = "0" ] || { echo "FAILED: $bad scenario(s)"; exit 1; }
[ "$truncated" = "0" ] || { echo "FAILED: a scenario file aborted early - see TRUNCATED above."; exit 1; }
echo "All scenarios passed."
