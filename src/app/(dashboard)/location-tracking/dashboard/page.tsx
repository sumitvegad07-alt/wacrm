'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import dynamic from 'next/dynamic';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Search,
  MapPin,
  Battery,
  Calendar,
  Clock,
  ChevronRight,
  CheckCircle2,
  User,
  Activity,
  Route,
  Loader2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  reverseGeocodeWithCache,
  getMultiPointRoute,
  type RouteResult,
} from '@/lib/geo-service';
import type { RouteOverlay } from '@/components/location-tracking/map-view';

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
  const [routeOverlay, setRouteOverlay] = useState<RouteOverlay[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteResult | null>(null);
  const [timelineAddresses, setTimelineAddresses] = useState<
    Record<number, string>
  >({});
  const [userAddress, setUserAddress] = useState<string>('');
  const supabase = createClient();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    // Fetch active tracking sessions (punched in users)
    const { data: sessions } = await supabase
      .from('tracking_sessions')
      .select(
        `
        id, user_id, started_at,
        profiles ( full_name, role )
      `
      )
      .is('ended_at', null);

    if (sessions) {
      const activeUsers = sessions.map((s) => ({
        id: s.user_id,
        sessionId: s.id,
        name: (s.profiles as any)?.full_name || 'Unknown',
        role: (s.profiles as any)?.role || 'Field Staff',
        status: 'active',
        userId: s.user_id,
        startedAt: s.started_at,
        punchedIn: new Date(s.started_at).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        battery: 0,
        distance: 0,
        totalVisits: 0,
        activeDeals: 0,
        completedTasks: 0,
      }));
      setUsersData(activeUsers);
      if (activeUsers.length > 0) setSelectedUser(activeUsers[0]);
    }
  };

  useEffect(() => {
    if (selectedUser?.sessionId) {
      fetchUserPoints(
        selectedUser.sessionId,
        selectedUser.userId,
        selectedUser.startedAt
      );
      // Reset route when user changes
      setRouteOverlay([]);
      setRouteInfo(null);
      setTimelineAddresses({});
      setUserAddress('');
    }
  }, [selectedUser?.sessionId]);

  const fetchUserPoints = async (
    sessionId: string,
    userId: string,
    startedAt: string
  ) => {
    const { data: pings } = await supabase
      .from('location_pings')
      .select('*')
      .eq('session_id', sessionId)
      .order('recorded_at', { ascending: true });

    const { data: visits } = await supabase
      .from('site_visits')
      .select('*, contacts(name)')
      .eq('user_id', userId)
      .gte('check_in_at', startedAt);

    let allPoints: any[] = [];

    if (visits) {
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
        }));
      allPoints = [...allPoints, ...visitPoints];
    }

    if (pings) {
      const formattedPoints = pings.map((p: any) => ({
        lat: p.lat,
        lng: p.lng,
        type: 'ping',
        time: new Date(p.recorded_at).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        label: 'Tracked Location',
        battery: p.battery_pct,
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
          if (result) setUserAddress(result.shortAddress);
        });
      }
    }

    allPoints.sort((a, b) => a.recordedAt - b.recordedAt);
    setPointsData(allPoints);
  };

  // Fetch route from ORS
  const handleShowRoute = useCallback(async () => {
    if (pointsData.length < 2) return;
    setRouteLoading(true);
    try {
      const waypoints = pointsData.map((p) => ({ lat: p.lat, lng: p.lng }));
      const route = await getMultiPointRoute(waypoints);
      if (route) {
        setRouteOverlay([
          {
            coordinates: route.coordinates,
            color: '#6366F1',
          },
        ]);
        setRouteInfo(route);
        // Update distance for selected user
        setSelectedUser((prev: any) => ({
          ...prev,
          distance: route.distanceKm,
        }));
      }
    } catch (err) {
      console.error('Route fetch failed:', err);
    }
    setRouteLoading(false);
  }, [pointsData]);

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
                }`}
              >
                <div className="relative shrink-0">
                  <Avatar className="border-border h-8 w-8 border">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {u.name[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`border-card absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 ${u.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground'}`}
                  />
                </div>
                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-medium ${selectedUser?.id === u.id ? 'text-primary' : 'text-foreground'}`}
                  >
                    {u.name}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {u.role}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Middle (Map Area) */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Top Controls Overlay */}
        <div className="pointer-events-none absolute top-4 right-4 left-4 z-10 flex flex-wrap items-start justify-between gap-2">
          <div className="bg-background/95 border-border pointer-events-auto flex rounded-md border p-1 shadow-sm backdrop-blur-sm">
            <button
              onClick={() => setLayerType('standard')}
              className={`rounded px-3 py-1 text-xs font-medium ${layerType === 'standard' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
            >
              Map
            </button>
            <button
              onClick={() => setLayerType('satellite')}
              className={`rounded px-3 py-1 text-xs font-medium ${layerType === 'satellite' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
            >
              Satellite
            </button>
          </div>

          <div className="bg-background/95 border-border pointer-events-auto flex flex-wrap items-center gap-4 rounded-md border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur-sm">
            <button
              onClick={() => setFilters((f) => ({ ...f, visits: !f.visits }))}
              className={`flex items-center gap-1.5 transition-opacity ${!filters.visits && 'opacity-40'}`}
            >
              <div className="h-2 w-2 rounded-sm bg-green-500" /> Visits
            </button>
            <button
              onClick={() => setFilters((f) => ({ ...f, tracked: !f.tracked }))}
              className={`flex items-center gap-1.5 transition-opacity ${!filters.tracked && 'opacity-40'}`}
            >
              <div className="h-2 w-2 rounded-sm bg-blue-500" /> Tracked
            </button>
            <button
              onClick={() => setFilters((f) => ({ ...f, ends: !f.ends }))}
              className={`flex items-center gap-1.5 transition-opacity ${!filters.ends && 'opacity-40'}`}
            >
              <div className="h-2 w-2 rounded-full bg-red-500" /> Ends
            </button>
            <div className="border-border ml-2 flex items-center gap-2 border-l pl-4">
              <Calendar className="text-muted-foreground h-3.5 w-3.5" />{' '}
              <span>Today</span>
            </div>
          </div>
        </div>

        {/* Route button */}
        <div className="pointer-events-auto absolute bottom-4 left-4 z-10">
          <Button
            variant="outline"
            size="sm"
            className="bg-background/95 h-8 gap-1.5 text-xs shadow-sm backdrop-blur-sm"
            onClick={handleShowRoute}
            disabled={routeLoading || pointsData.length < 2}
          >
            {routeLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Route className="h-3.5 w-3.5" />
            )}
            {routeInfo ? routeInfo.summary : 'Show Route'}
          </Button>
        </div>

        <div className="z-0 flex-1">
          <MapView
            points={filteredPoints as any}
            layerType={layerType}
            routes={routeOverlay}
            showStraightLine={routeOverlay.length === 0}
          />
        </div>
      </div>

      {/* Right Sidebar (Details & Timeline) */}
      <div className="border-border bg-card z-10 flex w-72 shrink-0 flex-col border-l shadow-[0_0_15px_rgba(0,0,0,0.05)]">
        {/* User Summary Header */}
        <div className="border-border bg-muted/10 border-b p-4">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Avatar className="border-border h-10 w-10 border">
                <AvatarFallback className="bg-primary/10 text-primary">
                  {selectedUser?.name?.[0] || '?'}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-foreground text-sm font-semibold">
                  {selectedUser?.name || 'No user selected'}
                </h3>
                {selectedUser && (
                  <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
                    <span className="flex items-center gap-1 text-green-600">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Active
                    </span>
                    <span>•</span>
                    <span>{selectedUser.battery}% Battery</span>
                  </div>
                )}
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

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-background border-border flex items-center justify-between rounded-lg border p-2.5">
              <div>
                <div className="text-muted-foreground mb-0.5 text-[10px] font-semibold uppercase">
                  Visits Today
                </div>
                <div className="text-lg leading-none font-bold">
                  {selectedUser?.totalVisits ?? 0}
                </div>
              </div>
              <MapPin className="h-4 w-4 text-blue-500/50" />
            </div>
            <div className="bg-background border-border flex items-center justify-between rounded-lg border p-2.5">
              <div>
                <div className="text-muted-foreground mb-0.5 text-[10px] font-semibold uppercase">
                  Distance
                </div>
                <div className="text-lg leading-none font-bold">
                  {selectedUser?.distance ?? 0}{' '}
                  <span className="text-muted-foreground text-xs font-normal">
                    km
                  </span>
                </div>
              </div>
              <Activity className="h-4 w-4 text-green-500/50" />
            </div>
          </div>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
          {/* CRM Context Stats */}
          <div className="mb-6 space-y-3">
            <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              CRM Activity
            </h4>
            <div className="hover:bg-muted/50 flex items-center justify-between rounded-md p-2 transition-colors">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="text-primary/70 h-4 w-4" />
                <span className="text-foreground text-sm">Tasks Completed</span>
              </div>
              <span className="text-sm font-semibold">
                {selectedUser?.completedTasks ?? 0}
              </span>
            </div>
            <div className="hover:bg-muted/50 flex items-center justify-between rounded-md p-2 transition-colors">
              <div className="flex items-center gap-2">
                <User className="text-primary/70 h-4 w-4" />
                <span className="text-foreground text-sm">Active Deals</span>
              </div>
              <span className="text-sm font-semibold">
                {selectedUser?.activeDeals ?? 0}
              </span>
            </div>
          </div>

          {/* Timeline */}
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
                <div className="border-border bg-card ml-3 w-full rounded-lg border p-2.5 shadow-sm">
                  <div className="mb-0.5 flex items-center justify-between">
                    <time className="text-muted-foreground text-[10px] font-medium">
                      {point.time}
                    </time>
                  </div>
                  <div className="text-foreground text-xs font-medium">
                    {point.label}
                  </div>
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
    </div>
  );
}
