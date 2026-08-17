/**
 * Attendance classification — turns a day's punch sessions plus the company's configured shift
 * timings into the labels an admin actually cares about:
 *
 *   Absent · Short Present · Late Start · Early Leaving · Present ·
 *   On Leave · Holiday · Weekly Off · Worked on Leave
 *
 * This is the ONLY thing the shift times are used for. They never gate location tracking: a rep
 * who is punched in is on duty and is tracked whatever the hour. A night-shift visit still shows
 * every track point; it just gets classified against the shift the admin configured.
 *
 * Pure functions only (no data fetching) so the same rules can be unit-tested and reused by the
 * daily view, the monthly summary, and anything added later.
 *
 * Leave, holidays and weekly offs are passed IN as context — this module never queries them.
 * Only APPROVED leave should ever be passed: a pending request must not change how a day reads.
 */

import { shiftBoundsFor, type TrackingSettings } from "./tracking-window";

/**
 * A day worked below this fraction of the shift counts as Short Present. 0.75 of a 9-hour shift
 * is 6h45m — short enough to be worth an admin's attention without flagging every early finish.
 */
export const SHORT_PRESENT_RATIO = 0.75;

/** Mutually exclusive: what the day fundamentally was. */
export type AttendanceStatus =
  | "absent"
  | "short_present"
  | "present"
  | "on_leave"
  | "holiday"
  | "weekly_off";

/** Additive: what went wrong within a day that was otherwise worked. */
export type AttendanceFlag =
  | "late_start"
  | "early_leaving"
  | "missing_punch_out"
  | "worked_on_leave";

/** How much of a day a leave consumes. Mirrors `leave_days.weightage` in the database. */
export type LeaveWeightage = "full" | "first_half" | "second_half" | "quarter";

/** Fraction of a working day each weightage consumes. Mirrors `leave_day_value()` in SQL. */
export const LEAVE_DAY_VALUE: Record<LeaveWeightage, number> = {
  full: 1,
  first_half: 0.5,
  second_half: 0.5,
  quarter: 0.25,
};

/** An APPROVED leave covering the day being classified. */
export interface AttendanceLeave {
  weightage: LeaveWeightage;
  /** Leave type name, e.g. "Casual Leave". Shown as a second badge when present. */
  typeName?: string | null;
}

export interface AttendanceSession {
  started_at: string;
  ended_at: string | null;
  /**
   * 'auto_midnight' means the rep never punched out and the system closed the day at midnight.
   * The record has an end time, but nobody chose it — so it must not be presented as one.
   */
  end_reason?: string | null;
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
  /** The approved leave covering this day, if any. Null on an ordinary day. */
  leave: AttendanceLeave | null;
  /** The company holiday falling on this day, if any. */
  holidayName: string | null;
}

export interface ComputeAttendanceInput {
  /** Sessions that STARTED on `day`. A night shift is grouped by its start date. */
  sessions: AttendanceSession[];
  /** The calendar day being classified. */
  day: Date;
  settings: TrackingSettings;
  /** "Now" — injected for testability. Defaults to Date.now(). */
  nowMs?: number;
  /**
   * APPROVED leave covering this day. Pending, rejected or cancelled leave must never be passed —
   * a request nobody has agreed to must not turn a red Absent into a green On Leave.
   */
  leave?: AttendanceLeave | null;
  /** Name of the company holiday on this date, if there is one. */
  holidayName?: string | null;
  /**
   * This employee's own working days, overriding `settings.working_days`.
   *
   * Weekly offs are per employee, not per company: they come from the holiday list assigned to
   * the person, because field staff and office staff routinely work different weeks. Omit it and
   * the account-level default in `settings` applies.
   */
  workingDays?: number[];
}

const ms = (iso: string) => new Date(iso).getTime();

