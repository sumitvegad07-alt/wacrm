'use client';

import dynamic from 'next/dynamic';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { mappedSelectionSummary, type SelectionPoint } from '@/lib/maps/selection-points';

/**
 * Shows MANY records on one map — the multi-select counterpart to
 * PointMapDialog.
 *
 * "Show on map" was per row only, so an admin comparing where a territory's
 * customers actually sit had to open them one at a time and hold the picture in
 * their head. Selecting the rows and pressing one button answers the real
 * question: are these spread across the city or clustered on one road?
 *
 * Leaflet touches `window` at import time, so the map is loaded lazily and only
 * in the browser.
 */
const MapView = dynamic(() => import('./map-view'), {
  ssr: false,
  loading: () => (
    <div className="bg-muted text-muted-foreground flex h-full w-full animate-pulse items-center justify-center text-sm">
      Loading map…
    </div>
  ),
});

export interface PointsMapSelection {
  /** Heading, e.g. "15 Customers on map". */
  title: string;
  /** The records that have a usable coordinate, in table order. */
  points: SelectionPoint[];
  /** Names of the selected records with no saved coordinate. */
  skipped: string[];
}

export function PointsMapDialog({
  selection,
  onClose,
}: {
  selection: PointsMapSelection | null;
  onClose: () => void;
}) {
  const open = !!selection && selection.points.length > 0;
  const summary = selection
    ? mappedSelectionSummary(selection.points.length, selection.skipped)
    : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">{selection?.title}</DialogTitle>
        </DialogHeader>
        {open && selection && (
          <>
            <div className="border-border h-[460px] w-full overflow-hidden rounded-lg border">
              <MapView
                points={selection.points.map((p, i) => ({
                  lat: p.lat,
                  lng: p.lng,
                  type: 'visit' as const,
                  time: '',
                  // `index` makes MapView draw a numbered teardrop pin instead of a
                  // plain dot, so a cluster can still be read against the list.
                  index: i + 1,
                  label: p.title,
                }))}
                layerType="standard"
                // These are addresses, not a journey — joining them with a line
                // would imply a route nobody travelled.
                showStraightLine={false}
              />
            </div>
            {summary && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{summary}</p>
                <p className="text-muted-foreground/80 text-xs">
                  Not on map: {selection.skipped.join(', ')}
                </p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
