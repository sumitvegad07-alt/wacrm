'use client';

import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  Polyline,
  useMap,
  ZoomControl,
  CircleMarker,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  reverseGeocodeWithCache,
  type ReverseGeoResult,
} from '@/lib/geo-service';

// Fix for default marker icons in Next.js/Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// ─── Custom marker icons ──────────────────────────────────────────────────
/** Travelled route. Green reads as "this is the path" against blue point markers. */
export const ROUTE_GREEN = '#16A34A';

const MARKER_COLORS = {
  ping: '#3B82F6',
  visit: '#10B981',
  start: '#22D3EE',
  end: '#EF4444',
  current: '#6366F1',
};

/**
 * Numbered teardrop pin, matching the marker style the founder asked for.
 *
 * A pin beats a plain dot for two reasons that matter on a dense city map: its tip marks the
 * exact coordinate (a circle centred on the point covers it), and the number inside gives the
 * sequence, so criss-crossing lines can still be read in order. Colours are unchanged, so the
 * existing legend still applies.
 */
function createColorIcon(
  type: string,
  index?: number,
  opts?: { mocked?: boolean; stale?: boolean },
): L.DivIcon {
  // A suspect (mock-GPS) point is drawn red; a stale point (agent gone dark) is greyed out.
  // These win over the normal type colour so trust problems are visible at a glance.
  const color = opts?.mocked
    ? '#EF4444'
    : opts?.stale
      ? '#94A3B8'
      : MARKER_COLORS[type as keyof typeof MARKER_COLORS] || '#6366F1';

  // Unnumbered points stay small dots — a pin for every breadcrumb would bury the map.
  if (index === undefined) {
    const size = type === 'current' ? 16 : 12;
    return L.divIcon({
      className: 'custom-div-marker',
      html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>`,
      iconSize: [size + 4, size + 4],
      iconAnchor: [(size + 4) / 2, (size + 4) / 2],
    });
  }

  const w = type === 'visit' ? 34 : 30;
  const h = Math.round(w * 1.36);
  const stroke = opts?.mocked ? '#FCA5A5' : '#FFFFFF';
  const label = String(index);
  // Shrink the digits as the number grows so three digits still fit inside the disc.
  const fontSize = label.length > 2 ? 9 : label.length > 1 ? 11 : 12;

  const html = `
    <svg width="${w}" height="${h}" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg"
         style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4));display:block;">
      <path d="M14 0.5C6.5 0.5 0.5 6.5 0.5 14c0 10.2 13.5 23.5 13.5 23.5S27.5 24.2 27.5 14C27.5 6.5 21.5 0.5 14 0.5z"
            fill="${color}" stroke="${stroke}" stroke-width="1.75"/>
      <circle cx="14" cy="14" r="8.5" fill="#FFFFFF" fill-opacity="0.95"/>
      <text x="14" y="14" text-anchor="middle" dominant-baseline="central"
            font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}"
            font-weight="700" fill="${color}">${label}</text>
    </svg>`;

  return L.divIcon({
    className: 'custom-div-marker',
    html,
    iconSize: [w, h],
    // The pin's TIP is the coordinate, so anchor at bottom-centre.
    iconAnchor: [w / 2, h],
  });
}

/** Initial bearing from one coordinate to the next, in degrees clockwise from north. */
function bearingDeg(from: [number, number], to: [number, number]): number {
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

/**
 * Evenly spaced direction arrows along a route.
 *
 * The route needed these more than it needed a different colour: with lines criss-crossing a
 * city you cannot otherwise tell whether a rep went north then south or the reverse, which is
 * the first thing anyone asks when reviewing a day.
 */
function arrowsAlong(
  coords: [number, number][],
  count = 12,
): { pos: [number, number]; deg: number }[] {
  if (coords.length < 2) return [];
  const step = Math.max(1, Math.floor(coords.length / (count + 1)));
  const out: { pos: [number, number]; deg: number }[] = [];
  for (let i = step; i < coords.length - 1; i += step) {
    out.push({ pos: coords[i], deg: bearingDeg(coords[i], coords[i + 1]) });
  }
  return out;
}

function arrowIcon(deg: number, color: string): L.DivIcon {
  return L.divIcon({
    className: 'route-arrow',
    // rotate(deg) points the glyph along the bearing; the glyph itself points north at 0.
    html: `<div style="transform:rotate(${deg}deg);width:16px;height:16px;line-height:16px;text-align:center;">
             <svg width="16" height="16" viewBox="0 0 16 16" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));">
               <path d="M8 1 L13 13 L8 10.2 L3 13 Z" fill="${color}" stroke="#FFFFFF" stroke-width="1"/>
             </svg>
           </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// ─── Types ────────────────────────────────────────────────────────────────
