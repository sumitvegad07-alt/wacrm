// ============================================================
// Shared guard for the MCP module's live-database tests.
//
// Why this exists: .env.local in this working copy still points at the
// decommissioned Singapore project (gxurqwpfvfktmreqmzqb), which is alive
// and answering with stale data. A schema test aimed there goes green while
// production drifts underneath it — worse than having no test, because it
// reports confidence it does not have.
//
// So a live test runs only when it can prove it is talking to the project it
// was written against. Anything else skips with a loud reason rather than
// quietly validating the wrong database.
//
// Point a local run at production by setting MCP_TEST_SUPABASE_URL and
// MCP_TEST_SERVICE_ROLE_KEY (they take precedence over .env.local).
// ============================================================
import dotenv from "dotenv";

/** Production, Mumbai. The only project these tests may assert against. */
export const EXPECTED_PROJECT_REF = "ltigfpywdbfilsagtpyd";

export interface TestDbTarget {
  url: string;
  key: string;
  ref: string;
}

let loaded = false;
function loadEnv() {
  if (!loaded) {
    dotenv.config({ path: ".env.local" });
    loaded = true;
  }
}

function refOf(url: string): string {
  return url.replace(/^https?:\/\/([^.]+)\..*$/, "$1");
}

/**
 * The database a live test should use, or a reason it must not run. Never
 * throws — the caller turns `reason` into a skip so a missing local
 * credential is not a red suite.
 */
export function testDbTarget(): { target: TestDbTarget } | { reason: string } {
  loadEnv();
  const url =
    process.env.MCP_TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.MCP_TEST_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.service_role ??
    "";

  if (!url || !key) {
    return { reason: "no Supabase URL / service-role key available" };
  }
  const ref = refOf(url);
  if (ref !== EXPECTED_PROJECT_REF) {
    return {
      reason:
        `pointed at project "${ref}", not production "${EXPECTED_PROJECT_REF}" — ` +
        `set MCP_TEST_SUPABASE_URL and MCP_TEST_SERVICE_ROLE_KEY to run this`,
    };
  }
  return { target: { url, key, ref } };
}

/** True when a live test may run. Used with vitest's describe.skipIf. */
export function canReachProductionDb(): boolean {
  return "target" in testDbTarget();
}

/** The skip reason, or null when the target is good. Printed once per file so
 *  a skipped live test says why instead of looking like it passed. */
export function skipReason(): string | null {
  const t = testDbTarget();
  return "target" in t ? null : t.reason;
}
