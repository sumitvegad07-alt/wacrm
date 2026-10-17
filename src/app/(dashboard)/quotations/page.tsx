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
  Eye,
  EyeOff,
  RotateCcw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { logQuotationActivity } from '@/lib/quotations';
import { QuotationForm } from '@/components/quotations/quotation-form';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';

import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyCustomFieldFilters, customFieldFilterKey, applyDateFilter, applyInFilter, applyTextFilter } from '@/lib/table/apply-filters';
import { RowActions } from '@/components/ui/data-table/row-actions';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { getVisibleTableColumns, matchesSearchableCustomFields } from '@/lib/custom-fields';
import { isDateInFilter } from "@/lib/date-filters";
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge } from '@/components/shared';
import {
  inactiveSelection,
  reactivateDisabledReason,
  bulkReactivate,
  reactivatedMessage,
} from '@/lib/table/bulk-activation';

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { extraColumns } from '@/lib/table/extra-columns';

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-amber-600 text-white shadow-sm border-transparent',
  Sent: 'bg-blue-600 text-white shadow-sm border-transparent',
  Approved: 'bg-emerald-600 text-white shadow-sm border-transparent',
  Rejected: 'bg-red-600 text-white shadow-sm border-transparent',
};

export default function QuotationsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEditSettings = useCan('edit-settings');
  const { account } = useAuth();

  
  // DataTable state
  // Default filter shows Active quotations (Inactive/all via the Status column filter).
  const tableView = useTableView("wacrm_quotations_table_columns", { record_status: ['active'] });
  const { filterState } = tableView;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Lookups
  const [customFields, setCustomFields] = useState<any[]>([]);

  const [bulkActionLoading, setBulkActionLoading] = useState(false);

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
      router.push('/quotations/new');
    }
  }, [searchParams, router]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from('custom_fields').select('*').eq('module_name', 'quotation');
      if (alive) setCustomFields(data || []);
    })();
    return () => { alive = false; };
  }, [supabase]);

  /**
   * One page of quotations, searched and filtered by the database.
   *
   * customer_name, creator_name, search_text and custom_values are columns on
   * the row (migrations 20261012120000 / 20261012130000). creator_name matters
   * here: quotations.user_id references auth.users, so the creator could never
   * be embedded via a PostgREST relationship and used to need its own query.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      let q = sb
        .from('quotations')
        .select(
          '*, contact:contacts!quotations_contact_id_fkey(name, company), lead:leads!quotations_lead_id_fkey(name, contact_person)',
          { count: 'exact' },
        )
        .eq('is_latest_version', true);

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      q = applyTextFilter(q, 'quotation_number', filters.quotation_number);
      q = applyInFilter(q, 'status', filters.status);
      q = applyTextFilter(q, 'customer_name', filters.contact);
      q = applyTextFilter(q, 'creator_name', filters.creator);
      q = applyDateFilter(q, 'date', filters.date);
      q = applyCustomFieldFilters(q, filters, customFields);

      const want = filters.record_status as string[] | undefined;
      if (Array.isArray(want) && want.length === 1) q = q.eq('is_active', want[0] === 'active');

      return q.order('created_at', { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [customFields],
  );

  /** Stable dep: only changes when an ACTIVE cf_* filter's type could change the query. */
  const cfKey = customFieldFilterKey(filterState, customFields);

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    deps: [cfKey],
  });

  const fetchQuotations = table.reload;
  const loading = table.loading;

  const toRow = (q: Record<string, any>) => ({
    ...q,
    ...(q.custom_values ?? {}),
    creator: q.creator_name ? { full_name: q.creator_name, email: null } : null,
  });

  const quotations = useMemo(
    () => table.rows.map((q) => toRow(q as Record<string, any>)),
    [table.rows],
  );

  const exportAll = useCallback(async () => {
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return { rows: rows.map((q) => toRow(q as Record<string, any>)), truncated };
  }, [supabase, buildQuery, table.search, filterState]);


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
    const { error } = await supabase.from('quotations').update({ is_active: false }).eq('id', deleteTarget.id);
    if (error) toast.error('Failed to deactivate quotation');
    else { toast.success('Quotation moved to Inactive'); fetchQuotations(); }
    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  async function handleReactivate(id: string) {
    const { error } = await supabase.from('quotations').update({ is_active: true }).eq('id', id);
    if (error) toast.error('Failed to re-activate quotation');
    else { toast.success('Quotation re-activated'); fetchQuotations(); }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Move ${selectedIds.size} selected quotation(s) to Inactive? They can be re-activated later.`)) return;

    setBulkActionLoading(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from('quotations').update({ is_active: false }).in('id', ids);
    if (!error) {
      toast.success(`${ids.length} quotation(s) moved to Inactive`);
      fetchQuotations();
    } else {
      toast.error('Failed to update quotations');
    }
    setBulkActionLoading(false);
  }

  /**
   * Restore every selected quotation that is currently Inactive. Not confirmed:
   * re-activating is not destructive, and the button is disabled unless the
   * selection holds something Inactive.
   */
  async function handleBulkReactivate() {
    const ids = inactiveSelection(quotations, selectedIds);
    if (ids.length === 0) return;
    setBulkActionLoading(true);
    const { error } = await bulkReactivate(supabase, 'quotations', ids);
    if (error) toast.error('Failed to re-activate quotations');
    else {
      toast.success(reactivatedMessage(ids.length, 'quotation'));
      setSelectedIds(new Set());
      fetchQuotations();
    }
    setBulkActionLoading(false);
  }

  const inactiveSelectedIds = inactiveSelection(quotations, selectedIds);

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
              <span className="font-medium text-foreground">{quotation.lead.name}</span>
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
      // Money — needs a range filter, not a contains match.
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
        <StatusBadge status={quotation.status.toLowerCase()} label={quotation.status} />
      )
    },
    {
      id: "creator",
      label: "Created By",
      type: "text",
      render: (quotation) => <span className="text-muted-foreground text-sm">{quotation.creator?.full_name || quotation.creator?.email || '-'}</span>
    },
    {
      id: "record_status",
      label: "Record Status",
      type: "select",
      visibleByDefault: true,
      options: [ { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" } ],
      render: (quotation) => {
        const active = quotation.is_active !== false;
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
      id: "actions",
      label: "Action",
      visibleByDefault: true,
      // Uniform Action column: Edit + Delete. Status transitions (Mark Sent /
      // Approve / Reject) and New Version live on the quotation detail page,
      // opened by clicking the row.
      render: (quotation) => (
        <RowActions
          isInactive={quotation.is_active === false}
          onEdit={() => {
            setFormQuotationId(quotation.id);
            setFormCloneId(undefined);
            setFormVersionId(undefined);
            setFormOpen(true);
          }}
          onDelete={() => { setDeleteTarget(quotation); setDeleteConfirmOpen(true); }}
          onReactivate={() => handleReactivate(quotation.id)}
          deleteTitle="Move to Inactive"
        />
      )
    },
    // The rest of what a quotation stores, so Manage Column can offer it.
    ...extraColumns<any>([
      ['version', 'Version', 'number'],
      ['valid_until', 'Valid Until', 'date'],
      ['sub_total', 'Sub Total', 'currency'],
      ['tax_total', 'Tax', 'currency'],
      ['terms_conditions', 'Terms & Conditions', 'text'],
      ['created_at', 'Created', 'date'],
    ]),
  ];

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, quotations);
  }, [columns, customFields, quotations]);

  /** buildQuery already applied the search and every column filter. */
  const filteredQuotations = quotations;

  return (
    <PageLayout>
      <PageHeader
        title="Quotations"
        subtitle="Manage and track your quotations."
        actions={
          <>
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
            <Button
              data-tour="quotation-add"
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => router.push('/quotations/new')}
            >
              <Plus className="size-4" />
              New Quotation
            </Button>
          </>
        }
      />

      <PageToolbar
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search by number or contact...",
        }}
      />

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          {
            label: "Re-activate",
            icon: <RotateCcw className="size-4" />,
            variant: "outline",
            onClick: handleBulkReactivate,
            disabled: bulkActionLoading || inactiveSelectedIds.length === 0,
            title: reactivateDisabledReason(selectedIds.size, inactiveSelectedIds.length),
          },
          {
            label: "Move to Inactive",
            icon: <Trash2 className="size-4" />,
            variant: "destructive",
            onClick: handleBulkDelete,
            disabled: bulkActionLoading,
          },
        ]}
      />

      <DataTable
        columns={visibleColumns}
        data={filteredQuotations}
        tableView={tableView}
        isLoading={loading}
        rowKey={(quotation) => quotation.id}
        onRowClick={(quotation) => router.push(`/quotations/${quotation.id}`)}
        serverPagination={{ ...table.serverPagination, exportAll }}
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
            <DialogTitle className="text-popover-foreground">Move Quotation to Inactive</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Move{' '}
              <span className="text-popover-foreground font-medium">
                {deleteTarget?.quotation_number}
              </span>
              {' '}to Inactive? It will be hidden from the default list but you can re-activate it anytime via “Show Inactive”.
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
              Move to Inactive
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
    </PageLayout>
  );
}
