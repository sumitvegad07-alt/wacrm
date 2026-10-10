// ============================================================
// Lead Discovery — how a harvest outlives one serverless invocation.
//
// A worker harvests for about four minutes and then has to stop; a full sweep
// is ten or more. So each worker hands on to a fresh one before its time runs
// out, by POSTing to the worker route, which answers immediately and does its
// own work after the response. Every link in the chain is therefore a fast HTTP
// call, and no invocation is ever left holding another one open.
//
// WHY A LOST LINK IS NOT A LOST HARVEST
//
// Every exit leaves the run claimable: status back to `queued`, heartbeat
// cleared, `next_index` pointing at the first search still owed. If a hand-off
// never arrives, the run simply sits there until something looks at it — and
// opening the Lead Discovery page is enough, because the page nudges any run
// that has gone quiet. The cost of a dropped link is a delay, never a row and
// never a wasted Google call.
//
// The worker route is authenticated with CRON_SECRET: these requests carry no
// user session, and an unauthenticated endpoint that spends the founder's
// Google quota is not something to leave open.
// ============================================================

import { serviceClient } from "@/lib/auth/superadmin";
import { harvestRun } from "./discovery-runner";

/**
 * How many times a harvest may hand on before it stops doing so.
 *
 * Twenty links is over an hour of harvesting — far more than the longest sweep
 * needs. It exists only so that a bug which stopped the plan advancing would
 * burn out instead of handing on to itself forever.
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
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[discover] CRON_SECRET is not set, so the harvest cannot hand on");
    return false;
  }

  try {
    const res = await fetch(`${baseUrl}${WORKER_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ runId, link }),
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
