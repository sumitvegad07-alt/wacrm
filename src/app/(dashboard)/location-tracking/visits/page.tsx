"use client";

import { useCallback, useState, useMemo, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataScope } from "@/hooks/use-data-scope";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Image as ImageIcon, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Link } from "@/components/ui/link";
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyDateFilter, applyInFilter, applyTextFilter, applyExtraColumnFilters } from '@/lib/table/apply-filters';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { extraColumns, type ExtraColumnSpec } from '@/lib/table/extra-columns';
import { isDateInFilter } from "@/lib/date-filters";
import { haversineMeters } from "@/lib/location/distance";
import { usePlaceNames, placeKey } from "@/hooks/use-place-names";
import { appendCustomFieldColumns } from "@/lib/custom-fields";
import type { CustomField } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { PageLayout, PageHeader } from "@/components/shared";
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
  const { accountId } = useAuth();

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
            // contacts carries the customer's own Area and its geo-tagged
            // position, so the Customer Area and Distance columns cost no extra
            // round trip — they ride along on the page of visits.
            `id, check_in_at, check_out_at, feedback_type, feedback_text, visit_photo_url,
             target_type, target_id, check_in_lat, check_in_lng, check_out_lat, check_out_lng,
             check_in_distance_m, check_out_distance_m,
             customer_name, visited_by_name,
             contacts ( name, company, area, city, latitude, longitude )`,
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
  const [leadInfo, setLeadInfo] = useState<
    Record<
      string,
      { name: string; person: string; area: string; lat: number | null; lng: number | null }
    >
  >({});

  /**
   * Admin-defined extra fields on a visit, and their values for the rows on
   * screen.
   *
   * Visits have had their own field builders at /custom-fields/customer_visit
   * and /custom-fields/lead_visit, and their own value tables, since migration
   * 097 — but nothing ever read or wrote them. An admin could define "Shop
   * cleanliness" or "Competitor stock seen", and the field appeared nowhere:
   * not on the rep's check-out form and not in this table. Both modules are
   * loaded together because this one table lists Customer and Lead visits side
   * by side, and a field id is unique across modules.
   */
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from('custom_fields')
        .select('*')
        .eq('account_id', accountId)
        .in('module_name', ['customer_visit', 'lead_visit'])
        .order('position');
      if (!alive) return;
      setCustomFields((data || []) as CustomField[]);
    })();
    return () => { alive = false; };
  }, [accountId, supabase]);

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
        .from('leads')
        .select('id, name, company, contact_person, area, city, latitude, longitude')
        .in('id', leadIdsKey.split(','));
      if (!alive) return;
      const map: Record<
        string,
        { name: string; person: string; area: string; lat: number | null; lng: number | null }
      > = {};
      (data || []).forEach((l: {
        id: string; name: string; company: string | null; contact_person: string | null;
        area: string | null; city: string | null;
        latitude: number | null; longitude: number | null;
      }) => {
        // Lead the row with the firm, as the customers list does.
        map[l.id] = {
          name: l.company || l.name,
          person: l.contact_person || '',
          // Leads carry the same Area / City pair as customers, so a lead visit
          // fills the Customer Area column too rather than reading '-'.
          area: l.area || l.city || '',
          lat: l.latitude,
          lng: l.longitude,
        };
      });
      setLeadInfo(map);
    })();
    return () => { alive = false; };
  }, [leadIdsKey, supabase]);

  /**
   * Custom-field values for the visits on this page only — the same
   * twenty-rows-at-a-time shape the Orders table uses, so a 24,000-row visit
   * history never pulls its whole value table down.
   */
  const pageIdsKey = useMemo(
    () => table.rows.map((v) => String((v as Record<string, unknown>).id)).join(','),
    [table.rows],
  );
  useEffect(() => {
    if (!pageIdsKey || customFields.length === 0) { setCustomValues({}); return; }
    const ids = pageIdsKey.split(',');
    let alive = true;
    void (async () => {
      // Customer and Lead visits keep their values in separate tables; a row is
      // in one or the other, so both are asked and the answers merged.
      const [cust, lead] = await Promise.all([
        supabase.from('customer_visit_custom_values')
          .select('visit_id, custom_field_id, value').in('visit_id', ids),
        supabase.from('lead_visit_custom_values')
          .select('visit_id, custom_field_id, value').in('visit_id', ids),
      ]);
      if (!alive) return;
      const byVisit: Record<string, Record<string, unknown>> = {};
      for (const row of [...(cust.data || []), ...(lead.data || [])]) {
        const r = row as { visit_id: string; custom_field_id: string; value: unknown };
        (byVisit[r.visit_id] ??= {})[`cf_${r.custom_field_id}`] = r.value;
      }
      setCustomValues(byVisit);
    })();
    return () => { alive = false; };
  }, [pageIdsKey, customFields.length, supabase]);

  const toRow = useCallback(
    (v: Record<string, any>) => {
      const isLead = v.target_type === 'Lead';
      const lead = isLead ? leadInfo[v.target_id] : undefined;
      // Show the COMPANY here, not the contact person. A visit listed as
      // "Laxmi mittal" when the customer is "Brahmani casting" is the same
      // record under two names, and nobody can tell which to ask about.
      const display = isLead ? lead?.name : v.customer_name;
      // Where the CUSTOMER is, on file. The anchor both for "how far off was
      // the check-in" and for the fallback when a visit has no coordinates.
      const anchorLat = isLead ? lead?.lat : (v.contacts?.latitude ?? null);
      const anchorLng = isLead ? lead?.lng : (v.contacts?.longitude ?? null);
      /**
       * Distance between where the rep checked in and where the customer is.
       *
       * Prefer the figure the database stamped at check-in: that one was
       * measured against the customer's position AT THE TIME, so moving a
       * customer's pin later cannot rewrite history. Accounts without
       * geo-fencing have no stamp, so the distance is worked out here from the
       * two coordinates the row already carries.
       */
      const checkInDistance =
        v.check_in_distance_m != null
          ? Math.round(Number(v.check_in_distance_m))
          : haversineMeters(v.check_in_lat, v.check_in_lng, anchorLat, anchorLng);
      const checkOutDistance =
        v.check_out_distance_m != null
          ? Math.round(Number(v.check_out_distance_m))
          : haversineMeters(v.check_out_lat, v.check_out_lng, anchorLat, anchorLng);
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
        // The two coordinate columns rendered `row.checkInLatLng` /
        // `row.checkOutLatLng`, which this function never produced — so both
        // columns were permanently blank however many visits had coordinates.
        checkInLatLng: formatLatLng(v.check_in_lat, v.check_in_lng),
        checkOutLatLng: formatLatLng(v.check_out_lat, v.check_out_lng),
        // Read-only, straight off the customer / lead record.
        customerArea: (isLead ? lead?.area : (v.contacts?.area || v.contacts?.city)) || '-',
        checkInDistanceM: checkInDistance,
        checkOutDistanceM: checkOutDistance,
        // Filled in by the place-name lookup once it lands (see placeNames).
        placeLat: v.check_in_lat,
        placeLng: v.check_in_lng,
        /**
         * The stored fields VISIT_EXTRA_COLUMNS offers through Manage Column,
         * under their own names.
         *
         * `extraColumns` reads `row[field]`, so every one of those five columns
         * — Visit Notes, Visited, Check-in Method and the two distances — printed
         * a dash for every row, because this function only ever built the
         * hand-written columns' keys. Switching one on in Manage Column gave an
         * empty column rather than the data.
         */
        notes: v.notes,
        target_type: v.target_type,
        check_in_method: v.check_in_method,
        // The stamped figures stay under their own names for these columns; the
        // Distance Difference column above falls back to computing them.
        check_in_distance_m: v.check_in_distance_m,
        check_out_distance_m: v.check_out_distance_m,
        ...customValues[String(v.id)],
      };
    },
    [leadInfo, customValues],
  );

  const visitsData = useMemo(
    () => table.rows.map((v) => toRow(v as Record<string, any>)),
    [table.rows, toRow],
  );

  /**
   * The name of the place each check-in happened in — "Rajkot", "Gondal".
   *
   * Resolved from the check-in coordinate, not from the customer's address: the
   * point of this column next to Distance is to show where the rep ACTUALLY
   * was. Lookups are cached and deduplicated per location, so the usual page
   * costs a handful of requests once and nothing afterwards.
   */
  const placeNames = usePlaceNames(
    useMemo(
      () => visitsData.map((r) => ({ lat: r.placeLat, lng: r.placeLng })),
      [visitsData],
    ),
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
      id: "customerArea",
      label: "Customer Area",
      // Read-only, from the customer / lead record. No filter cell: the area
      // lives on contacts/leads, not on site_visits, so a filter here could
      // only be served by turning the join inner — which would silently drop
      // every lead visit from the table. A dead filter is worse than none.
      render: (row) => (
        <span className="text-sm whitespace-nowrap">{row.customerArea}</span>
      ),
    },
    {
      id: "visitPlace",
      label: "Visit Location",
      // Resolved from the check-in coordinate, so it has no column to filter on.
      render: (row) => {
        const name =
          hasPoint(row.placeLat, row.placeLng)
            ? placeNames.get(placeKey(Number(row.placeLat), Number(row.placeLng)))
            : null;
        if (!hasPoint(row.placeLat, row.placeLng)) {
          return <span className="text-muted-foreground text-sm">-</span>;
        }
        return (
          <span className="text-sm whitespace-nowrap">
            {name ?? <span className="text-muted-foreground">Locating…</span>}
          </span>
        );
      },
    },
    {
      id: "checkInDistanceM",
      label: "Distance Difference (m)",
      // Derived from two coordinates; nothing stored to filter on for accounts
      // without geo-fencing, so no filter cell rather than one that misses rows.
      render: (row) => {
        if (row.checkInDistanceM == null) {
          return <span className="text-muted-foreground text-sm">-</span>;
        }
        // Red past 500 m: far enough from the customer's pin to be worth asking
        // about, and the same order as the geo-fence radii accounts actually set.
        const far = row.checkInDistanceM > 500;
        return (
          <span className={far ? 'text-sm font-medium text-destructive' : 'text-sm'}>
            {row.checkInDistanceM.toLocaleString('en-IN')} m
          </span>
        );
      },
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

  /**
   * The admin's own visit fields, appended after the built-in columns.
   *
   * `appendCustomFieldColumns` is what every other list screen uses, so these
   * behave identically: Manage Column lists them, `show_in_table` decides
   * whether they start on, and a deactivated field disappears. Filtering is
   * left to the client-side filter the DataTable already applies to rendered
   * values — buildQuery cannot filter a value that lives in another table.
   */
  appendCustomFieldColumns<any>(
    columns,
    customFields.filter((cf) => !cf.system_key),
    visitsData,
  );

  /** buildQuery already applied the search and every column filter. */
  const filteredVisits = visitsData;

  return (
    <PageLayout fill>
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

      <DataTable
        fill
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search by customer or employee...",
        }}
        columns={columns}
        data={filteredVisits}
        tableView={tableView}
        isLoading={isLoading}
        rowKey={(row) => row.id}
        rowHref={(row) => `/location-tracking/visits/${row.id}`}
        serverPagination={{ ...table.serverPagination, exportAll }}
      />

      <PointMapDialog point={mapPoint} onClose={() => setMapPoint(null)} />
    </PageLayout>
  );
}
