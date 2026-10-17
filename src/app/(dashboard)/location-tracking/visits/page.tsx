"use client";

import { useCallback, useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDataScope } from "@/hooks/use-data-scope";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Image as ImageIcon, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyDateFilter, applyInFilter, applyTextFilter, applyExtraColumnFilters } from '@/lib/table/apply-filters';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { extraColumns, type ExtraColumnSpec } from '@/lib/table/extra-columns';
import { isDateInFilter } from "@/lib/date-filters";
import { PageLayout, PageHeader, PageToolbar } from "@/components/shared";
import {
  PointMapDialog,
  formatLatLng,
  hasPoint,
  type MapPoint,
} from "@/components/location-tracking/point-map-dialog";

/** Stored visits fields with no hand-written column, shown via Manage Column. */
const VISIT_EXTRA_COLUMNS: readonly ExtraColumnSpec<any>[] = [
      ['notes', 'Visit Notes', 'text'],
      ['target_type', 'Visited', 'text'],
      ['check_in_method', 'Check-in Method', 'text'],
      ['check_in_distance_m', 'Check-in Distance (m)', 'number'],
      ['check_out_distance_m', 'Check-out Distance (m)', 'number'],
];

export default function CustomerVisitsPage() {
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);
  // No default date: the page opens showing recent visits across all days.
  // Picking a date narrows to that day; clearing it returns to "all".
  const [selectedDate, setSelectedDate] = useState('');
  // _v2: saved column layouts would otherwise hide the new coordinate columns.
  const tableView = useTableView("wacrm_visits_table_columns_v2", {});
  const { filterState } = tableView;

  const supabase = createClient();
  const scope = useDataScope();
  const router = useRouter();

  /**
   * One page of visits, searched and filtered by the database.
   *
   * This screen used to pull 500 visits and filter them in the browser — a hard
   * cap that also meant older visits simply could not be reached. site_visits
   * is the largest table in the app (24,310 rows and growing with every visit
   * every rep makes), so customer_name, visited_by_name and search_text are
   * columns on the row now (migration 20261012110000).
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      // Directional data-scoping (app-level; RLS is the real boundary).
      let q = scope.apply(
        sb
          .from('site_visits')
          .select(
            `id, check_in_at, check_out_at, feedback_type, feedback_text, visit_photo_url,
             target_type, target_id, check_in_lat, check_in_lng, check_out_lat, check_out_lng,
             customer_name, visited_by_name, contacts ( name, company )`,
            { count: 'exact' },
          ),
        'user_id',
      );

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      q = applyInFilter(q, 'customer_name', filters.name);
      q = applyInFilter(q, 'visited_by_name', filters.visitedBy);
      q = applyInFilter(q, 'feedback_type', filters.feedbackType);
      // The Feedback column was offered as a filter and never wired.
      q = applyTextFilter(q, 'feedback_text', filters.feedback);
      q = applyDateFilter(q, 'check_in_at', filters.checkIn);
      q = applyDateFilter(q, 'check_out_at', filters.checkOut);

      // The toolbar's date picker: empty means "all recent visits".
      if (selectedDate) {
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);
        q = q.gte('check_in_at', startOfDay.toISOString()).lte('check_in_at', endOfDay.toISOString());
      }

      // The columns Manage Column offers for the rest of the stored fields.

      q = applyExtraColumnFilters(q, filters, VISIT_EXTRA_COLUMNS);


      return q.order('check_in_at', { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [scope, selectedDate],
  );

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    enabled: scope.ready,
    deps: [scope.key, selectedDate],
  });

  const fetchVisits = table.reload;
  const isLoading = table.loading;

  /**
   * Lead names for the rows on screen.
   *
   * Visits are polymorphic (target_type 'Customer' | 'Lead') and PostgREST
   * cannot join polymorphically, so lead rows still need a lookup — but only
   * for the twenty rows on this page, not for every visit in the account.
   */
  const [leadInfo, setLeadInfo] = useState<Record<string, { name: string; person: string }>>({});
  const leadIdsKey = useMemo(
    () =>
      table.rows
        .filter((v) => (v as Record<string, unknown>).target_type === 'Lead' && (v as Record<string, unknown>).target_id)
        .map((v) => String((v as Record<string, unknown>).target_id))
        .join(','),
    [table.rows],
  );
  useEffect(() => {
    if (!leadIdsKey) { setLeadInfo({}); return; }
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from('leads').select('id, name, company, contact_person').in('id', leadIdsKey.split(','));
      if (!alive) return;
      const map: Record<string, { name: string; person: string }> = {};
      (data || []).forEach((l: { id: string; name: string; company: string | null; contact_person: string | null }) => {
        // Lead the row with the firm, as the customers list does.
        map[l.id] = { name: l.company || l.name, person: l.contact_person || '' };
      });
      setLeadInfo(map);
    })();
    return () => { alive = false; };
  }, [leadIdsKey, supabase]);

  const toRow = useCallback(
    (v: Record<string, any>) => {
      const isLead = v.target_type === 'Lead';
      const lead = isLead ? leadInfo[v.target_id] : undefined;
      // Show the COMPANY here, not the contact person. A visit listed as
      // "Laxmi mittal" when the customer is "Brahmani casting" is the same
      // record under two names, and nobody can tell which to ask about.
      const display = isLead ? lead?.name : v.customer_name;
      return {
        id: v.id,
        name: display ? `[${display}]` : 'Unknown',
        contactPerson: isLead ? (lead?.person || '-') : (v.contacts?.name || '-'),
        targetType: isLead ? 'Lead' : 'Customer',
        rawCheckIn: v.check_in_at,
        rawCheckOut: v.check_out_at,
        checkIn: new Date(v.check_in_at).toLocaleString('en-IN'),
        checkOut: v.check_out_at ? new Date(v.check_out_at).toLocaleString('en-IN') : 'Active',
        duration: v.check_out_at
          ? Math.round((new Date(v.check_out_at).getTime() - new Date(v.check_in_at).getTime()) / 60000) + 'min'
          : '-',
        feedbackType: v.feedback_type || 'N/A',
        feedback: v.feedback_text || '-',
        visitedBy: v.visited_by_name || 'Unknown',
        img: v.visit_photo_url || null,
        checkInLat: v.check_in_lat,
        checkInLng: v.check_in_lng,
        checkOutLat: v.check_out_lat,
        checkOutLng: v.check_out_lng,
      };
    },
    [leadInfo],
  );

  const visitsData = useMemo(
    () => table.rows.map((v) => toRow(v as Record<string, any>)),
    [table.rows, toRow],
  );

  const exportAll = useCallback(async () => {
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return { rows: rows.map((v) => toRow(v as Record<string, any>)), truncated };
  }, [supabase, buildQuery, table.search, filterState, toRow]);


  const columns: ColumnDef<any>[] = [
    {
      id: "name",
      label: "Name",
      type: "select",
      valueSource: { kind: "distinct", module: "visit", column: "customer_name" },
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
      id: "contactPerson",
      label: "Contact Person",
      // Derived for display; site_visits has no column to filter on.
      render: (row) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">{row.contactPerson}</span>
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
      // Derived for display; site_visits has no column to filter on.
      render: (row) => <span className="text-sm text-muted-foreground">{row.duration}</span>
    },
    {
      id: "img",
      label: "Image",
      // A map point or a photo, not text you can search.
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
      type: "select",
      valueSource: { kind: "distinct", module: "visit", column: "visited_by_name" },
      render: (row) => <span>{row.visitedBy}</span>
    },
    {
      id: "checkInLatLng",
      label: "Check-in location",
      // A map point or a photo, not text you can search.
      render: (row) => (
        <span className="font-mono text-xs whitespace-nowrap">{row.checkInLatLng}</span>
      )
    },
    {
      id: "checkOutLatLng",
      label: "Check-out location",
      // A map point or a photo, not text you can search.
      render: (row) => (
        <span className="font-mono text-xs whitespace-nowrap">{row.checkOutLatLng}</span>
      )
    },
    {
      id: "actions",
      label: "Action",
      visibleByDefault: true,
      render: (row) => (
        // The check-in is the point that matters here — where the rep actually met the customer.
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs whitespace-nowrap"
          disabled={!hasPoint(row.checkInLat, row.checkInLng)}
          onClick={(e) => {
            e.stopPropagation();
            setMapPoint({
              lat: row.checkInLat,
              lng: row.checkInLng,
              title: row.name,
              when: row.checkIn,
              label: 'Visit check-in',
            });
          }}
        >
          <MapPin className="h-3 w-3" /> MAP
        </Button>
      )
    },
    // The rest of what a visit stores, so Manage Column can offer it.
    ...extraColumns<any>(VISIT_EXTRA_COLUMNS),
  ];

  /** buildQuery already applied the search and every column filter. */
  const filteredVisits = visitsData;

  return (
    <PageLayout>
      <PageHeader
        title="Customer Visits"
        subtitle="Track field visits, feedback, and check-in times."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Filter by date</span>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-auto h-9"
            />
            {selectedDate && (
              <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => setSelectedDate('')}>
                All dates
              </Button>
            )}
          </div>
        }
      />

      <PageToolbar
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search by customer or employee...",
        }}
      />

      <DataTable
        columns={columns}
        data={filteredVisits}
        tableView={tableView}
        isLoading={isLoading}
        rowKey={(row) => row.id}
        onRowClick={(row) => router.push(`/location-tracking/visits/${row.id}`)}
        serverPagination={{ ...table.serverPagination, exportAll }}
      />

      <PointMapDialog point={mapPoint} onClose={() => setMapPoint(null)} />
    </PageLayout>
  );
}
