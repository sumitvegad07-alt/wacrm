"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';

export default function TrackReportPage() {
  const [globalSearch, setGlobalSearch] = useState("");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  
  const [reportData, setReportData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  
  const supabase = createClient();

  useEffect(() => {
    fetchReport();
  }, [fromDate, toDate]);

  const fetchReport = async () => {
    setIsLoading(true);

    const startOfDay = new Date(fromDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(toDate);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: pings } = await supabase
      .from('location_pings')
      .select(`
        id,
        user_id,
        lat,
        lng,
        accuracy,
        recorded_at,
        profiles ( full_name, role )
      `)
      .gte('recorded_at', startOfDay.toISOString())
      .lte('recorded_at', endOfDay.toISOString())
      .order('recorded_at', { ascending: true }); 

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
      const userAggregates: Record<string, any> = {};

      pings.forEach(p => {
        if (!userAggregates[p.user_id]) {
          userAggregates[p.user_id] = {
            id: p.user_id,
            name: (p.profiles as any)?.full_name || "Unknown",
            role: (p.profiles as any)?.role || "Field Staff",
            totalPings: 0,
            regular: 0,
            gpsOff: 0,
            switchOff: 0,
            critical: 0,
            mock: 0,
            distanceSum: 0,
            accuracySum: 0,
            lastPing: null
          };
        }
        
        const agg = userAggregates[p.user_id];
        agg.totalPings++;
        agg.regular++; 
        agg.accuracySum += (p.accuracy || 100);

        if (agg.lastPing && agg.lastPing.lat && agg.lastPing.lng && p.lat && p.lng) {
            agg.distanceSum += getDistanceFromLatLonInKm(agg.lastPing.lat, agg.lastPing.lng, p.lat, p.lng);
        }
        agg.lastPing = p;
      });

      const formatted = Object.values(userAggregates).map(agg => {
        return {
          ...agg,
          distance: agg.distanceSum.toFixed(2),
          accuracyPct: agg.totalPings > 0 ? (Math.min(100, agg.accuracySum / agg.totalPings)).toFixed(2) + "%" : "100.00%"
        };
      });

      formatted.sort((a, b) => a.name.localeCompare(b.name));
      setReportData(formatted);
    } else {
      setReportData([]);
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
      label: "User Role",
      type: "text",
      render: (row) => <span className="text-muted-foreground">{row.role}</span>
    },
    {
      id: "distance",
      label: "Distance (in km)",
      type: "text",
      render: (row) => <span>{row.distance}</span>
    },
    {
      id: "totalPings",
      label: "Total",
      type: "text",
      render: (row) => <span>{row.totalPings}</span>
    },
    {
      id: "regular",
      label: "Regular",
      type: "text",
      render: (row) => <span>{row.regular}</span>
    },
    {
      id: "gpsOff",
      label: "GPS Off",
      type: "text",
      visibleByDefault: false,
      render: (row) => <span>{row.gpsOff}</span>
    },
    {
      id: "switchOff",
      label: "Switch Off",
      type: "text",
      visibleByDefault: false,
      render: (row) => <span>{row.switchOff}</span>
    },
    {
      id: "critical",
      label: "Critical",
      type: "text",
      visibleByDefault: false,
      render: (row) => <span>{row.critical}</span>
    },
    {
      id: "mock",
      label: "Mock",
      type: "text",
      visibleByDefault: false,
      render: (row) => <span>{row.mock}</span>
    },
    {
      id: "accuracyPct",
      label: "Accuracy",
      type: "text",
      render: (row) => <span>{row.accuracyPct}</span>
    }
  ];

  const filteredReport = useMemo(() => {
    return reportData.filter(row => {
      if (globalSearch && !row.name.toLowerCase().includes(globalSearch.toLowerCase())) {
        return false;
      }
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === "name") {
          if (!row.name.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "role") {
          if (!row.role.toLowerCase().includes((val as string).toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [globalSearch, reportData, filterState]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Track Report</h1>
      </div>

      <div className="flex flex-col md:flex-row gap-4 bg-card p-4 rounded-xl border border-border items-end">
        <div className="relative w-full max-w-sm">
          <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1.5">User</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search user..."
              className="pl-9 bg-background border-border h-9"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
          </div>
        </div>
        
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">From Date <span className="text-red-500">*</span></label>
          <Input 
            type="date" 
            value={fromDate} 
            onChange={(e) => setFromDate(e.target.value)} 
            className="w-auto h-9 bg-background border-border"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">To Date <span className="text-red-500">*</span></label>
          <Input 
            type="date" 
            value={toDate} 
            onChange={(e) => setToDate(e.target.value)} 
            className="w-auto h-9 bg-background border-border"
          />
        </div>
        
        <Button onClick={fetchReport} className="h-9 font-semibold px-6">SEARCH</Button>
      </div>

      <DataTable
        columns={columns}
        data={filteredReport}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        storageKey="wacrm_track_report_table_columns"
        isLoading={isLoading}
        rowKey={(row) => row.id}
      />
    </div>
  );
}
