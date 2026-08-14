'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Truck, PackageCheck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { PageLayout, PageHeader, PageToolbar, StatusBadge } from '@/components/shared';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';

interface PendingRow {
  id: string;
  order_number: string;
  customerName: string;
  date: string;
  status: string;
  ordered: number;
  delivered: number;
  difference: number;
}

const STATUS_BADGE: Record<string, string> = {
  Approved: 'bg-blue-600 text-white shadow-sm border-transparent',
  'Part Dispatch': 'bg-orange-600 text-white shadow-sm border-transparent',
};

export default function PendingDispatchPage() {
  const supabase = createClient();
  const router = useRouter();
  const { accountId, hasPermission } = useAuth();
  const canDispatch = hasPermission(PERMISSIONS.CRM.CREATE_ORDERS);

  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [globalSearch, setGlobalSearch] = useState('');

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    // An order is "pending dispatch" while its status is Approved or Part
    // Dispatch — the state machine already flips it to Dispatched once every
    // item ships, so status is the source of truth for "not fully dispatched".
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, date, status, contacts(company, name), leads(name), order_items(quantity), order_dispatches(dispatch_items(quantity))')
      .eq('account_id', accountId)
      .in('status', ['Approved', 'Part Dispatch'])
      .order('created_at', { ascending: false });

    setRows(((data || []) as any[]).map((o) => {
      const ordered = (o.order_items || []).reduce((s: number, it: any) => s + Number(it.quantity || 0), 0);
      const delivered = (o.order_dispatches || []).reduce((s: number, d: any) =>
        s + (d.dispatch_items || []).reduce((t: number, di: any) => t + Number(di.quantity || 0), 0), 0);
      return {
        id: o.id,
        order_number: o.order_number,
        customerName: o.contacts?.company || o.contacts?.name || o.leads?.name || 'Unknown',
        date: o.date,
        status: o.status,
        ordered,
        delivered,
        difference: ordered - delivered,
      };
    }));
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: ColumnDef<PendingRow>[] = [
    { id: 'order_number', label: 'Order #', type: 'text', render: (o) => <span className="font-medium font-mono text-sm">{o.order_number}</span> },
    { id: 'customerName', label: 'Customer', type: 'text', render: (o) => <span className="font-medium">{o.customerName}</span> },
    { id: 'date', label: 'Date', type: 'date', render: (o) => <span className="text-sm text-muted-foreground">{o.date ? new Date(o.date).toLocaleDateString('en-IN') : '—'}</span> },
    {
      id: 'status', label: 'Status', type: 'select',
      options: [{ label: 'Approved', value: 'Approved' }, { label: 'Part Dispatch', value: 'Part Dispatch' }],
      render: (o) => <StatusBadge status={o.status.toLowerCase()} label={o.status} />,
    },
    { id: 'ordered', label: 'Ordered', type: 'text', render: (o) => <span className="text-sm">{o.ordered}</span> },
    { id: 'delivered', label: 'Delivered', type: 'text', render: (o) => <span className="text-sm text-emerald-600">{o.delivered}</span> },
    { id: 'difference', label: 'Difference', type: 'text', render: (o) => <span className="text-sm font-medium text-amber-600">{o.difference}</span> },
    ...(canDispatch ? [{
      id: 'actions', label: '', type: 'text' as const,
      render: (o: PendingRow) => (
        <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={(e) => { e.stopPropagation(); router.push(`/dispatches/new?orderId=${o.id}`); }}>
          <Truck className="size-3.5" /> Dispatch
        </Button>
      ),
    }] : []),
  ];

  const filtered = useMemo(() => rows.filter((o) => {
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      if (!o.order_number.toLowerCase().includes(q) && !o.customerName.toLowerCase().includes(q)) return false;
    }
    for (const [colId, val] of Object.entries(filterState)) {
      if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) continue;
      if (colId === 'customerName') { if (!o.customerName.toLowerCase().includes((val as string).toLowerCase())) return false; }
      else if (colId === 'order_number') { if (!o.order_number.toLowerCase().includes((val as string).toLowerCase())) return false; }
      else if (colId === 'status') { if (!(val as string[]).includes(o.status)) return false; }
      else if (colId === 'date') { if (!isDateInFilter(o.date, val as string | string[])) return false; }
    }
    return true;
  }), [rows, filterState, globalSearch]);

  return (
    <PageLayout>
      <PageHeader
        title="Pending Dispatch"
        subtitle="Approved orders still awaiting full dispatch. Difference = ordered − delivered."
      />

      <PageToolbar
        search={{
          value: globalSearch,
          onChange: setGlobalSearch,
          placeholder: "Search by order # or customer...",
        }}
      />

      <DataTable
        columns={columns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((prev) => ({ ...prev, [id]: val }))}
        storageKey="wacrm_pending_dispatch_table_columns"
        isLoading={loading}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
      />
    </PageLayout>
  );
}
