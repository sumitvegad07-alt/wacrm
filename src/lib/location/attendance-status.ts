/**
 * Attendance classification — turns a day's punch sessions plus the company's configured shift
 * timings into the labels an admin actually cares about:
 *
 *   Absent · Short Present · Late Start · Early Leaving · Present
 *
 * This is the ONLY thing the shift times are used for. They never gate location tracking: a rep
 * who is punched in is on duty and is tracked whatever the hour. A night-shift visit still shows
 * every track point; it just gets classified against the shift the admin configured.
 *
 * Pure functions only (no data fetching) so the same rules can be unit-tested and reused by the
 * daily view, the monthly summary, and anything added later.
 */

import { shiftBoundsFor, type TrackingSettings } from "./tracking-window";

/**
 * A day worked below this fraction of the shift counts as Short Present. 0.75 of a 9-hour shift
 * is 6h45m — short enough to be worth an admin's attention without flagging every early finish.
 */
export const SHORT_PRESENT_RATIO = 0.75;

/** Mutually exclusive: what the day fundamentally was. */
export type AttendanceStatus = "absent" | "short_present" | "present";

/** Additive: what went wrong within a day that was otherwise worked. */
export type AttendanceFlag = "late_start" | "early_leaving";

export interface AttendanceSession {
  started_at: string;
  ended_at: string | null;
}

export interface AttendanceDay {
  status: AttendanceStatus;
  /** Can hold both late_start and early_leaving — a day can be both, and hiding one loses data. */
  flags: AttendanceFlag[];
  firstPunchIn: string | null;
  lastPunchOut: string | null;
  /** Total time punched in. An open session counts up to `nowMs`. */
  workedMinutes: number;
  shiftMinutes: number;
  /** True while a session is still running — the day isn't final yet. */
  stillOnDuty: boolean;
  /** How many minutes late the first punch-in was, past the grace period. 0 when not late. */
  lateByMinutes: number;
  /** How many minutes early the last punch-out was, past the grace period. 0 when not early. */
  leftEarlyByMinutes: number;
}

export interface ComputeAttendanceInput {
  /** Sessions that STARTED on `day`. A night shift is grouped by its start date. */
  sessions: AttendanceSession[];
  /** The calendar day being classified. */
  day: Date;
  settings: TrackingSettings;
  /** "Now" — injected for testability. Defaults to Date.now(). */
  nowMs?: number;
}

const ms = (iso: string) => new Date(iso).getTime();

