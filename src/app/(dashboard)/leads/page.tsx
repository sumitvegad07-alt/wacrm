"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, Filter, Upload, MapPin, Eye, EyeOff, Trash2 } from "lucide-react";
import {
  PointMapDialog,
  formatLatLng,
  hasPoint,
  type MapPoint,
} from "@/components/location-tracking/point-map-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { useAuth } from "@/hooks/use-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { LeadForm } from "@/components/leads/lead-form";
import { ImportWizard } from "@/components/import/import-wizard";
import { DataTable } from "@/components/ui/data-table/data-table";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { appendCustomFieldColumns, matchesSearchableCustomFields, getVisibleTableColumns } from "@/lib/custom-fields";
import { isDateInFilter } from "@/lib/date-filters";
import { CustomField } from "@/types";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge, ConfirmDialog } from "@/components/shared";

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

export default function LeadsPage() {
  const { account } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  
  // Lookups for filters
  const [leadStatuses, setLeadStatuses] = useState<{id: string, name: string}[]>([]);
  const [leadSources, setLeadSources] = useState<{id: string, name: string}[]>([]);
  const [leadIndustries, setLeadIndustries] = useState<{id: string, name: string}[]>([]);

  const [loading, setLoading] = useState(true);
  
  // For the global search bar (optional, we might remove it later if column filters are enough)
  const [globalSearch, setGlobalSearch] = useState("");

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
  const [filterState, setFilterState] = useState<FilterState>({ record_status: ['active'] });

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      router.push('/leads/new');
    }
  }, [searchParams, router]);

  async function loadLeads() {
    if (!account) return;
    const supabase = createClient();
    
    // Fetch all leads (active + inactive); the Record Status column filter
    // (defaulting to Active) controls what shows.
    const { data: leadsData } = await supabase
      .from("leads")
      .select("*")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false });

    // Fetch custom field definitions for leads
    const { data: fieldsData } = await supabase
      .from("custom_fields")
      .select("*")
      .eq("account_id", account.id)
      .eq("module_name", "lead");

    // If there are leads, fetch their custom values
    let enhancedLeads = leadsData || [];
    if (leadsData && leadsData.length > 0) {
      const leadIds = leadsData.map((l: any) => l.id);
      const { data: valuesData } = await supabase
        .from("lead_custom_values")
        .select("*")
        .in("lead_id", leadIds);
        
      if (valuesData && valuesData.length > 0) {
        enhancedLeads = leadsData.map((lead: any) => {
          const leadValues = valuesData.filter((v: any) => v.lead_id === lead.id);
          const customData: any = {};
          leadValues.forEach((v: any) => {
            customData[`cf_${v.custom_field_id}`] = v.value;
          });
          return { ...lead, ...customData };
        });
      }
    }

    // Fetch Lookups
    const [statusesRes, sourcesRes, industriesRes] = await Promise.all([
      supabase.from("lead_statuses").select("*").eq("account_id", account.id).order("position"),
      supabase.from("lead_sources").select("*").eq("account_id", account.id).order("name"),
      supabase.from("lead_industries").select("*").eq("account_id", account.id).order("name")
    ]);

    setLeads(enhancedLeads);
    setCustomFields((fieldsData as CustomField[]) || []);
    setLeadStatuses(statusesRes.data || []);
    setLeadSources(sourcesRes.data || []);
    setLeadIndustries(industriesRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);
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

  // Removed dynamic extraction in favor of fetched lookups

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
      render: (lead) => (
        <StatusBadge
          status={lead.is_converted ? "converted" : lead.status || "new"}
          label={lead.is_converted ? "Converted" : lead.status}
        />
      )
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
      render: (lead) => (
        <span className="capitalize px-2 py-1 bg-muted rounded-full text-xs">
          {lead.source || "-"}
        </span>
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
      render: (lead) => <span>{lead.industry || "-"}</span>
    },
    // All remaining lead fields are exposed here so an admin can add any of them
    // from Manage Columns (hidden by default to keep the initial view compact).
    { id: "company", label: "Company", type: "text", visibleByDefault: false, render: (l) => <span>{(l as any).company || "-"}</span> },
    { id: "contact_person", label: "Contact Person", type: "text", visibleByDefault: false, render: (l) => <span>{(l as any).contact_person || "-"}</span> },
    { id: "phone", label: "Phone", type: "text", visibleByDefault: false, render: (l) => <span className="font-mono text-xs">{(l as any).phone || "-"}</span> },
    { id: "email", label: "Email", type: "text", visibleByDefault: false, render: (l) => <span>{(l as any).email || "-"}</span> },
    { id: "estimated_value", label: "Estimated Value", type: "text", visibleByDefault: false, render: (l) => { const v = (l as any).estimated_value; return <span className="text-sm font-medium">{v == null ? "-" : v}</span>; } },
    { id: "address", label: "Address", type: "text", visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).address || "-"}</span> },
    { id: "area", label: "Area", type: "text", visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).area || "-"}</span> },
    { id: "city", label: "City", type: "text", visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).city || "-"}</span> },
    { id: "state", label: "State", type: "text", visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).state || "-"}</span> },
    { id: "country", label: "Country", type: "text", visibleByDefault: false, render: (l) => <span className="text-sm">{(l as any).country || "-"}</span> },
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
      type: "text",
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
    }
  ];

  // Transform base columns and append custom fields (controlled by admin show_in_table, sortable, filterable flags)
  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, leads);
  }, [columns, customFields, leads]);

  const handleFilterChange = (columnId: string, value: any) => {
    setFilterState(prev => ({
      ...prev,
      [columnId]: value
    }));
  };

  // Apply filters locally (since we fetch all leads for now)
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      // Global search (name, whatsapp, and searchable custom fields)
      if (
        globalSearch &&
        !lead.name.toLowerCase().includes(globalSearch.toLowerCase()) &&
        !lead.whatsapp?.includes(globalSearch) &&
        !matchesSearchableCustomFields(lead, customFields, globalSearch)
      ) {
        return false;
      }

      // Column filters
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;

        if (colId === "name") {
          if (!lead.name?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "whatsapp") {
          if (!lead.whatsapp?.includes(val as string)) return false;
        } else if (colId === "status" || colId === "source" || colId === "industry") {
          if (!(val as string[]).includes((lead as any)[colId])) return false;
        } else if (colId === "record_status") {
          const want = val as string[];
          if (Array.isArray(want) && want.length) {
            const state = (lead as any).is_active !== false ? "active" : "inactive";
            if (!want.includes(state)) return false;
          }
        } else if (["company","contact_person","phone","email","address","area","city","state","country","pincode","estimated_value"].includes(colId)) {
          const field = (lead as any)[colId];
          if (field == null || !String(field).toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "created_at") {
          if (!isDateInFilter(lead.created_at, val as string | string[])) return false;
        } else if (colId.startsWith("cf_")) {
          // Filter logic for custom fields
          const cfVal = lead[colId];
          const typeOfCf = customFields.find(f => `cf_${f.id}` === colId)?.field_type;
          
          if (typeOfCf === 'date') {
            if (!isDateInFilter(cfVal, val as string | string[])) return false;
          } else if (typeOfCf === 'dropdown' || typeOfCf === 'radio' || typeOfCf === 'multi-select') {
             if (!(val as string[]).includes(cfVal)) return false;
          } else {
             if (!cfVal?.toLowerCase().includes((val as string).toLowerCase())) return false;
          }
        }
      }

      return true;
    });
  }, [leads, filterState, globalSearch]);

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
    <PageLayout>
      <BulkActionBar
        selectedCount={selectedLeads.size}
        onClear={() => setSelectedLeads(new Set())}
        actions={[
          {
            label: "Move to Inactive",
            icon: <Trash2 className="size-3.5" />,
            variant: "destructive",
            onClick: () => setBulkDeleteOpen(true),
          },
        ]}
      />

      <DataTable
        columns={visibleColumns}
        data={filteredLeads}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => setImportOpen(true)}>
              <Upload className="size-3 mr-1" /> Import Leads
            </Button>
            <Button size="sm" className="h-7 text-xs px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => router.push('/leads/new')}>
              <Plus className="size-3 mr-1" /> Add Lead
            </Button>
          </div>
        }
        filterState={filterState}
        onFilterChange={handleFilterChange}
        // _v2: saved column layouts would otherwise hide the new geo-tag columns.
        storageKey="wacrm_leads_table_columns_v2"
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
    </PageLayout>
  );
}
