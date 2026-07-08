"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  ZoomControl,
  CircleMarker,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { reverseGeocodeWithCache, type ReverseGeoResult } from "@/lib/geo-service";

// Fix for default marker icons in Next.js/Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// ─── Custom marker icons ──────────────────────────────────────────────────
const MARKER_COLORS = {
  ping: "#3B82F6",
  visit: "#10B981",
  start: "#22D3EE",
  end: "#EF4444",
  current: "#6366F1",
};

function createColorIcon(type: string): L.DivIcon {
  const color = MARKER_COLORS[type as keyof typeof MARKER_COLORS] || "#6366F1";
  const size = type === "current" ? 16 : 12;
  return L.divIcon({
    className: "custom-div-marker",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>`,
    iconSize: [size + 6, size + 6],
    iconAnchor: [(size + 6) / 2, (size + 6) / 2],
  });
}

// ─── Types ────────────────────────────────────────────────────────────────
export interface Point {
  lat: number;
  lng: number;
  type: "ping" | "visit" | "start" | "end" | "current";
  time: string;
  label?: string;
  battery?: number | null;
}

export type MapLayerType = "standard" | "satellite";

export interface RouteOverlay {
  coordinates: [number, number][]; // [lat, lng] pairs
  color?: string;
  dashed?: boolean;
  label?: string;
}

// ─── Map auto-fit ─────────────────────────────────────────────────────────
function MapUpdater({ points, routes }: { points: Point[]; routes?: RouteOverlay[] }) {
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

  const handleClick = useCallback(async () => {
    if (address || loading) return;
    setLoading(true);
    const result = await reverseGeocodeWithCache(point.lat, point.lng);
    setAddress(result);
    setLoading(false);
  }, [point.lat, point.lng, address, loading]);

  const icon = createColorIcon(point.type);
  const typeLabel = point.type.charAt(0).toUpperCase() + point.type.slice(1);

  return (
    <Marker
      position={[point.lat, point.lng]}
      icon={icon}
      eventHandlers={{ click: handleClick }}
    >
      <Popup maxWidth={280} className="custom-marker-popup">
        <div className="space-y-1 py-1">
          <p className="font-semibold text-[13px] text-foreground">
            {point.label || `Point ${index + 1}`}
          </p>
          <p className="text-[11px] text-muted-foreground">{point.time}</p>
          <p
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: MARKER_COLORS[point.type as keyof typeof MARKER_COLORS] }}
          >
            {typeLabel}
          </p>
          {point.battery != null && (
            <p className="text-[10px] text-muted-foreground">🔋 {point.battery}%</p>
          )}
          {loading && (
            <p className="text-[10px] text-muted-foreground italic">Loading address...</p>
          )}
          {address && (
            <div className="mt-1 pt-1 border-t border-border">
              <p className="text-[11px] text-foreground leading-snug">{address.shortAddress}</p>
            </div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

// ─── Main component ──────────────────────────────────────────────────────
export default function MapView({
  points,
  layerType = "standard",
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
    return <div className="h-full w-full bg-muted animate-pulse" />;

  const center =
    points.length > 0
      ? [points[0].lat, points[0].lng]
      : [21.1702, 72.8311]; // Default to Surat
  const polylinePositions = points.map(
    (p) => [p.lat, p.lng] as [number, number],
  );

  return (
    <div className="h-full w-full z-0 relative">
      <MapContainer
        center={center as [number, number]}
        zoom={13}
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <ZoomControl position="bottomright" />
        {layerType === "standard" ? (
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
              color: "hsl(var(--primary))",
              weight: 3,
              opacity: 0.6,
              dashArray: "6, 10",
            }}
          />
        )}

        {/* ORS route overlays */}
        {routes.map((route, idx) => (
          <Polyline
            key={`route-${idx}`}
            positions={route.coordinates}
            pathOptions={{
              color: route.color || "#6366F1",
              weight: 4,
              opacity: 0.85,
              dashArray: route.dashed ? "8, 12" : undefined,
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
