/**
 * Geo Service — Free geocoding (Nominatim) & routing (OpenRouteService)
 *
 * Nominatim: https://nominatim.org/release-docs/develop/api/
 * OpenRouteService: https://openrouteservice.org/dev/#/api-docs
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const ORS_BASE = "https://api.openrouteservice.org";

// ORS free tier key — replace with your own from https://openrouteservice.org/dev/#/signup
const ORS_API_KEY = process.env.NEXT_PUBLIC_ORS_API_KEY || "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjZiNzJlZjc3ZjY1YjQxZjlhYTA3OTI4ZDdhZTNjZWJhIiwiaCI6Im11cm11cjY0In0=";

// ─── Rate Limiting (Nominatim policy: max 1 req/sec) ──────────────────────
let lastNominatimCall = 0;
async function nominatimThrottle() {
  const now = Date.now();
  const elapsed = now - lastNominatimCall;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastNominatimCall = Date.now();
}

// ─── Geocoding: Address → Coordinates ─────────────────────────────────────
export interface GeocodingResult {
  lat: number;
  lng: number;
  displayName: string;
  type: string;
}

export async function geocode(query: string): Promise<GeocodingResult[]> {
  await nominatimThrottle();

  const params = new URLSearchParams({
    q: query,
    format: "json",
    addressdetails: "1",
    limit: "5",
    countrycodes: "in", // Prioritize India
  });

  const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
    headers: {
      "User-Agent": "WACRM-FieldForce/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) return [];

  const data = await res.json();
  return data.map((item: any) => ({
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    displayName: item.display_name,
    type: item.type || "unknown",
  }));
}

// ─── Reverse Geocoding: Coordinates → Address ─────────────────────────────
export interface ReverseGeoResult {
  address: string;
  road: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  shortAddress: string;
}

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeoResult | null> {
  await nominatimThrottle();

  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lng.toString(),
    format: "json",
    addressdetails: "1",
    zoom: "18",
  });

  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, {
    headers: {
      "User-Agent": "WACRM-FieldForce/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (data.error) return null;

  const addr = data.address || {};

  const road =
    addr.road || addr.pedestrian || addr.neighbourhood || addr.suburb || "";
  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.state_district ||
    "";
  const state = addr.state || "";
  const postcode = addr.postcode || "";
  const country = addr.country || "";

  // Build a concise short address
  const parts = [road, city, state].filter(Boolean);
  const shortAddress = parts.length > 0 ? parts.join(", ") : data.display_name;

  return {
    address: formatAddress(addr) || data.display_name,
    road,
    city,
    state,
    postcode,
    country,
    shortAddress,
  };
}

/**
 * Compose a street address the way Google writes one, from OpenStreetMap's structured parts.
 *
 * We used to hand back Nominatim's raw `display_name`, which reads
 * "Rajkot, Rajkot East Taluka, Rajkot, Gujarat, 360001, India" — the revenue-administration
 * units (taluka, county, state district) are meaningless to a sales manager, and the city
 * repeats three times. Dropping those fields and de-duplicating gives
 * "217, Raiya Rd, Chandan Park, Rajkot, Gujarat 360005, India".
 *
 * Deliberately NOT switching to Google's Geocoding API: it is billed per request and this runs
 * on hover over every point of every day. OSM has the same street data; it was only the
 * formatting that was wrong.
 */
function formatAddress(addr: Record<string, string | undefined>): string {
  const street = [addr.house_number, addr.road || addr.pedestrian]
    .filter(Boolean)
    .join(" ");

  // Order matters: narrowest first, exactly how an address is written on an envelope.
  // `county`, `state_district` and `region` are intentionally absent — those are the
  // "East Taluka" style administrative labels nobody wants to read.
  const ordered = [
    street,
    addr.neighbourhood,
    addr.suburb,
    addr.city_district,
    addr.city || addr.town || addr.village,
    addr.state,
    addr.country,
  ];

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of ordered) {
    const value = (part || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    // "Rajkot" is often both the suburb and the city; print it once.
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(value);
  }

  if (parts.length === 0) return "";

  // Postcode belongs beside the state, not as its own comma-separated element.
  if (addr.postcode && addr.state) {
    const stateIndex = parts.indexOf(addr.state);
    if (stateIndex !== -1) parts[stateIndex] = `${addr.state} ${addr.postcode}`;
  }

  return parts.join(", ");
}

