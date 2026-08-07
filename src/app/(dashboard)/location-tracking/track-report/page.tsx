"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { computeFilteredDistanceKm } from '@/lib/location/distance';

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

    const [{ data: pings }, { data: events }, { data: sessions }] = await Promise.all([
      supabase
        .from('location_pings')
        .select(`
          user_id,
          lat,
          lng,
          accuracy_m,
          is_mocked,
          recorded_at,
          profiles ( full_name, role )
        `)
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString())
        .order('recorded_at', { ascending: true }),
      // "Agent went dark" signals emitted by the mobile app during a shift.
      supabase
        .from('tracking_events')
        .select('user_id, event_type')
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString()),
      // Sessions that ended abnormally = a tracking gap (phone off / OS killed the app).
      supabase
        .from('tracking_sessions')
        .select('user_id, end_reason')
        .gte('started_at', startOfDay.toISOString())
        .lte('started_at', endOfDay.toISOString()),
    ]);

    if (pings) {
      const userAggregates: Record<string, any> = {};

      const ensure = (userId: string, p?: any) => {
        if (!userAggregates[userId]) {
          userAggregates[userId] = {
            id: userId,
            name: (p?.profiles as any)?.full_name || "Unknown",
            role: (p?.profiles as any)?.role || "Field Staff",
            totalPings: 0,
            regular: 0,
            gpsOff: 0,
            switchOff: 0,
            critical: 0,
            mock: 0,
            accuracySum: 0,
            accuracyCount: 0,
            pings: [] as any[],
          };
        }
        return userAggregates[userId];
      };

      pings.forEach(p => {
        const agg = ensure(p.user_id, p);
        agg.totalPings++;
        agg.regular++;
        if (p.is_mocked) agg.mock++;
        if (p.accuracy_m != null) {
          agg.accuracySum += p.accuracy_m;
          agg.accuracyCount++;
        }
        agg.pings.push(p);
      });

      // GPS turned off mid-shift (self-reported by the app).
      (events || []).forEach((e: any) => {
        const agg = ensure(e.user_id);
        if (e.event_type === 'gps_disabled') agg.gpsOff++;
      });

      // Abnormal session ends: app killed (phone off) vs timeout (silent tracking stop).
      (sessions || []).forEach((s: any) => {
        const agg = ensure(s.user_id);
        if (s.end_reason === 'app_killed') agg.switchOff++;
        else if (s.end_reason === 'timeout') agg.critical++;
      });

      const formatted = Object.values(userAggregates).map((agg: any) => {
        const avgAccuracy = agg.accuracyCount > 0
          ? Math.round(agg.accuracySum / agg.accuracyCount)
          : null;
        return {
          ...agg,
          // Trustworthy distance: excludes low-accuracy pings + impossible GPS jumps.
          distance: computeFilteredDistanceKm(agg.pings).toFixed(2),
          accuracyLabel: avgAccuracy != null ? `${avgAccuracy} m` : "—",
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
      id: "accuracyLabel",
      label: "Avg Accuracy",
      type: "text",
      render: (row) => <span>{row.accuracyLabel}</span>
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
