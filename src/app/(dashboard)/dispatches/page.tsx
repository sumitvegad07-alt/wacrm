'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, Truck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { formatCurrency } from '@/lib/currency';

interface DispatchRow {
  id: string;
  dispatch_number: string;
  order_number: string;
  customerName: string;
  date: string;
  itemCount: number;
  invoice_no: string;
  subAmount: number;
}

export default function DispatchesPage() {
  const supabase = createClient();
  const router = useRouter();
  const { accountId, defaultCurrency, hasPermission } = useAuth();
  const canCreate = hasPermission('add_orders');

  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [globalSearch, setGlobalSearch] = useState('');

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('order_dispatches')
      .select('id, dispatch_number, dispatched_at, invoice_no, order:orders(order_number, contacts(company, name), leads(name)), dispatch_items(quantity, order_item:order_items(price))')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    setRows(((data || []) as any[]).map((d) => {
      const dItems = (d.dispatch_items || []) as any[];
      const subAmount = dItems.reduce((s, di) => s + Number(di.quantity || 0) * Number(di.order_item?.price || 0), 0);
      return {
        id: d.id,
        dispatch_number: d.dispatch_number,
        order_number: d.order?.order_number || '—',
        customerName: d.order?.contacts?.company || d.order?.contacts?.name || d.order?.leads?.name || 'Unknown',
        date: d.dispatched_at,
        itemCount: dItems.length,
        invoice_no: d.invoice_no || '—',
        subAmount,
      };
    }));
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: ColumnDef<DispatchRow>[] = [
    { id: 'dispatch_number', label: 'Dispatch #', type: 'text', render: (d) => <span className="font-medium font-mono text-sm">{d.dispatch_number}</span> },
    { id: 'order_number', label: 'Order #', type: 'text', render: (d) => <span className="font-mono text-sm">{d.order_number}</span> },
    { id: 'customerName', label: 'Customer', type: 'text', render: (d) => <span className="font-medium">{d.customerName}</span> },
    { id: 'date', label: 'Date', type: 'date', render: (d) => <span className="text-sm text-muted-foreground">{d.date ? new Date(d.date).toLocaleDateString('en-IN') : '—'}</span> },
    { id: 'itemCount', label: 'Items', type: 'text', render: (d) => <span className="text-sm">{d.itemCount}</span> },
    { id: 'invoice_no', label: 'Invoice No', type: 'text', visibleByDefault: false, render: (d) => <span className="text-sm">{d.invoice_no}</span> },
    { id: 'subAmount', label: 'Sub Amount', type: 'text', render: (d) => <span className="font-medium">{formatCurrency(d.subAmount, defaultCurrency)}</span> },
  ];

  const filtered = useMemo(() => rows.filter((d) => {
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      if (!d.dispatch_number.toLowerCase().includes(q) && !d.order_number.toLowerCase().includes(q) && !d.customerName.toLowerCase().includes(q)) return false;
    }
    for (const [colId, val] of Object.entries(filterState)) {
      if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) continue;
      if (colId === 'customerName') { if (!d.customerName.toLowerCase().includes((val as string).toLowerCase())) return false; }
      else if (colId === 'dispatch_number') { if (!d.dispatch_number.toLowerCase().includes((val as string).toLowerCase())) return false; }
      else if (colId === 'order_number') { if (!d.order_number.toLowerCase().includes((val as string).toLowerCase())) return false; }
      else if (colId === 'date') { if (!isDateInFilter(d.date, val as string | string[])) return false; }
    }
    return true;
  }), [rows, filterState, globalSearch]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Truck className="size-6" /> Dispatches</h1>
          <p className="text-sm text-muted-foreground mt-1">Shipments recorded against your approved orders.</p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push('/dispatches/new')} className="gap-2"><Plus className="size-4" /> Create Dispatch</Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by dispatch #, order #, or customer..." className="pl-9 bg-background border-border" value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((prev) => ({ ...prev, [id]: val }))}
        storageKey="wacrm_dispatches_table_columns"
        isLoading={loading}
        rowKey={(d) => d.id}
        onRowClick={(d) => router.push(`/dispatches/${d.id}`)}
      />
    </div>
  );
}
