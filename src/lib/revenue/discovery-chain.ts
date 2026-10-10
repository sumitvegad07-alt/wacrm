// ============================================================
// Lead Discovery — how a harvest outlives one serverless invocation.
//
// A worker harvests for about four minutes and then has to stop; a full sweep
// is ten or more. So each worker hands on to a fresh one before its time runs
// out, by POSTing to the worker route, which answers immediately and does its
// own work after the response. Every link in the chain is therefore a fast HTTP
// call, and no invocation is ever left holding another one open.
//
// HOW A HAND-OFF AUTHENTICATES ITSELF
//
// With a single-use token written on the run, not a shared secret.
//
// The first version of this used CRON_SECRET, copied from the retention job.
// That variable is not set on this project, so the hand-off could never
// authenticate: every harvest did one chunk and stopped, and the dead run then
// blocked all later ones. A feature must not be one unset environment variable
// away from silently not working — so the token lives on the row the hand-off
// is about, and there is nothing to configure.
//
// It is also the stronger of the two. A leaked token buys one hand-off of one
// harvest; a leaked CRON_SECRET would buy every endpoint guarded by it, for
// ever. CRON_SECRET is still accepted when it is set, for prodding a run by
// hand.
//
// WHY A LOST LINK IS NOT A LOST HARVEST
//
// Every exit leaves the run claimable: status back to `queued`, heartbeat
// cleared, `next_index` pointing at the first search still owed. If a hand-off
// never arrives, the run sits there until something looks at it — and opening
// the Lead Discovery page is enough, because the page nudges any run that has
// gone quiet. A dropped link costs a delay, never a row and never a Google call.
// ============================================================

import { randomUUID } from "node:crypto";
import { serviceClient } from "@/lib/auth/superadmin";
import { harvestRun, type Admin } from "./discovery-runner";

/**
 * How many times a harvest may hand on before it stops doing so.
 *
 * Twenty links is over an hour of harvesting — far more than the longest sweep
 * needs. It exists only so that a bug which stopped the plan advancing would
 * burn out instead of handing on to itself for ever.
 */
const MAX_CHAIN_LINKS = 20;

export const WORKER_PATH = "/api/admin/revenue/discover/worker";

/**
 * Harvests, then hands the rest to a fresh invocation if there is any left.
 *
 * Call this from `after()`, never inline: it runs for minutes, and the request
 * that triggered it must have been answered long before.
 */
export async function harvestAndHandOn(baseUrl: string, runId: string, link = 0): Promise<void> {
  const admin = serviceClient();

  let outcome;
  try {
    outcome = await harvestRun(admin, runId);
  } catch (err) {
    // harvestRun already releases the run on failure; this is only here so a
    // throw cannot take down the invocation silently.
    console.error("[discover] worker threw", runId, err);
    return;
  }

  // Not claimed means another worker has it. Handing on would only produce a
  // second worker to lose the same race.
  if (!outcome.claimed || !outcome.handOff) return;

  if (link + 1 >= MAX_CHAIN_LINKS) {
    console.error("[discover] chain limit reached, leaving run queued", runId);
    return;
  }

  await kickWorker(baseUrl, runId, link + 1);
}

/**
 * Asks a fresh invocation to carry on.
 *
 * The call is awaited, but the worker route answers before it starts working,
 * so this returns in milliseconds. A failure is logged and swallowed: the run
 * is already queued and claimable, so the worst case is that it waits for the
 * next page load.
 */
export async function kickWorker(baseUrl: string, runId: string, link = 0): Promise<boolean> {
  const admin = serviceClient();
  const token = await mintWorkerToken(admin, runId);
  if (!token) return false;

  try {
    const res = await fetch(`${baseUrl}${WORKER_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, link, token }),
      // The route answers before it works, so anything slower than this is a
      // delivery problem, not a busy worker.
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    console.error("[discover] could not hand on", runId, err);
    return false;
  }
}

/**
 * Puts a fresh hand-off token on the run and returns it.
 *
 * Overwrites any token already there, which is what should happen: an older
 * hand-off that never arrived must not stay redeemable once a newer one has
 * been issued.
 */
async function mintWorkerToken(admin: Admin, runId: string): Promise<string | null> {
  const token = randomUUID();

  const { error } = await admin
    .from("re_discovery_runs")
    .update({ worker_token: token })
    .eq("id", runId);

  if (error) {
    console.error("[discover] could not mint a hand-off token", runId, error.message);
    return null;
  }

  return token;
}

/**
 * Whether this request may harvest that run.
 *
 * Either it presents the run's current hand-off token — spent here, so it works
 * exactly once — or it carries CRON_SECRET, for prodding a harvest by hand when
 * that variable happens to be set.
 */
export async function authorizeWorker(
  admin: Admin,
  runId: string,
  token: string,
  authorization: string | null,
): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && authorization === `Bearer ${secret}`) return true;

  if (!token) return false;

  const { data } = await admin.rpc("re_discovery_redeem_token", {
    p_run_id: runId,
    p_token: token,
  });

  return data === true;
}
