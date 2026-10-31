// Centralised date helpers for the dashboard so every chart / card
// agrees on what "today", "day boundary", and "day of week" mean.
// All boundaries are computed in the user's LOCAL timezone — which is
// what a business user intuitively expects when they say "today".

export function startOfLocalDay(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function daysAgoStart(days: number): Date {
  const out = startOfLocalDay()
  out.setDate(out.getDate() - days)
  return out
}

/** Date-only key (YYYY-MM-DD) for bucketing rows by local calendar day. */
export function localDayKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Inclusive list of local-day keys spanning the last `n` days, in
 * chronological order. Useful for seeding chart buckets so days with
 * zero activity still render a 0-point in the line.
 */
export function lastNDayKeys(n: number): string[] {
  const keys: string[] = []
  const start = daysAgoStart(n - 1)
  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    keys.push(localDayKey(d))
  }
  return keys
}

/**
 * ISO day-of-week where 0 = Monday … 6 = Sunday. JavaScript's native
 * getDay() uses 0 = Sunday which is awkward for most business charts.
 */
export function mondayIndex(d: Date): number {
  const jsDow = d.getDay() // 0..6 with Sunday=0
  return (jsDow + 6) % 7
}

export const DOW_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

// ── Account-timezone day boundaries ─────────────────────────
//
// Everything above works in the BROWSER's timezone, which is right for
// labelling a chart the viewer is looking at and wrong for deciding which
// rows count as "today". A tenant in Rajkot whose manager opens the dashboard
// from a laptop still set to UTC was shown a day that started at 05:30 local.
//
// House rule: a day boundary is the ACCOUNT's, resolved AT TIME ZONE its own
// zone. The authoritative version of these two functions is in SQL
// (account_day_start / account_month_start, migration
// 20261031120000_dashboard_aggregate_rpcs.sql) and that is what the dashboard
// actually uses. These exist so the pre-migration fallback path lands on the
// SAME instant as the RPC rather than disagreeing with it by 5.5 hours.
//
// The offset technique matches src/lib/mcp/periods.ts, which keeps its own
// private copy for the AI connector.

/** Used wherever an account has never set one. Matches src/lib/mcp/session.ts. */
export const DEFAULT_ACCOUNT_TIMEZONE = 'Asia/Kolkata'

/**
 * The account's IANA zone. It is NOT a column on `accounts` — it lives in the
 * `settings` jsonb, and most accounts have never written it, so the fallback
 * is the common case rather than an edge case.
 */
export function accountTimezone(settings: unknown): string {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).timezone
      : undefined
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_ACCOUNT_TIMEZONE
}

/** How far ahead of UTC `timezone` is at `at`, in milliseconds. */
function zoneOffsetMs(timezone: string, at: Date): number {
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(fields.find((f) => f.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  return asUtc - at.getTime()
}

/** The account's wall-clock calendar date at `at`. en-CA formats year-month-day. */
function zonedParts(timezone: string, at: Date): { y: number; m: number; d: number } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(at)
    .split('-')
    .map(Number)
  return { y, m, d }
}

/**
 * The real instant at which `y-m-d` began in `timezone`.
 *
 * The offset is taken ON that date, so a DST-observing tenant is not shifted
 * by an hour. India has no DST, but a tenant elsewhere would be.
 */
function zonedMidnight(timezone: string, y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0)
  return new Date(guess - zoneOffsetMs(timezone, new Date(guess)))
}

/** The instant the account's current day began. */
export function startOfAccountDay(timezone: string, at: Date = new Date()): Date {
  const { y, m, d } = zonedParts(timezone, at)
  return zonedMidnight(timezone, y, m, d)
}

/** The instant the account's current month began. */
export function startOfAccountMonth(timezone: string, at: Date = new Date()): Date {
  const { y, m } = zonedParts(timezone, at)
  return zonedMidnight(timezone, y, m, 1)
}

/** The instant the account's PREVIOUS month began. */
export function startOfPreviousAccountMonth(timezone: string, at: Date = new Date()): Date {
  const { y, m } = zonedParts(timezone, at)
  return m === 1 ? zonedMidnight(timezone, y - 1, 12, 1) : zonedMidnight(timezone, y, m - 1, 1)
}
