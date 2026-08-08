/**
 * Tracking-health engine: turns raw pings/sessions/events/heartbeats into a per-agent daily
 * diagnostic — coverage %, gaps, and each gap classified to a cause (IssueCode). Single source
 * of truth for both the account triage list and the per-agent detail page.
 *
 * Pure functions only (no data fetching) so they are unit-testable and identical everywhere.
 */

import { type IssueCode, type Severity, sortIssueCodes, worstSeverity } from "./tracking-issues";
import { hhmmToMinutes, type TrackingSettings } from "./tracking-window";

/** Fallback minutes between persisted pings, used when the account's interval isn't supplied. */
export const PING_INTERVAL_MIN = 10;
/** A quiet stretch longer than this (2× the interval) counts as a tracking gap. */
export const GAP_THRESHOLD_MIN = 20;
/** Gap threshold for a given interval — 2× the interval, so one missed ping isn't a "gap". */
const gapThresholdFor = (intervalMin: number) => intervalMin * 2;
/** Battery at/below this just before tracking stops implies the phone died. */
const LOW_BATTERY_PCT = 10;

/**
 * Coverage below this counts as needing attention on its own, even when no single gap could be
 * attributed to a specific cause. Founder decision: a shift that recorded under 60% of its
 * expected locations is not a usable record, so surface it rather than waiting for a
 * high-severity issue to be detected.
 */
export const LOW_COVERAGE_PCT = 60;

export interface HealthSession {
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
}
export interface HealthPing {
  recorded_at: string;
  battery_pct: number | null;
  is_mocked: boolean | null;
}
export interface HealthEvent {
  event_type: string; // 'gps_disabled' | 'gps_enabled' | 'permission_revoked' | 'permission_restored'
  recorded_at: string;
}
export interface HealthSnapshot {
  recorded_at: string;
  bg_location_permission: string | null;
  battery_optimization_on: boolean | null;
  low_power_mode: boolean | null;
  location_services_on: boolean | null;
  app_version: string | null;
}

export interface Gap {
  fromIso: string;
  toIso: string;
  minutes: number;
  issueCode: IssueCode;
}

export interface AgentHealth {
  punchedIn: boolean;
  activeSeconds: number;
  expectedPings: number;
  receivedPings: number;
  coveragePct: number; // 0–100
  gaps: Gap[];
  issueCodes: IssueCode[]; // deduped, most-severe first
  worstSeverity: Severity | null;
}

export interface ComputeHealthInput {
  sessions: HealthSession[];
  pings: HealthPing[];
  events: HealthEvent[];
  latestSnapshot: HealthSnapshot | null;
  /**
   * recorded_at of every device-health heartbeat that day. A live app emits one roughly hourly,
   * so their absence inside a gap tells us the process itself wasn't running.
   */
  snapshotTimes?: string[];
  /** Version of the app this agent's device last reported (from employee_devices). */
  deviceAppVersion?: string | null;
  /** The current/latest app version to compare against, if known. */
  currentAppVersion?: string | null;
  /** Device is pending approval (from employee_devices.status). */
  devicePending?: boolean;
  /**
   * The account's configured shift + interval. The interval drives the coverage calculation;
   * `start_time` decides whether a missing punch-in is "hasn't started yet" or "shift is
   * underway and nothing is being tracked".
   */
  trackingSettings?: TrackingSettings | null;
  /**
   * Whether to escalate a missing punch-in to a chase-it problem. False when looking at a
   * historical range — "the shift started an hour ago and nobody punched in" is a statement
   * about right now, and applying it to last week would accuse everyone of everything.
   * Kept separate from `trackingSettings` so history still gets the correct ping interval.
   */
  evaluateMissingPunchIn?: boolean;
  /** "Now" — injected for testability. Defaults to Date.now(). */
  nowMs?: number;
}

const ms = (iso: string) => new Date(iso).getTime();
const minutesBetween = (aIso: string, bIso: string) => (ms(bIso) - ms(aIso)) / 60000;

