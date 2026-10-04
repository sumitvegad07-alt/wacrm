// ============================================================
// Raw GPS pings -> where someone stopped, and for how long.
//
// A six-hour tracked day is roughly four thousand pings. Handing those to an
// AI is useless and expensive: it cannot read them, and the honest answer to
// "where was Dhaval between 11 and 5" is a dozen places with times, not a
// coordinate list.
//
// Deliberate choices, each one a wrong answer avoided:
//   * Mocked pings never form a stop. A faked location must not become
//     somewhere the rep "was"; it is counted separately so it can be said.
//   * Movement is measured between STOPS, not between consecutive pings.
//     GPS wobbles by a few metres while a phone sits still, and summing every
//     hop reports kilometres of travel from someone who never moved.
//   * Short passes are dropped. Driving past a place is not visiting it.
// ============================================================

export interface Ping {
  lat: number;
  lng: number;
  recorded_at: string;
  is_mocked?: boolean;
}

export interface Stop {
  from: string;
  to: string;
  minutes: number;
  lat: number;
  lng: number;
  ping_count: number;
}

export interface Trail {
  stops: Stop[];
  moving_km: number;
  /** Pings reporting a faked location, excluded from the stops above. */
  mocked_count: number;
}

export interface ClusterOptions {
  /** How far a ping may sit from a stop's centre and still belong to it. */
  radiusM?: number;
  /** Below this, a cluster was a pass-through rather than a stop. */
  minMinutes?: number;
}

const DEFAULT_RADIUS_M = 150;
const DEFAULT_MIN_MINUTES = 5;
const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Cluster {
  lat: number;
  lng: number;
  count: number;
  from: number;
  to: number;
}

function usable(p: Ping): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Number.isFinite(Date.parse(p.recorded_at))
  );
}

export function clusterPings(
  pings: Ping[],
  opts: ClusterOptions = {},
): Trail {
  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M;
  const minMinutes = opts.minMinutes ?? DEFAULT_MIN_MINUTES;

  let mocked = 0;
  const usablePings = pings
    .filter((p) => {
      if (p.is_mocked) {
        mocked += 1;
        return false;
      }
      return usable(p);
    })
    // Pings arrive out of order after an offline sync, and clustering a
    // shuffled trail invents stops that never happened.
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));

  if (usablePings.length === 0) {
    return { stops: [], moving_km: 0, mocked_count: mocked };
  }

  const clusters: Cluster[] = [];
  let current: Cluster | null = null;

  for (const p of usablePings) {
    const t = Date.parse(p.recorded_at);
    if (
      current &&
      haversineM(current.lat, current.lng, p.lat, p.lng) <= radiusM
    ) {
      // Running mean, so the centre is the place rather than the first fix.
      current.lat += (p.lat - current.lat) / (current.count + 1);
      current.lng += (p.lng - current.lng) / (current.count + 1);
      current.count += 1;
      current.to = t;
      continue;
    }
    if (current) clusters.push(current);
    current = { lat: p.lat, lng: p.lng, count: 1, from: t, to: t };
  }
  if (current) clusters.push(current);

  const kept = clusters.filter(
    (c) => (c.to - c.from) / 60_000 >= minMinutes,
  );
  // A trail that is one long drive has no qualifying stop; returning nothing
  // would read as "no data" rather than "never stopped anywhere".
  const stops = (kept.length ? kept : clusters).map(toStop);

  return {
    stops,
    moving_km: travelBetween(kept.length ? kept : clusters),
    mocked_count: mocked,
  };
}

function toStop(c: Cluster): Stop {
  return {
    from: new Date(c.from).toISOString(),
    to: new Date(c.to).toISOString(),
    minutes: Math.round((c.to - c.from) / 60_000),
    lat: Number(c.lat.toFixed(6)),
    lng: Number(c.lng.toFixed(6)),
    ping_count: c.count,
  };
}

/** Distance between consecutive stop centres — never between raw pings. */
function travelBetween(clusters: Cluster[]): number {
  let metres = 0;
  for (let i = 1; i < clusters.length; i++) {
    metres += haversineM(
      clusters[i - 1].lat,
      clusters[i - 1].lng,
      clusters[i].lat,
      clusters[i].lng,
    );
  }
  return Number((metres / 1000).toFixed(2));
}
