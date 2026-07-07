"use client";

import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, ZoomControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix for default marker icons in Next.js/Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

interface Point {
  lat: number;
  lng: number;
  type: "ping" | "visit" | "start" | "end";
  time: string;
  label?: string;
}

export type MapLayerType = "standard" | "satellite";

function MapUpdater({ points }: { points: Point[] }) {
  const map = useMap();
  const initialFitted = useRef(false);

  useEffect(() => {
    if (points.length > 0 && !initialFitted.current) {
      initialFitted.current = true;
      if (points.length === 1) {
        map.flyTo([points[0].lat, points[0].lng], 15);
      } else {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [points, map]);
  return null;
}

export default function MapView({ points, layerType = "standard" }: { points: Point[], layerType?: MapLayerType }) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return <div className="h-full w-full bg-muted animate-pulse" />;

  const center = points.length > 0 ? [points[0].lat, points[0].lng] : [21.1702, 72.8311]; // Default to Surat/Rajkot area as seen in wireframe
  const polylinePositions = points.map(p => [p.lat, p.lng] as [number, number]);

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
        <MapUpdater points={points} />
        
        {points.map((point, idx) => (
          <Marker key={idx} position={[point.lat, point.lng]}>
            <Popup>
              <div className="text-sm">
                <p className="font-bold">{point.label || `Point ${idx + 1}`}</p>
                <p className="text-muted-foreground">{point.time}</p>
                <p className="text-xs capitalize mt-1 text-primary">{point.type}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {polylinePositions.length > 1 && (
          <Polyline positions={polylinePositions} color="hsl(var(--primary))" weight={3} opacity={0.7} />
        )}
      </MapContainer>
    </div>
  );
}
