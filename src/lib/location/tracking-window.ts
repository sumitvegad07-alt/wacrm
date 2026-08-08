/**
 * Sales-person tracking + shift settings, stored on `accounts.settings.tracking_settings`.
 * Times are 24h "HH:MM" strings so the web form and the mobile app can never disagree about AM/PM.
 *
 * IMPORTANT — what the shift times do and do NOT do:
 *
 *   `start_time`/`end_time` are the company's SHIFT timings. They do NOT gate location tracking.
 *   Being punched in is what makes a rep on duty, and an on-duty rep is tracked at all hours: a
 *   night-shift customer visit produces track points exactly like a midday one.
 *
 *   Their only job is to classify the day for the Attendance page — Present, Late Start,
 *   Early Leaving, Short Present, Absent — and to tell Tracking Health when a missing punch-in
 *   has stopped being normal ("shift started an hour ago and nobody punched in").
 *
 * An earlier version of this module used the window to suppress background pings outside working
 * hours. That silently killed tracking for a rep who punched in at 01:26 with the default 09:00
 * shift still in place, and gave them no way to know why. Do not reintroduce that behaviour.
 *
 * `interval_minutes` is the only field the mobile background task acts on.
 */

export interface TrackingSettings {
  /** 24h "HH:MM" — shift start. */
  start_time: string;
  /** 24h "HH:MM" — shift end. May be earlier than start for a night shift (wraps midnight). */
  end_time: string;
  /** How often a location is recorded while punched in, in minutes. */
  interval_minutes: number;
  /**
   * Minutes of leeway before a punch-in counts as Late Start (or a punch-out as Early Leaving).
   * Without this, punching in at 09:01 on a 09:00 shift would be flagged, making the column noise.
   */
  grace_minutes: number;
}

export const DEFAULT_TRACKING: TrackingSettings = {
  start_time: "09:00",
  end_time: "18:00",
  // Founder decision: default to 10 minutes (the reference UI showed 15).
  interval_minutes: 10,
  grace_minutes: 15,
};

/** Interval choices offered in Organisation Settings. */
export const TRACKING_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;

/** Grace-period choices offered in Organisation Settings. */
export const GRACE_MINUTE_OPTIONS = [0, 5, 10, 15, 30, 60] as const;

/** Coerce whatever is in accounts.settings into a complete, safe TrackingSettings. */
export function normalizeTrackingSettings(raw: unknown): TrackingSettings {
  const r = (raw ?? {}) as Partial<TrackingSettings>;
  const interval = Number(r.interval_minutes);
  const grace = Number(r.grace_minutes);
  return {
    start_time: isHHMM(r.start_time) ? r.start_time! : DEFAULT_TRACKING.start_time,
    end_time: isHHMM(r.end_time) ? r.end_time! : DEFAULT_TRACKING.end_time,
    interval_minutes: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_TRACKING.interval_minutes,
    // 0 is a legitimate choice ("no leeway at all"), so only fall back when it isn't a number.
    grace_minutes: Number.isFinite(grace) && grace >= 0 ? grace : DEFAULT_TRACKING.grace_minutes,
  };
}

function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** "09:00" -> "9:00 AM" for display. */
export function formatHHMM(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

/** Minutes since midnight, for window comparisons. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The `enabled` flag that used to live on these settings is gone from the UI — an on/off switch
 * we could not put to honest use. It is still WRITTEN as true when saving, because APKs already
 * in the field read it as a tracking gate and would stop tracking entirely on false.
 */
export const LEGACY_ENABLED_FOR_OLD_APKS = true;

/**
 * Is `date` inside the configured shift? Handles a shift that wraps past midnight
 * (end earlier than start), e.g. a night shift 20:00 → 04:00.
 *
 * For attendance/display only — never use this to decide whether to record a location.
 */
export function isWithinShift(settings: TrackingSettings, date: Date = new Date()): boolean {
  const now = date.getHours() * 60 + date.getMinutes();
  const start = hhmmToMinutes(settings.start_time);
  const end = hhmmToMinutes(settings.end_time);
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

/**
 * Absolute start/end of the shift that BELONGS to the given calendar day.
 *
 * A night shift (20:00 → 04:00) ends on the following date, so the end is pushed forward a day.
 * Sessions are grouped by the date they started on, which keeps a night shift on one row.
 */
export function shiftBoundsFor(
  day: Date,
  settings: TrackingSettings,
): { startMs: number; endMs: number; durationMinutes: number } {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(hhmmToMinutes(settings.start_time));

  const end = new Date(day);
  end.setHours(0, 0, 0, 0);
  end.setMinutes(hhmmToMinutes(settings.end_time));

  // Wraps past midnight — the shift finishes on the next calendar day.
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
  };
}
