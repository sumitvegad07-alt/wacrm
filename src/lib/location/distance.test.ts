import { describe, it, expect } from "vitest";
import {
  computeFilteredDistanceKm,
  haversineKm,
  isTrustworthyPing,
  MAX_ACCURACY_M,
  type DistancePing,
} from "./distance";

// A ping ~111.19 km east of (0,0) along the equator (1° of longitude at the equator).
const ONE_DEG_LNG_KM = 111.19;

function ping(over: Partial<DistancePing>): DistancePing {
  return { lat: 0, lng: 0, accuracy_m: 10, recorded_at: "2026-07-16T00:00:00.000Z", ...over };
}

describe("haversineKm", () => {
  it("computes ~111.19 km for 1° of longitude at the equator", () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(ONE_DEG_LNG_KM, 1);
  });
});

describe("isTrustworthyPing", () => {
  it("rejects null position, null accuracy, and accuracy worse than the threshold", () => {
    expect(isTrustworthyPing(ping({ lat: null }))).toBe(false);
    expect(isTrustworthyPing(ping({ accuracy_m: null }))).toBe(false);
    expect(isTrustworthyPing(ping({ accuracy_m: MAX_ACCURACY_M + 1 }))).toBe(false);
    expect(isTrustworthyPing(ping({ accuracy_m: MAX_ACCURACY_M }))).toBe(true);
  });
});

describe("computeFilteredDistanceKm", () => {
  it("returns 0 for empty or single-ping input", () => {
    expect(computeFilteredDistanceKm([])).toBe(0);
    expect(computeFilteredDistanceKm([ping({})])).toBe(0);
  });

  it("sums a plausible segment between two good pings", () => {
    const d = computeFilteredDistanceKm([
      ping({ lng: 0, recorded_at: "2026-07-16T00:00:00.000Z" }),
      ping({ lng: 1, recorded_at: "2026-07-16T02:00:00.000Z" }), // 2h later => ~15 m/s, plausible
    ]);
    expect(d).toBeCloseTo(ONE_DEG_LNG_KM, 1);
  });

  it("excludes a low-accuracy ping from the path", () => {
    // Middle ping is low-accuracy: distance should be measured 0->2 directly, not 0->1->2.
    const withBad = computeFilteredDistanceKm([
      ping({ lng: 0, recorded_at: "2026-07-16T00:00:00.000Z" }),
      ping({ lng: 1, accuracy_m: 500, recorded_at: "2026-07-16T01:00:00.000Z" }),
      ping({ lng: 2, recorded_at: "2026-07-16T04:00:00.000Z" }),
    ]);
    // 0->2 = ~222.38 km over 4h (~15 m/s) => plausible, counted whole.
    expect(withBad).toBeCloseTo(ONE_DEG_LNG_KM * 2, 0);
  });

  it("excludes a NULL-accuracy ping", () => {
    const d = computeFilteredDistanceKm([
      ping({ lng: 0, recorded_at: "2026-07-16T00:00:00.000Z" }),
      ping({ lng: 1, accuracy_m: null, recorded_at: "2026-07-16T01:00:00.000Z" }),
      ping({ lng: 2, recorded_at: "2026-07-16T04:00:00.000Z" }),
    ]);
    expect(d).toBeCloseTo(ONE_DEG_LNG_KM * 2, 0);
  });

  it("skips an impossible GPS jump (teleport)", () => {
    // 111 km in 60 seconds => ~1853 m/s => impossible, segment dropped.
    const d = computeFilteredDistanceKm([
      ping({ lng: 0, recorded_at: "2026-07-16T00:00:00.000Z" }),
      ping({ lng: 1, recorded_at: "2026-07-16T00:01:00.000Z" }),
    ]);
    expect(d).toBe(0);
  });

  it("matches compute_daily_distance() SQL on the shared parity fixture (111.19 km)", () => {
    // These exact rows were run through the live Postgres compute_daily_distance() in a
    // rolled-back transaction and returned 111.19 km — re-verified on 2026-08-10 after the
    // rewrite for the dense trace (tighter accuracy bar plus the stationary gate). The drift
    // fixture in the test above was checked the same way and returns 0 in both engines.
    // If this assertion ever fails, the TS util and the SQL function have drifted — fix both,
    // don't just adjust the number here.
    const acc = (accuracy_m: number | null, lng: number, hhmm: string): DistancePing => ({
      lat: 0,
      lng,
      accuracy_m,
      recorded_at: `2026-06-01T${hhmm}:00.000Z`,
    });
    const fixture: DistancePing[] = [
      acc(10, 0.0, "00:00"),
      acc(20, 0.5, "00:30"),
      acc(500, 0.5, "01:00"), // low accuracy -> excluded
      acc(10, 1.0, "01:30"),
      acc(null, 1.0, "02:00"), // null accuracy -> excluded
      { lat: 5, lng: 1.0, accuracy_m: 10, recorded_at: "2026-06-01T02:05:00.000Z" }, // teleport -> skipped
    ];
    expect(computeFilteredDistanceKm(fixture)).toBe(111.19);
  });

  it("ignores a stationary phone's GPS drift", () => {
    // The single biggest source of fabricated distance on low-cost handsets. A parked phone
    // reports a position that jitters around a point; at a 15-second cadence that is 240 phantom
    // steps an hour. Each step here is ~11 m with the device claiming 20 m accuracy, so none of
    // them is distinguishable from standing still. Before the stationary gate this fixture
    // summed to ~0.22 km of travel that never happened.
    const jitter: DistancePing[] = [];
    for (let i = 0; i < 20; i++) {
      jitter.push({
        lat: 0,
        lng: i % 2 === 0 ? 0 : 0.0001, // ~11 m apart, oscillating around one spot
        accuracy_m: 20,
        recorded_at: new Date(Date.UTC(2026, 5, 1, 0, 0, i * 15)).toISOString(),
      });
    }
    expect(computeFilteredDistanceKm(jitter)).toBe(0);
  });

  it("still counts genuine slow movement that drifts past the uncertainty", () => {
    // Walking away in one direction must NOT be swallowed by the stationary gate: the steps
    // accumulate in one direction, so displacement from the baseline soon exceeds it.
    const walk: DistancePing[] = [];
    for (let i = 0; i < 20; i++) {
      walk.push({
        lat: 0,
        lng: i * 0.0001, // ~11 m per step, all the same way
        accuracy_m: 20,
        recorded_at: new Date(Date.UTC(2026, 5, 1, 0, 0, i * 15)).toISOString(),
      });
    }
    // 19 steps of ~11.1 m ≈ 211 m, counted in ~22 m increments once each clears the threshold.
    expect(computeFilteredDistanceKm(walk)).toBeGreaterThan(0.15);
    expect(computeFilteredDistanceKm(walk)).toBeLessThan(0.25);
  });

  it("is order-independent (sorts by recorded_at internally)", () => {
    const forward = computeFilteredDistanceKm([
      ping({ lng: 0, recorded_at: "2026-07-16T00:00:00.000Z" }),
      ping({ lng: 1, recorded_at: "2026-07-16T02:00:00.000Z" }),
    ]);
    const shuffled = computeFilteredDistanceKm([
      ping({ lng: 1, recorded_at: "2026-07-16T02:00:00.000Z" }),
      ping({ lng: 0, recorded_at: "2026-07-16T00:00:00.000Z" }),
    ]);
    expect(shuffled).toBe(forward);
  });
});
