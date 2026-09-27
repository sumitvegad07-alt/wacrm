// ============================================================
// Reducing a day of GPS points to the one row that outlives them.
//
// Once a day's pings pass the retention period they are deleted permanently, so
// this summary is the only record that survives. Everything the distance and
// attendance reports need afterwards has to come out of here.
//
// Pure functions, no database: the arithmetic that is easy to get subtly wrong
// is testable without one.
// ============================================================

import { cumulativeKm, type LatLng } from "@/lib/location/route-geometry";

export interface Ping {
  lat: number;
  lng: number;
  recorded_at: string;
  /** Set by the app when Android reports a mock location provider. */
  is_mocked?: boolean;
}

export interface DaySummary {
  /** Distance over genuine pings only, in kilometres. */
  distanceKm: number;
  pingCount: number;
  /** How many of those pings were faked. Kept so the figure can be judged. */
  mockedCount: number;
  firstAt: string;
  lastAt: string;
  firstLat: number;
  firstLng: number;
  lastLat: number;
  lastLng: number;
}

/** Whole metres, so a stored distance never carries float noise. */
function roundKm(km: number): number {
  return Math.round(km * 1000) / 1000;
}

/**
 * One day of pings for one user, reduced to a single row.
 *
 * Returns null for an empty day — there is nothing to record, and writing an
 * empty summary would mark the day as processed when it was not.
 */
export function summariseDay(pings: Ping[]): DaySummary | null {
  if (!pings?.length) return null;

  // The database returns rows in no guaranteed order, and distance summed over
  // an unsorted list is nonsense — inflated, and permanent once the raw points
  // are deleted.
  const sorted = [...pings].sort(
    (a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at),
  );

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // A faked location can sit anywhere on earth, so including one would add
  // hundreds of kilometres to a rep's day. They are counted but not measured.
  const genuine: LatLng[] = sorted
    .filter((p) => !p.is_mocked)
    .map((p) => [p.lat, p.lng] as LatLng);

  const cum = cumulativeKm(genuine);

  return {
    distanceKm: roundKm(cum.length ? cum[cum.length - 1] : 0),
    pingCount: sorted.length,
    mockedCount: sorted.filter((p) => p.is_mocked).length,
    firstAt: first.recorded_at,
    lastAt: last.recorded_at,
    firstLat: first.lat,
    firstLng: first.lng,
    lastLat: last.lat,
    lastLng: last.lng,
  };
}