export interface Point {
  lat: number;
  lng: number;
  type: 'ping' | 'visit' | 'start' | 'end' | 'current';
  time: string;
  label?: string;
  battery?: number | null;
  index?: number;
  duration?: string;
  /** Location reported as mocked/spoofed GPS — drawn red with a "suspect" warning. */
  mocked?: boolean;
  /** Agent has gone dark (no recent ping during an active session) — drawn greyed. */
  stale?: boolean;
  /** Human "last seen X min ago" string for the tooltip. */
  lastSeen?: string;
}

export type MapLayerType = 'standard' | 'satellite';

export interface RouteOverlay {
  coordinates: [number, number][]; // [lat, lng] pairs
  color?: string;
  dashed?: boolean;
  label?: string;
}

// ─── Map auto-fit ─────────────────────────────────────────────────────────
function MapUpdater({
  points,
  routes,
}: {
  points: Point[];
  routes?: RouteOverlay[];
}) {
  const map = useMap();
  const initialFitted = useRef(false);

  useEffect(() => {
    const allCoords: [number, number][] = [
      ...points.map((p) => [p.lat, p.lng] as [number, number]),
      ...(routes?.flatMap((r) => r.coordinates) || []),
    ];

    if (allCoords.length > 0 && !initialFitted.current) {
      initialFitted.current = true;
      if (allCoords.length === 1) {
        map.flyTo(allCoords[0], 15);
      } else {
        const bounds = L.latLngBounds(allCoords);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }
    }
  }, [points, routes, map]);
  return null;
}

