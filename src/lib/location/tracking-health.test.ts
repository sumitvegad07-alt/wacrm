import { describe, it, expect } from "vitest";
import {
  computeAgentHealth,
  explainGap,
  type HealthPing,
  type HealthSession,
  type HealthSnapshot,
} from "./tracking-health";

const T0 = Date.parse("2026-08-07T00:00:00.000Z");
const at = (minsFromT0: number) => new Date(T0 + minsFromT0 * 60000).toISOString();

function ping(minsFromT0: number, over: Partial<HealthPing> = {}): HealthPing {
  return { recorded_at: at(minsFromT0), battery_pct: 80, is_mocked: false, ...over };
}
function session(startMin: number, endMin: number | null, end_reason: string | null = null): HealthSession {
  return { started_at: at(startMin), ended_at: endMin == null ? null : at(endMin), end_reason };
}
const snapshot = (over: Partial<HealthSnapshot>): HealthSnapshot => ({
  recorded_at: at(0),
  bg_location_permission: "granted",
  battery_optimization_on: false,
  low_power_mode: false,
  location_services_on: true,
  app_version: "1.1.0",
  ...over,
});

describe("computeAgentHealth", () => {
  it("reports not punched in when there are no sessions", () => {
    const h = computeAgentHealth({ sessions: [], pings: [], events: [], latestSnapshot: null });
    expect(h.punchedIn).toBe(false);
    expect(h.coveragePct).toBe(100);
    expect(h.issueCodes).toContain("not_punched_in");
  });

  // The window comparison runs against the viewer's LOCAL clock, so these fixtures build
  // local-time dates explicitly rather than reusing the UTC-based `at()` helper above.
  const localAt = (h: number, m = 0) => new Date(2026, 7, 7, h, m, 0).valueOf();

  it("escalates a missing punch-in to 'late' once the configured window has started", () => {
    const window = {
      start_time: "09:00",
      end_time: "18:00",
      interval_minutes: 10,
      grace_minutes: 15,
        working_days: [1, 2, 3, 4, 5, 6],
    };

    // 08:00 local — before the shift starts: still just neutral info.
    const early = computeAgentHealth({
      sessions: [], pings: [], events: [], latestSnapshot: null,
      trackingSettings: window, nowMs: localAt(8),
    });
    expect(early.issueCodes).toContain("not_punched_in");
    expect(early.worstSeverity).toBe("info");

    // 11:00 local — shift well underway and still nothing: this is a real problem.
    const late = computeAgentHealth({
      sessions: [], pings: [], events: [], latestSnapshot: null,
      trackingSettings: window, nowMs: localAt(11),
    });
    expect(late.issueCodes).toContain("not_punched_in_late");
    expect(late.worstSeverity).toBe("high");
  });

  it("does not accuse anyone of a missing punch-in on a historical range", () => {
    // Viewing last week: "the shift started and nobody punched in" is a statement about NOW.
    const historical = computeAgentHealth({
      sessions: [], pings: [], events: [], latestSnapshot: null,
      trackingSettings: {
        start_time: "09:00",
        end_time: "18:00",
        interval_minutes: 10,
        grace_minutes: 15,
        working_days: [1, 2, 3, 4, 5, 6],
      },
      evaluateMissingPunchIn: false,
      nowMs: localAt(11),
    });
    expect(historical.issueCodes).toContain("not_punched_in");
    expect(historical.issueCodes).not.toContain("not_punched_in_late");
  });

  it("still measures coverage against the configured interval on a historical range", () => {
    // Regression: suppressing the late-punch-in judgement must not also drop the interval,
    // or a healthy rep on a 30-minute interval reads as ~33% coverage.
    const base = {
      // 3 hours on duty with a ping every 30 minutes: full coverage at a 30-minute interval.
      sessions: [session(0, 180, "manual")],
      pings: [0, 30, 60, 90, 120, 150].map((m) => ping(m)),
      events: [],
      latestSnapshot: null,
      evaluateMissingPunchIn: false,
    };
    const shift = {
      start_time: "09:00",
      end_time: "18:00",
      grace_minutes: 15,
      working_days: [1, 2, 3, 4, 5, 6],
    };

    const halfHourly = computeAgentHealth({
      ...base,
      trackingSettings: { ...shift, interval_minutes: 30 },
    });
    expect(halfHourly.expectedPings).toBe(6);
    expect(halfHourly.coveragePct).toBe(100);

    // Same data judged against a 10-minute interval is genuinely poor coverage — proving the
    // number tracks the setting rather than a hardcoded constant.
    const tenMinute = computeAgentHealth({
      ...base,
      trackingSettings: { ...shift, interval_minutes: 10 },
    });
    expect(tenMinute.expectedPings).toBe(18);
    expect(tenMinute.coveragePct).toBe(33);
  });

  it("stays neutral when no shift is configured at all", () => {
    const noWindow = computeAgentHealth({
      sessions: [], pings: [], events: [], latestSnapshot: null, nowMs: localAt(11),
    });
    expect(noWindow.issueCodes).toContain("not_punched_in");
    expect(noWindow.issueCodes).not.toContain("not_punched_in_late");
  });

  it("explainGap blames battery saver using the state when tracking fell silent", () => {
    // The real 2026-08-10 case. Display pings stopped after 13:30 and did not resume until
    // 14:21. Battery saver went ON at 13:08 (that is what stopped them) and was OFF again by
    // 14:11 once the phone went on charge. Reading the newest snapshot — of the day OR inside
    // the gap — would report "power save off" and lose the real cause.
    const at13_08 = snapshot({ recorded_at: at(0), low_power_mode: true });
    const at14_11 = snapshot({ recorded_at: at(63), low_power_mode: false });

    const result = explainGap({
      fromIso: at(22), // 13:30
      toIso: at(73), // 14:21
      events: [],
      snapshots: [at13_08, at14_11],
      batteryBeforeGap: 27,
      intervalMinutes: 10,
    });

    expect(result).not.toBeNull();
    expect(result!.minutes).toBe(51);
    expect(result!.issueCode).toBe("power_save_mode");
  });

  it("explainGap stays quiet for a normal interval", () => {
    expect(
      explainGap({
        fromIso: at(0),
        toIso: at(10), // exactly the configured interval — not a fault
        events: [],
        snapshots: [snapshot({})],
        batteryBeforeGap: 80,
        intervalMinutes: 10,
      }),
    ).toBeNull();
  });

  it("shows full coverage and no gaps when pings arrive every 10 min", () => {
    const pings = Array.from({ length: 13 }, (_, i) => ping(i * 10)); // 00:00..02:00
    const h = computeAgentHealth({
      sessions: [session(0, 120)],
      pings,
      events: [],
      latestSnapshot: snapshot({}),
      nowMs: T0 + 120 * 60000,
    });
    expect(h.gaps).toHaveLength(0);
    expect(h.coveragePct).toBe(100);
    expect(h.issueCodes).toHaveLength(0);
    expect(h.worstSeverity).toBeNull();
  });

  it("computes coverage percentage from expected vs received", () => {
    // 100-min session => expected 10; provide 6 pings => 60%.
    const h = computeAgentHealth({
      sessions: [session(0, 100)],
      pings: [ping(0), ping(10), ping(20), ping(30), ping(40), ping(50)],
      events: [],
      latestSnapshot: snapshot({}),
      nowMs: T0 + 100 * 60000,
    });
    expect(h.expectedPings).toBe(10);
    expect(h.receivedPings).toBe(6);
    expect(h.coveragePct).toBe(60);
  });

  it("classifies a gap as battery_optimization from the device snapshot", () => {
    const h = computeAgentHealth({
      sessions: [session(0, 120)],
      pings: [ping(0), ping(10)], // then silence to 02:00
      events: [],
      latestSnapshot: snapshot({ battery_optimization_on: true }),
      nowMs: T0 + 120 * 60000,
    });
    expect(h.gaps).toHaveLength(1);
    expect(h.gaps[0].issueCode).toBe("battery_optimization");
    expect(h.issueCodes).toContain("battery_optimization");
    expect(h.worstSeverity).toBe("high");
  });

  it("prefers an explicit gps_disabled event over snapshot inference", () => {
    const h = computeAgentHealth({
      sessions: [session(0, 120)],
      pings: [ping(0), ping(10)],
      events: [{ event_type: "gps_disabled", recorded_at: at(40) }],
      latestSnapshot: snapshot({ battery_optimization_on: true }),
      nowMs: T0 + 120 * 60000,
    });
    expect(h.gaps[0].issueCode).toBe("gps_off");
  });

  it("names an OS-killed background app instead of shrugging with unknown_gap", () => {
    // Reproduces the real 2026-08-08 incident: pings every 10 min for ~40 min, then dead
    // silence for hours while everything checkable stayed healthy and the app stopped
    // emitting its hourly heartbeat.
    const h = computeAgentHealth({
      sessions: [session(0, null)], // still punched in
      pings: [ping(0), ping(10), ping(20), ping(30), ping(40, { battery_pct: 43 })],
      events: [], // app never reported gps-off / permission-revoked — it wasn't running
      latestSnapshot: snapshot({
        location_services_on: true,
        bg_location_permission: "granted",
        low_power_mode: false,
      }),
      snapshotTimes: [at(0)], // last heartbeat at punch-in; none during the gap
      nowMs: T0 + 340 * 60000,
    });

    const trailing = h.gaps[h.gaps.length - 1];
    expect(trailing.issueCode).toBe("app_stopped_in_background");
    expect(h.worstSeverity).toBe("high");
  });

  it("still defers to a real device signal over the OS-killed inference", () => {
    const h = computeAgentHealth({
      sessions: [session(0, null)],
      pings: [ping(0), ping(10)],
      events: [{ event_type: "gps_disabled", recorded_at: at(30) }],
      latestSnapshot: snapshot({}),
      snapshotTimes: [at(0)],
      nowMs: T0 + 200 * 60000,
    });
    expect(h.gaps[h.gaps.length - 1].issueCode).toBe("gps_off");
  });

  it("does not blame the OS when a heartbeat proves the app was alive", () => {
    const h = computeAgentHealth({
      sessions: [session(0, null)],
      pings: [ping(0), ping(10)],
      events: [],
      latestSnapshot: snapshot({}),
      // App kept checking in during the gap, so something else stopped the pings.
      snapshotTimes: [at(0), at(60), at(120)],
      nowMs: T0 + 200 * 60000,
    });
    expect(h.gaps[h.gaps.length - 1].issueCode).toBe("unknown_gap");
  });

  it("classifies a trailing gap after a low battery as phone_died", () => {
    const h = computeAgentHealth({
      sessions: [session(0, null)], // still open
      pings: [ping(0, { battery_pct: 50 }), ping(10, { battery_pct: 8 })],
      events: [],
      latestSnapshot: null,
      nowMs: T0 + 120 * 60000,
    });
    expect(h.gaps[0].issueCode).toBe("phone_died");
  });

  it("flags mock_location and app_outdated", () => {
    const h = computeAgentHealth({
      sessions: [session(0, 30)],
      pings: [ping(0, { is_mocked: true }), ping(10), ping(20), ping(30)],
      events: [],
      latestSnapshot: snapshot({}),
      deviceAppVersion: "1.0.0",
      currentAppVersion: "1.1.0",
      nowMs: T0 + 30 * 60000,
    });
    expect(h.issueCodes).toContain("mock_location");
    expect(h.issueCodes).toContain("app_outdated");
  });

  it("classifies bg_permission_missing when background permission is not granted", () => {
    const h = computeAgentHealth({
      sessions: [session(0, 120)],
      pings: [ping(0)],
      events: [],
      latestSnapshot: snapshot({ bg_location_permission: "denied" }),
      nowMs: T0 + 120 * 60000,
    });
    expect(h.gaps.some((g) => g.issueCode === "bg_permission_missing")).toBe(true);
  });
});
