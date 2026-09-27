import { describe, it, expect } from "vitest";
import { summariseDay, type Ping } from "./summarise";

/** 0.01° of latitude is about 1.11 km, anywhere on earth. */
const BASE_LAT = 18.5204;
const BASE_LNG = 73.8567;

function ping(minutesFromStart: number, latOffset = 0, is_mocked = false): Ping {
  return {
    lat: BASE_LAT + latOffset,
    lng: BASE_LNG,
    recorded_at: new Date(Date.UTC(2026, 8, 20, 4, minutesFromStart, 0)).toISOString(),
    is_mocked,
  };
}

describe("summariseDay", () => {
  it("measures the distance walked between two points", () => {
    const s = summariseDay([ping(0), ping(30, 0.01)])!;
    expect(s.distanceKm).toBeCloseTo(1.11, 1);
  });

  it("records where and when the day started and ended", () => {
    const s = summariseDay([ping(0), ping(30, 0.01), ping(60, 0.02)])!;

    expect(s.firstAt).toBe(ping(0).recorded_at);
    expect(s.lastAt).toBe(ping(60).recorded_at);
    expect(s.firstLat).toBeCloseTo(BASE_LAT, 4);
    expect(s.lastLat).toBeCloseTo(BASE_LAT + 0.02, 4);
    expect(s.pingCount).toBe(3);
  });

  // The database returns rows in whatever order it likes. Summing distance over
  // an unsorted list produces a wildly inflated figure — a rep who walked 2 km
  // would be recorded as having walked far more, and the raw points are deleted
  // straight afterwards, so the wrong number would be permanent.
  it("sorts by time before measuring, whatever order the rows arrive in", () => {
    const ordered = summariseDay([ping(0), ping(30, 0.01), ping(60, 0.02)])!;
    const shuffled = summariseDay([ping(60, 0.02), ping(0), ping(30, 0.01)])!;

    expect(shuffled.distanceKm).toBeCloseTo(ordered.distanceKm, 6);
    expect(shuffled.firstAt).toBe(ordered.firstAt);
    expect(shuffled.lastAt).toBe(ordered.lastAt);
  });

  it("leaves faked locations out of the distance but still counts them", () => {
    const s = summariseDay([ping(0), ping(30, 5, true), ping(60, 0.01)])!;

    expect(s.distanceKm).toBeCloseTo(1.11, 1);
    expect(s.mockedCount).toBe(1);
    expect(s.pingCount).toBe(3);
  });

  it("reports zero distance for a rep who never moved", () => {
    const s = summariseDay([ping(0), ping(30), ping(60)])!;
    expect(s.distanceKm).toBe(0);
  });

  it("still summarises a single ping", () => {
    const s = summariseDay([ping(0)])!;
    expect(s.distanceKm).toBe(0);
    expect(s.pingCount).toBe(1);
    expect(s.firstAt).toBe(s.lastAt);
  });

  it("returns null when there is nothing to summarise", () => {
    expect(summariseDay([])).toBeNull();
  });

  // If every ping on a day was faked there is no trustworthy distance, but the
  // day must still be summarised — otherwise its pings can never be deleted,
  // because deletion requires a summary to exist.
  it("summarises a day of entirely faked pings as zero distance", () => {
    const s = summariseDay([ping(0, 0, true), ping(30, 0.01, true)])!;

    expect(s).not.toBeNull();
    expect(s.distanceKm).toBe(0);
    expect(s.mockedCount).toBe(2);
    expect(s.pingCount).toBe(2);
  });
});
