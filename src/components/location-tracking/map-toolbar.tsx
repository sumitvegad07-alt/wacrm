'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Filter, ChevronLeft, Loader2 } from 'lucide-react';
import type { MapLayerType } from './map-view';

/**
 * The Live Feed map's single control bar.
 *
 * Deliberately ONE row. An earlier version stacked a legend panel and a date-range panel on top
 * of the map, which buried the map under chrome and put a permanent range picker on screen for
 * something admins change rarely. Viewing one day is the normal case, so that gets a plain date
 * picker inline; a range lives behind the funnel, in a small "Extra Filters" panel with Apply
 * and Clear.
 *
 * There is no travelled-route toggle: the road-snapped route is always drawn.
 */

export interface MapPointFilters {
  visits: boolean;
  tracked: boolean;
  ends: boolean;
}

export interface MapToolbarProps {
  layerType: MapLayerType;
  onLayerTypeChange: (t: MapLayerType) => void;
  filters: MapPointFilters;
  onToggleFilter: (key: keyof MapPointFilters) => void;
  /** Applied range. */
  fromDate: string;
  toDate: string;
  /** Pending range shown in the Extra Filters panel. */
  draftFrom: string;
  draftTo: string;
  onDraftFromChange: (v: string) => void;
  onDraftToChange: (v: string) => void;
  /** Inline picker — viewing a single day needs no Apply step. */
  onSingleDayChange: (v: string) => void;
  onApply: () => void;
  onClear: () => void;
  canApply: boolean;
  canClear: boolean;
  loading?: boolean;
}

/** "08 Aug" — compact enough for the toolbar chip when a range is active. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function MapToolbar({
  layerType,
  onLayerTypeChange,
  filters,
  onToggleFilter,
  fromDate,
  toDate,
  draftFrom,
  draftTo,
  onDraftFromChange,
  onDraftToChange,
  onSingleDayChange,
  onApply,
  onClear,
  canApply,
  canClear,
  loading = false,
}: MapToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isSingleDay = fromDate === toDate;

  const legend: { key: keyof MapPointFilters; label: string; dot: string }[] = [
    { key: 'tracked', label: 'Tracked', dot: 'h-2 w-2 rounded-sm bg-blue-500' },
    { key: 'visits', label: 'Visits', dot: 'h-2 w-2 rounded-sm bg-green-500' },
    { key: 'ends', label: 'First & last', dot: 'h-2 w-2 rounded-full bg-red-500' },
  ];

  return (
    <div className="pointer-events-none absolute top-4 right-4 left-4 z-10 flex flex-wrap items-start justify-between gap-2">
      {/* Base layer */}
      <div className="bg-background/95 border-border pointer-events-auto flex rounded-md border p-1 shadow-sm backdrop-blur-sm">
        {(['standard', 'satellite'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onLayerTypeChange(t)}
            className={`rounded px-3 py-1 text-xs font-medium capitalize ${
              layerType === t
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {t === 'standard' ? 'Map' : 'Satellite'}
          </button>
        ))}
      </div>

      <div className="pointer-events-auto relative">
        <div className="bg-background/95 border-border flex flex-wrap items-center gap-1 rounded-md border py-1 pr-1 pl-3 text-xs font-medium shadow-sm backdrop-blur-sm">
          {legend.map(({ key, label, dot }) => (
            <button
              key={key}
              onClick={() => onToggleFilter(key)}
              aria-pressed={filters[key]}
              className={`flex items-center gap-1.5 px-1.5 py-1 transition-opacity ${
                filters[key] ? '' : 'opacity-40'
              }`}
            >
              <span className={dot} /> {label}
            </button>
          ))}

          <span className="bg-border mx-1 h-5 w-px" />

          {isSingleDay ? (
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => onSingleDayChange(e.target.value)}
              className="h-7 w-[140px] border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
              aria-label="Date"
            />
          ) : (
            <button
              onClick={() => setFiltersOpen(true)}
              className="hover:bg-muted rounded px-2 py-1"
              title="Date range — click to change"
            >
              {shortDate(fromDate)} – {shortDate(toDate)}
            </button>
          )}

          <button
            onClick={() => setFiltersOpen((o) => !o)}
            aria-label="Extra filters"
            title="Extra filters"
            className={`hover:bg-muted relative ml-0.5 rounded p-1.5 transition-colors ${
              filtersOpen || !isSingleDay ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            {/* "A filter is applied" badge. Deliberately a solid palette colour rather than a
                themed background: `bg-muted`/`bg-primary/10` both resolve to fully transparent
                on this button, so a background tint would have been an invisible signal. */}
            {!isSingleDay && (
              <span className="border-background absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border bg-blue-500" />
            )}
          </button>

          {loading && (
            <Loader2 className="text-muted-foreground mr-1 ml-0.5 h-3.5 w-3.5 animate-spin" />
          )}
        </div>

        {filtersOpen && (
          <>
            {/* Click anywhere else to dismiss. */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setFiltersOpen(false)}
              aria-hidden
            />
            <div className="bg-background border-border absolute top-full right-0 z-20 mt-2 w-64 rounded-md border p-3 shadow-lg">
              <div className="border-border mb-3 flex items-center gap-1.5 border-b pb-2">
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close filters"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold">Extra Filters</span>
              </div>

              <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                Date
              </p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-muted-foreground w-20 shrink-0 text-xs">From Date</label>
                  <Input
                    type="date"
                    value={draftFrom}
                    max={draftTo}
                    onChange={(e) => onDraftFromChange(e.target.value)}
                    className="h-8 flex-1 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-muted-foreground w-20 shrink-0 text-xs">To Date</label>
                  <Input
                    type="date"
                    value={draftTo}
                    min={draftFrom}
                    onChange={(e) => onDraftToChange(e.target.value)}
                    className="h-8 flex-1 text-xs"
                  />
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  size="sm"
                  className="h-8 flex-1 text-xs"
                  onClick={() => {
                    onApply();
                    setFiltersOpen(false);
                  }}
                  disabled={!canApply}
                >
                  Apply
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 text-xs"
                  onClick={() => {
                    onClear();
                    setFiltersOpen(false);
                  }}
                  disabled={!canClear}
                >
                  Clear
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
