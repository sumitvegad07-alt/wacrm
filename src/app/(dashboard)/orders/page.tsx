'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, TrendingUp, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { formatCurrency } from '@/lib/currency';
import { OrderForm } from '@/components/orders/order-form';

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
  direct: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  primary: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  secondary: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

// Status is managed through the order detail view (manage_order_status +
// update_order_status RPC). The list shows a read-only badge.
const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  Approved: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  Dispatched: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  Rejected: 'bg-red-500/10 text-red-600 border-red-500/30',
  Cancelled: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
};

export default function OrdersPage() {
  const supabase = createClient();
  const router = useRouter();
  const { accountId, defaultCurrency, hasPermission, isAdmin, isOwner } = useAuth();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [statuses, setStatuses] = useState<{ id: string; name: string; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const canCreateOrder = hasPermission('add_orders');
  const canEditOrder = hasPermission('edit_orders');

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);

    const [{ data: orderData }, { data: statusData }, { data: profiles }] = await Promise.all([
      supabase
        .from('orders')
        .select('*, order_items(count), contacts(company, name), leads(name)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      supabase.from('order_statuses').select('id, name, color').eq('account_id', accountId).order('position'),
      supabase.from('profiles').select('id, full_name').eq('account_id', accountId),
    ]);

    setStatuses(statusData || []);
    const profileMap: Record<string, string> = {};
    profiles?.forEach((p: { id: string; full_name: string }) => { profileMap[p.id] = p.full_name; });

    const rows: OrderRow[] = (orderData || []).map((o: Record<string, any>) => ({
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
    }));
    setOrders(rows);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      options: statuses.map((s) => ({ label: s.name, value: s.name })),
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

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (globalSearch) {
        const q = globalSearch.toLowerCase();
        if (!o.order_number.toLowerCase().includes(q) && !o.customerName.toLowerCase().includes(q) && !o.salesmanName.toLowerCase().includes(q)) return false;
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
  }, [orders, filterState, globalSearch]);

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
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="size-4" /> Create Order
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by order #, customer, or salesman..."
            className="pl-9 bg-background border-border"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((prev) => ({ ...prev, [id]: val }))}
        storageKey="wacrm_orders_table_columns"
        isLoading={loading}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
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
