'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, Truck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { formatCurrency } from '@/lib/currency';
import { getVisibleTableColumns, matchesSearchableCustomFields } from '@/lib/custom-fields';
import { CustomField } from '@/types';
import { PageLayout, PageHeader, PageToolbar } from '@/components/shared';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';

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
  const searchParams = useSearchParams();
  const { accountId, defaultCurrency, hasPermission, isAdmin, isOwner } = useAuth();
  
  const canCreate = hasPermission(PERMISSIONS.CRM.CREATE_ORDERS);

  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [globalSearch, setGlobalSearch] = useState('');

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [{ data }, { data: fieldsData }] = await Promise.all([
      supabase
        .from('order_dispatches')
        .select('id, dispatch_number, dispatched_at, invoice_no, order:orders(order_number, contacts(company, name), leads(name)), dispatch_items(quantity, order_item:order_items(price))')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      supabase.from('custom_fields').select('*').eq('account_id', accountId).eq('module_name', 'dispatch'),
    ]);

    setCustomFields(fieldsData || []);

    let dispatchValues: any[] = [];
    if (data && data.length > 0) {
      const dispatchIds = data.map((d: any) => d.id);
      const { data: vals } = await supabase.from('dispatch_custom_values').select('*').in('dispatch_id', dispatchIds);
      dispatchValues = vals || [];
    }

    setRows(((data || []) as any[]).map((d) => {
      const dItems = (d.dispatch_items || []) as any[];
      const subAmount = dItems.reduce((s, di) => s + Number(di.quantity || 0) * Number(di.order_item?.price || 0), 0);
      const customData: Record<string, any> = {};
      dispatchValues.filter((v: any) => v.dispatch_id === d.id).forEach((v: any) => {
        customData[`cf_${v.custom_field_id}`] = v.value;
      });
      return {
        id: d.id,
        dispatch_number: d.dispatch_number,
        order_number: d.order?.order_number || '—',
        customerName: d.order?.contacts?.company || d.order?.contacts?.name || d.order?.leads?.name || 'Unknown',
        date: d.dispatched_at,
        itemCount: dItems.length,
        invoice_no: d.invoice_no || '—',
        subAmount,
        ...customData,
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

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, rows);
  }, [columns, customFields, rows]);

  const filtered = useMemo(() => rows.filter((d) => {
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      if (!d.dispatch_number.toLowerCase().includes(q) && !d.order_number.toLowerCase().includes(q) && !d.customerName.toLowerCase().includes(q) && !matchesSearchableCustomFields(d, customFields, globalSearch)) return false;
    }
    for (const [colId, val] of Object.entries(filterState)) {
      if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) continue;
      if (colId === 'customerName') { if (!d.customerName.toLowerCase().includes((val as string).toLowerCase())) return false; }
      else if (colId === 'dispatch_number') { if (!d.dispatch_number.toLowerCase().includes((val as string).toLowerCase())) return false; }
      else if (colId === 'order_number') { if (!d.order_number.toLowerCase().includes((val as string).toLowerCase())) return false; }
      else if (colId === 'date') { if (!isDateInFilter(d.date, val as string | string[])) return false; }
    }
    return true;
  }), [rows, filterState, globalSearch, customFields]);

  return (
    <PageLayout>
      <PageHeader
        title="Dispatches"
        subtitle="Shipments recorded against your approved orders."
        actions={
          canCreate ? (
            <Button onClick={() => router.push('/dispatches/new')} className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="size-4" /> Create Dispatch
            </Button>
          ) : undefined
        }
      />

      <PageToolbar
        search={{
          value: globalSearch,
          onChange: setGlobalSearch,
          placeholder: "Search by dispatch #, order #, or customer...",
        }}
      />

      <DataTable
        columns={visibleColumns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((prev) => ({ ...prev, [id]: val }))}
        storageKey="wacrm_dispatches_table_columns"
        isLoading={loading}
        rowKey={(d) => d.id}
        onRowClick={(d) => router.push(`/dispatches/${d.id}`)}
      />
    </PageLayout>
  );
}