// ─── Address popup on click ──────────────────────────────────────────────
function AddressMarker({ point, index }: { point: Point; index: number }) {
  const [address, setAddress] = useState<ReverseGeoResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleHover = useCallback(async () => {
    if (address || loading) return;
    setLoading(true);
    const result = await reverseGeocodeWithCache(point.lat, point.lng);
    setAddress(result);
    setLoading(false);
  }, [point.lat, point.lng, address, loading]);

  const icon = createColorIcon(point.type, point.index, {
    mocked: point.mocked,
    stale: point.stale,
  });
  const typeLabel = point.type.charAt(0).toUpperCase() + point.type.slice(1);

  return (
    <Marker
      position={[point.lat, point.lng]}
      icon={icon}
      eventHandlers={{ mouseover: handleHover }}
    >
      <Tooltip direction="top" offset={[0, -15]} opacity={1} className="custom-marker-tooltip bg-white border border-slate-200 shadow-xl rounded-lg p-0">
        {point.type === 'visit' ? (
          <div className="space-y-2 py-1 px-2 w-56 text-left">
            <h4 className="text-slate-900 border-slate-200 mb-1 border-b pb-1 text-sm leading-tight font-bold">
              {point.label || 'Customer Visit'}
            </h4>
            {address ? (
              <p className="text-slate-600 text-[11px] leading-snug whitespace-normal">
                <span className="text-slate-900 font-medium">Address:</span>{' '}
                {address.shortAddress}
              </p>
            ) : (
              <p className="text-slate-500 text-[11px] italic">
                {loading ? 'Loading address...' : 'Address unknown'}
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold uppercase">
                  Date
                </span>
                <span className="text-slate-900 font-medium">{point.time}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold uppercase">
                  Duration
                </span>
                <span className="text-slate-900 font-medium">
                  {point.duration || 'N/A'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1 py-1 px-1 text-left">
            <p className="text-slate-900 text-[13px] font-semibold m-0">
              {point.label || `Point ${index + 1}`}
            </p>
            <p className="text-slate-500 text-[11px] m-0">{point.time}</p>
            <p
              className="text-[10px] font-bold tracking-wide uppercase m-0"
              style={{
                color: MARKER_COLORS[point.type as keyof typeof MARKER_COLORS],
              }}
            >
              {typeLabel}
            </p>
            {point.battery != null && (
              <p className="text-muted-foreground text-[10px]">
                🔋 {point.battery}%
              </p>
            )}
            {point.lastSeen && (
              <p
                className="text-[10px] m-0"
                style={{ color: point.stale ? '#EF4444' : '#64748B' }}
              >
                {point.stale ? '⚠ went dark — ' : ''}last seen {point.lastSeen}
              </p>
            )}
            {point.mocked && (
              <p className="text-[10px] font-bold m-0" style={{ color: '#EF4444' }}>
                ⚠ Suspect location (mock GPS)
              </p>
            )}
            {loading && (
              <p className="text-muted-foreground text-[10px] italic">
                Loading address...
              </p>
            )}
            {address && (
              <div className="border-border mt-1 border-t pt-1">
                <p className="text-foreground text-[11px] leading-snug">
                  {address.shortAddress}
                </p>
              </div>
            )}
          </div>
        )}
      </Tooltip>
    </Marker>
  );
}

// ─── Main component ──────────────────────────────────────────────────────
export default function MapView({
  points,
  layerType = 'standard',
  routes = [],
  showStraightLine = true,
}: {
  points: Point[];
  layerType?: MapLayerType;
  routes?: RouteOverlay[];
  showStraightLine?: boolean;
}) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted)
    return <div className="bg-muted h-full w-full animate-pulse" />;

  const center =
    points.length > 0 ? [points[0].lat, points[0].lng] : [21.1702, 72.8311]; // Default to Surat
  const polylinePositions = points.map(
    (p) => [p.lat, p.lng] as [number, number]
  );

  return (
    <div className="relative z-0 h-full w-full">
      <MapContainer
        center={center as [number, number]}
        zoom={13}
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <ZoomControl position="bottomright" />
        {layerType === 'standard' ? (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        )}
        <MapUpdater points={points} routes={routes} />

        {/* Markers with address popup */}
        {points.map((point, idx) => (
          <AddressMarker key={idx} point={point} index={idx} />
        ))}

        {/* Straight-line polyline (GPS trail) */}
        {showStraightLine && polylinePositions.length > 1 && (
          <Polyline
            positions={polylinePositions}
            pathOptions={{
              color: 'hsl(var(--primary))',
              weight: 3,
              opacity: 0.6,
              dashArray: '6, 10',
            }}
          />
        )}

        {/* Travelled route: a white casing under the coloured line keeps it legible over both
            the street map and satellite imagery, then arrows show the direction of travel. */}
        {routes.map((route, idx) => {
          const color = route.color || ROUTE_GREEN;
          return (
            <Fragment key={`route-${idx}`}>
              <Polyline
                positions={route.coordinates}
                pathOptions={{
                  color: '#FFFFFF',
                  weight: 8,
                  opacity: 0.7,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              <Polyline
                positions={route.coordinates}
                pathOptions={{
                  color,
                  weight: 4.5,
                  opacity: 0.95,
                  dashArray: route.dashed ? '8, 12' : undefined,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              {arrowsAlong(route.coordinates).map((a, i) => (
                <Marker
                  key={`arrow-${idx}-${i}`}
                  position={a.pos}
                  icon={arrowIcon(a.deg, color)}
                  interactive={false}
                />
              ))}
            </Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
