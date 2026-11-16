#!/usr/bin/env bash
# Run ONLY the scenario files, against a cluster that is already up.
#
# `run-db-tests.sh` spends twelve minutes rebuilding a cluster and applying 315
# migrations before it reaches the scenarios. When the schema has not changed
# since the last run — a scenario file edited, a rule mutated — that is twelve
# minutes to find out whether one assertion holds.
#
# This is that script's second half, and nothing else. It assumes a prepared
# cluster: migrations applied, `public` granted to the API roles, and the
# auth.users trigger disabled. It does NOT create one.
#
#   PGPORT=54411 bash scripts/run-db-scenarios-only.sh
#   PGPORT=54411 bash scripts/run-db-scenarios-only.sh 76_portal_dispatch_write
#
# With no arguments it runs the whole list in the same ORDER the full runner
# uses, which is load-bearing: 75 counts rows that 71 and 72 add to, so it runs
# before them.
#
# The truncation guard is the same one, and for the same reason: a file that
# hits an unexpected error ABORTS, every assertion below that line never runs,
# and the suite reports "all passed" about a third fewer scenarios.
set -uo pipefail

PORT="${PGPORT:-54399}"
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$WEB_DIR/../tools/pgsql/bin}"
export PATH="$PG_BIN:$PATH"
PSQL=(psql -v ON_ERROR_STOP=0 -q -p "$PORT" -U postgres -d postgres)

if ! "${PSQL[@]}" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "No cluster on port $PORT. Run scripts/run-db-tests.sh first." >&2
  exit 2
fi

ALL="00_fixture 10_buying_status 20_mapping_codes_territory 30_territory_coverage_rls 40_area_channel_mapping 50_rights_and_many_holders 60_dms_foundation 70_dashboard_viewer_scope 70_portal_visibility 75_portal_list_filters 71_portal_customer_create 72_portal_place_order 74_portal_payments_write 76_portal_dispatch_write 77_portal_reports"

FILES="${*:-$ALL}"

# A partial run must not be measured against the whole suite's leftovers.
if [ $# -eq 0 ]; then
  "${PSQL[@]}" -c "DELETE FROM qa_results;" >/dev/null 2>&1
fi

truncated=0
for f in $FILES; do
  p="$WEB_DIR/supabase/tests/$f.sql"
  [ -f "$p" ] || { echo "  $f — NO SUCH FILE" >&2; truncated=1; continue; }
  before=$("${PSQL[@]}" -tAc "SELECT count(*) FROM qa_results;" 2>/dev/null || echo 0)
  echo "  $f"
  "${PSQL[@]}" -f "$p" 2>&1 | grep -iE '^psql.*(ERROR|FATAL)' | head -5 | sed 's/^/      /'
  expected=$(grep -cE "^[[:space:]]*SELECT[[:space:]]+qa(_refused|_allowed)?\(" "$p" || true)
  after=$("${PSQL[@]}" -tAc "SELECT count(*) FROM qa_results;" 2>/dev/null || echo 0)
  got=$((after - before))
  if [ "${expected:-0}" -gt 0 ] && [ "$got" -lt "$expected" ]; then
    echo "      TRUNCATED: recorded $got of $expected scenarios - the file aborted early."
    truncated=1
  fi
done

printf '\n\033[1m== Results\033[0m\n'
"${PSQL[@]}" -c "SELECT count(*) FILTER (WHERE pass) AS passed,
                        count(*) FILTER (WHERE pass IS NOT TRUE) AS failed
                   FROM qa_results;"
"${PSQL[@]}" -c "SELECT scenario, detail FROM qa_results WHERE pass IS NOT TRUE ORDER BY scenario;"

failed=$("${PSQL[@]}" -tAc "SELECT count(*) FROM qa_results WHERE pass IS NOT TRUE;")
if [ "${failed:-1}" -ne 0 ]; then
  echo "FAILED: $failed scenario(s)."; exit 1
fi
if [ "$truncated" -ne 0 ]; then
  echo "FAILED: a scenario file aborted early."; exit 1
fi
echo "All scenarios passed."
