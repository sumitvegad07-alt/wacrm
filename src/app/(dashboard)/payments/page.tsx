'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Plus, CheckCircle2, XCircle, Ban, Loader2, Edit } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { formatCurrency } from '@/lib/currency';
import { PaymentForm } from '@/components/payments/payment-form';
import { getVisibleTableColumns, matchesSearchableCustomFields } from '@/lib/custom-fields';
import { CustomField } from '@/types';
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge } from '@/components/shared';
import { PAYMENT_STATUSES, PAYMENT_SOURCES, getSourceLabel } from '@/lib/payments/statuses';
import { PaymentStatusBadge } from '@/components/payments/payment-status-badge';

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

const LEGAL_TO: Record<string, string[]> = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Rejected', 'Cancelled'],
};

const BULK_ACTIONS = [
  { to: 'Approved', label: 'Approve', icon: CheckCircle2, variant: 'default' as const },
  { to: 'Rejected', label: 'Reject', icon: XCircle, variant: 'destructive' as const },
];

export default function PaymentsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId, defaultCurrency, hasPermission, isAdmin, isOwner } = useAuth();

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const canCreatePayment = hasPermission('add_payments');
  const canApprove = hasPermission('approve_payments');

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);

    const [{ data: paymentData }, { data: profiles }, { data: fieldsData }] = await Promise.all([
      supabase
        .from('payments')
        .select('*, contacts(company, name), payment_types(name)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, user_id, full_name').eq('account_id', accountId),
      supabase.from('custom_fields').select('*').eq('account_id', accountId).eq('module_name', 'payment'),
    ]);

    setCustomFields(fieldsData || []);

    let paymentValues: any[] = [];
    if (paymentData && paymentData.length > 0) {
      const paymentIds = paymentData.map((p: any) => p.id);
      const { data: vals } = await supabase.from('payment_custom_values').select('*').in('payment_id', paymentIds);
      paymentValues = vals || [];
    }

    const profileMap: Record<string, string> = {};
    profiles?.forEach((p: { user_id: string; full_name: string }) => { profileMap[p.user_id] = p.full_name; });

    const rows: PaymentRow[] = (paymentData || []).map((p: Record<string, any>) => {
      const customData: Record<string, any> = {};
      paymentValues.filter((v: any) => v.payment_id === p.id).forEach((v: any) => {
        customData[`cf_${v.custom_field_id}`] = v.value;
      });
      return {
        id: p.id,
        payment_number: p.payment_number,
        payment_date: p.payment_date,
        amount: p.amount || 0,
        verified_amount: p.verified_amount,
        status: p.status,
        source: p.source,
        reference_number: p.reference_number,
        payment_type_name: p.payment_types?.name || 'Unknown',
        customerName: p.contacts?.company || p.contacts?.name || 'Unknown',
        collectedByName: profileMap[p.user_id] || 'Unknown',
        ...customData,
      };
    });
    setPayments(rows);
    setSelectedIds(new Set());
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    setBulkLoading(true);
    let ok = 0, failed = 0;
    for (const p of targets) {
      const { error } = await supabase.rpc('update_payment_status', { p_payment_id: p.id, p_new_status: newStatus });
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
      type: 'text',
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
      type: 'text',
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
      label: '',
      type: 'text',
      render: (p) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {p.status === 'Pending' && canApprove && (
            <>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={(e) => { e.stopPropagation(); handleInlineApprove(p); }} title="Approve">
                <CheckCircle2 className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); handleInlineReject(p); }} title="Reject">
                <XCircle className="size-4" />
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); router.push(`/payments/${p.id}`); }} title="Edit">
            <Edit className="size-4" />
          </Button>
        </div>
      ),
    },
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

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      if (globalSearch) {
        const q = globalSearch.toLowerCase();
        if (
          !p.payment_number.toLowerCase().includes(q) && 
          !p.customerName.toLowerCase().includes(q) && 
          !(p.reference_number || '').toLowerCase().includes(q) &&
          !matchesSearchableCustomFields(p, customFields, globalSearch)
        ) return false;
      }
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === 'customerName') { if (!p.customerName.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === 'payment_type_name') { if (!p.payment_type_name.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === 'payment_number') { if (!p.payment_number.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === 'source') { if (!(val as string[]).includes(p.source)) return false; }
        else if (colId === 'status') { if (!(val as string[]).includes(p.status)) return false; }
        else if (colId === 'payment_date') { if (!isDateInFilter(p.payment_date, val as string | string[])) return false; }
      }
      return true;
    });
  }, [payments, filterState, globalSearch, customFields]);

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
          value: globalSearch,
          onChange: setGlobalSearch,
          placeholder: "Search by payment #, customer, or reference...",
        }}
      />

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={
          canApprove
            ? BULK_ACTIONS.map((a) => {
                const Icon = a.icon;
                return {
                  label: a.label,
                  icon: <Icon className="size-4" />,
                  variant: a.variant,
                  onClick: () => handleBulkStatus(a.to),
                  disabled: bulkLoading,
                };
              })
            : []
        }
      />

      <DataTable
        columns={visibleColumns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((prev) => ({ ...prev, [id]: val }))}
        storageKey="wacrm_payments_table_columns"
        isLoading={loading}
        rowKey={(p) => p.id}
        onRowClick={(p) => router.push(`/payments/${p.id}`)}
        selection={canApprove ? {
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
