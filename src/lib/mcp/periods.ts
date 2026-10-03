// ============================================================
// Named period -> account-local date range.
//
// The AI never sends raw dates. It sends a preset name and OZZO works out
// the real dates in the tenant's own timezone, server-side. This is the
// single rule that makes date correctness impossible for the AI to get
// wrong — and it exists because the dashboard's own getDatesForPeriod()
// runs in the *browser's* timezone, which on a UTC server is 5.5 hours
// out for an Indian tenant (the DSR "0 visits" bug).
//
// Semantics deliberately mirror src/components/reports/report-filter-drawer.tsx
// including its quirks (last_90_days spans 91 inclusive days). The trust
// test asserts the connector and the dashboard return identical numbers,
// so "fixing" a quirk here would break that equality.
// ============================================================

const LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_quarter: "This Quarter",
  previous_quarter: "Previous Quarter",
  current_year: "Current Year",
  previous_year: "Previous Year",
  last_7_days: "Last 7 Days",
  last_15_days: "Last 15 Days",
  last_30_days: "Last 30 Days",
  last_60_days: "Last 60 Days",
  last_90_days: "Last 90 Days",
  last_180_days: "Last 180 Days",
  last_365_days: "Last 365 Days",
};

export const MCP_PERIODS: readonly string[] = Object.keys(LABELS);

export interface ResolvedPeriod {
  start_date: string;
  end_date: string;
  label: string;
  timezone: string;
}

export function isMcpPeriod(v: unknown): v is string {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LABELS, v);
}

/** yyyy-mm-dd for `now` as seen in `timezone`. en-CA formats in that order. */
export function todayInZone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Parse yyyy-mm-dd into its parts. Calendar arithmetic below is done on
 *  these numbers, never on a Date, so no timezone can re-enter. */
function parts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Shift a calendar date by n days using UTC midnight, which has no DST. */
function shiftDays(ymd: string, n: number): string {
  const { y, m, d } = parts(ymd);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Day of week for a calendar date, 0 = Sunday — matching date-fns'
 *  startOfWeek default that the dashboard uses. */
function dow(ymd: string): number {
  const { y, m, d } = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function resolvePeriod(
  period: string,
  timezone: string,
  now: Date = new Date(),
): ResolvedPeriod {
  if (!isMcpPeriod(period)) {
    throw new Error(
      `Unknown period "${period}". Allowed: ${MCP_PERIODS.join(", ")}`,
    );
  }

  const today = todayInZone(timezone, now);
  const { y, m } = parts(today);
  const wrap = (start_date: string, end_date: string): ResolvedPeriod => ({
    start_date,
    end_date,
    label: LABELS[period],
    timezone,
  });

  switch (period) {
    case "today":
      return wrap(today, today);
    case "yesterday": {
      const y1 = shiftDays(today, -1);
      return wrap(y1, y1);
    }
    case "this_week": {
      const start = shiftDays(today, -dow(today));
      return wrap(start, shiftDays(start, 6));
    }
    case "last_week": {
      const start = shiftDays(today, -dow(today) - 7);
      return wrap(start, shiftDays(start, 6));
    }
    case "this_month":
      return wrap(fmt(y, m, 1), fmt(y, m, daysInMonth(y, m)));
    case "last_month": {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      return wrap(fmt(ly, lm, 1), fmt(ly, lm, daysInMonth(ly, lm)));
    }
    case "this_quarter": {
      const qs = Math.floor((m - 1) / 3) * 3 + 1;
      return wrap(fmt(y, qs, 1), fmt(y, qs + 2, daysInMonth(y, qs + 2)));
    }
    case "previous_quarter": {
      const qs = Math.floor((m - 1) / 3) * 3 + 1;
      const ps = qs === 1 ? 10 : qs - 3;
      const py = qs === 1 ? y - 1 : y;
      return wrap(fmt(py, ps, 1), fmt(py, ps + 2, daysInMonth(py, ps + 2)));
    }
    case "current_year":
      return wrap(fmt(y, 1, 1), fmt(y, 12, 31));
    case "previous_year":
      return wrap(fmt(y - 1, 1, 1), fmt(y - 1, 12, 31));
    // The short windows below have NO dashboard counterpart, so unlike
    // last_90_days they are exact: "last 15 days" is 15 calendar days ending
    // today, which is what a person means by it. The legacy windows keep
    // their off-by-one because the trust test requires them to agree with the
    // dashboard, and silently changing a figure an admin already knows would
    // be worse than the inconsistency.
    case "last_7_days":
      return wrap(shiftDays(today, -6), today);
    case "last_15_days":
      return wrap(shiftDays(today, -14), today);
    case "last_30_days":
      return wrap(shiftDays(today, -29), today);
    case "last_60_days":
      return wrap(shiftDays(today, -59), today);
    case "last_90_days":
      return wrap(shiftDays(today, -90), today);
    case "last_180_days":
      return wrap(shiftDays(today, -180), today);
    case "last_365_days":
      return wrap(shiftDays(today, -365), today);
    default:
      throw new Error(`Unknown period "${period}"`);
  }
}
