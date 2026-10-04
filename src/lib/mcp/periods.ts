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

// ── Arbitrary ranges ────────────────────────────────────────
//
// Named presets cannot cover every real question: "last 9 days", "20 Sep to
// 4 Oct", "1 to 15 August". The original rule was named periods only, so the
// AI could never repeat the DSR timezone bug by computing dates itself.
//
// These keep that guarantee. OZZO still owns the timezone: `days_back` is
// computed here from the account's own today, and an explicit range is read
// as account-local CALENDAR dates, exactly as a person reading a date on a
// page would mean them. The AI supplies intent, never arithmetic on an
// instant.

/** Longest span we will answer in one call. */
export const MAX_RANGE_DAYS = 1100; // about three years

/** Exactly `days` calendar days ending today, in the account's timezone. */
export function resolveDaysBack(
  days: number,
  timezone: string,
  now: Date = new Date(),
): ResolvedPeriod {
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("days_back must be a whole number of days, 1 or more.");
  }
  const whole = Math.floor(days);
  if (whole > MAX_RANGE_DAYS) {
    throw new Error(
      `days_back is limited to ${MAX_RANGE_DAYS} days. Ask for a narrower window.`,
    );
  }
  const today = todayInZone(timezone, now);
  return {
    start_date: shiftDays(today, -(whole - 1)),
    end_date: today,
    label: `Last ${whole} Day${whole === 1 ? "" : "s"}`,
    timezone,
  };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** True when the string is a real calendar date, not just the right shape. */
function isRealDate(ymd: string): boolean {
  if (!YMD.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

/** An explicit range, read as account-local calendar dates. */
export function resolveCustomRange(
  startDate: string,
  endDate: string,
  timezone: string,
): ResolvedPeriod {
  if (!isRealDate(startDate) || !isRealDate(endDate)) {
    throw new Error(
      "start_date and end_date must be real calendar dates in YYYY-MM-DD form, e.g. 2026-09-20.",
    );
  }
  if (startDate > endDate) {
    throw new Error(
      `start_date (${startDate}) is after end_date (${endDate}).`,
    );
  }
  const span =
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (span > MAX_RANGE_DAYS) {
    throw new Error(
      `That range covers ${Math.round(span)} days; the limit is ${MAX_RANGE_DAYS}. Ask for a narrower window.`,
    );
  }
  return {
    start_date: startDate,
    end_date: endDate,
    label: `${startDate} to ${endDate}`,
    timezone,
  };
}

/**
 * The UTC instants bounding an account-local day range.
 *
 * A reader query filters a timestamptz column, so "20 September" has to
 * become a real instant. Doing that in UTC would start an Indian tenant's day
 * 5.5 hours late and drop the first evening of visits — the DSR bug in
 * another costume. The offset is taken on the date in question, so a
 * DST-observing tenant is not shifted by an hour either.
 *
 * `to` is EXCLUSIVE: the instant the day after end_date begins. Comparing
 * against 23:59:59 would silently drop anything in the final second.
 */
export function localRangeToUtc(
  period: ResolvedPeriod,
): { from: string; to: string } {
  return {
    from: localMidnightUtc(period.start_date, period.timezone),
    to: localMidnightUtc(shiftDays(period.end_date, 1), period.timezone),
  };
}

function localMidnightUtc(ymd: string, timezone: string): string {
  const { y, m, d } = parts(ymd);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = zoneOffsetMs(timezone, new Date(guess));
  return new Date(guess - offset).toISOString();
}

/** How far ahead of UTC `timezone` is at `at`, in milliseconds. */
function zoneOffsetMs(timezone: string, at: Date): number {
  const fields = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(fields.find((f) => f.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/**
 * Render a UTC instant in the account's timezone, with its offset.
 *
 * The connector used to hand the AI raw UTC and leave it to convert — and it
 * said so out loud: "the timestamps are stored in UTC, and I converted them
 * to IST". That is exactly the work this module exists to take away, and one
 * slip turns a 6pm visit into a midnight one. An offset-bearing string is
 * both unambiguous and still machine-readable:
 *
 *   2026-10-02T19:13:55Z  ->  2026-10-03T00:43:55+05:30
 *
 * Returns the input unchanged if it is not a timestamp we can read, because a
 * display concern must never lose data.
 */
export function toAccountLocalIso(value: string, timezone: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const at = new Date(ms);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  const local = `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;

  const offsetMin = Math.round(
    (Date.parse(`${local}Z`) - at.getTime()) / 60_000,
  );
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${local}${sign}${hh}:${mm}`;
}
