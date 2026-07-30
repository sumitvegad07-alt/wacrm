'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, TrendingUp, Pencil, CheckCircle2, XCircle, Ban, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { formatCurrency } from '@/lib/currency';
import { OrderForm } from '@/components/orders/order-form';
import { getVisibleTableColumns, matchesSearchableCustomFields } from '@/lib/custom-fields';
import { CustomField } from '@/types';

interface OrderRow {
  id: string;
  order_number: string;
  date: string;
  total_amount: number;
  status: string;
  classification: 'direct' | 'primary' | 'secondary';
  user_id: string;
  contact_id: string | null;
  lead_id: string | null;
  customerName: string;
  itemCount: number;
  salesmanName: string;
}

const CLASS_BADGE: Record<string, string> = {
  direct: 'bg-slate-600 text-white shadow-sm border-transparent',
  primary: 'bg-blue-600 text-white shadow-sm border-transparent',
  secondary: 'bg-amber-600 text-white shadow-sm border-transparent',
};

// Per-row status is a read-only badge; changes go through update_order_status
// (single via detail view, or the bulk bar below), never a direct write.
const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-amber-600 text-white shadow-sm border-transparent',
  Approved: 'bg-blue-600 text-white shadow-sm border-transparent',
  'Part Dispatch': 'bg-orange-600 text-white shadow-sm border-transparent',
  Dispatched: 'bg-emerald-600 text-white shadow-sm border-transparent',
  Rejected: 'bg-red-600 text-white shadow-sm border-transparent',
  Cancelled: 'bg-slate-600 text-white shadow-sm border-transparent',
};

// Legal transitions per the SQL state machine — a bulk action only applies to
// rows where the transition is legal from their current status.
const LEGAL_TO: Record<string, string[]> = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Rejected', 'Cancelled'],
  'Part Dispatch': ['Cancelled'],
};
// Fixed order statuses (the configurable order_statuses table is retired).
const ALL_STATUSES = ['Pending', 'Approved', 'Part Dispatch', 'Dispatched', 'Rejected', 'Cancelled'];

// Bulk status actions (deliberately no bulk Dispatch — that's per-order).
const BULK_ACTIONS: { to: string; label: string; icon: typeof CheckCircle2; variant: 'default' | 'outline' | 'destructive' }[] = [
  { to: 'Approved', label: 'Approve', icon: CheckCircle2, variant: 'default' },
  { to: 'Rejected', label: 'Reject', icon: XCircle, variant: 'destructive' },
  { to: 'Cancelled', label: 'Cancel', icon: Ban, variant: 'outline' },
];

