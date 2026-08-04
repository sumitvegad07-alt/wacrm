"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, Filter, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { LeadForm } from "@/components/leads/lead-form";
import { LeadImportDialog } from "@/components/leads/lead-import-dialog";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { appendCustomFieldColumns, matchesSearchableCustomFields, getVisibleTableColumns } from "@/lib/custom-fields";
import { isDateInFilter } from "@/lib/date-filters";
import { CustomField } from "@/types";
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge } from "@/components/shared";

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
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  
  // Lookups for filters
  const [leadStatuses, setLeadStatuses] = useState<{id: string, name: string}[]>([]);
  const [leadSources, setLeadSources] = useState<{id: string, name: string}[]>([]);
  const [leadIndustries, setLeadIndustries] = useState<{id: string, name: string}[]>([]);

  const [loading, setLoading] = useState(true);
  
  // For the global search bar (optional, we might remove it later if column filters are enough)
  const [globalSearch, setGlobalSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());

  const [filterState, setFilterState] = useState<FilterState>({});

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      router.push('/leads/new');
    }
  }, [searchParams, router]);

  async function loadLeads() {
    if (!account) return;
    const supabase = createClient();
    
    // Fetch leads
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
  }, [account]);

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
        actions={[]}
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
        storageKey="wacrm_leads_table_columns"
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
        onOpenChange={setFormOpen} 
        lead={null} 
        onSaved={loadLeads} 
      />
      <LeadImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={loadLeads}
      />
    </PageLayout>
  );
}