/** Was there an event of `type` inside [fromIso, toIso] (with a small lead-in buffer)? */
function eventInWindow(
  events: HealthEvent[],
  type: string,
  fromIso: string,
  toIso: string,
  leadInMin: number = GAP_THRESHOLD_MIN,
): boolean {
  const from = ms(fromIso) - leadInMin * 60000; // small lead-in: the trigger can precede the gap
  const to = ms(toIso);
  return events.some((e) => e.event_type === type && ms(e.recorded_at) >= from && ms(e.recorded_at) <= to);
}

/**
 * Classify one gap by the strongest available evidence. Order matters: explicit device events
 * beat inferred snapshot state, which beats battery/end-reason inference, which beats "unknown".
 */
function classifyGap(
  gap: { fromIso: string; toIso: string },
  ctx: {
    events: HealthEvent[];
    snapshot: HealthSnapshot | null;
    batteryBeforeGap: number | null;
    isTrailingGap: boolean;
    sessionEndReason: string | null;
    /** True when the app sent no device-health heartbeat at all inside this gap. */
    noHeartbeatDuringGap: boolean;
    /** The account's configured gap threshold, used as the event lead-in buffer. */
    gapThresholdMin: number;
  },
): IssueCode {
  const lead = ctx.gapThresholdMin;
  if (eventInWindow(ctx.events, "gps_disabled", gap.fromIso, gap.toIso, lead)) return "gps_off";
  if (eventInWindow(ctx.events, "permission_revoked", gap.fromIso, gap.toIso, lead))
    return "permission_revoked";

  const s = ctx.snapshot;
  if (s?.location_services_on === false) return "gps_off";
  if (s && s.bg_location_permission != null && s.bg_location_permission !== "granted")
    return "bg_permission_missing";
  if (s?.battery_optimization_on === true) return "battery_optimization";
  if (s?.low_power_mode === true) return "power_save_mode";

  if (
    ctx.isTrailingGap &&
    ctx.batteryBeforeGap != null &&
    ctx.batteryBeforeGap <= LOW_BATTERY_PCT
  )
    return "phone_died";

  if (ctx.isTrailingGap && ctx.sessionEndReason === "app_killed") return "os_killed_app";

  // Nothing on the app's side was wrong — location was on, background permission was granted,
  // battery saver was off and the battery was healthy — yet tracking stopped dead AND the app
  // stopped sending its own health heartbeat (it emits one roughly hourly while alive). The app
  // wasn't running to report anything, which means the OS put it to sleep. This is the single
  // most common real-world cause of a tracking gap on Android, so name it instead of shrugging.
  // (battery saver is already ruled out above — reaching here means low_power_mode wasn't true)
  if (
    s &&
    s.location_services_on === true &&
    (s.bg_location_permission == null || s.bg_location_permission === "granted") &&
    (ctx.batteryBeforeGap == null || ctx.batteryBeforeGap > LOW_BATTERY_PCT) &&
    ctx.noHeartbeatDuringGap
  ) {
    return "app_stopped_in_background";
  }

  return "unknown_gap";
}

/** Gaps within a single session (start→first ping, between pings, last ping→end). */
function sessionGaps(
  session: HealthSession,
  sessionPings: HealthPing[],
  events: HealthEvent[],
  snapshot: HealthSnapshot | null,
  nowMs: number,
  heartbeatTimes: number[] = [],
  gapThresholdMin: number = GAP_THRESHOLD_MIN,
): Gap[] {
  const endIso = session.ended_at ?? new Date(nowMs).toISOString();
  const sorted = [...sessionPings].sort((a, b) => ms(a.recorded_at) - ms(b.recorded_at));

  // Boundaries the pings sit between: [start, p1, p2, ..., pn, end]
  const boundaries: { iso: string; batteryBefore: number | null }[] = [
    { iso: session.started_at, batteryBefore: null },
    ...sorted.map((p) => ({ iso: p.recorded_at, batteryBefore: p.battery_pct })),
    { iso: endIso, batteryBefore: sorted.length ? sorted[sorted.length - 1].battery_pct : null },
  ];

  const gaps: Gap[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const fromIso = boundaries[i - 1].iso;
    const toIso = boundaries[i].iso;
    const minutes = minutesBetween(fromIso, toIso);
    if (minutes <= gapThresholdMin) continue;
    const isTrailingGap = i === boundaries.length - 1;
    gaps.push({
      fromIso,
      toIso,
      minutes: Math.round(minutes),
      issueCode: classifyGap(
        { fromIso, toIso },
        {
          events,
          snapshot,
          batteryBeforeGap: boundaries[i - 1].batteryBefore,
          isTrailingGap,
          sessionEndReason: session.end_reason,
          // A live app emits a health heartbeat roughly hourly. None inside a long gap is
          // strong evidence the process wasn't running at all.
          noHeartbeatDuringGap: !heartbeatTimes.some(
            (t) => t > ms(fromIso) && t < ms(toIso),
          ),
          gapThresholdMin,
        },
      ),
    });
  }
  return gaps;
}