export default function OrdersPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId, defaultCurrency, hasPermission, isAdmin, isOwner } = useAuth();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const canCreateOrder = hasPermission('add_orders');
  const canEditOrder = hasPermission('edit_orders');
  const canManageStatus = hasPermission('manage_order_status');

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);

    const [{ data: orderData }, { data: profiles }, { data: fieldsData }] = await Promise.all([
      supabase
        .from('orders')
        .select('*, order_items(count), contacts(company, name), leads(name)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').eq('account_id', accountId),
      supabase.from('custom_fields').select('*').eq('account_id', accountId).eq('module_name', 'order'),
    ]);

    setCustomFields(fieldsData || []);

    let orderValues: any[] = [];
    if (orderData && orderData.length > 0) {
      const orderIds = orderData.map((o: any) => o.id);
      const { data: vals } = await supabase.from('order_custom_values').select('*').in('order_id', orderIds);
      orderValues = vals || [];
    }

    const profileMap: Record<string, string> = {};
    profiles?.forEach((p: { id: string; full_name: string }) => { profileMap[p.id] = p.full_name; });

    const rows: OrderRow[] = (orderData || []).map((o: Record<string, any>) => {
      const customData: Record<string, any> = {};
      orderValues.filter((v: any) => v.order_id === o.id).forEach((v: any) => {
        customData[`cf_${v.custom_field_id}`] = v.value;
      });
      return {
        id: o.id,
        order_number: o.order_number,
        date: o.date,
        total_amount: o.total_amount || 0,
        status: o.status,
        classification: o.classification,
        user_id: o.user_id,
        contact_id: o.contact_id,
        lead_id: o.lead_id,
        customerName: o.contacts?.company || o.contacts?.name || o.leads?.name || 'Unknown',
        itemCount: o.order_items?.[0]?.count ?? 0,
        salesmanName: profileMap[o.user_id] || 'Unknown',
        ...customData,
      };
    });
    setOrders(rows);
    setSelectedIds(new Set());
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      router.push('/orders/new');
    }
  }, [searchParams, router]);

  // Bulk status change over the selected rows. Each order goes through the
  // update_order_status RPC (validates transition + manage_order_status +
  // logs), so we only attempt rows where the transition is legal from their
  // current status and report a summary. No bulk dispatch — that's per-order.
  async function handleBulkStatus(newStatus: string) {
    const targets = orders.filter((o) => selectedIds.has(o.id) && (LEGAL_TO[o.status] || []).includes(newStatus));
    const skipped = selectedIds.size - targets.length;
    if (targets.length === 0) {
      toast.error(`None of the selected orders can be moved to ${newStatus}.`);
      return;
    }
    setBulkLoading(true);
    let ok = 0, failed = 0;
    for (const o of targets) {
      const { error } = await supabase.rpc('update_order_status', { p_order_id: o.id, p_new_status: newStatus });
      if (error) failed++; else ok++;
    }
    setBulkLoading(false);
    const parts = [`${ok} ${newStatus.toLowerCase()}`];
    if (skipped) parts.push(`${skipped} skipped (not eligible)`);
    if (failed) parts.push(`${failed} failed`);
    if (failed) toast.error(parts.join(', ')); else toast.success(parts.join(', '));
    fetchData();
  }

  const columns: ColumnDef<OrderRow>[] = [
    {
      id: 'order_number',
      label: 'Order #',
      type: 'text',
      render: (o) => <span className="font-medium font-mono text-sm">{o.order_number}</span>,
    },
    {
      id: 'customerName',
      label: 'Customer',
      type: 'text',
      render: (o) => <span className="font-medium">{o.customerName}</span>,
    },
    {
      id: 'date',
      label: 'Date',
      type: 'date',
      render: (o) => <span className="text-sm text-muted-foreground">{new Date(o.date).toLocaleDateString('en-IN')}</span>,
    },
    {
      id: 'itemCount',
      label: 'Items',
      type: 'text',
      render: (o) => <span className="text-sm">{o.itemCount}</span>,
    },
    {
      id: 'total_amount',
      label: 'Total',
      type: 'text',
      render: (o) => <span className="font-medium">{formatCurrency(o.total_amount, defaultCurrency)}</span>,
    },
    {
      id: 'classification',
      label: 'Type',
      type: 'select',
      options: [
        { label: 'Direct', value: 'direct' },
        { label: 'Primary', value: 'primary' },
        { label: 'Secondary', value: 'secondary' },
      ],
      render: (o) => (
        <Badge variant="outline" className={`capitalize text-xs ${CLASS_BADGE[o.classification]}`}>
          {o.classification}
        </Badge>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      options: ALL_STATUSES.map((s) => ({ label: s, value: s })),
      render: (o) => (
        <Badge variant="outline" className={`text-xs ${STATUS_BADGE[o.status] || 'bg-slate-500/10 text-slate-500 border-slate-500/20'}`}>
          {o.status}
        </Badge>
      ),
    },
    {
      id: 'salesmanName',
      label: 'Salesman',
      type: 'text',
      visibleByDefault: false,
      render: (o) => <span className="text-sm">{o.salesmanName}</span>,
    },
    ...(canEditOrder ? [{
      id: 'actions',
      label: '',
      type: 'text' as const,
      render: (o: OrderRow) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1"
          onClick={(e) => { e.stopPropagation(); setEditOrderId(o.id); }}
        >
          <Pencil className="size-3.5" /> Edit
        </Button>
      ),
    }] : []),
  ];

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, orders);
  }, [columns, customFields, orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (globalSearch) {
        const q = globalSearch.toLowerCase();
        if (!o.order_number.toLowerCase().includes(q) && !o.customerName.toLowerCase().includes(q) && !o.salesmanName.toLowerCase().includes(q) && !matchesSearchableCustomFields(o, customFields, globalSearch)) return false;
      }
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) continue;
        if (colId === 'customerName') { if (!o.customerName.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === 'salesmanName') { if (!o.salesmanName.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === 'order_number') { if (!o.order_number.toLowerCase().includes((val as string).toLowerCase())) return false; }
        else if (colId === 'classification') { if (!(val as string[]).includes(o.classification)) return false; }
        else if (colId === 'status') { if (!(val as string[]).includes(o.status)) return false; }
        else if (colId === 'date') { if (!isDateInFilter(o.date, val as string | string[])) return false; }
      }
      return true;
    });
  }, [orders, filterState, globalSearch, customFields]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Orders placed by your field team. Update status and create dispatches here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(isAdmin || isOwner) && (
            <Button variant="outline" className="gap-2" onClick={() => router.push('/orders/sync-health')}>
              <TrendingUp className="size-4" /> Sync Health
            </Button>
          )}
          {canCreateOrder && (
            <Button onClick={() => router.push('/orders/new')} className="gap-2">
              <Plus className="size-4" /> Create Order
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by order #, customer, or salesman..."
            className="pl-9 bg-background border-border"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </div>

        {/* Bulk status bar — appears when rows are selected (needs manage_order_status) */}
        {canManageStatus && selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto shrink-0 bg-primary/10 border border-primary/20 rounded-md p-1.5 px-3">
            <span className="text-sm font-medium text-primary mr-1">{selectedIds.size} selected</span>
            {BULK_ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <Button key={a.to} variant={a.variant} size="sm" className="h-8 gap-1.5" disabled={bulkLoading} onClick={() => handleBulkStatus(a.to)}>
                  {bulkLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />} {a.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <DataTable
        columns={visibleColumns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((prev) => ({ ...prev, [id]: val }))}
        storageKey="wacrm_orders_table_columns"
        isLoading={loading}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        selection={canManageStatus ? {
          selectedIds,
          onSelectAll: (checked: boolean) => setSelectedIds(checked ? new Set(filtered.map((o) => o.id)) : new Set()),
          onSelect: (id: string, checked: boolean) => setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id); else next.delete(id);
            return next;
          }),
        } : undefined}
      />

      <OrderForm open={createOpen} onOpenChange={setCreateOpen} onSaved={fetchData} />
      <OrderForm
        open={!!editOrderId}
        orderId={editOrderId}
        onOpenChange={(o) => { if (!o) setEditOrderId(null); }}
        onSaved={fetchData}
      />
    </div>
  );
}
