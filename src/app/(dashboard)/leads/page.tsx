"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, Filter, Upload, MapPin, Eye, EyeOff, Trash2, RotateCcw } from "lucide-react";
import {
  PointMapDialog,
  formatLatLng,
  hasPoint,
  type MapPoint,
} from "@/components/location-tracking/point-map-dialog";
import {
  PointsMapDialog,
  type PointsMapSelection,
} from "@/components/location-tracking/points-map-dialog";
import { splitMappableSelection, type GeoTaggedRow } from "@/lib/maps/selection-points";
import {
  inactiveSelection,
  reactivateDisabledReason,
  bulkReactivate,
  reactivatedMessage,
} from "@/lib/table/bulk-activation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { extraColumns, type ExtraColumnSpec } from '@/lib/table/extra-columns';
import { useAuth } from "@/hooks/use-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { LeadForm } from "@/components/leads/lead-form";
import { ImportWizard } from "@/components/import/import-wizard";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useTableView } from "@/hooks/use-table-view";
import { useServerTable } from "@/hooks/use-server-table";
import { fetchAllPages } from "@/lib/table/export-all-pages";
import type { ServerTableQuery } from "@/lib/table/server-query";
import { applyArrayOverlapFilter, applyCustomFieldFilters, customFieldFilterKey, applyDateFilter, applyInFilter, applyInWithFallbackFilter, applyTextFilter, applyExtraColumnFilters } from "@/lib/table/apply-filters";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { appendCustomFieldColumns, matchesSearchableCustomFields, getVisibleTableColumns } from "@/lib/custom-fields";
import { isDateInFilter } from "@/lib/date-filters";
import { CustomField } from "@/types";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PageLayout, PageHeader, BulkActionBar, StatusBadge, ConfirmDialog } from "@/components/shared";

interface Lead {
  id: string;
  name: string;
  source: string;
  status: string;
  industry: string;
  whatsapp: string;
  created_at: string;
  is_converted: boolean;
  [key: string]: any; // To allow custom field keys (e.g., cf_uuid)
}

/** Stored leads fields with no hand-written column, shown via Manage Column. */
const LEAD_EXTRA_COLUMNS: readonly ExtraColumnSpec<Lead>[] = [
      ["estimated_value", "Estimated Value", "currency"],
      ["is_converted", "Converted", "boolean"],
];

