import { describe, it, expect } from "vitest";
import {
  arrowsAlong,
  bearingDeg,
  cumulativeKm,
  playbackDurationMs,
  poseAtFraction,
  type LatLng,
} from "./route-geometry";

/** Straight run due east along the equator, 1 km-ish steps. */
const EAST: LatLng[] = [
  [0, 0],
  [0, 0.01],
  [0, 0.02],
  [0, 0.03],
  [0, 0.04],
];

describe("bearingDeg", () => {
  it("reads 90° due east and 0° due north", () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(90, 1);
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(0, 1);
  });

  it("wraps to 0–360 rather than going negative", () => {
    const west = bearingDeg([0, 0], [0, -1]);
    expect(west).toBeGreaterThanOrEqual(0);
    expect(west).toBeCloseTo(270, 1);
  });
});

describe("cumulativeKm", () => {
  it("starts at zero and increases monotonically", () => {
    const cum = cumulativeKm(EAST);
    expect(cum[0]).toBe(0);
    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThan(cum[i - 1]);
  });
});

describe("poseAtFraction", () => {
  const cum = cumulativeKm(EAST);

  it("returns the start at 0 and the end at 1", () => {
    expect(poseAtFraction(EAST, cum, 0)!.pos[1]).toBeCloseTo(0, 6);
    expect(poseAtFraction(EAST, cum, 1)!.pos[1]).toBeCloseTo(0.04, 6);
  });

  it("is halfway along the path at 0.5", () => {
    expect(poseAtFraction(EAST, cum, 0.5)!.pos[1]).toBeCloseTo(0.02, 4);
  });

  it("moves at constant ground speed even when coordinates are unevenly spaced", () => {
    // Dense at the start (a junction), sparse at the end (open road). Stepping one coordinate
    // per frame would crawl through the junction and then jump; distance interpolation must not.
    const uneven: LatLng[] = [
      [0, 0],
      [0, 0.001],
      [0, 0.002],
      [0, 0.003],
      [0, 0.1], // long straight
    ];
    const c = cumulativeKm(uneven);
    const quarter = poseAtFraction(uneven, c, 0.25)!.pos[1];
    const half = poseAtFraction(uneven, c, 0.5)!.pos[1];
    const threeQ = poseAtFraction(uneven, c, 0.75)!.pos[1];

    // Equal fractions of the journey cover equal ground, so the steps are near-identical.
    expect(half - quarter).toBeCloseTo(threeQ - half, 3);
    // And by halfway it is already deep into the long straight, not still at the junction.
    expect(half).toBeGreaterThan(0.04);
  });

  it("clamps out-of-range fractions instead of running off the end", () => {
    expect(poseAtFraction(EAST, cum, -5)!.pos[1]).toBeCloseTo(0, 6);
    expect(poseAtFraction(EAST, cum, 5)!.pos[1]).toBeCloseTo(0.04, 6);
  });

  it("returns null for a route that goes nowhere", () => {
    expect(poseAtFraction([[0, 0]], [0], 0.5)).toBeNull();
    const stationary: LatLng[] = [
      [0, 0],
      [0, 0],
    ];
    expect(poseAtFraction(stationary, cumulativeKm(stationary), 0.5)).toBeNull();
  });

  it("faces the direction of travel", () => {
    expect(poseAtFraction(EAST, cum, 0.5)!.deg).toBeCloseTo(90, 1);
  });
});

describe("arrowsAlong", () => {
  it("returns nothing for a route with fewer than two points", () => {
    expect(arrowsAlong([])).toEqual([]);
    expect(arrowsAlong([[0, 0]])).toEqual([]);
  });

  it("spaces arrows through the route and points them along it", () => {
    const many: LatLng[] = Array.from({ length: 60 }, (_, i) => [0, i * 0.001] as LatLng);
    const arrows = arrowsAlong(many, 12);
    expect(arrows.length).toBeGreaterThan(5);
    // `count` is a hard ceiling on clutter, not a rough target.
    expect(arrows.length).toBeLessThanOrEqual(12);
    arrows.forEach((a) => expect(a.deg).toBeCloseTo(90, 1));
  });
});

describe("playbackDurationMs", () => {
  it("keeps a short day watchable and caps a long one", () => {
    expect(playbackDurationMs(0.5)).toBe(8000);
    expect(playbackDurationMs(15)).toBe(13500);
    expect(playbackDurationMs(500)).toBe(30000);
  });
});
