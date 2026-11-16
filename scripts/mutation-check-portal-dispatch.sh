#!/usr/bin/env bash
# Mutation-check the dispatch rules against a cluster that is ALREADY built.
#
# The working agreement's third rule: "a guard that has never failed is not a
# guard". Each rule below is removed from `portal_create_dispatch` in turn and
# the scenario that is supposed to catch it is watched to FAIL. A rule whose
# removal changes nothing was never doing anything.
#
# Why this is a separate script and not part of run-db-tests.sh: the full
# runner rebuilds the cluster and reapplies 313 migrations, which is 6-20
# minutes. Three mutations that way is an hour. This reuses the cluster the
# runner left behind, so each mutation costs seconds.
#
#   KEEP=1 bash scripts/run-db-tests.sh      # leaves the cluster up
#   bash scripts/mutation-check-portal-dispatch.sh
#
# If the cluster is not up this exits saying so, rather than reporting that
# every mutation "passed" against a database that was not there — which is the
# shape of the fault this whole file exists to catch.
set -uo pipefail

PORT="${PGPORT:-54399}"
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$WEB_DIR/../tools/pgsql/bin}"
export PATH="$PG_BIN:$PATH"
PSQL=(psql -v ON_ERROR_STOP=0 -q -p "$PORT" -U postgres -d postgres)

MIG="$WEB_DIR/supabase/migrations/20261116150000_portal_dispatch_write.sql"
# THE WHOLE SCENARIO LIST IS RE-RUN FOR EACH MUTATION, not just file 76.
#
# 76 cannot be run on its own against a database the later files have already
# touched: 77 finishes by closing ORD_S1, and 76 opens by setting it back to
# Approved — a transition the status machine refuses from Closed, so with
# ON_ERROR_STOP the file aborts on its first statement and records NOTHING.
# Re-running 70 first does not fix it either; 70 deletes contacts that 72's
# orders now reference, so it aborts on a foreign key.
#
# The first version of this script did exactly that and reported all three
# guards ASLEEP — a verdict about a file that had never run. Hence the
# `recorded` floor below: silence is not success.
#
# The full list costs seconds. The migrations are what cost twelve minutes,
# and they are not reapplied.
SCENARIOS="$WEB_DIR/scripts/run-db-scenarios-only.sh"
WORK="${TMPDIR:-/tmp}/ozzo-mutation"
mkdir -p "$WORK"

if ! "${PSQL[@]}" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "No cluster on port $PORT. Run: KEEP=1 bash scripts/run-db-tests.sh" >&2
  exit 2
fi

# A scenario name, and the exact line to delete from the migration.
#
# `D4` the order is not the caller's own purchase order
# `D5` never more than remains
# `D9` a replay is not a second load
run_mutation() {
  local name="$1" scenario="$2" pattern="$3"

  python - "$MIG" "$WORK/mutated.sql" "$pattern" <<'PY'
import sys, re
src, dst, pattern = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src, encoding="utf-8").read()
out, removed = re.subn(pattern, "", text, flags=re.S)
if removed == 0:
    sys.exit("MUTATION DID NOT APPLY: " + pattern[:60])
open(dst, "w", encoding="utf-8").write(out)
PY
  if [ $? -ne 0 ]; then
    echo "  $name: COULD NOT MUTATE — the pattern no longer matches the migration." >&2
    return 1
  fi

  "${PSQL[@]}" -f "$WORK/mutated.sql" >/dev/null 2>&1
  PGPORT="$PORT" bash "$SCENARIOS" >/dev/null 2>&1

  # SILENCE IS NOT SUCCESS. If file 76 did not run at all, "the guard still
  # passed" is a statement about nothing — which is exactly what the first
  # version of this script reported, three times, with confidence.
  local recorded failed
  recorded=$("${PSQL[@]}" -tAc "SELECT count(*) FROM qa_results WHERE scenario LIKE 'D%';")
  if [ "${recorded:-0}" -lt 10 ]; then
    echo "  $name: INCONCLUSIVE — file 76 recorded only ${recorded:-0} scenarios." >&2
    "${PSQL[@]}" -f "$MIG" >/dev/null 2>&1
    return 1
  fi

  failed=$("${PSQL[@]}" -tAc \
    "SELECT count(*) FROM qa_results WHERE pass IS NOT TRUE AND scenario LIKE '${scenario}%';")

  if [ "${failed:-0}" -gt 0 ]; then
    echo "  $name: the guard BITES — $scenario failed with the rule removed."
  else
    echo "  $name: *** THE GUARD IS ASLEEP *** — $scenario still passed without the rule." >&2
  fi

  # Put the real function back before the next one.
  "${PSQL[@]}" -f "$MIG" >/dev/null 2>&1
}

echo "Mutation checks for portal_create_dispatch"

# 1. The line the money draws: their own purchase order is the company's to ship.
run_mutation "own purchase order" "D4" \
  '\n *-- THE LINE: their customers.*?\n *AND o\.contact_id IS DISTINCT FROM v_caller'

# 2. Never more than remains.
run_mutation "remaining quantity" "D5" \
  '\n *IF v_qty > v_item\.quantity - v_shipped THEN.*?\n *END IF;'

# 3. A replay is not a second load.
run_mutation "replay" "D9" \
  '\n *IF FOUND THEN\n *RETURN jsonb_build_object\(.*?\n *END IF;'

# And leave the database exactly as it was found.
PGPORT="$PORT" bash "$SCENARIOS" >/dev/null 2>&1
echo "Restored; the whole suite re-run against the real function."
"${PSQL[@]}" -c "SELECT count(*) FILTER (WHERE pass) AS passed,
                        count(*) FILTER (WHERE pass IS NOT TRUE) AS failed
                   FROM qa_results;"
