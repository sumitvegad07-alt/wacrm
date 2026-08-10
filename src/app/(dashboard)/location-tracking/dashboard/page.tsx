'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import dynamic from 'next/dynamic';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search, MapPin, Battery, ChevronLeft, ChevronRight } from 'lucide-react';
import MapToolbar from '@/components/location-tracking/map-toolbar';
import { Input } from '@/components/ui/input';
import {
  reverseGeocodeWithCache,
  getMultiPointRoute,
  type RouteResult,
} from '@/lib/geo-service';
// Type-only: map-view pulls in Leaflet, which touches `window` at import time and is why it is
// loaded with ssr:false. A value import here would drag it into the server bundle.
import type { RouteOverlay } from '@/components/location-tracking/map-view';
import { computeFilteredDistanceKm, isTrustworthyPing } from '@/lib/location/distance';
import { isManualPing, pingSourceLabel } from '@/lib/location/ping-source';

/** Colour for a visit's feedback verdict, so a bad call stands out when scanning the day. */
function feedbackTone(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('good') || t.includes('positive') || t.includes('order'))
    return 'bg-green-500/15 text-green-600';
  if (t.includes('bad') || t.includes('negative') || t.includes('lost'))
    return 'bg-red-500/15 text-red-600';
  return 'bg-amber-500/15 text-amber-600';
}