export default function LeadsPage() {
  const { account } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);
  const [mapSelection, setMapSelection] = useState<PointsMapSelection | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  
  // Lookups for filters
  const [leadStatuses, setLeadStatuses] = useState<{id: string, name: string, color?: string | null}[]>([]);
  const [leadSources, setLeadSources] = useState<{id: string, name: string, color?: string | null}[]>([]);
  const [leadIndustries, setLeadIndustries] = useState<{id: string, name: string, color?: string | null}[]>([]);

  /** Resolves an owner/collaborator id (profiles.id OR auth uid) to a name. */
  const [profiles, setProfiles] = useState<{ id: string; user_id: string; full_name: string }[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());

  // Soft-delete dialogs
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Default filter: show Active records only (Inactive/all reachable via the Status column filter).
  // _v2: saved column layouts would otherwise hide the new geo-tag columns.
  const tableView = useTableView("wacrm_leads_table_columns_v2", { record_status: ['active'] });
  const { filterState } = tableView;

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      router.push('/leads/new');
    }
  }, [searchParams, router]);

  // Reference data: small, fixed-size lookups the columns and filters need.
  // Loaded once per account, not once per page of leads.
  useEffect(() => {
    if (!account) return;
    let alive = true;
    void (async () => {
      const supabase = createClient();
      const [fieldsRes, statusesRes, sourcesRes, industriesRes, profilesRes] = await Promise.all([
        supabase.from("custom_fields").select("*").eq("account_id", account.id).eq("module_name", "lead"),
        supabase.from("lead_statuses").select("*").eq("account_id", account.id).order("position"),
        supabase.from("lead_sources").select("*").eq("account_id", account.id).order("name"),
        supabase.from("lead_industries").select("*").eq("account_id", account.id).order("name"),
        supabase.from("profiles").select("id, user_id, full_name").eq("account_id", account.id),
      ]);
      if (!alive) return;
      setCustomFields((fieldsRes.data as CustomField[]) || []);
      setLeadStatuses(statusesRes.data || []);
      setLeadSources(sourcesRes.data || []);
      setLeadIndustries(industriesRes.data || []);
      setProfiles(profilesRes.data || []);
    })();
    return () => { alive = false; };
  }, [account]);

  /**
   * One page of leads, searched and filtered by the database.
   *
   * `search_text` (migration 20261012120000) covers name, whatsapp and every
   * searchable custom field value, so the single search box is one indexed
   * `ilike` instead of downloading the table. `custom_values` carries the
   * `cf_*` values the custom columns render and filter on.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      let q = sb
        .from("leads")
        .select("*", { count: "exact" })
        .eq("account_id", account!.id);

      if (search) q = q.ilike("search_text", `%${search.toLowerCase()}%`);

      q = applyTextFilter(q, "name", filters.name);
      q = applyTextFilter(q, "whatsapp", filters.whatsapp);
      q = applyInFilter(q, "status", filters.status);
      q = applyInFilter(q, "source", filters.source);
      q = applyInFilter(q, "industry", filters.industry);
      // Columns the filter row offers as a value list match exactly; the rest
      // are still typed, so they stay a contains match.
      for (const col of ["company", "area", "city", "state", "country"]) {
        q = applyInFilter(q, col, filters[col]);
      }
      for (const col of ["contact_person", "phone", "email", "address", "pincode"]) {
        q = applyTextFilter(q, col, filters[col]);
      }

      // Owner and Collaborator never reached the query at all before: the
      // columns rendered names but filtering by them did nothing. Both hold
      // AUTH user ids, and Owner falls back to the creator when `owner_id` is
      // null, exactly as the column displays it.
      q = applyInWithFallbackFilter(q, "owner_id", "user_id", filters.lead_owner);
      q = applyArrayOverlapFilter(q, "collaborator_ids", filters.lead_collaborator);
      q = applyDateFilter(q, "created_at", filters.created_at);
      q = applyCustomFieldFilters(q, filters, customFields);

      // Record Status: the screen shows Active by default, with Inactive and
      // both reachable from the column filter.
      const want = filters.record_status as string[] | undefined;
      if (Array.isArray(want) && want.length === 1) {
        q = q.eq("is_active", want[0] === "active");
      }

      // The columns Manage Column offers for the rest of the stored fields.

      q = applyExtraColumnFilters(q, filters, LEAD_EXTRA_COLUMNS);

      return q.order("created_at", { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [account, customFields],
  );

  /** Stable dep: only changes when an ACTIVE cf_* filter's type could change the query. */
  const cfKey = customFieldFilterKey(filterState, customFields);

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    enabled: Boolean(account?.id),
    deps: [account?.id, cfKey],
  });

  const loadLeads = table.reload;
  const loading = table.loading;

  /** Flatten custom_values into cf_* keys and resolve owner names for display. */
  const nameOf = useCallback(
    (id: string | null | undefined): string | null => {
      if (!id) return null;
      const p = profiles.find((x) => x.id === id || x.user_id === id);
      return p?.full_name ?? null;
    },
    [profiles],
  );

  const leads = useMemo(
    () =>
      table.rows.map((row) => {
        const l = row as Record<string, unknown> & {
          custom_values?: Record<string, unknown> | null;
          owner_id?: string | null;
          user_id?: string | null;
          collaborator_ids?: unknown;
        };
        return {
          ...l,
          ...(l.custom_values ?? {}),
          _leadOwner: nameOf(l.owner_id) ?? nameOf(l.user_id),
          _leadCollaborators: (Array.isArray(l.collaborator_ids) ? l.collaborator_ids : [])
            .map((id: string) => nameOf(id))
            .filter(Boolean)
            .join(", "),
        } as unknown as Lead;
      }),
    [table.rows, nameOf],
  );

  const exportAll = useCallback(async () => {
    const supabase = createClient();
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return {
      rows: rows.map((r) => ({ ...(r as object), ...((r as { custom_values?: object }).custom_values ?? {}) })),
      truncated,
    };
  }, [buildQuery, table.search, filterState]);

  useRealtimeRefresh('leads', loadLeads);

  function confirmDelete(lead: Lead) {
    setDeleteTarget(lead);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget || !account) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from("leads").update({ is_active: false }).eq("id", deleteTarget.id);
    if (error) toast.error("Failed to deactivate lead");
    else { toast.success("Lead moved to Inactive"); loadLeads(); }
    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  async function handleReactivate(lead: Lead) {
    const supabase = createClient();
    const { error } = await supabase.from("leads").update({ is_active: true }).eq("id", lead.id);
    if (error) toast.error("Failed to re-activate lead");
    else { toast.success("Lead re-activated"); loadLeads(); }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedLeads);
    if (ids.length === 0) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from("leads").update({ is_active: false }).in("id", ids);
    if (error) toast.error("Failed to deactivate leads");
    else {
      toast.success(`${ids.length} lead${ids.length === 1 ? "" : "s"} moved to Inactive`);
      setSelectedLeads(new Set());
      loadLeads();
    }
    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  /**
   * Restore every selected lead that is currently Inactive.
   *
   * Not confirmed: re-activating is not destructive, and the button is disabled
   * unless the selection actually holds something Inactive.
   */
  async function handleBulkReactivate() {
    const ids = inactiveSelection(leads, selectedLeads);
    if (ids.length === 0) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await bulkReactivate(supabase, "leads", ids);
    if (error) toast.error("Failed to re-activate leads");
    else {
      toast.success(reactivatedMessage(ids.length, "lead"));
      setSelectedLeads(new Set());
      loadLeads();
    }
    setDeleting(false);
  }

  /** Plot every selected lead that has a saved coordinate on one map. */
  function handleShowSelectionOnMap() {
    const { points, skipped } = splitMappableSelection(leads, selectedLeads, {
      titleOf: (l) => l.name || l.contact_person || l.whatsapp,
      latOf: (l) => (l as GeoTaggedRow).latitude,
      lngOf: (l) => (l as GeoTaggedRow).longitude,
    });
    if (points.length === 0) {
      toast.error("None of the selected leads have a saved location");
      return;
    }
    setMapSelection({
      title: `${points.length} ${points.length === 1 ? "Lead" : "Leads"} on map`,
      points,
      skipped,
    });
  }

  // Removed dynamic extraction in favor of fetched lookups

  // Colour codes are configured per option in Lead Settings (status/source/
  // industry each carry a hex `color`). Render them as a coloured pill so the
  // table reflects the same colour coding the settings screens define.
  const colorFor = (
    list: { name: string; color?: string | null }[],
    value?: string | null,
  ) => (value ? list.find((x) => x.name === value)?.color ?? null : null);

  const ColorPill = ({ color, label }: { color?: string | null; label: string }) => (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={
        color
          ? { backgroundColor: `${color}1a`, color }
          : undefined
      }
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className={color ? "" : "text-muted-foreground"}>{label}</span>
    </span>
  );

  const columns: ColumnDef<Lead>[] = [
    {
      id: "name",
      label: "Name",
      type: "text",
      render: (lead) => (
        <Link href={`/leads/${lead.id}`} className="text-primary hover:underline font-medium">
          {lead.name}
        </Link>
      )
    },
    {
      id: "status",
      label: "Lead Status",
      type: "select",
      options: leadStatuses.map(s => ({ label: s.name, value: s.name })),
      render: (lead) =>
        lead.is_converted ? (
          <StatusBadge status="converted" label="Converted" />
        ) : (
          <ColorPill color={colorFor(leadStatuses, lead.status)} label={lead.status || "New"} />
        )
    },
    {
      id: "lead_owner",
      label: "Lead Owner",
      type: "select",
      // `leads.owner_id` holds an AUTH user id, not a profiles.id.
      valueSource: { kind: "people", idSpace: "auth" },
      // Owner = area-assigned employee / the creator set as owner. Visible by
      // default; admins can hide it via Manage Columns.
      visibleByDefault: true,
      render: (lead) => {
        const emp = (lead as any)._leadOwner;
        return emp ? <span>{emp}</span> : <span className="text-muted-foreground">Unassigned</span>;
      }
    },
    {
      id: "lead_collaborator",
      label: "Lead Collaborator",
      type: "select",
      // `collaborator_ids` is a uuid[] of AUTH user ids.
      valueSource: { kind: "people", idSpace: "auth" },
      visibleByDefault: true,
      render: (lead) => {
        const c = (lead as any)._leadCollaborators;
        return c ? <span>{c}</span> : <span className="text-muted-foreground">-</span>;
      }
    },
    {
      id: "created_at",
      label: "Created at",
      type: "date",
      render: (lead) => (
        <span className="text-muted-foreground text-sm">
          {new Date(lead.created_at).toLocaleDateString()}
        </span>
      )
    },
    {
      id: "source",
      label: "Source",
      type: "select",
      options: leadSources.map(s => ({ label: s.name, value: s.name })),
      render: (lead) =>
        lead.source ? (
          <ColorPill color={colorFor(leadSources, lead.source)} label={lead.source} />
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        )
    },
    {
      id: "whatsapp",
      label: "Contact no",
      type: "text",
      render: (lead) => <span>{lead.whatsapp || "-"}</span>
    },
    {
      id: "industry",
      label: "Industry",
      type: "select",
      options: leadIndustries.map(s => ({ label: s.name, value: s.name })),
      render: (lead) =>
        lead.industry ? (
          <ColorPill color={colorFor(leadIndustries, lead.industry)} label={lead.industry} />
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        )
    },
    // All remaining lead fields are exposed here so an admin can add any of them
    // from Manage Columns (hidden by default to keep the initial view compact).
    { id: "company", label: "Company", type: "select", valueSource: { kind: "distinct", module: "lead", column: "company" }, visibleByDefault: false, render: (l) => <span>{(l as any).company || "-"}</span> },
    { id: "contact_person", label: "Contact Person", type: "text", visibleByDefault: false, render: (l) => <span>{(l as any).contact_person || "-"}</span> },
    { id: "phone", label: "Phone", type: "text", visibleByDefault: false, render: (l) => <span className="font-mono text-xs">{(l as any).phone || "-"}</span> },
    { id: "email", label: "Email", type: "text", visibleByDefault: false, render: (l) => <span>{(l as any).email || "-"}</span> },
    { id: "address", label: "Address", type: "text", visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).address || "-"}</span> },
    { id: "area", label: "Area", type: "select", valueSource: { kind: "distinct", module: "lead", column: "area" }, visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).area || "-"}</span> },
    { id: "city", label: "City", type: "select", valueSource: { kind: "distinct", module: "lead", column: "city" }, visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).city || "-"}</span> },
    { id: "state", label: "State", type: "select", valueSource: { kind: "distinct", module: "lead", column: "state" }, visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).state || "-"}</span> },
    { id: "country", label: "Country", type: "select", valueSource: { kind: "distinct", module: "lead", column: "country" }, visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).country || "-"}</span> },
    { id: "pincode", label: "Pincode", type: "text", visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).pincode || "-"}</span> },
    {
      // Soft-delete status (Active / Inactive), distinct from the workflow "Lead Status".
      id: "record_status",
      label: "Record Status",
      type: "select",
      visibleByDefault: true,
      options: [ { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" } ],
      render: (lead) => {
        const active = (lead as any).is_active !== false;
        return (
          <Badge className={active
            ? 'bg-emerald-600 text-white shadow-sm border-transparent text-[10px] px-1.5 font-semibold'
            : 'bg-muted text-muted-foreground border-border text-[10px] px-1.5 font-semibold'}>
            {active ? 'Active' : 'Inactive'}
          </Badge>
        );
      }
    },
    {
      // The geo-tag captured when a rep tagged this lead on site.
      id: "latLng",
      label: "Latitude, Longitude",
      // A map point, not text you can search.
      render: (lead) => (
        <span className="font-mono text-xs whitespace-nowrap">
          {formatLatLng((lead as any).latitude, (lead as any).longitude)}
        </span>
      )
    },
    {
      id: "geoMap",
      label: "Geo Map",
      render: (lead) => (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs whitespace-nowrap"
          disabled={!hasPoint((lead as any).latitude, (lead as any).longitude)}
          onClick={(e) => {
            e.stopPropagation();
            setMapPoint({
              lat: (lead as any).latitude,
              lng: (lead as any).longitude,
              title: lead.name || 'Lead',
              label: 'Lead geo-tag',
            });
          }}
        >
          <MapPin className="h-3 w-3" /> MAP
        </Button>
      )
    },
    {
      id: "actions",
      label: "Action",
      visibleByDefault: true,
      render: (lead) => {
        const inactive = (lead as any).is_active === false;
        return (
          <RowActions
            isInactive={inactive}
            onEdit={() => { setEditLead(lead); setFormOpen(true); }}
            onDelete={() => confirmDelete(lead)}
            onReactivate={() => handleReactivate(lead)}
            deleteTitle="Move to Inactive"
          />
        );
      }
    },
    // The rest of what a lead stores, so Manage Column can offer it.
    ...extraColumns<Lead>(LEAD_EXTRA_COLUMNS),
  ];

  // Transform base columns and append custom fields (controlled by admin show_in_table, sortable, filterable flags)
  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, leads);
  }, [columns, customFields, leads]);

  // Apply filters locally (since we fetch all leads for now)
  /**
   * Nothing left to filter: buildQuery pushed the search, every column filter,
   * the date range, the record-status toggle and the custom-field filters into
   * the query, so every row the server returned belongs on screen.
   */
  const filteredLeads = leads;

  // Which bulk actions can run against this selection — derived, so they can
  // never drift from what is actually selected.
  const inactiveSelectedIds = useMemo(
    () => inactiveSelection(leads, selectedLeads),
    [leads, selectedLeads],
  );
  const mappableSelectedCount = useMemo(
    () =>
      splitMappableSelection(leads, selectedLeads, {
        titleOf: (l) => l.name || l.contact_person || l.whatsapp,
        latOf: (l) => (l as GeoTaggedRow).latitude,
        lngOf: (l) => (l as GeoTaggedRow).longitude,
      }).points.length,
    [leads, selectedLeads],
  );

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedLeads(new Set(filteredLeads.map(l => l.id)));
    } else {
      setSelectedLeads(new Set());
    }
  };

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <PageLayout fill>
      <BulkActionBar
        selectedCount={selectedLeads.size}
        onClear={() => setSelectedLeads(new Set())}
        actions={[
          {
            label: "Show on Map",
            icon: <MapPin className="size-3.5" />,
            variant: "outline",
            onClick: handleShowSelectionOnMap,
            disabled: mappableSelectedCount === 0,
            title: mappableSelectedCount === 0
              ? "None of the selected leads have a saved location"
              : undefined,
          },
          {
            label: "Re-activate",
            icon: <RotateCcw className="size-3.5" />,
            variant: "outline",
            onClick: handleBulkReactivate,
            disabled: deleting || inactiveSelectedIds.length === 0,
            title: reactivateDisabledReason(selectedLeads.size, inactiveSelectedIds.length),
          },
          {
            label: "Move to Inactive",
            icon: <Trash2 className="size-3.5" />,
            variant: "destructive",
            onClick: () => setBulkDeleteOpen(true),
          },
        ]}
      />

      <DataTable
        fill
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search leads by name, WhatsApp or custom field...",
        }}
        columns={visibleColumns}
        data={filteredLeads}
        serverPagination={{ ...table.serverPagination, exportAll }}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => setImportOpen(true)}>
              <Upload className="size-3 mr-1" /> Import Leads
            </Button>
            <Button data-tour="lead-add" size="sm" className="h-7 text-xs px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => router.push('/leads/new')}>
              <Plus className="size-3 mr-1" /> Add Lead
            </Button>
          </div>
        }
        tableView={tableView}
        isLoading={loading}
        rowKey={(lead) => lead.id}
        onRowClick={(lead) => router.push(`/leads/${lead.id}`)}
        selection={{
          selectedIds: selectedLeads,
          onSelectAll: handleSelectAll,
          onSelect: handleSelect
        }}
      />

      <LeadForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditLead(null); }}
        lead={editLead as any}
        onSaved={loadLeads}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        module="leads"
        onImported={loadLeads}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Move Lead to Inactive"
        description={
          <>
            Move <span className="font-medium text-foreground">{deleteTarget?.name}</span> to Inactive? It will be hidden from the default list but you can re-activate it anytime via “Show Inactive”.
          </>
        }
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Move ${selectedLeads.size} Leads to Inactive`}
        description={`Move ${selectedLeads.size} lead${selectedLeads.size === 1 ? '' : 's'} to Inactive? They can be re-activated anytime via “Show Inactive”.`}
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deleting}
        onConfirm={handleBulkDelete}
      />

      <PointMapDialog point={mapPoint} onClose={() => setMapPoint(null)} />
      <PointsMapDialog selection={mapSelection} onClose={() => setMapSelection(null)} />
    </PageLayout>
  );
}
