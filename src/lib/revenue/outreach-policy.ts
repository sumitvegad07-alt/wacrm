// ============================================================
// Outreach throttle policy — every brake on the sender, in one pure module.
//
// WHY THIS FILE IMPORTS NOTHING
//
// The Chrome extension that does the sending is the least reviewable code in
// the system: unpacked, unversioned by any registry, run by nobody but Chrome.
// It must not be the component holding the brakes. So it holds none of them —
// it asks `/next` for one number and one finished message — and everything it
// would otherwise have decided lives here, where it is ordinary TypeScript
// with ordinary tests.
//
// There is no database harness in this repo, which is the other reason: a
// mistake in this file sends 20,000 messages from the founder's business
// WhatsApp number, and "we'll check it by watching" is not a test.
// ============================================================

/**
 * India time. The founder's day, his prospects' day, and the day boundary the
 * cap resets on. Never derived from the server's clock zone, which is UTC on
 * Vercel and would start the day 5.5 hours late.
 */
export const OUTREACH_TIMEZONE = "Asia/Kolkata";

export const DEFAULT_DAILY_CAP = 80;
export const DEFAULT_GAP_MIN_SEC = 45;
export const DEFAULT_GAP_MAX_SEC = 120;

/** How much further a number may send each day of its warm-up. */
export const WARMUP_STEP = 20;

export const LONG_BREAK_EVERY = 20;
export const LONG_BREAK_MIN_SEC = 300;
export const LONG_BREAK_MAX_SEC = 720;

/**
 * The cap on the window-closed and cap-reached waits only. It is not a
 * ceiling on every wait: a long break can be up to LONG_BREAK_MAX_SEC (720s),
 * and a spacing wait is whatever is left of the gap.
 *
 * Out-of-window and cap-reached waits could be computed exactly, which means
 * multi-day calendar arithmetic for a wait nobody is watching. Capping the
 * poll instead costs one HTTP request every ten minutes and buys something
 * better: a window or cap the founder edits mid-campaign takes effect within
 * ten minutes instead of at the end of a wait computed under the old numbers.
 */
export const MAX_POLL_WAIT_SEC = 600;

/** An in_flight claim older than this is a laptop that closed mid-send. */
export const CLAIM_STALE_MINUTES = 15;

export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Appended to every message that does not already carry it.
 *
 * Nothing in V1 reads replies, so this is honoured by hand — the founder sees
 * the reply on his phone and pastes the number into the suppression box. It is
 * still not optional: bulk messages with no way out are what get a number
 * reported, and being reported is what actually ends in a ban.
 */
export const OPT_OUT_LINE = "Reply STOP and I won't message you again.";

/**
 * What a blank merge field becomes.
 *
 * Google Maps returns an empty city constantly, and "Hello , in " reads as a
 * bot to a human and as a template to WhatsApp.
 */
export const MERGE_FALLBACKS: Record<string, string> = {
  name: "there",
  city: "your area",
  industry: "your line of work",
};

export interface SendWindow {
  /** "10:00" */
  windowStart: string;
  /** "18:30", exclusive. */
  windowEnd: string;
  weekdaysOnly: boolean;
}

export interface ZonedClock {
  /** yyyy-mm-dd in the zone. */
  ymd: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function zonedClock(now: Date, timezone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);

  const got: Record<string, string> = {};
  for (const part of parts) got[part.type] = part.value;

  // Intl renders midnight as hour "24" under hour12:false in some runtimes,
  // which would read as 1440 minutes and fall outside every window.
  const hour = Number(got.hour) % 24;

  return {
    ymd: `${got.year}-${got.month}-${got.day}`,
    minutes: hour * 60 + Number(got.minute),
    weekday: WEEKDAY_INDEX[got.weekday] ?? 0,
  };
}

export function parseHhMm(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isInSendWindow(clock: ZonedClock, window: SendWindow): boolean {
  if (window.weekdaysOnly && (clock.weekday === 0 || clock.weekday === 6)) {
    return false;
  }
  // End exclusive: comparing against 18:30 inclusive would let a message start
  // at the moment the window closes.
  return (
    clock.minutes >= parseHhMm(window.windowStart) &&
    clock.minutes < parseHhMm(window.windowEnd)
  );
}

/**
 * How long this particular message must sit behind the last one.
 *
 * Deterministic in `sentCount`, deliberately. The gap has to look random to
 * WhatsApp but be stable to us: `/next` is polled repeatedly during one wait,
 * and a fresh random number each poll would move the deadline every time and
 * the wait would never end.
 */
export function requiredGapSeconds(
  sentCount: number,
  minSec: number,
  maxSec: number,
): number {
  if (maxSec <= minSec) return minSec;
  let hash = Math.imul(sentCount + 1, 2654435761) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash ^= hash >>> 13;
  return minSec + ((hash >>> 0) % (maxSec - minSec + 1));
}

export function isLongBreakDue(sentToday: number): boolean {
  return sentToday > 0 && sentToday % LONG_BREAK_EVERY === 0;
}

/**
 * Calendar days between two yyyy-mm-dd strings.
 *
 * Arithmetic is done on the parsed numbers through Date.UTC, never by parsing
 * the string into a local Date, so no timezone can re-enter after the clock
 * has already been read in the right zone.
 */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000,
  );
}

