import { describe, expect, it } from "vitest";
import { clusterPings, type Ping } from "./dwell";

/** A ping `min` minutes into 2026-10-03, at a position. */
const at = (min: number, lat: number, lng: number): Ping => ({
  lat,
  lng,
  recorded_at: new Date(Date.UTC(2026, 9, 3, 5, 0) + min * 60_000).toISOString(),
});

// Two real Mumbai positions, about 7 km apart.
const ANDHERI: [number, number] = [19.1197, 72.8468];
const BKC: [number, number] = [19.0607, 72.8362];

describe("clusterPings", () => {
  it("returns nothing for an empty trail", () => {
    expect(clusterPings([])).toEqual({ stops: [], moving_km: 0, mocked_count: 0 });
  });

  it("collapses pings within the radius into one stop", () => {
    const t = clusterPings([
      at(0, 19.1197, 72.8468),
      at(10, 19.1198, 72.8469),
      at(20, 19.1197, 72.847),
    ]);
    expect(t.stops).toHaveLength(1);
    expect(t.stops[0].minutes).toBe(20);
    expect(t.stops[0].ping_count).toBe(3);
  });

  it("splits into two stops when the rep moves away and settles again", () => {
    const t = clusterPings([
      at(0, ...ANDHERI),
      at(15, 19.1198, 72.8469),
      at(40, ...BKC),
      at(60, 19.0608, 72.8363),
    ]);
    expect(t.stops).toHaveLength(2);
  });

  it("drops a pass-through shorter than minMinutes", () => {
    const t = clusterPings(
      [
        at(0, ...ANDHERI),
        at(30, 19.1198, 72.8469),
        at(32, ...BKC), // 2 minutes — driving past
        at(60, 19.2183, 72.9781),
        at(90, 19.2184, 72.9782),
      ],
      { minMinutes: 5 },
    );
    expect(t.stops).toHaveLength(2);
  });

  it("reports distance travelled between stops", () => {
    const t = clusterPings([
      at(0, ...ANDHERI),
      at(10, 19.1198, 72.8469),
      at(40, ...BKC),
      at(60, 19.0608, 72.8363),
    ]);
    expect(t.moving_km).toBeGreaterThan(5);
    expect(t.moving_km).toBeLessThan(15);
  });

  it("turns thousands of pings into a handful of stops", () => {
    // A six-hour day is roughly this many pings; an AI cannot read them.
    const pings: Ping[] = [];
    for (let i = 0; i < 4000; i++) {
      const base = i < 2000 ? ANDHERI : BKC;
      pings.push(at(i * 0.1, base[0] + i * 1e-6, base[1] + i * 1e-6));
    }
    const t = clusterPings(pings);
    expect(t.stops.length).toBeLessThan(10);
    expect(t.stops.length).toBeGreaterThan(0);
  });

  it("orders stops in time and never overlaps them", () => {
    const t = clusterPings([
      at(0, ...ANDHERI),
      at(20, 19.1198, 72.8469),
      at(60, ...BKC),
      at(90, 19.0608, 72.8363),
    ]);
    for (let i = 1; i < t.stops.length; i++) {
      expect(t.stops[i].from >= t.stops[i - 1].to).toBe(true);
    }
  });

  it("excludes mocked pings from stops but counts them", () => {
    // A faked location must never become a place the rep "was".
    const t = clusterPings([
      at(0, ...ANDHERI),
      at(10, 19.1198, 72.8469),
      { ...at(15, ...BKC), is_mocked: true },
      at(20, 19.1197, 72.847),
    ]);
    expect(t.mocked_count).toBe(1);
    expect(t.stops).toHaveLength(1);
  });

  it("survives pings arriving out of order", () => {
    const t = clusterPings([
      at(20, 19.1197, 72.847),
      at(0, ...ANDHERI),
      at(10, 19.1198, 72.8469),
    ]);
    expect(t.stops).toHaveLength(1);
    expect(t.stops[0].minutes).toBe(20);
  });

  it("ignores a ping with no usable position", () => {
    const t = clusterPings([
      at(0, ...ANDHERI),
      { lat: Number.NaN, lng: 72.8, recorded_at: at(5, 0, 0).recorded_at },
      at(10, 19.1198, 72.8469),
    ]);
    expect(t.stops).toHaveLength(1);
    expect(t.stops[0].ping_count).toBe(2);
  });

  it("keeps a single ping as a zero-length stop rather than losing it", () => {
    const t = clusterPings([at(0, ...ANDHERI)], { minMinutes: 0 });
    expect(t.stops).toHaveLength(1);
    expect(t.stops[0].minutes).toBe(0);
  });

  it("reports a stop's centre, not its first ping", () => {
    // 0.001 degrees of latitude is about 111 m, so these two are inside the
    // 150 m radius and belong to one stop whose centre is their midpoint.
    const t = clusterPings([
      at(0, 19.12, 72.85),
      at(10, 19.121, 72.85),
    ]);
    expect(t.stops).toHaveLength(1);
    expect(t.stops[0].lat).toBeCloseTo(19.1205, 4);
  });

  it("starts a new stop when the next ping is outside the radius", () => {
    // ~300 m apart: a different place, not jitter.
    const t = clusterPings([
      at(0, 19.12, 72.85),
      at(10, 19.122, 72.852),
    ]);
    expect(t.stops).toHaveLength(2);
  });

  it("does not count jitter at one place as travel", () => {
    // GPS wobbles by a few metres while a phone sits still; summing every
    // hop would report kilometres of "travel" from a stationary rep.
    const pings: Ping[] = [];
    for (let i = 0; i < 200; i++) {
      pings.push(at(i, 19.1197 + (i % 2) * 2e-5, 72.8468 + (i % 3) * 2e-5));
    }
    expect(clusterPings(pings).moving_km).toBeLessThan(0.5);
  });
});