/** Classify one rep's one day. */
export function computeAttendanceDay(input: ComputeAttendanceInput): AttendanceDay {
  const nowMs = input.nowMs ?? Date.now();
  const { sessions, day, settings } = input;
  const { startMs, endMs, durationMinutes } = shiftBoundsFor(day, settings);

  if (sessions.length === 0) {
    return {
      status: "absent",
      flags: [],
      firstPunchIn: null,
      lastPunchOut: null,
      workedMinutes: 0,
      shiftMinutes: durationMinutes,
      stillOnDuty: false,
      lateByMinutes: 0,
      leftEarlyByMinutes: 0,
    };
  }

  const ordered = [...sessions].sort((a, b) => ms(a.started_at) - ms(b.started_at));
  const firstPunchIn = ordered[0].started_at;

  // Sum every session, not just the first — a rep who punches out for lunch and back in has
  // two sessions, and counting only one would wrongly read as Short Present.
  let workedMs = 0;
  let stillOnDuty = false;
  for (const s of ordered) {
    const end = s.ended_at ? ms(s.ended_at) : nowMs;
    if (!s.ended_at) stillOnDuty = true;
    workedMs += Math.max(0, end - ms(s.started_at));
  }
  const workedMinutes = Math.round(workedMs / 60000);

  // Only a closed day has a meaningful punch-out.
  const closed = ordered.filter((s) => s.ended_at);
  const lastPunchOut = closed.length
    ? closed.reduce((a, b) => (ms(a.ended_at!) > ms(b.ended_at!) ? a : b)).ended_at
    : null;

  const graceMs = Math.max(0, settings.grace_minutes) * 60000;
  const flags: AttendanceFlag[] = [];

  // Late Start — first punch-in later than shift start + grace.
  let lateByMinutes = 0;
  if (settings.enabled) {
    const lateMs = ms(firstPunchIn) - (startMs + graceMs);
    if (lateMs > 0) {
      lateByMinutes = Math.round(lateMs / 60000);
      flags.push("late_start");
    }
  }

  // Early Leaving — last punch-out earlier than shift end - grace. Skipped while still on duty:
  // someone mid-shift hasn't left early, they simply haven't finished.
  let leftEarlyByMinutes = 0;
  if (settings.enabled && lastPunchOut && !stillOnDuty) {
    const earlyMs = endMs - graceMs - ms(lastPunchOut);
    if (earlyMs > 0) {
      leftEarlyByMinutes = Math.round(earlyMs / 60000);
      flags.push("early_leaving");
    }
  }

  // Short Present — worked well under the shift's length. Not judged mid-shift, for the same
  // reason: the hours aren't in yet.
  const shortThreshold = durationMinutes * SHORT_PRESENT_RATIO;
  const status: AttendanceStatus =
    !stillOnDuty && durationMinutes > 0 && workedMinutes < shortThreshold
      ? "short_present"
      : "present";

  return {
    status,
    flags,
    firstPunchIn,
    lastPunchOut,
    workedMinutes,
    shiftMinutes: durationMinutes,
    stillOnDuty,
    lateByMinutes,
    leftEarlyByMinutes,
  };
}

/** Badge tone per status/flag, matching the Badge component's variants. */
export type AttendanceTone = "success" | "destructive" | "warning" | "info" | "neutral";

const STATUS_LABELS: Record<AttendanceStatus, { label: string; tone: AttendanceTone }> = {
  absent: { label: "Absent", tone: "destructive" },
  short_present: { label: "Short Present", tone: "warning" },
  present: { label: "Present", tone: "success" },
};

const FLAG_LABELS: Record<AttendanceFlag, { label: string; tone: AttendanceTone }> = {
  late_start: { label: "Late Start", tone: "warning" },
  early_leaving: { label: "Early Leaving", tone: "warning" },
};

/**
 * Every badge to render for a day, primary status first. "On Duty" replaces the status while a
 * session is still running, so an admin doesn't read a half-finished shift as a verdict.
 */
export function attendanceBadges(
  day: AttendanceDay,
): { key: string; label: string; tone: AttendanceTone }[] {
  const primary = day.stillOnDuty
    ? { key: "on_duty", label: "On Duty", tone: "info" as AttendanceTone }
    : { key: day.status, ...STATUS_LABELS[day.status] };

  return [primary, ...day.flags.map((f) => ({ key: f, ...FLAG_LABELS[f] }))];
}

/** Single-value label, for filtering and CSV-style views that can't show several badges. */
export function attendancePrimaryLabel(day: AttendanceDay): string {
  if (day.stillOnDuty) return "On Duty";
  return STATUS_LABELS[day.status].label;
}

/**
 * Filter options for the daily attendance table. Includes the flags, so an admin can pull up
 * "everyone who started late today" — the actual question they open this page to answer.
 */
export const ATTENDANCE_STATUS_OPTIONS = [
  { label: "Present", value: "Present" },
  { label: "Short Present", value: "Short Present" },
  { label: "Absent", value: "Absent" },
  { label: "On Duty", value: "On Duty" },
  { label: "Late Start", value: "Late Start" },
  { label: "Early Leaving", value: "Early Leaving" },
];

/** Every label that applies to a day — primary status plus flags. Used for filtering. */
export function attendanceMatchLabels(day: AttendanceDay): string[] {
  return attendanceBadges(day).map((b) => b.label);
}

/** "6h 45m" / "45min" / "-" */
export function formatWorkedMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}min`;
}
