'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  FileText,
  Copy,
  Send,
  Check,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { logQuotationActivity } from '@/lib/quotations';
import { QuotationForm } from '@/components/quotations/quotation-form';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';

import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from "@/lib/date-filters";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-slate-100 text-slate-700 border-slate-200',
  Sent: 'bg-blue-100 text-blue-700 border-blue-200',
  Approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Rejected: 'bg-red-100 text-red-700 border-red-200',
};

export default function QuotationsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEditSettings = useCan('edit-settings');
  const { account } = useAuth();

  const [quotations, setQuotations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // DataTable state
  const [globalSearch, setGlobalSearch] = useState('');
  const [filterState, setFilterState] = useState<FilterState>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Lookups
  const [customFields, setCustomFields] = useState<any[]>([]);

  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form State
  const [formOpen, setFormOpen] = useState(false);
  const [formQuotationId, setFormQuotationId] = useState<string | undefined>(undefined);
  const [formCloneId, setFormCloneId] = useState<string | undefined>(undefined);
  const [formVersionId, setFormVersionId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setFormQuotationId(undefined);
      setFormCloneId(undefined);
      setFormVersionId(undefined);
      setFormOpen(true);
      router.replace('/quotations');
    }
  }, [searchParams, router]);

  const fetchQuotations = useCallback(async () => {
    setLoading(true);

    const [{ data: quotationsData }, { data: fieldsData }] = await Promise.all([
      supabase.from('quotations').select('*, contact:contacts!quotations_contact_id_fkey(name, company), lead:leads!quotations_lead_id_fkey(title, contact_person), creator:profiles!quotations_user_id_fkey(full_name, email)').eq('is_latest_version', true).order('created_at', { ascending: false }),
      supabase.from('custom_fields').select('*').eq('module_name', 'quotation')
    ]);

    setCustomFields(fieldsData || []);

    let enhancedQuotations = quotationsData || [];
    if (quotationsData && quotationsData.length > 0) {
      const quotationIds = quotationsData.map(q => q.id);
      const { data: valuesData } = await supabase
        .from('quotation_custom_values')
        .select('*')
        .in('quotation_id', quotationIds);

      if (valuesData && valuesData.length > 0) {
        enhancedQuotations = quotationsData.map(quotation => {
          const quotationValues = valuesData.filter((v: any) => v.quotation_id === quotation.id);
          const customData: any = {};
          quotationValues.forEach((v: any) => {
            customData[`cf_${v.custom_field_id}`] = v.value;
          });
          return { ...quotation, ...customData };
        });
      }
    }

    setQuotations(enhancedQuotations);
    setLoading(false);
    setSelectedIds(new Set());
  }, [supabase]);

  useEffect(() => {
    fetchQuotations();
  }, [fetchQuotations]);

  const changeStatus = async (id: string, newStatus: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await supabase.from('quotations').update({ status: newStatus }).eq('id', id);
    if (!error) {
      toast.success(`Quotation marked as ${newStatus}`);
      await logQuotationActivity(supabase, id, 'status_changed', { new_status: newStatus });
      fetchQuotations();
    } else {
      toast.error('Failed to update status');
    }
  };

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('quotations').delete().eq('id', deleteTarget.id);
    if (error) toast.error('Failed to delete quotation');
    else { toast.success('Quotation deleted'); fetchQuotations(); }
    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.size} selected quotation(s)? This action cannot be undone.`)) return;
    
    setBulkActionLoading(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from('quotations').delete().in('id', ids);
    if (!error) {
      toast.success(`Deleted ${ids.length} quotations`);
      fetchQuotations();
    } else {
      toast.error('Failed to delete quotations');
    }
    setBulkActionLoading(false);
  }

  const columns: ColumnDef<any>[] = [
    {
      id: "quotation_number",
      label: "Quotation Number",
      type: "text",
      render: (quotation) => (
        <div className="flex items-center gap-2">
          {!quotation.is_read && (
            <div className="size-2 rounded-full bg-blue-500" title="Unread" />
          )}
          <span className="font-medium text-foreground">
            {quotation.quotation_number}
          </span>
          {quotation.version > 1 && (
            <Badge variant="secondary" className="font-normal text-[10px] px-1.5 py-0">
              v{quotation.version}
            </Badge>
          )}
        </div>
      )
    },
    {
      id: "date",
      label: "Date",
      type: "date",
      render: (quotation) => <span className="text-muted-foreground">{quotation.date ? new Date(quotation.date).toLocaleDateString() : '-'}</span>
    },
    {
      id: "contact",
      label: "Quotation For",
      type: "text",
      render: (quotation) => {
        if (quotation.lead) {
          return (
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{quotation.lead.title}</span>
              <span className="text-xs text-muted-foreground">Lead</span>
            </div>
          );
        }
        if (quotation.contact) {
          return (
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{quotation.contact.name}</span>
              {quotation.contact.company && (
                <span className="text-xs text-muted-foreground">{quotation.contact.company}</span>
              )}
            </div>
          );
        }
        return <span className="text-muted-foreground italic">Unknown</span>;
      }
    },
    {
      id: "amount",
      label: "Amount",
      type: "text",
      render: (quotation) => (
        <span className="font-medium text-foreground">
          ₹{quotation.total_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )
    },
    {
      id: "status",
      label: "Status",
      type: "select",
      options: Object.keys(STATUS_COLORS).map(s => ({ label: s, value: s })),
      render: (quotation) => (
        <Badge variant="outline" className={`font-normal ${STATUS_COLORS[quotation.status] || ''}`}>
          {quotation.status}
        </Badge>
      )
    },
    {
      id: "creator",
      label: "Created By",
      type: "text",
      render: (quotation) => <span className="text-muted-foreground text-sm">{quotation.creator?.full_name || quotation.creator?.email || '-'}</span>
    },
    {
      id: "actions",
      label: "",
      visibleByDefault: true,
      render: (quotation) => (
        <DropdownMenu>
          <DropdownMenuTrigger 
            render={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" />}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover border-border">
            <DropdownMenuItem 
              className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/quotations/${quotation.id}`);
              }}
            >
              <FileText className="size-4 mr-2" /> View
            </DropdownMenuItem>
            <DropdownMenuItem 
              className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setFormQuotationId(quotation.id);
                setFormCloneId(undefined);
                setFormVersionId(undefined);
                setFormOpen(true);
              }}
            >
              <Pencil className="size-4 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem 
              className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setFormQuotationId(undefined);
                setFormCloneId(undefined);
                setFormVersionId(quotation.id);
                setFormOpen(true);
              }}
            >
              <Copy className="size-4 mr-2" /> New Version
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            
            {quotation.status === 'Pending' && (
              <DropdownMenuItem 
                className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                onClick={(e) => changeStatus(quotation.id, 'Sent', e)}
              >
                <Send className="size-4 mr-2 text-blue-500" /> Mark Sent
              </DropdownMenuItem>
            )}
            {(quotation.status === 'Pending' || quotation.status === 'Sent') && (
              <>
                <DropdownMenuItem 
                  className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                  onClick={(e) => changeStatus(quotation.id, 'Approved', e)}
                >
                  <Check className="size-4 mr-2 text-emerald-500" /> Approve
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                  onClick={(e) => changeStatus(quotation.id, 'Rejected', e)}
                >
                  <X className="size-4 mr-2 text-red-500" /> Reject
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(quotation);
                setDeleteConfirmOpen(true);
              }}
            >
              <Trash2 className="size-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  // Append custom fields
  customFields.forEach(cf => {
    let type: any = "text";
    let options: any[] = [];
    if (cf.field_type === 'dropdown' || cf.field_type === 'radio' || cf.field_type === 'multi-select') {
      type = "select";
      const uniqueVals = Array.from(new Set(quotations.map(q => q[`cf_${cf.id}`]).filter(Boolean)));
      options = uniqueVals.map(val => ({ label: val as string, value: val as string }));
    } else if (cf.field_type === 'date') {
      type = "date";
    }

    columns.splice(columns.length - 1, 0, {
      id: `cf_${cf.id}`,
      label: cf.field_name,
      type: type,
      options: options.length > 0 ? options : undefined,
      visibleByDefault: false,
      render: (quotation) => {
        const val = quotation[`cf_${cf.id}`];
        if (!val) return <span className="text-muted-foreground">-</span>;
        if (cf.field_type === 'checkbox') return <span>{val === 'true' ? 'Yes' : 'No'}</span>;
        if (cf.field_type === 'attachment') return <a href={val} target="_blank" rel="noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>View</a>;
        return <span>{val}</span>;
      }
    });
  });

  const filteredQuotations = useMemo(() => {
    return quotations.filter(quotation => {
      // Global search
      if (globalSearch) {
        const search = globalSearch.toLowerCase();
        const matchesNumber = quotation.quotation_number?.toLowerCase().includes(search);
        const matchesContact = quotation.contact?.name?.toLowerCase().includes(search);
        const matchesLead = quotation.lead?.title?.toLowerCase().includes(search);
        if (!matchesNumber && !matchesContact && !matchesLead) {
          return false;
        }
      }

      // Column filters
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;

        if (colId === "quotation_number") {
          if (!quotation.quotation_number?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "status") {
          if (!(val as string[]).includes(quotation.status)) return false;
        } else if (colId === "contact") {
          const matchC = quotation.contact?.name?.toLowerCase().includes((val as string).toLowerCase());
          const matchL = quotation.lead?.title?.toLowerCase().includes((val as string).toLowerCase());
          if (!matchC && !matchL) return false;
        } else if (colId === "creator") {
          const creatorName = quotation.creator?.full_name || quotation.creator?.email || "";
          if (!creatorName.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "date") {
          if (!isDateInFilter(quotation.date, val as string | string[])) return false;
        } else if (colId.startsWith("cf_")) {
          const cfVal = quotation[colId];
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
  }, [quotations, filterState, globalSearch, customFields]);

  return (
    <div className="flex flex-col h-full space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Quotations</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and track your quotations.</p>
        </div>
        <div className="flex items-center gap-2">
          {process.env.NODE_ENV === 'development' && (
            <Button 
              variant="secondary"
              className="gap-2" 
              onClick={async () => {
                toast.loading('Seeding 20 quotations...', { id: 'seed' });
                const { data: contacts } = await supabase.from('contacts').select('id').limit(1);
                if (!contacts || contacts.length === 0) {
                  toast.error('Create a contact first', { id: 'seed' });
                  return;
                }
                const contactId = contacts[0].id;
                
                const { data: userData } = await supabase.auth.getUser();
                if (!userData?.user) return;
                
                const { data: member } = await supabase.from('profiles').select('account_id').eq('user_id', userData.user.id).single();
                if (!member) {
                  toast.error('Failed to get account information', { id: 'seed' });
                  return;
                }
                
                const dummyQuotations = Array.from({ length: 20 }).map((_, i) => ({
                  account_id: member.account_id,
                  user_id: userData.user.id,
                  contact_id: contactId,
                  date: new Date().toISOString().split('T')[0],
                  status: ['Pending', 'Sent', 'Approved', 'Rejected'][Math.floor(Math.random() * 4)],
                  sub_total: 100 * (i + 1),
                  total_amount: 100 * (i + 1),
                }));
                
                const { error } = await supabase.from('quotations').insert(dummyQuotations);
                if (error) {
                  toast.error('Failed to seed quotations', { id: 'seed' });
                } else {
                  toast.success('20 dummy quotations created!', { id: 'seed' });
                  fetchQuotations();
                }
              }}
            >
              Seed Dummy
            </Button>
          )}
          {canEditSettings && (
            <Button variant="outline" onClick={() => setCustomFieldsOpen(true)} className="border-border text-muted-foreground hover:bg-muted">
              <SlidersHorizontal className="size-4 mr-2" /> Custom fields
            </Button>
          )}
          <Button 
            className="gap-2"
            onClick={() => {
              setFormQuotationId(undefined);
              setFormCloneId(undefined);
              setFormVersionId(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            New Quotation
          </Button>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search by number or contact..."
            className="pl-9 bg-background border-border"
          />
        </div>
        
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto shrink-0 bg-primary/10 border border-primary/20 rounded-md p-1 px-3">
            <span className="text-sm font-medium text-primary mr-2 hidden sm:inline-block">
              {selectedIds.size} selected
            </span>
            <Button variant="destructive" size="sm" className="h-8" disabled={bulkActionLoading} onClick={handleBulkDelete}>
              {bulkActionLoading ? <Loader2 className="size-3.5 animate-spin mr-2" /> : <Trash2 className="size-3.5 mr-2" />} Delete
            </Button>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filteredQuotations}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        storageKey="wacrm_quotations_table_columns"
        isLoading={loading}
        rowKey={(quotation) => quotation.id}
        onRowClick={(quotation) => router.push(`/quotations/${quotation.id}`)}
        selection={{
          selectedIds: selectedIds,
          onSelectAll: (checked) => setSelectedIds(checked ? new Set(filteredQuotations.map(q => q.id)) : new Set()),
          onSelect: (id, checked) => setSelectedIds(prev => {
             const next = new Set(prev);
             if (checked) next.add(id); else next.delete(id);
             return next;
          })
        }}
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Delete Quotation</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-popover-foreground font-medium">
                {deleteTarget?.quotation_number}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {formOpen && (
        <QuotationForm
          open={formOpen}
          onOpenChange={setFormOpen}
          quotationId={formQuotationId}
          cloneId={formCloneId}
          versionId={formVersionId}
          onSaved={(newId) => {
            fetchQuotations();
            if (newId) router.push(`/quotations/${newId}`);
          }}
        />
      )}
      
      {canEditSettings && <CustomFieldsManager open={customFieldsOpen} onOpenChange={setCustomFieldsOpen} />}
    </div>
  );
}