/** "₹5.4K" / "₹560" — the tile is narrow, so large values are abbreviated. */
function formatInr(amount: number): string {
  if (!amount) return '₹0';
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount)}`;
}

const MapView = dynamic(
  () => import('@/components/location-tracking/map-view'),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted text-muted-foreground flex h-full w-full animate-pulse items-center justify-center text-sm">
        Loading Map...
      </div>
    ),
  }
);

export default function LocationDashboardPage() {
  const [usersData, setUsersData] = useState<any[]>([]);
  const [pointsData, setPointsData] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [layerType, setLayerType] = useState<'standard' | 'satellite'>(
    'standard'
  );
  const [filters, setFilters] = useState({
    visits: true,
    tracked: true,
    ends: true,
  });
  // Date range for the map. Defaults to today, but any past range can be replayed — the map used
  // to be locked to the current session, so history was unreachable.
  //
  // `draft*` is what the pickers show; `fromDate`/`toDate` is what has actually been applied.
  // Splitting them means changing a date doesn't fire a query (and a routing call) per keystroke.
  const today = () => new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [draftFrom, setDraftFrom] = useState(today);
  const [draftTo, setDraftTo] = useState(today);
  /** Road-snapped path of where the rep actually drove, from OpenRouteService. Always shown. */
  const [travelRoute, setTravelRoute] = useState<RouteOverlay[]>([]);
  const [routeSummary, setRouteSummary] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  /** Guards against a slow earlier fetch landing after a newer one. See fetchUserPoints. */
  const requestIdRef = useRef(0);

  const filterDirty = draftFrom !== fromDate || draftTo !== toDate;
  const filterCleared = fromDate === today() && toDate === today();

  /** Inline toolbar picker: viewing a single day is the normal case and needs no Apply step. */
  const setSingleDay = (value: string) => {
    if (!value) return;
    setDraftFrom(value);
    setDraftTo(value);
    setFromDate(value);
    setToDate(value);
  };

  const applyDateFilter = () => {
    setFromDate(draftFrom);
    setToDate(draftTo);
  };

  const clearDateFilter = () => {
    const t = today();
    setDraftFrom(t);
    setDraftTo(t);
    setFromDate(t);
    setToDate(t);
  };
  const [timelineAddresses, setTimelineAddresses] = useState<
    Record<number, string>
  >({});
  const [userAddress, setUserAddress] = useState<string>('');
  const supabase = createClient();

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    // 1. Fetch ALL team profiles for this account
    const { data: allProfiles } = await supabase
      .from('profiles')
      // The role shown is ALWAYS the admin-created one. `account_role` is an internal security
      // value derived from that role's Full Access flag and drives RLS; it is not a label for
      // people, and showing "agent"/"owner" alongside roles the admin actually named was noise.
      .select('id, user_id, full_name, employee_roles(name)')
      .order('full_name');

    // 2. Fetch active tracking sessions (punched in users)
    const { data: sessions } = await supabase
      .from('tracking_sessions')
      .select('id, user_id, started_at')
      .is('ended_at', null);

    // Build a map of active sessions by user_id (deduplicated — take latest)
    const activeSessionMap = new Map<string, any>();
    if (sessions) {
      for (const s of sessions) {
        const existing = activeSessionMap.get(s.user_id);
        if (!existing || new Date(s.started_at) > new Date(existing.started_at)) {
          activeSessionMap.set(s.user_id, s);
        }
      }
    }

    // 3. Build user list: active users first, then offline
    const allUsers: any[] = [];
    const seenUserIds = new Set<string>();

    if (allProfiles) {
      for (const profile of allProfiles) {
        if (seenUserIds.has(profile.user_id)) continue;
        seenUserIds.add(profile.user_id);

        const session = activeSessionMap.get(profile.user_id);
        const isActive = !!session;

        allUsers.push({
          id: profile.user_id,
          sessionId: session?.id || null,
          name: profile.full_name || 'Unknown',
          role: (profile.employee_roles as any)?.name || 'No role assigned',
          status: isActive ? 'active' : 'offline',
          userId: profile.user_id,
          startedAt: session?.started_at || null,
          punchedIn: isActive
            ? new Date(session.started_at).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : null,
          battery: 0,
          distance: 0,
          totalVisits: 0,
          totalCustomers: 0,
          totalOrders: 0,
          activityTotal: 0,
          activityDone: 0,
          expenseTotal: 0,
          expenseApproved: 0,
          expensePending: 0,
        });
      }
    }

    // Sort: active first, then offline, each alphabetically
    allUsers.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return a.name.localeCompare(b.name);
    });

    setUsersData(allUsers);

    // THIS RUNS EVERY 30 SECONDS. It used to read `selectedUser` from the closure, which was
    // captured as null when the polling interval was created — so every poll re-selected the
    // first user in the list and yanked the admin off whoever they had actually clicked.
    // Reading the live value through the updater is what keeps the selection put.
    setSelectedUser((prev: any) => {
      if (!prev) return allUsers[0] ?? null;
      // Keep the selection, but refresh the live bits (a rep may have punched in or out since).
      const fresh = allUsers.find((u) => u.userId === prev.userId);
      return fresh
        ? {
            ...prev,
            status: fresh.status,
            sessionId: fresh.sessionId,
            startedAt: fresh.startedAt,
            punchedIn: fresh.punchedIn,
          }
        : prev;
    });
  };

  useEffect(() => {
    if (!selectedUser?.userId) return;

    // Wipe the previous rep's trail immediately. Leaving it on screen while the new one loads
    // is how someone ends up reading Dhaval's route under Sumit's name.
    setTimelineAddresses({});
    setUserAddress('');
    setPointsData([]);
    setTravelRoute([]);
    setRouteSummary(null);
    fetchUserPoints(selectedUser.userId, fromDate, toDate);

    // Only poll when the range actually includes today; replaying a past day is static data
    // and re-fetching it every 30 seconds just burns the routing quota.
    if (toDate < today()) return;
    const interval = setInterval(
      () => fetchUserPoints(selectedUser.userId, fromDate, toDate),
      30000
    );
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser?.userId, fromDate, toDate]);

  const fetchUserPoints = async (userId: string, from: string, to: string) => {
    // Every fetch claims a ticket. Queries + routing take a couple of seconds, so switching rep
    // or changing the range mid-flight would otherwise let the older, slower response land last
    // and overwrite the newer one.
    const reqId = ++requestIdRef.current;
    const isCurrent = () => reqId === requestIdRef.current;
    setPointsLoading(true);

    // Range, not session: an admin needs to replay any past day, and a rep who is currently
    // punched out has no session id at all.
    const rangeStart = new Date(from);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(to);
    rangeEnd.setHours(23, 59, 59, 999);
    const startStr = rangeStart.toISOString();
    const endStr = rangeEnd.toISOString();

    const { data: pings } = await supabase
      .from('location_pings')
      .select('*')
      .eq('user_id', userId)
      .gte('recorded_at', startStr)
      .lte('recorded_at', endStr)
      .order('recorded_at', { ascending: true });

    const { data: visits } = await supabase
      .from('site_visits')
      .select('*, contacts(name)')
      .eq('user_id', userId)
      .gte('check_in_at', startStr)
      .lte('check_in_at', endStr);

    // expenses.employee_id is profiles.id, not the auth user id, so resolve it first.
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    const [ordersRes, tasksRes, expensesRes] = await Promise.all([
      // ORDERS, not quotations. This tile is labelled "Orders" but was counting rows in
      // `quotations`, so a rep who booked real orders all day still read as 0. Also pulls
      // total_amount so the order value can sit beside the count.
      supabase
        .from('orders')
        .select('id, total_amount')
        .eq('user_id', userId)
        .gte('created_at', startStr)
        .lte('created_at', endStr),
      // The column is `assigned_user_id`; `assigned_to` does not exist on tasks, so this
      // request 400'd every time and Activity was permanently 0.
      supabase
        .from('tasks')
        .select('status')
        .eq('assigned_user_id', userId)
        .gte('created_at', startStr)
        .lte('created_at', endStr),
      profile
        ? supabase
            .from('expenses')
            .select('amount, status')
            .eq('employee_id', profile.id)
            .gte('created_at', startStr)
            .lte('created_at', endStr)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    let expenseTotal = 0,
      expenseApproved = 0,
      expensePending = 0;
    (expensesRes.data || []).forEach((e: any) => {
      expenseTotal += Number(e.amount) || 0;
      if (e.status === 'Approved') expenseApproved += Number(e.amount) || 0;
      if (e.status === 'Pending') expensePending += Number(e.amount) || 0;
    });

    const totalOrders = ordersRes.data?.length || 0;
    // Value of what the rep actually booked, straight off the orders they raised.
    const orderAmount = (ordersRes.data || []).reduce(
      (sum: number, o: any) => sum + (Number(o.total_amount) || 0),
      0,
    );
    const activityTotal = tasksRes.data?.length || 0;
    const activityDone =
      tasksRes.data?.filter((t) => t.status === 'Completed').length || 0;

    let allPoints: any[] = [];
    let visitCount = 0;
    let uniqueCustomers = new Set();

    if (visits) {
      visitCount = visits.length;
      visits.forEach((v) => {
        if (v.contact_id) uniqueCustomers.add(v.contact_id);
      });

      const visitPoints = visits
        .filter((v: any) => v.check_in_lat && v.check_in_lng)
        .map((v: any) => ({
          lat: v.check_in_lat,
          lng: v.check_in_lng,
          type: 'visit',
          time: new Date(v.check_in_at).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          label: v.contacts?.name
            ? `Visit: ${v.contacts.name}`
            : 'Client Visit',
          battery: null,
          recordedAt: new Date(v.check_in_at).getTime(),
          checkoutAt: v.check_out_at ? new Date(v.check_out_at).getTime() : null,
          // Everything the timeline card shows for a visit. Read straight off the visit record
          // so the panel needs no second query.
          customerName: v.contacts?.name || 'Unknown customer',
          visitedAt: new Date(v.check_in_at).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
          feedbackType: v.feedback_type || null,
          feedbackText: v.feedback_text || v.notes || null,
        }));
      allPoints = [...allPoints, ...visitPoints];
    }

    if (pings) {
      // A visit already gets its own richer marker from site_visits above (customer name,
      // duration). Drawing its ping too would stack two markers on the same doorstep.
      // Trace points are excluded as MARKERS — one every 15 seconds would bury the map — but
      // they are exactly what draws the route line and the distance below.
      const formattedPoints = pings
        .filter((p: any) => p.source !== 'trace' && !isManualPing(p.source))
        .map((p: any) => ({
          lat: p.lat,
          lng: p.lng,
          type: 'ping',
          time: new Date(p.recorded_at).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          label: pingSourceLabel(p.source).label === 'Auto'
            ? 'Tracked Location'
            : pingSourceLabel(p.source).label,
          // Full date for the map hover card; `time` stays the clock-only value the timeline uses.
          dateTime: new Date(p.recorded_at).toLocaleString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
          battery: p.battery_pct,
          mocked: p.is_mocked ?? false,
          recordedAt: new Date(p.recorded_at).getTime(),
        }));
      allPoints = [...allPoints, ...formattedPoints];

      // Update battery for selected user
      if (pings.length > 0) {
        const lastPing = pings[pings.length - 1];
        if (lastPing.battery_pct != null) {
          setSelectedUser((prev: any) => ({
            ...prev,
            battery: lastPing.battery_pct,
          }));
        }
        // Fetch address for last known location
        reverseGeocodeWithCache(lastPing.lat, lastPing.lng).then((result) => {
          if (result && isCurrent()) setUserAddress(result.shortAddress);
        });
      }
    }

    allPoints.sort((a, b) => a.recordedAt - b.recordedAt);

    // Set first and last to start and end
    const pingOnlyPoints = allPoints.filter((p) => p.type === 'ping');
    if (pingOnlyPoints.length > 0) {
      pingOnlyPoints[0].type = 'start';
      pingOnlyPoints[0].label = 'Start Point';
      pingOnlyPoints[pingOnlyPoints.length - 1].type = 'end';
      pingOnlyPoints[pingOnlyPoints.length - 1].label = 'Last Known Location';
    }

    // Add index numbers and durations
    let index = 1;
    for (let i = 0; i < allPoints.length; i++) {
      allPoints[i].index = index++;
      if (allPoints[i].type === 'visit') {
        if (allPoints[i].checkoutAt) {
          const diffMs = allPoints[i].checkoutAt - allPoints[i].recordedAt;
          const diffMins = Math.round(diffMs / 60000);
          // "0h 2m" — how long they actually stood at the customer, which is the number an
          // admin scans this list for.
          const h = Math.floor(diffMins / 60);
          allPoints[i].duration = `${h}h ${diffMins % 60}m`;
        } else {
          allPoints[i].duration = 'Ongoing';
        }
      }
    }

    // Distance uses the shared filtered calculation (drops low-accuracy pings and impossible
    // GPS jumps) so this number agrees with Tracking Health and the Postgres function, instead
    // of the raw haversine loop that used to live here and inflated it.
    const totalDistanceKm = computeFilteredDistanceKm((pings || []) as any);

    // A slower earlier request must never repaint the screen for a rep the admin has moved on from.
    if (!isCurrent()) return;

    setSelectedUser((prev: any) => ({
      ...prev,
      distance: totalDistanceKm.toFixed(2),
      totalVisits: visitCount,
      totalCustomers: uniqueCustomers.size,
      totalOrders,
      orderAmount,
      activityTotal,
      activityDone,
      expenseTotal,
      expenseApproved,
      expensePending,
    }));

    setPointsData(allPoints);
    setPointsLoading(false);

    // Snap the trail to real roads. A straight line between two pings 10 minutes apart cuts
    // through buildings and understates the journey; this shows where the rep actually drove.
    void buildTravelRoute((pings || []) as any[], reqId);
  };

  /**
   * Ask OpenRouteService for the driving path through the day's positions.
   *
   * Only trustworthy pings are used as waypoints — feeding a 1.2 km-accuracy reading to the
   * router drags the whole route to the wrong street. Falls back silently to the straight-line
   * trail (the map already draws one) when routing is unavailable or the day is too sparse.
   */
  const buildTravelRoute = async (pings: any[], reqId: number) => {
    const isCurrent = () => reqId === requestIdRef.current;
    const waypoints = pings
      .filter(isTrustworthyPing)
      .map((p) => ({ lat: p.lat as number, lng: p.lng as number }));

    if (waypoints.length < 2) {
      setTravelRoute([]);
      setRouteSummary(null);
      return;
    }

    setRouteLoading(true);
    try {
      const result: RouteResult | null = await getMultiPointRoute(waypoints);
      // Routing is the slowest step on the page, so it is the most likely to come back after
      // the admin has already clicked a different rep.
      if (!isCurrent()) return;
      if (result?.coordinates?.length) {
        // No colour set on purpose — MapView owns the route styling (green line, white casing,
        // direction arrows) so every map in the product draws a route the same way.
        setTravelRoute([
          { coordinates: result.coordinates, label: 'Travelled route' },
        ]);
        setRouteSummary(result.summary);
      } else {
        setTravelRoute([]);
        setRouteSummary(null);
      }
    } finally {
      if (isCurrent()) setRouteLoading(false);
    }
  };


  // Load address for timeline entries lazily
  const loadTimelineAddress = useCallback(
    async (index: number, lat: number, lng: number) => {
      if (timelineAddresses[index]) return;
      const result = await reverseGeocodeWithCache(lat, lng);
      if (result) {
        setTimelineAddresses((prev) => ({
          ...prev,
          [index]: result.shortAddress,
        }));
      }
    },
    [timelineAddresses]
  );

  const filteredUsers = useMemo(() => {
    return usersData.filter((u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, usersData]);

  const filteredPoints = useMemo(() => {
    return pointsData.filter((p) => {
      if (p.type === 'ping' && !filters.tracked) return false;
      if (p.type === 'visit' && !filters.visits) return false;
      if (p.type === 'end' && !filters.ends) return false;
      return true;
    });
  }, [pointsData, filters]);

  return (
    <div className="border-border bg-background -m-4 flex h-[calc(100vh-2rem)] overflow-hidden rounded-xl border sm:-m-6">
      {/* Left Sidebar (User List) */}
      <div className="border-border bg-card flex hidden w-64 shrink-0 flex-col border-r md:flex">
        <div className="border-border bg-muted/20 border-b p-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
            <Input
              placeholder="Search users..."
              className="bg-background h-9 pl-8 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="custom-scrollbar flex-1 overflow-y-auto">
          <div className="text-muted-foreground mt-1 px-4 py-2 text-[11px] font-semibold tracking-wider uppercase">
            Field Staff
          </div>
          {filteredUsers.length === 0 ? (
            <div className="text-muted-foreground p-4 text-center text-sm">
              No users found
            </div>
          ) : (
            filteredUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUser(u as any)}
                className={`flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition-colors ${
                  selectedUser?.id === u.id
                    ? 'bg-primary/5 border-primary'
                    : 'hover:bg-muted border-transparent'
                } ${u.status === 'offline' ? 'opacity-60' : ''}`}
              >
                <div className="relative shrink-0">
                  <Avatar className={`h-8 w-8 border ${u.status === 'offline' ? 'border-muted-foreground/30' : 'border-border'}`}>
                    <AvatarFallback className={`text-xs ${u.status === 'offline' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                      {u.name[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`border-card absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 ${u.status === 'active' ? 'bg-green-500' : 'bg-zinc-500'}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${selectedUser?.id === u.id ? 'text-primary' : u.status === 'offline' ? 'text-muted-foreground' : 'text-foreground'}`}
                  >
                    {u.name}
                  </p>
                  <p className={`truncate text-xs ${u.status === 'offline' ? 'text-zinc-500' : 'text-muted-foreground'}`}>
                    {u.status === 'active' ? u.role : 'Offline'}
                  </p>
                </div>
                {u.status === 'active' && (
                  <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-green-500" />
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Middle (Map Area) */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <MapToolbar
          layerType={layerType}
          onLayerTypeChange={setLayerType}
          filters={filters}
          onToggleFilter={(key) => setFilters((f) => ({ ...f, [key]: !f[key] }))}
          fromDate={fromDate}
          toDate={toDate}
          draftFrom={draftFrom}
          draftTo={draftTo}
          onDraftFromChange={setDraftFrom}
          onDraftToChange={setDraftTo}
          onSingleDayChange={setSingleDay}
          onApply={applyDateFilter}
          onClear={clearDateFilter}
          canApply={filterDirty}
          canClear={filterDirty || !filterCleared}
          loading={routeLoading || pointsLoading}
        />

        <div className="z-0 flex-1">
          <MapView
            points={filteredPoints as any}
            layerType={layerType}
            routes={travelRoute}
            // With the real route drawn, the dashed straight line is just visual noise — it only
            // appears as a fallback when routing returned nothing.
            showStraightLine={travelRoute.length === 0}
          />
        </div>
      </div>

      {/* Right Sidebar (Details & Timeline). Collapses to a rail so the map can take the full
          width — on a laptop the panel was eating a third of the screen the map needs. */}
      {panelCollapsed ? (
        <div className="border-border bg-card z-10 flex w-10 shrink-0 flex-col items-center border-l pt-4">
          <button
            onClick={() => setPanelCollapsed(false)}
            aria-label="Expand details panel"
            title="Expand details"
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span
            className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase"
            style={{ writingMode: 'vertical-rl' }}
          >
            {selectedUser?.name || 'Details'}
          </span>
        </div>
      ) : (
      <div className="border-border bg-card z-10 flex w-72 shrink-0 flex-col border-l shadow-[0_0_15px_rgba(0,0,0,0.05)]">
        <div className="border-border flex justify-end border-b px-2 py-1">
          <button
            onClick={() => setPanelCollapsed(true)}
            aria-label="Collapse details panel"
            title="Collapse details"
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1.5"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* User Summary Header */}
        <div className="border-border bg-muted/10 border-b p-4">
          <div className={`mb-4 flex items-start justify-between rounded-xl border p-3 ${selectedUser?.status === 'active' ? 'border-green-500/20 bg-green-500/10' : 'border-zinc-500/20 bg-zinc-500/10'}`}>
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
                <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                  {selectedUser?.name?.[0] || '?'}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-foreground text-sm font-bold">
                  {selectedUser?.name || 'No user selected'}
                </h3>
                {selectedUser && (
                  <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10px]">
                    <span className={`flex items-center gap-1 font-medium ${selectedUser.status === 'active' ? 'text-green-600' : 'text-zinc-500'}`}>
                      <div className={`h-1.5 w-1.5 rounded-full ${selectedUser.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-zinc-500'}`} />
                      {selectedUser.status === 'active' ? 'Active' : 'Offline'}
                    </span>
                    <span>•</span>
                    <span>{selectedUser.battery}% Battery</span>
                  </div>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg leading-none font-bold ${selectedUser?.status === 'active' ? 'text-green-600' : 'text-zinc-500'}`}>
                {selectedUser?.distance ?? 0}{' '}
                <span className="text-muted-foreground text-[10px] font-normal uppercase">
                  km
                </span>
              </div>
              {/* ONE distance only. Showing the straight-line total beside the road-route total
                  gave two different "km" for the same day and left admins unable to say which
                  was right. This is the figure Tracking Health and the reports use, so the whole
                  product agrees. The road route is still drawn on the map, just not as a rival
                  number. Which of the two should be canonical is a pending product decision. */}
              <div className="text-muted-foreground mt-1 text-[10px] leading-tight">
                travelled
              </div>
            </div>
          </div>

          {/* Address */}
          {userAddress && (
            <div className="bg-background border-border mb-3 flex items-start gap-2 rounded-lg border p-2">
              <MapPin className="text-primary/70 mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="text-muted-foreground text-[11px] leading-snug">
                {userAddress}
              </p>
            </div>
          )}

          <div className="border-border mb-4 grid grid-cols-4 gap-2 border-b pb-4">
            <div className="text-center">
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase">
                Visit
              </div>
              <div className="text-lg font-bold">
                {selectedUser?.totalVisits ?? 0}
              </div>
            </div>
            <div className="border-border border-l text-center">
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase">
                Customers
              </div>
              <div className="text-lg font-bold">
                {selectedUser?.totalCustomers ?? 0}
              </div>
            </div>
            <div className="border-border border-l text-center">
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase">
                Orders
              </div>
              <div className="text-lg font-bold text-green-600">
                {selectedUser?.totalOrders ?? 0}
              </div>
            </div>
            <div className="border-border border-l text-center">
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase">
                Order Amt
              </div>
              <div className="text-sm leading-tight font-bold text-green-600">
                {formatInr(selectedUser?.orderAmount ?? 0)}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <h4 className="text-primary mb-2 flex items-center justify-between text-[11px] font-semibold tracking-wide uppercase">
              Activity
              <div className="bg-border ml-2 h-px flex-1"></div>
            </h4>
            <div className="bg-muted/20 border-border/50 flex items-center justify-between rounded-lg border p-2">
              <div className="flex-1 text-center">
                <div className="text-muted-foreground text-[9px] font-semibold uppercase">
                  Total
                </div>
                <div className="text-sm font-bold">
                  {selectedUser?.activityTotal ?? 0}
                </div>
              </div>
              <div className="border-border/50 flex-1 border-l text-center">
                <div className="text-muted-foreground text-[9px] font-semibold uppercase">
                  Done
                </div>
                <div className="text-sm font-bold text-green-600">
                  {selectedUser?.activityDone ?? 0}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h4 className="mb-2 flex items-center justify-between text-[11px] font-semibold tracking-wide text-blue-500 uppercase">
              Expense
              <div className="bg-border ml-2 h-px flex-1"></div>
            </h4>
            <div className="bg-muted/20 border-border/50 flex items-center justify-between rounded-lg border p-2">
              <div className="flex-1 text-center">
                <div className="text-muted-foreground text-[9px] font-semibold uppercase">
                  Total
                </div>
                <div className="text-xs font-bold">
                  ₹{selectedUser?.expenseTotal ?? 0}
                </div>
              </div>
              <div className="border-border/50 flex-1 border-l text-center">
                <div className="text-muted-foreground text-[9px] font-semibold uppercase">
                  Approved
                </div>
                <div className="text-xs font-bold text-green-600">
                  ₹{selectedUser?.expenseApproved ?? 0}
                </div>
              </div>
              <div className="border-border/50 flex-1 border-l text-center">
                <div className="text-muted-foreground text-[9px] font-semibold uppercase">
                  Pending
                </div>
                <div className="text-xs font-bold text-orange-500">
                  ₹{selectedUser?.expensePending ?? 0}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Timeline lives in its OWN scroll area. It used to sit inside the summary block, which
            had no overflow of its own, so a day with more than a handful of points simply ran
            off the bottom of the screen and could not be reached at all. */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
          <h4 className="text-muted-foreground mb-4 text-xs font-semibold tracking-wider uppercase">
            Location Timeline
          </h4>
          <div className="before:via-border relative space-y-3 before:absolute before:inset-0 before:ml-[11px] before:h-full before:w-0.5 before:-translate-x-px before:bg-gradient-to-b before:from-transparent before:to-transparent">
            {pointsData.map((point, i) => (
              <div
                key={i}
                className="relative flex cursor-pointer items-center"
                onMouseEnter={() =>
                  loadTimelineAddress(i, point.lat, point.lng)
                }
              >
                <div
                  className={`border-background z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-white ${point.type === 'visit' ? 'bg-green-500' : point.type === 'start' ? 'bg-red-500' : 'bg-blue-500'}`}
                />
                <div
                  className={`ml-3 w-full min-w-0 rounded-lg border p-2.5 shadow-sm ${
                    point.type === 'visit'
                      ? // A customer visit is what the day was for, so it is the one entry that
                        // gets real emphasis instead of reading like another breadcrumb.
                        'border-l-4 border-green-500/60 border-l-green-500 bg-green-500/[0.07]'
                      : 'border-border bg-card'
                  }`}
                >
                  {point.type === 'visit' ? (
                    /* A visit is the substance of the day, so it gets the full record rather
                       than a one-line label: who, when, how long, and what came of it. */
                    <>
                      <p className="text-foreground text-[13px] leading-snug font-semibold break-words">
                        {point.customerName}
                      </p>
                      <time className="text-muted-foreground mt-0.5 block text-[10px]">
                        {point.visitedAt}
                      </time>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="bg-muted text-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold">
                          ⏱ {point.duration}
                        </span>
                        {point.feedbackType && (
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${feedbackTone(point.feedbackType)}`}
                          >
                            {point.feedbackType}
                          </span>
                        )}
                      </div>
                      {point.feedbackText && (
                        <p className="text-muted-foreground mt-1.5 text-[11px] leading-snug break-words">
                          {point.feedbackText}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mb-0.5 flex items-center justify-between">
                        <time className="text-muted-foreground text-[10px] font-medium">
                          {point.time}
                        </time>
                      </div>
                      <div className="text-foreground text-xs font-medium">
                        {point.label}
                      </div>
                    </>
                  )}
                  {timelineAddresses[i] && (
                    <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[10px]">
                      <MapPin className="text-primary/60 h-2.5 w-2.5" />
                      {timelineAddresses[i]}
                    </div>
                  )}
                  {point.battery != null && (
                    <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[10px]">
                      <Battery className="h-3 w-3 text-green-500" />{' '}
                      {point.battery}%
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