/** Classify one rep's one day. */
export function computeAttendanceDay(input: ComputeAttendanceInput): AttendanceDay {
  const nowMs = input.nowMs ?? Date.now();
  const { sessions, day, settings } = input;
  const leave = input.leave ?? null;
  const holidayName = input.holidayName ?? null;
  const { startMs, endMs, durationMinutes } = shiftBoundsFor(day, settings);

  const workingDays = input.workingDays ?? settings.working_days;
  const isWeeklyOff = !workingDays.includes(day.getDay());
  // A holiday or weekly off is checked BEFORE leave on purpose. A leave cannot normally be
  // booked on either (the database excludes them), but an admin can add a holiday over leave that
  // was already approved — in that case the day is a holiday for everyone, and the approved leave
  // record is deliberately left untouched rather than silently rewritten.
  const isNonWorkingDay = isWeeklyOff || holidayName !== null;

  const base = {
    firstPunchIn: null,
    lastPunchOut: null,
    workedMinutes: 0,
    shiftMinutes: durationMinutes,
    stillOnDuty: false,
    lateByMinutes: 0,
    leftEarlyByMinutes: 0,
    leave,
    holidayName,
  };

  if (sessions.length === 0) {
    if (holidayName !== null) return { ...base, status: "holiday", flags: [] };
    if (isWeeklyOff) return { ...base, status: "weekly_off", flags: [] };
    // A full-day leave is the whole answer for the day. A PART-day leave is not: the employee was
    // still expected for the rest of it and did not come in, so the day stays Absent and the leave
    // rides along as a second badge. Calling that "On Leave" would hide a real no-show.
    if (leave?.weightage === "full") return { ...base, status: "on_leave", flags: [] };
    return { ...base, status: "absent", flags: [] };
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

  // A shift the system closed at midnight has an end time nobody chose. Treat it as NO
  // punch-out: showing 00:00 would put a time in an attendance record that never happened,
  // and would make the rep look like a spectacular early-leaver every time.
  const missingPunchOut = ordered.some((s) => s.end_reason === "auto_midnight");
  const closed = ordered.filter((s) => s.ended_at && s.end_reason !== "auto_midnight");
  const lastPunchOut = closed.length
    ? closed.reduce((a, b) => (ms(a.ended_at!) > ms(b.ended_at!) ? a : b)).ended_at
    : null;

  const graceMs = Math.max(0, settings.grace_minutes) * 60000;
  const flags: AttendanceFlag[] = [];
  // Surfaced so nobody reads the day's duration as verified — it was capped at midnight, not
  // measured. Without this the hours look real and quietly feed Short Present.
  if (missingPunchOut) flags.push("missing_punch_out");

  // Someone who worked on a weekly off or a company holiday is judged against nothing: there is no
  // shift that day, so Late Start / Early Leaving / Short Present would all be noise measured
  // against a window that does not apply. They were present, and that is the whole story.
  if (isNonWorkingDay) {
    return {
      status: "present",
      flags,
      firstPunchIn,
      lastPunchOut,
      workedMinutes,
      shiftMinutes: 0,
      stillOnDuty,
      lateByMinutes: 0,
      leftEarlyByMinutes: 0,
      leave,
      holidayName,
    };
  }

  // Approved leave shrinks the day the employee actually owed. Without this, a rep on approved
  // first-half leave who arrives at 13:30 is flagged Late Start, and one on second-half leave who
  // leaves at 13:30 is flagged Early Leaving — punished for time off their manager granted.
  //
  // First half moves the expected start forward; second half and quarter move the expected end
  // back. A quarter day carries no position (there is no "which quarter"), so the end is pulled in
  // for the hours calculation but Early Leaving is not judged at all rather than guessed at.
  const leaveFraction = leave ? LEAVE_DAY_VALUE[leave.weightage] : 0;
  const expectedMinutes = Math.max(0, Math.round(durationMinutes * (1 - leaveFraction)));
  const shiftMs = endMs - startMs;
  const effectiveStartMs = leave?.weightage === "first_half" ? startMs + shiftMs * 0.5 : startMs;
  const effectiveEndMs =
    leave?.weightage === "second_half"
      ? endMs - shiftMs * 0.5
      : leave?.weightage === "quarter"
        ? endMs - shiftMs * 0.25
        : endMs;
  const judgeEarlyLeaving = leave?.weightage !== "quarter";

  if (leave?.weightage === "full") {
    // They took the whole day off and worked anyway. Allowed — a rep on leave often still steps
    // out for one urgent customer — but the admin needs to see it, and the day is not judged
    // against a shift the employee did not owe.
    flags.push("worked_on_leave");
    return {
      status: "present",
      flags,
      firstPunchIn,
      lastPunchOut,
      workedMinutes,
      shiftMinutes: 0,
      stillOnDuty,
      lateByMinutes: 0,
      leftEarlyByMinutes: 0,
      leave,
      holidayName,
    };
  }

  // Late Start — first punch-in later than the expected start + grace.
  let lateByMinutes = 0;
  const lateMs = ms(firstPunchIn) - (effectiveStartMs + graceMs);
  if (lateMs > 0) {
    lateByMinutes = Math.round(lateMs / 60000);
    flags.push("late_start");
  }

  // Early Leaving — last punch-out earlier than the expected end - grace. Skipped while still on
  // duty: someone mid-shift hasn't left early, they simply haven't finished.
  let leftEarlyByMinutes = 0;
  if (lastPunchOut && !stillOnDuty && judgeEarlyLeaving) {
    const earlyMs = effectiveEndMs - graceMs - ms(lastPunchOut);
    if (earlyMs > 0) {
      leftEarlyByMinutes = Math.round(earlyMs / 60000);
      flags.push("early_leaving");
    }
  }

  // Short Present — worked well under the hours actually owed. Not judged mid-shift, for the same
  // reason: the hours aren't in yet. Also not judged when the punch-out is missing, because
  // the worked total is then an artefact of where midnight fell, not of what the rep did.
  const shortThreshold = expectedMinutes * SHORT_PRESENT_RATIO;
  const status: AttendanceStatus =
    !stillOnDuty && !missingPunchOut && expectedMinutes > 0 && workedMinutes < shortThreshold
      ? "short_present"
      : "present";

  return {
    status,
    flags,
    firstPunchIn,
    lastPunchOut,
    workedMinutes,
    shiftMinutes: expectedMinutes,
    stillOnDuty,
    lateByMinutes,
    leftEarlyByMinutes,
    leave,
    holidayName,
  };
}

/** Badge tone per status/flag, matching the Badge component's variants. */
export type AttendanceTone = "success" | "destructive" | "warning" | "info" | "neutral";

const STATUS_LABELS: Record<AttendanceStatus, { label: string; tone: AttendanceTone }> = {
  absent: { label: "Absent", tone: "destructive" },
  short_present: { label: "Short Present", tone: "warning" },
  present: { label: "Present", tone: "success" },
  on_leave: { label: "On Leave", tone: "info" },
  holiday: { label: "Holiday", tone: "neutral" },
  weekly_off: { label: "Weekly Off", tone: "neutral" },
};

const FLAG_LABELS: Record<AttendanceFlag, { label: string; tone: AttendanceTone }> = {
  late_start: { label: "Late Start", tone: "warning" },
  early_leaving: { label: "Early Leaving", tone: "warning" },
  missing_punch_out: { label: "No Punch Out", tone: "destructive" },
  worked_on_leave: { label: "Worked on Leave", tone: "warning" },
};

const WEIGHTAGE_LABELS: Record<LeaveWeightage, string> = {
  full: "Full Day Leave",
  first_half: "First Half Leave",
  second_half: "Second Half Leave",
  quarter: "Quarter Day Leave",
};

/**
 * Every badge to render for a day, primary status first. "On Duty" replaces the status while a
 * session is still running, so an admin doesn't read a half-finished shift as a verdict.
 *
 * A part-day leave gets its own badge alongside whatever the day was, so "Absent · First Half
 * Leave" and "Present · Second Half Leave" both read correctly. A full-day leave already says
 * everything in the primary badge, so it isn't repeated — unless the rep worked anyway, in which
 * case the leave badge is what explains the "Worked on Leave" flag next to it.
 */
export function attendanceBadges(
  day: AttendanceDay,
): { key: string; label: string; tone: AttendanceTone }[] {
  const primary = day.stillOnDuty
    ? { key: "on_duty", label: "On Duty", tone: "info" as AttendanceTone }
    : { key: day.status, ...STATUS_LABELS[day.status] };

  const badges = [primary, ...day.flags.map((f) => ({ key: f, ...FLAG_LABELS[f] }))];

  if (day.leave && day.status !== "on_leave") {
    badges.push({
      key: `leave_${day.leave.weightage}`,
      label: day.leave.typeName
        ? `${day.leave.typeName} · ${WEIGHTAGE_LABELS[day.leave.weightage]}`
        : WEIGHTAGE_LABELS[day.leave.weightage],
      tone: "info",
    });
  } else if (day.leave?.typeName && day.status === "on_leave") {
    badges.push({ key: "leave_type", label: day.leave.typeName, tone: "neutral" });
  }

  if (day.holidayName) {
    badges.push({ key: "holiday_name", label: day.holidayName, tone: "neutral" });
  }

  return badges;
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
  { label: "On Leave", value: "On Leave" },
  { label: "Holiday", value: "Holiday" },
  { label: "Weekly Off", value: "Weekly Off" },
  { label: "Late Start", value: "Late Start" },
  { label: "Early Leaving", value: "Early Leaving" },
  { label: "No Punch Out", value: "No Punch Out" },
  { label: "Worked on Leave", value: "Worked on Leave" },
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
