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

/**
 * Per-test timeout for the suites in this folder, in ms.
 *
 * Vitest's default is 5000, which is a sensible budget for a unit test and the
 * wrong one for a test that crosses the internet to Mumbai and back. Applied
 * per suite — `describe(name, { timeout: LIVE_DB_TIMEOUT }, …)` — rather than
 * globally, so the other ~3,700 unit tests keep the tight default and a real
 * hang still shows up as a hang.
 *
 * Sized from measurement, not taste. The slowest single live test here is
 * ~1.8s uncontended (tenant isolation over `territories`, which reads 1,000
 * ids and then re-reads them in chunks of 150 to check their owner). During a
 * full 202-file run that crossed 5s often enough to fail a different
 * tenant-isolation test on roughly one run in two — the worst possible place
 * to have a test people learn to ignore, because the day it fails for a real
 * reason it looks like the usual noise. 20s leaves about 11x headroom over the
 * worst case observed while still bounding a genuinely stuck request.
 *
 * If a test here needs more than this, that is a signal about the test, not
 * about the number: `scenarios.test.ts` once awaited 24 windows one after
 * another in a single test and took 9.3s. Fetching them concurrently brought
 * it to 0.8s. Prefer fixing the serialisation.
 */
export const LIVE_DB_TIMEOUT = 20_000;

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

  // The URL and the key are separate variables, so they can disagree — and
  // did: repointing the URL at Mumbai while a Singapore service-role key was
  // still in place would turn a clean skip into an opaque "invalid JWT" on
  // every assertion. A legacy key carries its project in the `ref` claim, so
  // check it. Modern sb_secret_ keys are opaque and cannot be checked here.
  const keyRef = legacyKeyRef(key);
  if (keyRef && keyRef !== EXPECTED_PROJECT_REF) {
    return {
      reason:
        `the service-role key belongs to project "${keyRef}" but the URL points at ` +
        `"${ref}" — update SUPABASE_SERVICE_ROLE_KEY in .env.local to the ${EXPECTED_PROJECT_REF} key`,
    };
  }

  return { target: { url, key, ref } };
}

/** The project ref inside a legacy JWT API key, or null if it is not one. */
function legacyKeyRef(key: string): string | null {
  const payload = key.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return typeof claims?.ref === "string" ? claims.ref : null;
  } catch {
    return null;
  }
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
