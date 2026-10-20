// ============================================================
// All of the renewal screen's day arithmetic, in one testable place.
//
// Two rules hold everything together:
//
//   1. "Today" is Asia/Kolkata, resolved through todayInIndia(). Vercel runs in
//      UTC, so at 23:40 IST the server's own date is still yesterday — a screen
//      built on it would show yesterday's due list for the last 5½ hours of
//      every day.
//   2. A date-only value is compared as a yyyy-mm-dd STRING, or as a UTC-noon
//      instant when a day count is needed. Never `new Date("2026-10-20")`
//      compared against a local `Date`: that mixes a UTC midnight with a local
//      one and shifts the answer by a day in either direction.
//
// The tabs are CUMULATIVE on purpose. "Next 7 days" answers "what needs chasing
// this week", so it includes today and anything already overdue — a renewal
// that lapsed on Monday must not vanish from the week's list.
// ============================================================

import { todayInIndia } from "@/lib/proposals/today";
import type { RenewalBucket, SubscriptionRow } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date-only string as a UTC-noon instant: far from any day boundary. */
function utcNoon(date: string): number | null {
  if (!DATE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whole days from today to `endDate`: 0 today, 1 tomorrow, −1 yesterday.
 *
 * `today` is normally supplied by the caller (the API resolves it once per
 * request). `now` exists so a test can pin the clock without mocking Date.
 */
export function daysUntil(
  endDate: string,
  today?: string,
  now: Date = new Date(),
): number | null {
  const end = utcNoon(endDate);
  const start = utcNoon(today ?? todayInIndia(now));
  if (end === null || start === null) return null;

  return Math.round((end - start) / 86_400_000);
}

/**
 * The narrowest bucket a row belongs to, or null when it is not due soon.
 *
 * A `lost` customer is in no due bucket however their date reads: they are not
 * coming back, and the one screen that has to be actionable each morning should
 * not carry them. They stay visible under the All tab.
 */
export function bucketOf(
  row: Pick<SubscriptionRow, "end_date" | "status">,
  today?: string,
  now: Date = new Date(),
): RenewalBucket | null {
  if (row.status === "lost") return null;

  const days = daysUntil(row.end_date, today, now);
  if (days === null) return null;

  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "next_7";
  if (days <= 30) return "next_30";
  return null;
}

/** Whether a row belongs on a given tab. The due tabs are cumulative. */
export function inBucket(
  row: Pick<SubscriptionRow, "end_date" | "status">,
  bucket: RenewalBucket,
  today?: string,
  now: Date = new Date(),
): boolean {
  if (bucket === "all") return true;
  if (row.status === "lost") return false;

  const days = daysUntil(row.end_date, today, now);
  if (days === null) return false;

  switch (bucket) {
    case "overdue":
      return days < 0;
    case "today":
      return days === 0;
    case "next_7":
      return days <= 7;
    case "next_30":
      return days <= 30;
  }
}

export interface BucketFigure {
  count: number;
  amount: number;
}

/** The tiles above the table: a count and a rupee value for every tab. */
export function bucketSummary(
  rows: SubscriptionRow[],
  today?: string,
  now: Date = new Date(),
): Record<RenewalBucket, BucketFigure> {
  const blank = (): BucketFigure => ({ count: 0, amount: 0 });
  const out: Record<RenewalBucket, BucketFigure> = {
    today: blank(),
    overdue: blank(),
    next_7: blank(),
    next_30: blank(),
    all: blank(),
  };

  for (const row of rows ?? []) {
    const amount = Number(row.amount) || 0;

    out.all.count += 1;
    out.all.amount += amount;

    for (const bucket of ["overdue", "today", "next_7", "next_30"] as const) {
      if (inBucket(row, bucket, today, now)) {
        out[bucket].count += 1;
        out[bucket].amount += amount;
      }
    }
  }

  return out;
}
