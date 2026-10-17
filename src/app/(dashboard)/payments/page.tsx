'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Plus, CheckCircle2, XCircle, Ban, Loader2, Edit } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyCustomFieldFilters, customFieldFilterKey, applyDateFilter, applyInFilter, applyTextFilter, applyExtraColumnFilters } from '@/lib/table/apply-filters';
import { RowActions } from '@/components/ui/data-table/row-actions';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { formatCurrency } from '@/lib/currency';
import { PaymentForm } from '@/components/payments/payment-form';
import { getVisibleTableColumns, matchesSearchableCustomFields } from '@/lib/custom-fields';
import { CustomField } from '@/types';
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge } from '@/components/shared';
import { PAYMENT_STATUSES, PAYMENT_SOURCES, getSourceLabel } from '@/lib/payments/statuses';
import { PaymentStatusBadge } from '@/components/payments/payment-status-badge';
import { extraColumns, type ExtraColumnSpec } from '@/lib/table/extra-columns';

interface PaymentRow {
  id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
  verified_amount: number | null;
  status: string;
  source: string;
  reference_number: string | null;
  payment_type_name: string;
  customerName: string;
  collectedByName: string;
}

// Mirrors payment_status_transition_allowed() in the database. An approved payment
// cannot be retrospectively Rejected — cancellation is its only reversal, and it
// requires a reason.
const LEGAL_TO: Record<string, string[]> = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Cancelled'],
};

const BULK_ACTIONS = [
  { to: 'Approved', label: 'Approve', icon: CheckCircle2, variant: 'default' as const },
  { to: 'Rejected', label: 'Reject', icon: XCircle, variant: 'destructive' as const },
];

/** Stored payments fields with no hand-written column, shown via Manage Column. */
const PAYMENT_EXTRA_COLUMNS: readonly ExtraColumnSpec<PaymentRow>[] = [
      ['reference_number', 'Reference No', 'text'],
      ['receipt_number', 'Receipt No', 'text'],
      ['notes', 'Notes', 'text'],
      ['approved_at', 'Approved On', 'date'],
      ['rejection_reason', 'Rejection Reason', 'text'],
      ['cancellation_reason', 'Cancellation Reason', 'text'],
      ['erp_reference', 'ERP Reference', 'text'],
      ['created_at', 'Created', 'date'],
];

