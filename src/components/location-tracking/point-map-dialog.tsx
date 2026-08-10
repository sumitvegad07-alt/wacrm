'use client';

import dynamic from 'next/dynamic';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Shows ONE captured coordinate on a map.
 *
 * Every "View Map" button in the product used to navigate to the Live Feed, which renders
 * whichever rep and date that page happens to be showing — not the row that was clicked. An
 * admin checking where a specific check-in happened got an unrelated map. This opens the actual
 * point, in place, without losing the table underneath.
 *
 * Leaflet touches `window` at import time, so the map is loaded lazily and only in the browser.
 */
const MapView = dynamic(() => import('./map-view'), {
  ssr: false,
  loading: () => (
    <div className="bg-muted text-muted-foreground flex h-full w-full animate-pulse items-center justify-center text-sm">
      Loading map…
    </div>
  ),
});

export interface MapPoint {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Heading of the dialog, e.g. the customer or rep name. */
  title: string;
  /** Shown under the title and in the marker tooltip, e.g. "10/08/2026, 02:21 pm". */
  when?: string | null;
  /** Short caption for the marker, e.g. "Check-in" or "Punch In". */
  label?: string;
  battery?: number | null;
}

export function formatLatLng(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string {
  if (lat == null || lng == null) return '-';
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

/** True when there is an actual coordinate to show, so callers can disable the button. */
export function hasPoint(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

export function PointMapDialog({
  point,
  onClose,
}: {
  point: MapPoint | null;
  onClose: () => void;
}) {
  const open = !!point && hasPoint(point.lat, point.lng);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {point?.title}
            {point?.when && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {point.when}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {open && point && (
          <>
            <div className="border-border h-[420px] w-full overflow-hidden rounded-lg border">
              <MapView
                points={[
                  {
                    lat: Number(point.lat),
                    lng: Number(point.lng),
                    type: 'current',
                    time: point.when || '',
                    dateTime: point.when || undefined,
                    label: point.label || 'Captured location',
                    battery: point.battery ?? null,
                  },
                ]}
                layerType="standard"
                showStraightLine={false}
              />
            </div>
            <p className="text-muted-foreground font-mono text-xs">
              {formatLatLng(point.lat, point.lng)}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
