'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
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
const MARKER_COLORS = {
  ping: '#3B82F6',
  visit: '#10B981',
  start: '#22D3EE',
  end: '#EF4444',
  current: '#6366F1',
};

function createColorIcon(type: string, index?: number): L.DivIcon {
  const color = MARKER_COLORS[type as keyof typeof MARKER_COLORS] || '#6366F1';
  let size = type === 'current' ? 16 : index !== undefined ? 24 : 12;
  if (type === 'visit') size = 32;

  let html = `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">`;
  if (index !== undefined && size >= 20) {
    html += `<span style="color:white;font-size:${type === 'visit' ? 13 : 11}px;font-weight:bold;line-height:1;">${index}</span>`;
  }
  html += `</div>`;

  return L.divIcon({
    className: 'custom-div-marker',
    html,
    iconSize: [size + 6, size + 6],
    iconAnchor: [(size + 6) / 2, (size + 6) / 2],
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

  const icon = createColorIcon(point.type, point.index);
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

        {/* ORS route overlays */}
        {routes.map((route, idx) => (
          <Polyline
            key={`route-${idx}`}
            positions={route.coordinates}
            pathOptions={{
              color: route.color || '#6366F1',
              weight: 4,
              opacity: 0.85,
              dashArray: route.dashed ? '8, 12' : undefined,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
