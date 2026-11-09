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
export const MAX_ACCURACY_M = 50;

/** A segment implying a faster speed than this (~200 km/h) is treated as a GPS jump and skipped. */
export const MAX_PLAUSIBLE_SPEED_MPS = 55;

/**
 * Floor for the "did they actually move" threshold, in metres.
 *
 * A stationary phone reports a position that wanders continuously. Summed over a day parked at
 * customers, that drift alone fabricates kilometres — and it is worst on exactly the cheap
 * handsets field reps carry. A step counts as movement only when it exceeds the GPS uncertainty
 * of the two fixes involved, so the bar rises automatically when the device is less sure of
 * itself; this constant stops it dropping to nothing when a device claims 2 m accuracy.
 */
export const MIN_MOVE_M = 15;

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

/**
 * Straight-line distance between two points, in whole metres, or null when
 * either point is missing.
 *
 * This is the "how far from the customer was the rep when he checked in"
 * number. It must stay identical to `enforce_site_visit_geofence` in migration
 * 20260910140000, which stamps the same figure onto `check_in_distance_m` —
 * but only for accounts that have geo-fencing switched ON. Everyone else has
 * the two coordinates and no distance, so the reading screens work it out.
 */
export function haversineMeters(
  lat1: number | null | undefined,
  lng1: number | null | undefined,
  lat2: number | null | undefined,
  lng2: number | null | undefined,
): number | null {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const a = [Number(lat1), Number(lng1), Number(lat2), Number(lng2)];
  if (a.some((n) => !Number.isFinite(n))) return null;
  return Math.round(haversineKm(a[0], a[1], a[2], a[3]) * 1000);
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
  // The previous ACCEPTED point, which is not always the previous point in the list: a rejected
  // step must not reset the baseline, or a stationary phone drifting 10 m at a time would add
  // every one of those steps as real travel.
  let prev: DistancePing | null = usable[0] ?? null;

  for (let i = 1; i < usable.length; i++) {
    const curr = usable[i];
    if (!prev) {
      prev = curr;
      continue;
    }

    const segKm = haversineKm(prev.lat!, prev.lng!, curr.lat!, curr.lng!);
    const segM = segKm * 1000;

    // Stationary gate — indistinguishable from standing still given the two fixes' uncertainty.
    // Keep `prev` where it is so drift cannot accumulate step by step.
    if (segM < Math.max(MIN_MOVE_M, prev.accuracy_m ?? 0, curr.accuracy_m ?? 0)) continue;

    const dtSec =
      (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000;
    // Impossible-speed gate — a GPS glitch, not a journey. Also skipped without moving `prev`.
    if (dtSec > 0 && segM / dtSec > MAX_PLAUSIBLE_SPEED_MPS) continue;

    totalKm += segKm;
    prev = curr;
  }
  return Math.round(totalKm * 100) / 100;
}
