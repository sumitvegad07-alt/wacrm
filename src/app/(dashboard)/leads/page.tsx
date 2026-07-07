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
import { LeadExportDialog } from "@/components/leads/lead-export-dialog";
import { LeadImportDialog } from "@/components/leads/lead-import-dialog";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { isDateInFilter } from "@/lib/date-filters";
import { CustomField } from "@/types";

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
      setFormOpen(true);
      router.replace('/leads');
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
        <span className={`capitalize px-2 py-1 rounded-full text-xs ${
          lead.is_converted ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'
        }`}>
          {lead.is_converted ? "Converted" : lead.status}
        </span>
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

  // Append custom fields to columns
  customFields.forEach(cf => {
    let type: any = "text";
    let options: any[] = [];
    
    if (cf.field_type === 'dropdown' || cf.field_type === 'radio' || cf.field_type === 'multi-select') {
      type = "select";
      // Note: for relational fields, this takes the distinct values in the table. 
      // If we wanted to fetch the full module list for the filter we would need an async effect here,
      // but for now relying on unique row values for the filter is standard.
      const uniqueVals = Array.from(new Set(leads.map(l => l[`cf_${cf.id}`]).filter(Boolean)));
      options = uniqueVals.map(val => ({ label: val, value: val }));
    } else if (cf.field_type === 'date') {
      type = "date";
    }

    columns.push({
      id: `cf_${cf.id}`,
      label: cf.field_name,
      type: type,
      options: options.length > 0 ? options : undefined,
      visibleByDefault: false,
      render: (lead) => {
        const val = lead[`cf_${cf.id}`];
        if (!val) return <span className="text-muted-foreground">-</span>;
        
        if (cf.field_type === 'checkbox') {
          return <span>{val === 'true' ? 'Yes' : 'No'}</span>;
        }
        if (cf.field_type === 'attachment') {
          return <a href={val} target="_blank" rel="noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>View</a>;
        }
        return <span>{val}</span>;
      }
    });
  });

  const handleFilterChange = (columnId: string, value: any) => {
    setFilterState(prev => ({
      ...prev,
      [columnId]: value
    }));
  };

  // Apply filters locally (since we fetch all leads for now)
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      // Global search
      if (globalSearch && !lead.name.toLowerCase().includes(globalSearch.toLowerCase()) && !lead.whatsapp?.includes(globalSearch)) {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage raw prospects before they become contacts.
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Lead
        </Button>
      </div>

      <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search leads globally..." 
            className="pl-9"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2">
            <Filter className="h-4 w-4" /> Filter
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import Leads
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredLeads}
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
    </div>
  );
}
