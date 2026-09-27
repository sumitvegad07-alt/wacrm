// ============================================================
// Splitting a pile of pings into one bucket per user per LOCAL day.
//
// The local part is the whole point. The database stores UTC, and 20:30 UTC is
// 02:00 the next morning in India. Grouping on the UTC date would file a
// rep's late evening under the wrong day and split one shift across two
// summaries — and because the raw pings are deleted immediately afterwards,
// the mistake would be permanent and unrecoverable.
//
// This is the same class of bug as the DSR report's "0 visits": UTC arithmetic
// where account-local arithmetic was needed.
// ============================================================

import type { Ping } from "./summarise";

export type UserPing = Ping & { user_id: string };

/** Formatter cache — building one per ping is measurably slow over a million rows. */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** yyyy-mm-dd in the given zone. `en-CA` formats in exactly that order. */
function localDay(iso: string, timeZone: string): string {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso));
}

/**
 * Keyed `"<user_id>|<yyyy-mm-dd>"`, which is exactly the unique key on
 * `location_daily_summary`, so a group maps to one row with no further work.
 */
export function groupPingsByLocalDay(
  pings: UserPing[],
  timeZone: string,
): Map<string, UserPing[]> {
  const groups = new Map<string, UserPing[]>();

  for (const ping of pings ?? []) {
    const key = `${ping.user_id}|${localDay(ping.recorded_at, timeZone)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(ping);
    else groups.set(key, [ping]);
  }

  return groups;
}

/** Splits a group key back into its parts. */
export function parseGroupKey(key: string): { userId: string; day: string } {
  const at = key.lastIndexOf("|");
  return { userId: key.slice(0, at), day: key.slice(at + 1) };
}
