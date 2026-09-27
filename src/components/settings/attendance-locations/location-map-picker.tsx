'use client';

// The map half of the Attendance Location form: drop a pin, see the fence.
//
// Loaded through next/dynamic with ssr:false by its parent — Leaflet touches
// `window` at import time, which is also why map-view.tsx is imported that way.
//
// Drawing the radius as a real circle is the point of having a map here at all:
// "100 m" means nothing until the admin sees that it does not reach the gate.

import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Same CDN icon fix map-view.tsx applies — without it Leaflet asks for marker
// images at a path Next.js does not serve and the pin renders as a broken image.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

/** Click anywhere to move the pin — the fastest way to place a site by eye. */
function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

/**
 * Recentre when the coordinates change from outside the map (address search,
 * "use my location", or typing lat/lng), but NOT on every render — panning the
 * map out from under an admin who is dragging it would be maddening.
 */
function Recentre({ lat, lng, zoomTo }: { lat: number; lng: number; zoomTo: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoomTo ? Math.max(map.getZoom(), 16) : map.getZoom());
  }, [lat, lng, zoomTo, map]);
  return null;
}

export interface LocationMapPickerProps {
  lat: number;
  lng: number;
  radiusM: number;
  /** Fired when the admin clicks the map or drags the pin. */
  onPick: (lat: number, lng: number) => void;
  /** Bumped by the parent when the coordinates came from outside the map. */
  recentreKey?: number;
}

export default function LocationMapPicker({
  lat,
  lng,
  radiusM,
  onPick,
  recentreKey = 0,
}: LocationMapPickerProps) {
  const centre = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);

  return (
    <div className="h-64 w-full overflow-hidden rounded-md border border-border">
      <MapContainer center={centre} zoom={16} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPlace onPick={onPick} />
        <Recentre lat={lat} lng={lng} zoomTo={recentreKey > 0} />
        <Circle
          center={centre}
          radius={radiusM}
          pathOptions={{ color: '#0A5BFF', fillColor: '#0A5BFF', fillOpacity: 0.12, weight: 2 }}
        />
        <Marker
          position={centre}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const { lat: newLat, lng: newLng } = (e.target as L.Marker).getLatLng();
              onPick(newLat, newLng);
            },
          }}
        />
      </MapContainer>
    </div>
  );
}
