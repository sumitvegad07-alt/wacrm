/**
 * Sales-person continuous tracking window — the admin-configurable schedule that says
 * "track this rep's location between X and Y, every N minutes".
 *
 * Stored on `accounts.settings.tracking_settings`. Times are 24h "HH:MM" strings so the web
 * form and the mobile app can never disagree about AM/PM.
 *
 * The mobile app reads the same shape to decide (a) how often to persist a location ping and
 * (b) whether "now" is inside the working window at all, and Tracking Health uses `start_time`
 * to decide when a missing punch-in stops being normal and becomes a problem worth flagging.
 */

export interface TrackingSettings {
  /** Master switch for the scheduled window. When false, tracking is punch-in driven only. */
  enabled: boolean;
  /** 24h "HH:MM" — start of the working window. */
  start_time: string;
  /** 24h "HH:MM" — end of the working window. */
  end_time: string;
  /** How often a ping is persisted, in minutes. */
  interval_minutes: number;
}

export const DEFAULT_TRACKING: TrackingSettings = {
  enabled: true,
  start_time: "09:00",
  end_time: "18:00",
  // Founder decision: default to 10 minutes (the reference UI showed 15).
  interval_minutes: 10,
};

/** Interval choices offered in Organisation Settings. */
export const TRACKING_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;

/** Coerce whatever is in accounts.settings into a complete, safe TrackingSettings. */
export function normalizeTrackingSettings(raw: unknown): TrackingSettings {
  const r = (raw ?? {}) as Partial<TrackingSettings>;
  const interval = Number(r.interval_minutes);
  return {
    enabled: r.enabled !== false,
    start_time: isHHMM(r.start_time) ? r.start_time! : DEFAULT_TRACKING.start_time,
    end_time: isHHMM(r.end_time) ? r.end_time! : DEFAULT_TRACKING.end_time,
    interval_minutes: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_TRACKING.interval_minutes,
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
 * Is `date` inside the configured window? Handles a window that wraps past midnight
 * (end earlier than start), e.g. a night shift 20:00 → 04:00.
 */
export function isWithinTrackingWindow(settings: TrackingSettings, date: Date = new Date()): boolean {
  if (!settings.enabled) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const start = hhmmToMinutes(settings.start_time);
  const end = hhmmToMinutes(settings.end_time);
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}
