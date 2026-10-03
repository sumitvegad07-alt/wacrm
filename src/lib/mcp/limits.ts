// ============================================================
// Cost control. The connector is free on every plan, so an AI that makes
// fifty lookups to answer one prompt is billable load. These are
// deliberately loose opening values, to be tuned from mcp_call_log after
// a month of real usage rather than guessed now.
// ============================================================
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { todayInZone } from "./periods";

export const MCP_ROW_CEILING = 1000;
export const MCP_DAILY_CALL_BUDGET = 2000;

/** A hard ceiling, never a suggestion: a larger request is clamped. */
export function clampLimit(requested: number | undefined): number {
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested <= 0
  ) {
    return MCP_ROW_CEILING;
  }
  return Math.min(Math.floor(requested), MCP_ROW_CEILING);
}

/** A full page means more rows may exist. The AI must be able to say so —
 *  a silent cut-off is how an AI reports 4 lakh when the truth is 12. */
export function wasTruncated(returned: number, limit: number): boolean {
  return returned >= limit;
}

/** Thrown when an account has spent its day's calls. Carries a message the
 *  AI can relay verbatim to the admin. */
export class McpBudgetExceededError extends Error {
  constructor(used: number) {
    super(
      `This account has used its ${MCP_DAILY_CALL_BUDGET} AI data requests for today (${used} so far). ` +
        `Access resets at midnight in the account's own timezone.`,
    );
    this.name = "McpBudgetExceededError";
  }
}

/**
 * Throw when the account has exhausted today's call budget.
 *
 * "Today" is the account's own calendar day, not UTC — an Indian tenant's
 * budget must reset at midnight IST, which is 18:30 UTC the day before.
 * Counting from mcp_call_log means the budget survives a redeploy, unlike
 * the in-memory rate limiter.
 */
export async function assertDailyBudget(
  accountId: string,
  timezone: string,
): Promise<void> {
  const db = supabaseAdmin();
  const dayStart = startOfAccountDayUtc(timezone);

  const { count, error } = await db
    .from("mcp_call_log")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("created_at", dayStart);

  // Never fail a customer's question because the meter could not be read.
  if (error) {
    console.error("[mcp] daily budget check failed:", error.message);
    return;
  }
  if ((count ?? 0) >= MCP_DAILY_CALL_BUDGET) {
    throw new McpBudgetExceededError(count ?? 0);
  }
}

/**
 * The UTC instant at which the account's current local day began.
 *
 * Derived by asking Intl what the local date is, then finding the offset for
 * that zone, rather than assuming a fixed one — so a tenant in a
 * DST-observing zone is still counted against the right day.
 */
export function startOfAccountDayUtc(
  timezone: string,
  now: Date = new Date(),
): string {
  const localDate = todayInZone(timezone, now);
  const [y, m, d] = localDate.split("-").map(Number);

  // Guess that local midnight is the same wall-clock moment in UTC, then
  // correct by the zone's offset at that instant.
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMs = zoneOffsetMs(timezone, new Date(guess));
  return new Date(guess - offsetMs).toISOString();
}

/** How far ahead of UTC `timezone` is at `at`, in milliseconds. */
function zoneOffsetMs(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    // Intl renders midnight as hour 24 in some locales/zones.
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}