/** Compute the full daily tracking-health picture for one agent. */
export function computeAgentHealth(input: ComputeHealthInput): AgentHealth {
  const nowMs = input.nowMs ?? Date.now();
  const { sessions, pings, events, latestSnapshot } = input;
  const heartbeatTimes = (input.snapshotTimes ?? []).map((t) => ms(t));

  // Coverage has to be measured against the interval the admin actually configured. Hard-coding
  // 10 minutes made Tracking Health report ~33% coverage for a perfectly healthy rep on a
  // 30-minute interval — the report would have been accusing people of a problem we invented.
  const intervalMin =
    input.trackingSettings && input.trackingSettings.interval_minutes > 0
      ? input.trackingSettings.interval_minutes
      : PING_INTERVAL_MIN;
  const gapThresholdMin = gapThresholdFor(intervalMin);

  const codes = new Set<IssueCode>();
  if (input.devicePending) codes.add("device_pending");

  if (sessions.length === 0) {
    // Distinguish "hasn't started their shift yet" (fine) from "the working window is already
    // underway and they still haven't punched in" (nothing is being tracked — chase it).
    const ts = input.trackingSettings;
    const now = new Date(nowMs);
    const shiftStarted =
      input.evaluateMissingPunchIn !== false &&
      !!ts &&
      now.getHours() * 60 + now.getMinutes() >= hhmmToMinutes(ts.start_time);
    codes.add(shiftStarted ? "not_punched_in_late" : "not_punched_in");
    return {
      punchedIn: false,
      activeSeconds: 0,
      expectedPings: 0,
      receivedPings: 0,
      coveragePct: 100,
      gaps: [],
      issueCodes: sortIssueCodes([...codes]),
      worstSeverity: worstSeverity([...codes]),
    };
  }

  let activeSeconds = 0;
  const allGaps: Gap[] = [];
  for (const session of sessions) {
    const endMs = session.ended_at ? ms(session.ended_at) : nowMs;
    activeSeconds += Math.max(0, (endMs - ms(session.started_at)) / 1000);
    const sessionPings = pings.filter(
      (p) => ms(p.recorded_at) >= ms(session.started_at) && ms(p.recorded_at) <= endMs,
    );
    allGaps.push(
      ...sessionGaps(
        session,
        sessionPings,
        events,
        latestSnapshot,
        nowMs,
        heartbeatTimes,
        gapThresholdMin,
      ),
    );
  }

  const expectedPings = Math.floor(activeSeconds / (intervalMin * 60));
  const receivedPings = pings.length;
  const coveragePct =
    expectedPings === 0 ? 100 : Math.min(100, Math.round((receivedPings / expectedPings) * 100));

  for (const g of allGaps) codes.add(g.issueCode);

  if (pings.some((p) => p.is_mocked)) codes.add("mock_location");

  if (
    input.deviceAppVersion &&
    input.currentAppVersion &&
    input.deviceAppVersion !== input.currentAppVersion
  )
    codes.add("app_outdated");

  // Punched in, has gaps, but never sent a device-health heartbeat = old build we can't diagnose.
  if (!latestSnapshot && allGaps.length > 0) codes.add("no_heartbeat");

  const issueCodes = sortIssueCodes([...codes]);
  return {
    punchedIn: true,
    activeSeconds: Math.round(activeSeconds),
    expectedPings,
    receivedPings,
    coveragePct,
    gaps: allGaps,
    issueCodes,
    worstSeverity: worstSeverity(issueCodes),
  };
}
