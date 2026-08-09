/**
 * Pure geometry for drawing and animating a travelled route.
 *
 * Kept out of the map component on purpose: that module imports Leaflet, which touches `window`
 * at import time and can only run in the browser. Here the maths is plain functions, so the
 * parts that are easy to get subtly wrong — bearings, constant-speed interpolation — are
 * testable without a DOM.
 */

import { haversineKm } from "./distance";

export type LatLng = [number, number];

/** Initial bearing from one coordinate to the next, in degrees clockwise from north. */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lng1] = from;
  const [lat2, lng2] = to;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Running distance in km to each coordinate; index 0 is always 0. */
export function cumulativeKm(coords: LatLng[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(
      cum[i - 1] + haversineKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]),
    );
  }
  return cum;
}

/**
 * Evenly spaced direction arrows along a route.
 *
 * Without these you cannot tell whether a rep drove north then south or the reverse — which is
 * the first question anyone asks of a day with criss-crossing lines.
 */
export function arrowsAlong(
  coords: LatLng[],
  count = 12,
): { pos: LatLng; deg: number }[] {
  if (coords.length < 2) return [];
  // ceil, not floor: flooring the stride overshoots the requested count on long routes
  // (60 points asking for 12 produced 14), and `count` is meant to cap the clutter.
  const step = Math.max(1, Math.ceil(coords.length / (count + 1)));
  const out: { pos: LatLng; deg: number }[] = [];
  for (let i = step; i < coords.length - 1; i += step) {
    out.push({ pos: coords[i], deg: bearingDeg(coords[i], coords[i + 1]) });
  }
  return out;
}

/**
 * Where the rider is at `fraction` (0..1) of the way through the journey, and which way it faces.
 *
 * Interpolates on DISTANCE, not on array index. Router output is unevenly spaced — dense through
 * junctions, sparse on straights — so advancing one coordinate per frame would make the rider
 * crawl round corners and rocket down open road. Constant ground speed is what makes playback
 * read as a journey.
 */
export function poseAtFraction(
  coords: LatLng[],
  cumulative: number[],
  fraction: number,
): { pos: LatLng; deg: number } | null {
  if (coords.length < 2) return null;
  const total = cumulative[cumulative.length - 1];
  if (!(total > 0)) return null;

  const t = Math.max(0, Math.min(1, fraction));
  const travelled = t * total;

  // First coordinate whose running distance reaches `travelled`.
  let seg = 1;
  while (seg < cumulative.length - 1 && cumulative[seg] < travelled) seg++;

  const a = coords[seg - 1];
  const b = coords[seg];
  const segStart = cumulative[seg - 1];
  const segLen = cumulative[seg] - segStart;
  const f = segLen > 0 ? Math.max(0, Math.min(1, (travelled - segStart) / segLen)) : 0;

  return {
    pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    deg: bearingDeg(a, b),
  };
}

/**
 * How long playback should run. Long days must not take proportionally long to watch, and a
 * two-street day must not blink past before anyone sees it.
 */
export function playbackDurationMs(totalKm: number): number {
  return Math.min(30000, Math.max(8000, totalKm * 900));
}
