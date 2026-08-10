'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Search, MapPin, AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table/data-table';
import {
  ColumnDef,
  FilterState,
} from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import {
  PING_SOURCE_OPTIONS,
  pingSourceLabel,
} from '@/lib/location/ping-source';
import { explainGap } from '@/lib/location/tracking-health';
import { ISSUE_CATALOG, type IssueCode } from '@/lib/location/tracking-issues';
import { normalizeTrackingSettings } from '@/lib/location/tracking-window';
import { useAuth } from '@/hooks/use-auth';

const PointMap = dynamic(() => import('@/components/location-tracking/map-view'), {
  ssr: false,
  loading: () => (
    <div className="bg-muted text-muted-foreground flex h-full w-full animate-pulse items-center justify-center text-sm">
      Loading map…
    </div>
  ),
});

export default function AllLocationsPage() {
  const { accountId } = useAuth();
  const [mapRow, setMapRow] = useState<any | null>(null);
  const [issueRow, setIssueRow] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [pingsData, setPingsData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});

  const supabase = createClient();

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, accountId]);

  const fetchLocations = async () => {
    if (!accountId) return;
    setIsLoading(true);

    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);
    const isoStart = startOfDay.toISOString();
    const isoEnd = endOfDay.toISOString();

    const [{ data: pings }, { data: events }, { data: snaps }, { data: acct }] =
      await Promise.all([
        supabase
          .from('location_pings')
          .select(
            `
        id,
        user_id,
        lat,
        lng,
        battery_pct,
        recorded_at,
        source,
        profiles ( full_name, role )
      `
          )
          // Trace rows exist only to make distance accurate — one every 15 seconds. They are
          // machine data, not something an admin should scroll through, so this stays the
          // human-readable set.
          .neq('source', 'trace')
          .gte('recorded_at', isoStart)
          .lte('recorded_at', isoEnd)
          .order('recorded_at', { ascending: false }),
        // Both feed the "why was there no ping" explanation on each row.
        supabase
          .from('tracking_events')
          .select('user_id, event_type, recorded_at')
          .gte('recorded_at', isoStart)
          .lte('recorded_at', isoEnd),
        supabase
          .from('device_health_snapshots')
          .select(
            'user_id, recorded_at, bg_location_permission, battery_optimization_on, low_power_mode, location_services_on, app_version',
          )
          .gte('recorded_at', isoStart)
          .lte('recorded_at', isoEnd),
        supabase.from('accounts').select('settings').eq('id', accountId).maybeSingle(),
      ]);

    const intervalMinutes = normalizeTrackingSettings(
      (acct as any)?.settings?.tracking_settings,
    ).interval_minutes;

    const byUser = (list: any[] | null) => {
      const m: Record<string, any[]> = {};
      (list || []).forEach((r: any) => (m[r.user_id] ||= []).push(r));
      return m;
    };
    const eventsByUser = byUser(events as any);
    const snapsByUser = byUser(snaps as any);

    const getDistanceFromLatLonInKm = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number
    ) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * (Math.PI / 180);
      const dLon = (lon2 - lon1) * (Math.PI / 180);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) *
          Math.cos(lat2 * (Math.PI / 180)) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const d = R * c;
      return d;
    };

    if (pings) {
      const pingsByUser: Record<string, any[]> = {};
      const ascPings = [...pings].sort(
        (a, b) =>
          new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
      );

      ascPings.forEach((p) => {
        if (!pingsByUser[p.user_id]) pingsByUser[p.user_id] = [];
        pingsByUser[p.user_id].push(p);
      });

      const formatted = pings.map((p) => {
        const userPings = pingsByUser[p.user_id];
        const index = userPings.findIndex((up) => up.id === p.id);

        let durationStr = '0min';
        let distanceKm = 0;
        let gap: { issueCode: IssueCode; minutes: number } | null = null;

        if (index > 0) {
          const prevPing = userPings[index - 1];
          const diffMs =
            new Date(p.recorded_at).getTime() -
            new Date(prevPing.recorded_at).getTime();
          const diffMins = Math.round(diffMs / 60000);
          if (diffMins > 60) {
            const hrs = Math.floor(diffMins / 60);
            const mins = diffMins % 60;
            durationStr = `${hrs}hr ${mins}min`;
          } else {
            durationStr = `${diffMins}min`;
          }

          if (prevPing.lat && prevPing.lng && p.lat && p.lng) {
            distanceKm = getDistanceFromLatLonInKm(
              prevPing.lat,
              prevPing.lng,
              p.lat,
              p.lng
            );
          }

          // Why was the phone silent between the previous ping and this one? Answered on the
          // row itself, so nobody has to open Tracking Health and infer it.
          gap = explainGap({
            fromIso: prevPing.recorded_at,
            toIso: p.recorded_at,
            events: eventsByUser[p.user_id] || [],
            snapshots: snapsByUser[p.user_id] || [],
            batteryBeforeGap: prevPing.battery_pct ?? null,
            intervalMinutes,
          });
        }

        return {
          id: p.id,
          name: (p.profiles as any)?.full_name || 'Unknown',
          role: (p.profiles as any)?.role || 'Field Staff',
          rawDate: p.recorded_at,
          date: new Date(p.recorded_at).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
          distance: distanceKm.toFixed(2),
          duration: durationStr,
          battery: p.battery_pct !== null ? `${p.battery_pct}%` : '-',
          // What produced this point. Rows written before `source` existed read as 'auto'.
          source: (p as any).source ?? 'auto',
          // Raw coordinates, so an admin can verify or paste a point anywhere. Every capture
          // type carries them — automatic, visit check-in/out, punch, first and last.
          lat: p.lat,
          lng: p.lng,
          latLng:
            p.lat != null && p.lng != null
              ? `${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}`
              : '-',
          gapIssue: gap ? ISSUE_CATALOG[gap.issueCode].title : null,
          gapCause: gap ? ISSUE_CATALOG[gap.issueCode].cause : null,
          gapFix: gap ? ISSUE_CATALOG[gap.issueCode].fix : null,
          gapSeverity: gap ? ISSUE_CATALOG[gap.issueCode].severity : null,
          gapMinutes: gap?.minutes ?? null,
        };
      });

      setPingsData(formatted);
    } else {
      setPingsData([]);
    }

    setIsLoading(false);
  };

  const columns: ColumnDef<any>[] = [
    {
      id: 'name',
      label: 'User',
      type: 'text',
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'role',
      label: 'User role',
      type: 'text',
      render: (row) => (
        <span className="text-muted-foreground">{row.role}</span>
      ),
    },
    {
      id: 'date',
      label: 'Date',
      type: 'date',
      render: (row) => <span>{row.date}</span>,
    },
    {
      id: 'distance',
      label: 'Distance (in km)',
      type: 'text',
      visibleByDefault: true,
      render: (row) => <span>{row.distance}</span>,
    },
    {
      id: 'duration',
      label: 'Duration',
      type: 'text',
      render: (row) => <span>{row.duration}</span>,
    },
    {
      id: 'battery',
      label: 'Battery level',
      type: 'text',
      visibleByDefault: true,
      render: (row) => <span>{row.battery}</span>,
    },
    {
      id: 'source',
      label: 'Type',
      type: 'select',
      visibleByDefault: true,
      options: PING_SOURCE_OPTIONS,
      render: (row) => {
        const { label, tone } = pingSourceLabel(row.source);
        return <Badge variant={tone}>{label}</Badge>;
      },
    },
    {
      id: 'latLng',
      label: 'Latitude, Longitude',
      type: 'text',
      visibleByDefault: true,
      render: (row) => (
        <span className="font-mono text-xs whitespace-nowrap">{row.latLng}</span>
      ),
    },
    {
      id: 'gapIssue',
      label: 'Tracking gap',
      type: 'text',
      visibleByDefault: true,
      render: (row) =>
        row.gapIssue ? (
          // The row's own answer to "why is there no ping for 51 minutes". Clicking opens the
          // same cause-and-fix wording Tracking Health uses, so both screens say one thing.
          <button
            onClick={() => setIssueRow(row)}
            className="inline-flex items-center gap-1 text-left text-xs font-medium text-destructive hover:underline"
          >
            <AlertTriangle className="size-3.5 shrink-0" />
            {row.gapIssue}
            <span className="text-muted-foreground font-normal">
              ({row.gapMinutes}m)
            </span>
          </button>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      id: 'actions',
      label: 'View Map',
      visibleByDefault: true,
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs whitespace-nowrap"
          // Opens THIS point, which is what the button promises. It used to navigate to the
          // Live Feed, which showed whichever rep and day that page happened to be on.
          onClick={() => setMapRow(row)}
          disabled={row.lat == null || row.lng == null}
        >
          <MapPin className="h-3 w-3" /> VIEW MAP
        </Button>
      ),
    },
  ];

  const filteredPings = useMemo(() => {
    return pingsData.filter((row) => {
      // Coordinates are searchable too — pasting a lat/lng from a dispute finds the row.
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matches =
          row.name.toLowerCase().includes(q) ||
          (row.latLng || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      for (const [colId, val] of Object.entries(filterState)) {
        if (
          val === null ||
          val === undefined ||
          val === '' ||
          (Array.isArray(val) && val.length === 0)
        )
          continue;
        if (colId === 'name') {
          if (!row.name.toLowerCase().includes((val as string).toLowerCase()))
            return false;
        } else if (colId === 'role') {
          if (!row.role.toLowerCase().includes((val as string).toLowerCase()))
            return false;
        } else if (colId === 'source') {
          if (!(val as string[]).includes(row.source)) return false;
        } else if (colId === 'latLng') {
          if (!(row.latLng || '').toLowerCase().includes((val as string).toLowerCase()))
            return false;
        } else if (colId === 'gapIssue') {
          if (
            !(row.gapIssue || '').toLowerCase().includes((val as string).toLowerCase())
          )
            return false;
        } else if (colId === 'date') {
          if (!isDateInFilter(row.rawDate, val as string | string[]))
            return false;
        }
      }
      return true;
    });
  }, [searchQuery, pingsData, filterState]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-bold tracking-tight">All Locations</h1>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-9 w-auto"
          />
        </div>
      </div>

      <div className="bg-card border-border flex flex-col gap-4 rounded-xl border p-4 sm:flex-row">
        <div className="relative w-full max-w-sm">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search by user or coordinates..."
            className="bg-background border-border pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredPings}
        filterState={filterState}
        onFilterChange={(id, val) =>
          setFilterState((prev) => ({ ...prev, [id]: val }))
        }
        // Bumped to _v2: column visibility is cached per browser, so an admin who had already
        // opened this page would never see the new coordinate and tracking-gap columns appear.
        storageKey="wacrm_all_locations_table_columns_v2"
        isLoading={isLoading}
        rowKey={(row) => row.id}
      />

      {/* This exact point, on its own map. */}
      <Dialog open={!!mapRow} onOpenChange={(open) => !open && setMapRow(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {mapRow?.name} — {mapRow?.date}
            </DialogTitle>
          </DialogHeader>
          {mapRow && (
            <>
              <div className="h-[420px] w-full overflow-hidden rounded-lg border border-border">
                <PointMap
                  points={[
                    {
                      lat: Number(mapRow.lat),
                      lng: Number(mapRow.lng),
                      type: 'current',
                      time: mapRow.date,
                      dateTime: mapRow.date,
                      label: pingSourceLabel(mapRow.source).label,
                      battery:
                        mapRow.battery === '-' ? null : parseInt(mapRow.battery, 10),
                    },
                  ]}
                  layerType="standard"
                  showStraightLine={false}
                />
              </div>
              <p className="text-muted-foreground font-mono text-xs">
                {mapRow.latLng}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Why the phone went quiet before this point — same wording as Tracking Health. */}
      <Dialog open={!!issueRow} onOpenChange={(open) => !open && setIssueRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              {issueRow?.gapIssue}
            </DialogTitle>
          </DialogHeader>
          {issueRow && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                No location was recorded for{' '}
                <span className="text-foreground font-semibold">
                  {issueRow.gapMinutes} minutes
                </span>{' '}
                before {issueRow.date}.
              </p>
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                  What happened
                </p>
                <p>{issueRow.gapCause}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                  Send this to {issueRow.name}
                </p>
                <p className="rounded-md border border-border bg-muted/40 p-3">
                  {issueRow.gapFix}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
