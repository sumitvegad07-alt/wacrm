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