export default function PaymentsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId, defaultCurrency, hasPermission, isAdmin, isOwner } = useAuth();


  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const tableView = useTableView("wacrm_payments_table_columns", {});
  const { filterState } = tableView;
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const canCreatePayment = hasPermission(PERMISSIONS.PAYMENTS.CREATE);
  const canApprove = hasPermission(PERMISSIONS.PAYMENTS.APPROVE);
  const canReject = hasPermission(PERMISSIONS.PAYMENTS.REJECT);
  const canEdit = hasPermission(PERMISSIONS.PAYMENTS.EDIT);
  const canCancel = hasPermission(PERMISSIONS.PAYMENTS.CANCEL);

  // Reference data, loaded once per account rather than per page of payments.
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void (async () => {
      const [{ data: profiles }, { data: fieldsData }] = await Promise.all([
        supabase.from('profiles').select('id, user_id, full_name').eq('account_id', accountId),
        supabase.from('custom_fields').select('*').eq('account_id', accountId).eq('module_name', 'payment'),
      ]);
      if (!alive) return;
      const map: Record<string, string> = {};
      profiles?.forEach((pr: { user_id: string; full_name: string }) => { map[pr.user_id] = pr.full_name; });
      setProfileMap(map);
      setCustomFields(fieldsData || []);
    })();
    return () => { alive = false; };
  }, [accountId, supabase]);

  /**
   * One page of payments, searched and filtered by the database.
   *
   * customer_name, payment_type_name, search_text and custom_values are columns
   * on the row (migrations 20261012110000 / 20261012130000), so this no longer
   * embeds contacts or payment_types and no longer fetches the custom-value
   * table for the whole account.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      let q = sb
        .from('payments')
        .select('*', { count: 'exact' })
        .eq('account_id', accountId!);

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      q = applyInFilter(q, 'customer_name', filters.customerName);
      q = applyInFilter(q, 'payment_type_name', filters.payment_type_name);
      q = applyTextFilter(q, 'payment_number', filters.payment_number);
      q = applyInFilter(q, 'source', filters.source);
      q = applyInFilter(q, 'status', filters.status);
      q = applyDateFilter(q, 'payment_date', filters.payment_date);
      q = applyCustomFieldFilters(q, filters, customFields);

      // The columns Manage Column offers for the rest of the stored fields.

      q = applyExtraColumnFilters(q, filters, PAYMENT_EXTRA_COLUMNS);


      return q.order('created_at', { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [accountId, customFields],
  );

  /** Stable dep: only changes when an ACTIVE cf_* filter's type could change the query. */
  const cfKey = customFieldFilterKey(filterState, customFields);

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    enabled: Boolean(accountId),
    deps: [accountId, cfKey],
  });

  const fetchData = table.reload;
  const loading = table.loading;

  const payments: PaymentRow[] = useMemo(
    () =>
      table.rows.map((row) => {
        const p = row as Record<string, any>;
        return {
          id: p.id,
          payment_number: p.payment_number,
          payment_date: p.payment_date,
          amount: p.amount || 0,
          verified_amount: p.verified_amount,
          status: p.status,
          source: p.source,
          reference_number: p.reference_number,
          payment_type_name: p.payment_type_name || 'Unknown',
          customerName: p.customer_name || 'Unknown',
          collectedByName: profileMap[p.user_id] || 'Unknown',
          ...(p.custom_values ?? {}),
        } as PaymentRow;
      }),
    [table.rows, profileMap],
  );

  // Selection is per page now, so a new page must not keep stale ticks.
  const pageIds = useMemo(() => payments.map((p) => p.id).join(','), [payments]);
  useEffect(() => { setSelectedIds(new Set()); }, [pageIds]);

  const exportAll = useCallback(async () => {
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return {
      rows: rows.map((r) => {
        const p = r as Record<string, any>;
        return { ...p, customerName: p.customer_name || 'Unknown', ...(p.custom_values ?? {}) };
      }),
      truncated,
    };
  }, [supabase, buildQuery, table.search, filterState]);

  useRealtimeRefresh('payments', fetchData);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      router.push('/payments/new');
    }
  }, [searchParams, router]);

  async function handleBulkStatus(newStatus: string) {
    const targets = payments.filter((p) => selectedIds.has(p.id) && (LEGAL_TO[p.status] || []).includes(newStatus));
    const skipped = selectedIds.size - targets.length;
    if (targets.length === 0) {
      toast.error(`None of the selected payments can be moved to ${newStatus}.`);
      return;
    }
    // A cancellation without a reason is refused by the database, so collect one
    // up front rather than letting every row fail.
    let bulkReason: string | null = null;
    if (newStatus === 'Cancelled') {
      bulkReason = window.prompt(`Reason for cancelling ${targets.length} payment(s):`);
      if (bulkReason === null) return;
      if (!bulkReason.trim()) { toast.error('Cancellation reason is required'); return; }
    }

    setBulkLoading(true);
    let ok = 0, failed = 0;
    for (const p of targets) {
      const { error } = await supabase.rpc('update_payment_status', {
        p_payment_id: p.id,
        p_new_status: newStatus,
        p_cancellation_reason: bulkReason?.trim() ?? undefined,
      });
      if (error) failed++; else ok++;
    }
    setBulkLoading(false);
    const parts = [`${ok} ${newStatus.toLowerCase()}`];
    if (skipped) parts.push(`${skipped} skipped (not eligible)`);
    if (failed) parts.push(`${failed} failed`);
    if (failed) toast.error(parts.join(', ')); else toast.success(parts.join(', '));
    fetchData();
  }

  const columns: ColumnDef<PaymentRow>[] = [
    {
      id: 'payment_number',
      label: 'Payment #',
      type: 'text',
      render: (p) => <span className="font-medium font-mono text-sm">{p.payment_number}</span>,
    },
    {
      id: 'customerName',
      label: 'Customer',
      type: 'select',
      valueSource: { kind: 'distinct', module: 'payment', column: 'customer_name' },
      render: (p) => <span className="font-medium">{p.customerName}</span>,
    },
    {
      id: 'payment_date',
      label: 'Date',
      type: 'date',
      render: (p) => <span className="text-sm text-muted-foreground">{new Date(p.payment_date).toLocaleDateString('en-IN')}</span>,
    },
    {
      id: 'payment_type_name',
      label: 'Type',
      type: 'select',
      valueSource: { kind: 'distinct', module: 'payment', column: 'payment_type_name' },
      render: (p) => <span className="text-sm">{p.payment_type_name}</span>,
    },
    {
      id: 'amount',
      label: 'Amount',
      type: 'text',
      render: (p) => <span className="font-medium">{formatCurrency(p.amount, defaultCurrency)}</span>,
    },
    {
      id: 'verified_amount',
      label: 'Verified',
      type: 'text',
      render: (p) => <span className="font-medium text-emerald-600">{p.verified_amount != null ? formatCurrency(p.verified_amount, defaultCurrency) : '—'}</span>,
    },
    {
      id: 'source',
      label: 'Source',
      type: 'select',
      options: PAYMENT_SOURCES.map(s => ({ label: getSourceLabel(s), value: s })),
      render: (p) => <span className="text-sm text-muted-foreground">{getSourceLabel(p.source)}</span>,
    },
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      options: PAYMENT_STATUSES.map((s) => ({ label: s, value: s })),
      render: (p) => (
        <PaymentStatusBadge status={p.status} />
      ),
    },
    {
      id: 'collectedByName',
      label: 'Collected By',
      type: 'text',
      visibleByDefault: false,
      render: (p) => <span className="text-sm">{p.collectedByName}</span>,
    },
    {
      id: 'actions',
      label: 'Action',
      type: 'text',
      // Uniform Action column: Edit only. Payments are never soft-deleted; their
      // Approve / Reject / Cancel workflow lives on the payment detail page (open
      // via this Edit icon or the row) and in the bulk action bar.
      render: (p) => (
        <RowActions onEdit={() => router.push(`/payments/${p.id}`)} />
      ),
    },
    // The rest of what a payment stores, so Manage Column can offer it.
    ...extraColumns<PaymentRow>(PAYMENT_EXTRA_COLUMNS),
  ];

  const handleInlineApprove = async (p: PaymentRow) => {
    const vAmt = window.prompt(`Enter verified amount for ${p.payment_number}:`, p.amount.toString());
    if (vAmt === null) return;
    const parsedAmt = parseFloat(vAmt);
    
    setBulkLoading(true);
    const { error } = await supabase.rpc('update_payment_status', { 
      p_payment_id: p.id, 
      p_new_status: 'Approved',
      p_verified_amount: isNaN(parsedAmt) ? p.amount : parsedAmt
    });
    setBulkLoading(false);
    
    if (error) toast.error(error.message);
    else { toast.success('Approved successfully'); fetchData(); }
  };

  const handleInlineReject = async (p: PaymentRow) => {
    const reason = window.prompt(`Reason for rejecting ${p.payment_number}:`);
    if (reason === null) return;
    if (!reason.trim()) { toast.error('Rejection reason is required'); return; }
    
    setBulkLoading(true);
    const { error } = await supabase.rpc('update_payment_status', { 
      p_payment_id: p.id, 
      p_new_status: 'Rejected',
      p_rejection_reason: reason.trim()
    });
    setBulkLoading(false);
    
    if (error) toast.error(error.message);
    else { toast.success('Rejected successfully'); fetchData(); }
  };

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, payments);
  }, [columns, customFields, payments]);

  /**
   * buildQuery pushed the search, every column filter, the date range and the
   * custom-field filters into the query, so every row returned belongs here.
   */
  const filtered = payments;

  return (
    <PageLayout>
      <PageHeader
        title="Payments"
        subtitle="Manage and track incoming payments from customers."
        actions={
          <>
            {canCreatePayment && (
              <Button onClick={() => router.push('/payments/new')} className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="size-4" /> New Payment
              </Button>
            )}
          </>
        }
      />

      <PageToolbar
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search by payment #, customer, or reference...",
        }}
      />

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={
          BULK_ACTIONS.filter(a => {
            if (a.to === 'Approved') return canApprove;
            if (a.to === 'Rejected') return canReject;
            return false;
          }).map((a) => {
            const Icon = a.icon;
            return {
              label: a.label,
              icon: <Icon className="size-4" />,
              variant: a.variant,
              onClick: () => handleBulkStatus(a.to),
              disabled: bulkLoading,
            };
          })
        }
      />

      <DataTable
        columns={visibleColumns}
        data={filtered}
        tableView={tableView}
        isLoading={loading}
        rowKey={(p) => p.id}
        onRowClick={(p) => router.push(`/payments/${p.id}`)}
        serverPagination={{ ...table.serverPagination, exportAll }}
        selection={(canApprove || canReject) ? {
          selectedIds,
          onSelectAll: (checked: boolean) => setSelectedIds(checked ? new Set(filtered.map((p) => p.id)) : new Set()),
          onSelect: (id: string, checked: boolean) => setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id); else next.delete(id);
            return next;
          }),
        } : undefined}
      />

      <PaymentForm open={createOpen} onOpenChange={setCreateOpen} onSaved={fetchData} />
    </PageLayout>
  );
}
