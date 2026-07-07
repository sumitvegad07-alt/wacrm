"use client";

import { useState, useMemo, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import dynamic from "next/dynamic";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Search, MapPin, Battery, Calendar, Clock, ChevronRight, CheckCircle2, User, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";

const MapView = dynamic(() => import("@/components/location-tracking/map-view"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-muted flex items-center justify-center animate-pulse text-muted-foreground text-sm">Loading Map...</div>,
});

export default function LocationDashboardPage() {
  const [usersData, setUsersData] = useState<any[]>([]);
  const [pointsData, setPointsData] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [layerType, setLayerType] = useState<"standard" | "satellite">("standard");
  const [filters, setFilters] = useState({ visits: true, tracked: true, ends: true });
  const supabase = createClient();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    // Fetch active tracking sessions (punched in users)
    const { data: sessions } = await supabase
      .from('tracking_sessions')
      .select(`
        id, user_id, started_at,
        profiles ( full_name, role )
      `)
      .is('ended_at', null);

    if (sessions) {
      const activeUsers = sessions.map(s => ({
        id: s.user_id,
        sessionId: s.id,
        name: (s.profiles as any)?.full_name || "Unknown",
        role: (s.profiles as any)?.role || "Field Staff",
        status: "active",
        punchedIn: new Date(s.started_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        battery: 0,
        distance: 0,
        totalVisits: 0,
        activeDeals: 0,
        completedTasks: 0
      }));
      setUsersData(activeUsers);
      if (activeUsers.length > 0) setSelectedUser(activeUsers[0]);
    }
  };

  useEffect(() => {
    if (selectedUser?.sessionId) {
      fetchUserPoints(selectedUser.sessionId);
    }
  }, [selectedUser]);

  const fetchUserPoints = async (sessionId: string) => {
    const { data: pings } = await supabase
      .from('location_pings')
      .select('*')
      .eq('session_id', sessionId)
      .order('recorded_at', { ascending: true });

    if (pings) {
      const formattedPoints = pings.map((p: any) => ({
        lat: p.lat,
        lng: p.lng,
        type: "ping",
        time: new Date(p.recorded_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        label: "Tracked Location",
        battery: p.battery_pct
      }));
      setPointsData(formattedPoints);

      // Update battery for selected user
      if (pings.length > 0) {
        const lastPing = pings[pings.length - 1];
        if (lastPing.battery_pct != null) {
          setSelectedUser((prev: any) => ({ ...prev, battery: lastPing.battery_pct }));
        }
      }
    }
  };

  const filteredUsers = useMemo(() => {
    return usersData.filter(u => u.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [searchQuery, usersData]);

  const filteredPoints = useMemo(() => {
    return pointsData.filter(p => {
      if (p.type === 'ping' && !filters.tracked) return false;
      if (p.type === 'visit' && !filters.visits) return false;
      if (p.type === 'end' && !filters.ends) return false;
      return true;
    });
  }, [pointsData, filters]);

  return (
    <div className="flex h-[calc(100vh-2rem)] -m-4 sm:-m-6 border border-border bg-background overflow-hidden rounded-xl">
      
      {/* Left Sidebar (User List) */}
      <div className="w-64 border-r border-border bg-card flex flex-col hidden md:flex shrink-0">
        <div className="p-3 border-b border-border bg-muted/20">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search users..." 
              className="pl-8 bg-background h-9 text-sm" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="text-[11px] font-semibold text-muted-foreground px-4 py-2 mt-1 uppercase tracking-wider">Field Staff</div>
          {filteredUsers.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">No users found</div>
          ) : (
            filteredUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedUser(u as any)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 border-l-2 transition-colors ${
                  selectedUser.id === u.id 
                    ? "bg-primary/5 border-primary" 
                    : "border-transparent hover:bg-muted"
                }`}
              >
                <div className="relative shrink-0">
                  <Avatar className="h-8 w-8 border border-border">
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">{u.name[0]}</AvatarFallback>
                  </Avatar>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${u.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${selectedUser.id === u.id ? "text-primary" : "text-foreground"}`}>{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.role}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Middle (Map Area) */}
      <div className="flex-1 relative flex flex-col min-w-0">
        {/* Top Controls Overlay */}
        <div className="absolute top-4 left-4 right-4 z-10 flex flex-wrap gap-2 justify-between items-start pointer-events-none">
          <div className="bg-background/95 backdrop-blur-sm rounded-md shadow-sm border border-border p-1 pointer-events-auto flex">
            <button 
              onClick={() => setLayerType("standard")}
              className={`px-3 py-1 text-xs font-medium rounded ${layerType === "standard" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
            >
              Map
            </button>
            <button 
              onClick={() => setLayerType("satellite")}
              className={`px-3 py-1 text-xs font-medium rounded ${layerType === "satellite" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
            >
              Satellite
            </button>
          </div>
          
          <div className="bg-background/95 backdrop-blur-sm rounded-md shadow-sm border border-border px-3 py-2 pointer-events-auto flex flex-wrap items-center gap-4 text-xs font-medium">
            <button onClick={() => setFilters(f => ({...f, visits: !f.visits}))} className={`flex items-center gap-1.5 transition-opacity ${!filters.visits && "opacity-40"}`}>
              <div className="w-2 h-2 rounded-sm bg-green-500" /> Visits
            </button>
            <button onClick={() => setFilters(f => ({...f, tracked: !f.tracked}))} className={`flex items-center gap-1.5 transition-opacity ${!filters.tracked && "opacity-40"}`}>
              <div className="w-2 h-2 rounded-sm bg-blue-500" /> Tracked
            </button>
            <button onClick={() => setFilters(f => ({...f, ends: !f.ends}))} className={`flex items-center gap-1.5 transition-opacity ${!filters.ends && "opacity-40"}`}>
              <div className="w-2 h-2 rounded-full bg-red-500" /> Ends
            </button>
            <div className="pl-4 ml-2 border-l border-border flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> <span>Today</span>
            </div>
          </div>
        </div>

        <div className="flex-1 z-0">
          <MapView points={filteredPoints as any} layerType={layerType} />
        </div>
      </div>

      {/* Right Sidebar (Details & Timeline) */}
      <div className="w-72 border-l border-border bg-card flex flex-col z-10 shrink-0 shadow-[0_0_15px_rgba(0,0,0,0.05)]">
        {/* User Summary Header (Sleek) */}
        <div className="p-4 border-b border-border bg-muted/10">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border border-border">
                <AvatarFallback className="bg-primary/10 text-primary">{selectedUser?.name?.[0] || '?'}</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{selectedUser?.name || 'No user selected'}</h3>
                {selectedUser && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 text-green-600"><div className="w-1.5 h-1.5 rounded-full bg-green-500"/> Active</span>
                    <span>•</span>
                    <span>{selectedUser.battery}% Battery</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="bg-background border border-border rounded-lg p-2.5 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">Visits Today</div>
                <div className="text-lg font-bold leading-none">{selectedUser?.totalVisits ?? 0}</div>
              </div>
              <MapPin className="h-4 w-4 text-blue-500/50" />
            </div>
            <div className="bg-background border border-border rounded-lg p-2.5 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-0.5">Distance</div>
                <div className="text-lg font-bold leading-none">{selectedUser?.distance ?? 0} <span className="text-xs text-muted-foreground font-normal">km</span></div>
              </div>
              <Activity className="h-4 w-4 text-green-500/50" />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {/* CRM Context Stats */}
          <div className="mb-6 space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">CRM Activity</h4>
            <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary/70" />
                <span className="text-sm text-foreground">Tasks Completed</span>
              </div>
              <span className="text-sm font-semibold">{selectedUser?.completedTasks ?? 0}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-primary/70" />
                <span className="text-sm text-foreground">Active Deals</span>
              </div>
              <span className="text-sm font-semibold">{selectedUser?.activeDeals ?? 0}</span>
            </div>
          </div>

          {/* Timeline */}
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Location Timeline</h4>
          <div className="space-y-3 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
            {pointsData.map((point, i) => (
              <div key={i} className="relative flex items-center">
                <div className={`flex items-center justify-center w-6 h-6 rounded-full border-2 border-background text-white shrink-0 z-10 ${point.type === 'visit' ? 'bg-green-500' : point.type === 'start' ? 'bg-red-500' : 'bg-blue-500'}`} />
                <div className="ml-3 p-2.5 rounded-lg border border-border bg-card shadow-sm w-full">
                  <div className="flex justify-between items-center mb-0.5">
                    <time className="text-[10px] text-muted-foreground font-medium">{point.time}</time>
                  </div>
                  <div className="font-medium text-xs text-foreground">{point.label}</div>
                  {point.battery != null && (
                    <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <Battery className="w-3 h-3 text-green-500"/> {point.battery}%
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
