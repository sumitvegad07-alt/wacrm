"use client";

import { useState, useMemo, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Image as ImageIcon, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from "@/lib/date-filters";
import { PageLayout, PageHeader, PageToolbar } from "@/components/shared";

export default function CustomerVisitsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [visitsData, setVisitsData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>({});

  const supabase = createClient();

  useEffect(() => {
    fetchVisits();
  }, [selectedDate]);

  const fetchVisits = async () => {
    setIsLoading(true);
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from('site_visits')
      .select(`
        id,
        check_in_at,
        check_out_at,
        feedback_type,
        feedback_text,
        visit_photo_url,
        target_type,
        target_id,
        contacts ( name ),
        profiles ( full_name )
      `)
      .gte('check_in_at', startOfDay.toISOString())
      .lte('check_in_at', endOfDay.toISOString())
      .order('check_in_at', { ascending: false });

    if (data) {
      // Visits are polymorphic (target_type 'Customer' | 'Lead'). The
      // contacts embed only resolves legacy contact_id rows, and PostgREST
      // can't join polymorphically — so lead names need a second lookup.
      const leadIds = data
        .filter(v => (v as any).target_type === 'Lead' && (v as any).target_id)
        .map(v => (v as any).target_id);
      const leadNames: Record<string, string> = {};
      if (leadIds.length > 0) {
        const { data: leadRows } = await supabase
          .from('leads')
          .select('id, name')
          .in('id', leadIds);
        leadRows?.forEach(l => { leadNames[l.id] = l.name; });
      }

      const formatted = data.map(v => ({
        id: v.id,
        name: (v as any).target_type === 'Lead'
          ? (leadNames[(v as any).target_id] ? `[${leadNames[(v as any).target_id]}]` : "Unknown")
          : ((v.contacts as any)?.name ? `[${(v.contacts as any).name}]` : "Unknown"),
        targetType: (v as any).target_type === 'Lead' ? 'Lead' : 'Customer',
        rawCheckIn: v.check_in_at,
        rawCheckOut: v.check_out_at,
        checkIn: new Date(v.check_in_at).toLocaleString('en-IN'),
        checkOut: v.check_out_at ? new Date(v.check_out_at).toLocaleString('en-IN') : "Active",
        duration: v.check_out_at ? Math.round((new Date(v.check_out_at).getTime() - new Date(v.check_in_at).getTime()) / 60000) + "min" : "-",
        feedbackType: v.feedback_type || "N/A",
        feedback: v.feedback_text || "-",
        visitedBy: (v.profiles as any)?.full_name || "Unknown",
        img: v.visit_photo_url || null
      }));
      setVisitsData(formatted);
    } else {
      setVisitsData([]);
    }
    setIsLoading(false);
  };

  const columns: ColumnDef<any>[] = [
    {
      id: "name",
      label: "Name",
      type: "text",
      render: (row) => (
        <span className="font-medium whitespace-nowrap inline-flex items-center gap-2">
          {row.name}
          <Badge
            className={
              row.targetType === 'Lead'
                ? 'bg-amber-600 text-white shadow-sm border-transparent text-[10px] px-1.5 font-semibold'
                : 'bg-blue-600 text-white shadow-sm border-transparent text-[10px] px-1.5 font-semibold'
            }
          >
            {row.targetType}
          </Badge>
        </span>
      )
    },
    {
      id: "checkIn",
      label: "Check In",
      type: "date",
      render: (row) => <span className="text-sm text-muted-foreground whitespace-nowrap">{row.checkIn}</span>
    },
    {
      id: "checkOut",
      label: "Check Out",
      type: "date",
      render: (row) => <span className="text-sm text-muted-foreground whitespace-nowrap">{row.checkOut}</span>
    },
    {
      id: "duration",
      label: "Duration",
      type: "text",
      render: (row) => <span className="text-sm text-muted-foreground">{row.duration}</span>
    },
    {
      id: "img",
      label: "Image",
      type: "text",
      visibleByDefault: true,
      render: (row) => (
        <div className="flex justify-center">
          {row.img ? (
            <Dialog>
              <DialogTrigger className="h-10 w-10 rounded-md overflow-hidden border border-border inline-flex hover:ring-2 hover:ring-primary transition-all" onClick={(e) => e.stopPropagation()}>
                <img src={row.img} alt="Shop" className="w-full h-full object-cover" />
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Visit Photo - {row.name}</DialogTitle>
                </DialogHeader>
                <div className="flex justify-center p-4">
                  <img src={row.img} alt="Shop" className="max-w-full rounded-md shadow-lg" />
                </div>
              </DialogContent>
            </Dialog>
          ) : (
            <div className="h-10 w-10 rounded-md border border-border inline-flex items-center justify-center bg-muted">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
      )
    },
    {
      id: "feedbackType",
      label: "Feedback Type",
      type: "select",
      options: [
        { label: "Excellent", value: "Excellent" },
        { label: "Good", value: "Good" },
        { label: "Average", value: "Average" },
        { label: "N/A", value: "N/A" },
      ],
      render: (row) => (
        <Badge 
          className={
            row.feedbackType === 'Excellent' ? 'bg-emerald-600 text-white shadow-sm border-transparent font-medium' : 
            row.feedbackType === 'Good' ? 'bg-blue-600 text-white shadow-sm border-transparent font-medium' :
            'bg-amber-600 text-white shadow-sm border-transparent font-medium'
          }
        >
          {row.feedbackType}
        </Badge>
      )
    },
    {
      id: "feedback",
      label: "Feedback",
      type: "text",
      render: (row) => <span className="max-w-[150px] truncate block">{row.feedback}</span>
    },
    {
      id: "visitedBy",
      label: "Visited By",
      type: "text",
      render: (row) => <span>{row.visitedBy}</span>
    },
    {
      id: "actions",
      label: "Action",
      visibleByDefault: true,
      render: (row) => (
        <Link href="/location-tracking/dashboard" onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs whitespace-nowrap">
            <MapPin className="h-3 w-3" /> MAP
          </Button>
        </Link>
      )
    }
  ];

  const filteredVisits = useMemo(() => {
    return visitsData.filter(row => {
      if (searchQuery && !row.name.toLowerCase().includes(searchQuery.toLowerCase()) && !row.visitedBy.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === "name") {
          if (!row.name.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "visitedBy") {
          if (!row.visitedBy.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "feedbackType") {
          if (!(val as string[]).includes(row.feedbackType)) return false;
        } else if (colId === "checkIn") {
          if (!isDateInFilter(row.rawCheckIn, val as string | string[])) return false;
        } else if (colId === "checkOut") {
          if (!isDateInFilter(row.rawCheckOut, val as string | string[])) return false;
        }
      }
      return true;
    });
  }, [searchQuery, visitsData, filterState]);

  return (
    <PageLayout>
      <PageHeader
        title="Customer Visits"
        subtitle="Track field visits, feedback, and check-in times."
        actions={
          <Input 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)} 
            className="w-auto h-9"
          />
        }
      />

      <PageToolbar
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: "Search by customer or employee...",
        }}
      />

      <DataTable
        columns={columns}
        data={filteredVisits}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        storageKey="wacrm_visits_table_columns"
        isLoading={isLoading}
        rowKey={(row) => row.id}
      />
    </PageLayout>
  );
}