/** Which day of this number's sending life today is. Never less than 1. */
export function daysSending(firstSentOn: string | null, todayYmd: string): number {
  if (!firstSentOn) return 1;
  return Math.max(1, daysBetween(firstSentOn, todayYmd) + 1);
}

export function warmUpCap(day: number, dailyCap: number): number {
  return Math.min(dailyCap, Math.max(1, day) * WARMUP_STEP);
}

/**
 * Which wording this recipient gets.
 *
 * Recipient ids are sequential within a campaign, so a modulo spreads the
 * variants evenly without having to count anything.
 */
export function pickVariant(recipientId: number, variantCount: number): number {
  if (variantCount <= 1) return 0;
  return recipientId % variantCount;
}

export function renderMessage(
  variant: string,
  fields: Record<string, string>,
): string {
  // Two authoring slips are common enough to be worth absorbing rather than
  // deleting: `{{name}}` (Handlebars habit) and `{ name }` (stray spaces).
  // Both are normalised to `{name}` so the substitution pass below sees them.
  // Anything still malformed after this — `{first name}`, `{city-name}` — is
  // genuinely unresolvable and the debrace pass removes it, because leaking
  // the literal words "first name" to a prospect is worse than leaking nothing.
  const normalised = variant
    .replace(/\{\{\s*(\w+)\s*\}\}/g, "{$1}")
    .replace(/\{\s*(\w+)\s*\}/g, "{$1}");

  const filled = normalised.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = (fields[key] ?? "").trim();
    if (value) return value;
    // A defined-but-blank field falls back; an undefined one disappears.
    return MERGE_FALLBACKS[key] ?? "";
  });

  // Anything still carrying a brace never reaches a prospect. The pass above
  // only matches \w+ tokens, so `{first name}`, `{ name }` and the outer
  // braces of `{{name}}` survive it — and a literal brace in a cold message
  // reads as a bot to a human long before WhatsApp notices anything.
  const debraced = filled.replace(/\{[^{}]*\}/g, "").replace(/[{}]/g, "");

  const tidied = debraced.replace(/[ \t]{2,}/g, " ").replace(/ +([,.])/g, "$1").trim();

  return tidied.includes(OPT_OUT_LINE) ? tidied : `${tidied}\n\n${OPT_OUT_LINE}`;
}

export interface DecideInput {
  now: Date;
  timezone: string;
  window: SendWindow;
  dailyCap: number;
  /** Sends from THIS NUMBER today, across every campaign. */
  sentToday: number;
  /** First day this number ever sent, yyyy-mm-dd. Null = it never has. */
  firstSentOn: string | null;
  lastSentAt: Date | null;
  gapMinSec: number;
  gapMaxSec: number;
  queuedRemaining: number;
  consecutiveFailures: number;
}

export type Decision =
  | { kind: "send" }
  | { kind: "wait"; waitSeconds: number; reason: string }
  | { kind: "paused"; reason: string }
  | { kind: "done"; reason: string };

/**
 * The whole policy, in the order the checks have to happen.
 *
 * Failures are checked before anything else: a campaign failing every send
 * must stop even when it is mid-window with thousands queued, because the
 * most likely cause is a logged-out or restricted WhatsApp session and
 * carrying on is how a restriction becomes a ban.
 */
export function decide(input: DecideInput): Decision {
  // Written as a negated "<" on purpose, here and in the two checks below:
  // a NaN counter makes every comparison false, so ">=" would let NaN fall
  // through to a send. These guards protect a real business number, so NaN
  // must stop, not pass. Do not "simplify" this back to ">=".
  if (!(input.consecutiveFailures < MAX_CONSECUTIVE_FAILURES)) {
    return {
      kind: "paused",
      reason: `${input.consecutiveFailures} sends failed in a row`,
    };
  }

  if (input.queuedRemaining <= 0) {
    return { kind: "done", reason: "Every recipient has been dealt with" };
  }

  const clock = zonedClock(input.now, input.timezone);

  if (!isInSendWindow(clock, input.window)) {
    return {
      kind: "wait",
      waitSeconds: MAX_POLL_WAIT_SEC,
      reason: "Outside the send window",
    };
  }

  const cap = warmUpCap(
    daysSending(input.firstSentOn, clock.ymd),
    input.dailyCap,
  );
  if (!(input.sentToday < cap)) {
    return {
      kind: "wait",
      waitSeconds: MAX_POLL_WAIT_SEC,
      reason: `Reached today's cap of ${cap}`,
    };
  }

  const longBreak = isLongBreakDue(input.sentToday);
  const needed = longBreak
    ? requiredGapSeconds(input.sentToday, LONG_BREAK_MIN_SEC, LONG_BREAK_MAX_SEC)
    : requiredGapSeconds(input.sentToday, input.gapMinSec, input.gapMaxSec);

  if (input.lastSentAt) {
    const elapsed = Math.floor(
      (input.now.getTime() - input.lastSentAt.getTime()) / 1000,
    );
    if (!(elapsed >= needed)) {
      return {
        kind: "wait",
        waitSeconds: needed - elapsed,
        reason: longBreak ? "Taking a long break" : "Spacing messages out",
      };
    }
  }

  return { kind: "send" };
}
