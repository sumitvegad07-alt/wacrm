import { describe, it, expect } from "vitest";
import {
  computeAgentHealth,
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
      enabled: true,
      start_time: "09:00",
      end_time: "18:00",
      interval_minutes: 10,
      grace_minutes: 15,
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

  it("stays neutral when no tracking window is configured or it is disabled", () => {
    const noWindow = computeAgentHealth({
      sessions: [], pings: [], events: [], latestSnapshot: null, nowMs: localAt(11),
    });
    expect(noWindow.issueCodes).toContain("not_punched_in");

    const disabled = computeAgentHealth({
      sessions: [], pings: [], events: [], latestSnapshot: null,
      trackingSettings: {
        enabled: false,
        start_time: "09:00",
        end_time: "18:00",
        interval_minutes: 10,
        grace_minutes: 15,
      },
      nowMs: localAt(11),
    });
    expect(disabled.issueCodes).toContain("not_punched_in");
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