// ─── Routing: Get driving directions ──────────────────────────────────────
export interface RouteResult {
  coordinates: [number, number][]; // [lat, lng] pairs for polyline
  distanceKm: number;
  durationMin: number;
  summary: string;
}

export async function getRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<RouteResult | null> {
  if (!ORS_API_KEY) {
    console.warn(
      "[geo-service] ORS_API_KEY not set — routing disabled. Set NEXT_PUBLIC_ORS_API_KEY env var.",
    );
    return null;
  }

  try {
    const res = await fetch(`${ORS_BASE}/v2/directions/driving-car`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat], // ORS uses [lng, lat]
          [to.lng, to.lat],
        ],
      }),
    });

    if (!res.ok) {
      console.error("[geo-service] ORS routing error:", res.status);
      return null;
    }

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;

    // Decode geometry — ORS returns GeoJSON coordinates [lng, lat]
    const coords: [number, number][] = route.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]], // flip to [lat, lng]
    );

    return {
      coordinates: coords,
      distanceKm: +(route.summary.distance / 1000).toFixed(2),
      durationMin: +(route.summary.duration / 60).toFixed(1),
      summary: `${(route.summary.distance / 1000).toFixed(1)} km · ${Math.round(route.summary.duration / 60)} min`,
    };
  } catch (err) {
    console.error("[geo-service] routing error:", err);
    return null;
  }
}

/**
 * Get route along multiple waypoints (for daily track visualization)
 */
export async function getMultiPointRoute(
  points: { lat: number; lng: number }[],
): Promise<RouteResult | null> {
  if (!ORS_API_KEY || points.length < 2) return null;

  // ORS limits waypoints to 50 per request — sample if needed
  let waypoints = points;
  if (waypoints.length > 50) {
    const step = Math.ceil(waypoints.length / 48);
    const sampled = [waypoints[0]];
    for (let i = step; i < waypoints.length - 1; i += step) {
      sampled.push(waypoints[i]);
    }
    sampled.push(waypoints[waypoints.length - 1]);
    waypoints = sampled;
  }

  try {
    const res = await fetch(`${ORS_BASE}/v2/directions/driving-car/geojson`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify({
        coordinates: waypoints.map((p) => [p.lng, p.lat]),
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;

    const coords: [number, number][] =
      feature.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);

    const props = feature.properties?.summary || {};

    return {
      coordinates: coords,
      distanceKm: +((props.distance || 0) / 1000).toFixed(2),
      durationMin: +((props.duration || 0) / 60).toFixed(1),
      summary: `${((props.distance || 0) / 1000).toFixed(1)} km · ${Math.round((props.duration || 0) / 60)} min`,
    };
  } catch (err) {
    console.error("[geo-service] multi-point routing error:", err);
    return null;
  }
}

// ─── In-memory cache for reverse geocoding ────────────────────────────────
const reverseCache = new Map<string, ReverseGeoResult>();

export async function reverseGeocodeWithCache(
  lat: number,
  lng: number,
): Promise<ReverseGeoResult | null> {
  // Round to ~11m precision for cache key
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (reverseCache.has(key)) return reverseCache.get(key)!;

  const result = await reverseGeocode(lat, lng);
  if (result) {
    reverseCache.set(key, result);
    // Limit cache size
    if (reverseCache.size > 500) {
      const firstKey = reverseCache.keys().next().value;
      if (firstKey) reverseCache.delete(firstKey);
    }
  }
  return result;
}
