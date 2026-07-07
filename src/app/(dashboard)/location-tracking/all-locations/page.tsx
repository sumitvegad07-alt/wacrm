"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin } from "lucide-react";
import Link from "next/link";
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from "@/lib/date-filters";

export default function AllLocationsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [pingsData, setPingsData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  
  const supabase = createClient();

  useEffect(() => {
    fetchLocations();
  }, [selectedDate]);

  const fetchLocations = async () => {
    setIsLoading(true);

    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: pings } = await supabase
      .from('location_pings')
      .select(`
        id,
        user_id,
        lat,
        lng,
        battery_pct,
        recorded_at,
        profiles ( full_name, role )
      `)
      .gte('recorded_at', startOfDay.toISOString())
      .lte('recorded_at', endOfDay.toISOString())
      .order('recorded_at', { ascending: false });

    const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371; 
      const dLat = (lat2 - lat1) * (Math.PI / 180);
      const dLon = (lon2 - lon1) * (Math.PI / 180);
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2); 
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
      const d = R * c; 
      return d;
    };

    if (pings) {
      const pingsByUser: Record<string, any[]> = {};
      const ascPings = [...pings].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
      
      ascPings.forEach(p => {
        if (!pingsByUser[p.user_id]) pingsByUser[p.user_id] = [];
        pingsByUser[p.user_id].push(p);
      });

      const formatted = pings.map(p => {
        const userPings = pingsByUser[p.user_id];
        const index = userPings.findIndex(up => up.id === p.id);
        
        let durationStr = "0min";
        let distanceKm = 0;

        if (index > 0) {
          const prevPing = userPings[index - 1];
          const diffMs = new Date(p.recorded_at).getTime() - new Date(prevPing.recorded_at).getTime();
          const diffMins = Math.round(diffMs / 60000);
          if (diffMins > 60) {
            const hrs = Math.floor(diffMins / 60);
            const mins = diffMins % 60;
            durationStr = `${hrs}hr ${mins}min`;
          } else {
            durationStr = `${diffMins}min`;
          }

          if (prevPing.lat && prevPing.lng && p.lat && p.lng) {
            distanceKm = getDistanceFromLatLonInKm(prevPing.lat, prevPing.lng, p.lat, p.lng);
          }
        }

        return {
          id: p.id,
          name: (p.profiles as any)?.full_name || "Unknown",
          role: (p.profiles as any)?.role || "Field Staff",
          rawDate: p.recorded_at,
          date: new Date(p.recorded_at).toLocaleString('en-IN', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
          }),
          distance: distanceKm.toFixed(2),
          duration: durationStr,
          battery: p.battery_pct !== null ? `${p.battery_pct}%` : "-",
          status: "Regular"
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
      id: "name",
      label: "User",
      type: "text",
      render: (row) => <span className="font-medium">{row.name}</span>
    },
    {
      id: "role",
      label: "User role",
      type: "text",
      render: (row) => <span className="text-muted-foreground">{row.role}</span>
    },
    {
      id: "date",
      label: "Date",
      type: "date",
      render: (row) => <span>{row.date}</span>
    },
    {
      id: "distance",
      label: "Distance (in km)",
      type: "text",
      render: (row) => <span>{row.distance}</span>
    },
    {
      id: "duration",
      label: "Duration",
      type: "text",
      render: (row) => <span>{row.duration}</span>
    },
    {
      id: "battery",
      label: "Battery level",
      type: "text",
      render: (row) => <span>{row.battery}</span>
    },
    {
      id: "status",
      label: "Status",
      type: "select",
      options: [{ label: "Regular", value: "Regular" }],
      render: (row) => (
        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">{row.status}</Badge>
      )
    },
    {
      id: "actions",
      label: "View Map",
      visibleByDefault: true,
      render: (row) => (
        <Link href="/location-tracking/dashboard">
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs whitespace-nowrap">
            <MapPin className="h-3 w-3" /> VIEW MAP
          </Button>
        </Link>
      )
    }
  ];

  const filteredPings = useMemo(() => {
    return pingsData.filter(row => {
      if (searchQuery && !row.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === "name") {
          if (!row.name.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "role") {
          if (!row.role.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "status") {
          if (!(val as string[]).includes(row.status)) return false;
        } else if (colId === "date") {
          if (!isDateInFilter(row.rawDate, val as string | string[])) return false;
        }
      }
      return true;
    });
  }, [searchQuery, pingsData, filterState]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">All Locations</h1>
        <div className="flex items-center gap-2">
          <Input 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)} 
            className="w-auto h-9"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by user..."
            className="pl-9 bg-background border-border"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredPings}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        storageKey="wacrm_all_locations_table_columns"
        isLoading={isLoading}
        rowKey={(row) => row.id}
      />
    </div>
  );
}
