// ------------------------------------------------------------
// Frequency + time-bucketing helpers for the SFA analytics block.
//
// One frequency control (Daily / Monthly / Quarterly / Yearly) drives two
// things:
//   - CURRENT-PERIOD range  → the KPI tiles, top-5 lists, and order-by-status
//     snapshot ("Today" / "This Month" / "This Quarter" / "This Year").
//   - TREND range + buckets → the time-series charts, showing a trailing window
//     bucketed at the chosen granularity so the run-up to now is visible.
//
// Pure data + pure functions (no DB, no React) so it can run in the server
// action and be unit-tested.
// ------------------------------------------------------------

import { format } from "date-fns";

export type Frequency = "daily" | "monthly" | "quarterly" | "yearly";

export const FREQUENCIES: readonly Frequency[] = ["daily", "monthly", "quarterly", "yearly"] as const;

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "Daily",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

/** Human name of the current period a frequency snapshots for KPIs / top-5. */
export const PERIOD_LABEL: Record<Frequency, string> = {
  daily: "Today",
  monthly: "This Month",
  quarterly: "This Quarter",
  yearly: "This Year",
};

/** How many trailing buckets each frequency's trend chart shows. */
const TREND_BUCKETS: Record<Frequency, number> = {
  daily: 30,
  monthly: 12,
  quarterly: 8,
  yearly: 5,
};

export interface DateRange {
  start_date: string; // YYYY-MM-DD, inclusive
  end_date: string; // YYYY-MM-DD, inclusive
}

export interface Bucket {
  /** Stable bucket key (e.g. 2026-09, 2026-Q3, 2026-09-06, 2026). */
  key: string;
  /** Short axis label. */
  label: string;
  value: number;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function quarterOf(month0: number): number {
  return Math.floor(month0 / 3) + 1; // month0 is 0-11
}

/** The current-period range a frequency snapshots (start of period → today). */
export function currentPeriodRange(freq: Frequency, now: Date = new Date()): DateRange {
  const end = new Date(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (freq) {
    case "daily":
      break; // today only
    case "monthly":
      start.setDate(1);
      break;
    case "quarterly": {
      const q = quarterOf(start.getMonth());
      start.setMonth((q - 1) * 3, 1);
      break;
    }
    case "yearly":
      start.setMonth(0, 1);
      break;
  }
  return { start_date: ymd(start), end_date: ymd(end) };
}

/** The trailing window a frequency's trend chart covers. */
export function trendRange(freq: Frequency, now: Date = new Date()): DateRange {
  const end = new Date(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const n = TREND_BUCKETS[freq];
  switch (freq) {
    case "daily":
      start.setDate(start.getDate() - (n - 1));
      break;
    case "monthly":
      start.setMonth(start.getMonth() - (n - 1), 1);
      break;
    case "quarterly": {
      const q = quarterOf(start.getMonth());
      start.setMonth((q - 1) * 3, 1); // start of this quarter
      start.setMonth(start.getMonth() - (n - 1) * 3);
      break;
    }
    case "yearly":
      start.setMonth(0, 1);
      start.setFullYear(start.getFullYear() - (n - 1));
      break;
  }
  return { start_date: ymd(start), end_date: ymd(end) };
}

/** The bucket key a given calendar day falls into, at the chosen frequency. */
export function bucketOf(dateStr: string, freq: Frequency): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  const y = d.getFullYear();
  switch (freq) {
    case "daily":
      return ymd(d);
    case "monthly":
      return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    case "quarterly":
      return `${y}-Q${quarterOf(d.getMonth())}`;
    case "yearly":
      return String(y);
  }
}

function labelFor(key: string, freq: Frequency): string {
  switch (freq) {
    case "daily":
      return format(new Date(`${key}T00:00:00`), "d MMM");
    case "monthly":
      return format(new Date(`${key}-01T00:00:00`), "MMM yy");
    case "quarterly": {
      const [y, q] = key.split("-Q");
      return `${q}Q ${y.slice(2)}`;
    }
    case "yearly":
      return key;
  }
}

/** The ordered, gap-free set of buckets a trend chart should render. */
export function trendBuckets(freq: Frequency, now: Date = new Date()): Bucket[] {
  const n = TREND_BUCKETS[freq];
  const out: Bucket[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  if (freq === "quarterly") cursor.setMonth((quarterOf(cursor.getMonth()) - 1) * 3, 1);
  if (freq === "monthly") cursor.setDate(1);
  if (freq === "yearly") cursor.setMonth(0, 1);

  for (let i = 0; i < n; i++) {
    const d = new Date(cursor);
    switch (freq) {
      case "daily":
        d.setDate(d.getDate() - (n - 1 - i));
        break;
      case "monthly":
        d.setMonth(d.getMonth() - (n - 1 - i));
        break;
      case "quarterly":
        d.setMonth(d.getMonth() - (n - 1 - i) * 3);
        break;
      case "yearly":
        d.setFullYear(d.getFullYear() - (n - 1 - i));
        break;
    }
    const key = bucketOf(ymd(d), freq);
    out.push({ key, label: labelFor(key, freq), value: 0 });
  }
  return out;
}

/**
 * Fold daily `{ date, value }` rows (as returned by execute_report grouped on
 * the `date` dimension) into the trend buckets for the frequency. Rows outside
 * the window are ignored; empty buckets stay at 0 so the axis is continuous.
 */
export function foldIntoBuckets(
  rows: { date: string; value: number }[],
  freq: Frequency,
  now: Date = new Date(),
): Bucket[] {
  const buckets = trendBuckets(freq, now);
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const r of rows) {
    if (!r.date) continue;
    const key = bucketOf(String(r.date), freq);
    const i = index.get(key);
    if (i !== undefined) buckets[i].value += Number(r.value) || 0;
  }
  return buckets;
}
