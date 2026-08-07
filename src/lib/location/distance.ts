/**
 * Trustworthy travel-distance calculation for Location Tracking.
 *
 * This is the SINGLE source of truth for "how far did an agent travel" on the web.
 * It replaces two earlier inline Haversine loops (Track Report + Overview) that summed
 * EVERY GPS ping regardless of quality — which let a single low-accuracy reading (production
 * data has readings up to 1.2 km accuracy, and a third of pings with none at all) inflate the
 * number that approves fuel expenses.
 *
 * It must stay behaviourally identical to the Postgres function `compute_daily_distance`
 * (migration 20260807170000_location_trust_foundation). If you change a threshold here, change
 * it there too, and re-run the parity fixtures in distance.test.ts.
 */

/** Pings with a worse (larger) accuracy reading than this, or none at all, are excluded. */
export const MAX_ACCURACY_M = 100;

/** A segment implying a faster speed than this (~200 km/h) is treated as a GPS jump and skipped. */
export const MAX_PLAUSIBLE_SPEED_MPS = 55;

export interface DistancePing {
  lat: number | null;
  lng: number | null;
  /** GPS horizontal accuracy in metres (the DB column is `accuracy_m`). */
  accuracy_m: number | null;
  /** ISO timestamp string of when the position was captured. */
  recorded_at: string;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

/** True if a ping has a real position AND an accuracy good enough to trust for distance. */
export function isTrustworthyPing(p: DistancePing): boolean {
  return (
    p.lat !== null &&
    p.lng !== null &&
    p.accuracy_m !== null &&
    p.accuracy_m <= MAX_ACCURACY_M
  );
}

/**
 * Total travel distance (km, rounded to 2 dp) across one user's pings.
 *
 * Accepts pings in any order (sorted internally by `recorded_at`). Excludes low-accuracy /
 * position-less pings, then skips any segment whose implied speed is physically impossible
 * (a GPS teleport). A segment with a non-positive time delta is dropped — an instantaneous
 * jump can't be validated. Mirrors compute_daily_distance() exactly.
 */
export function computeFilteredDistanceKm(pings: DistancePing[]): number {
  const usable = pings
    .filter(isTrustworthyPing)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

  let totalKm = 0;
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1];
    const curr = usable[i];
    const segKm = haversineKm(prev.lat!, prev.lng!, curr.lat!, curr.lng!);
    const dtSec = (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000;
    if (dtSec > 0 && (segKm * 1000) / dtSec <= MAX_PLAUSIBLE_SPEED_MPS) {
      totalKm += segKm;
    }
  }
  return Math.round(totalKm * 100) / 100;
}
