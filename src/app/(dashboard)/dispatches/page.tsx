'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, Truck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyCustomFieldFilters, customFieldFilterKey, applyDateFilter, applyInFilter, applyTextFilter, applyExtraColumnFilters } from '@/lib/table/apply-filters';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { formatCurrency } from '@/lib/currency';
import { getVisibleTableColumns, matchesSearchableCustomFields } from '@/lib/custom-fields';
import { CustomField } from '@/types';
import { PageLayout, PageHeader } from '@/components/shared';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { extraColumns, type ExtraColumnSpec } from '@/lib/table/extra-columns';

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

/** Stored dispatches fields with no hand-written column, shown via Manage Column. */
const DISPATCH_EXTRA_COLUMNS: readonly ExtraColumnSpec<DispatchRow>[] = [
      ['transport_name', 'Transport Name', 'text'],
      ['transport_contact_no', 'Transport Contact', 'text'],
      ['tracking_number', 'Tracking No', 'text'],
      ['lr_no', 'LR No', 'text'],
      ['lr_date', 'LR Date', 'date'],
      ['invoice_date', 'Invoice Date', 'date'],
      ['dispatched_at', 'Dispatched On', 'date'],
      ['notes', 'Notes', 'text'],
];

export default function DispatchesPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId, defaultCurrency, hasPermission, isAdmin, isOwner } = useAuth();
  
  const canCreate = hasPermission(PERMISSIONS.CRM.CREATE_ORDERS);

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const tableView = useTableView("wacrm_dispatches_table_columns", {});
  const { filterState } = tableView;

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from('custom_fields').select('*')
        .eq('account_id', accountId).eq('module_name', 'dispatch');
      if (alive) setCustomFields(data || []);
    })();
    return () => { alive = false; };
  }, [accountId, supabase]);

  /**
   * One page of dispatches, searched and filtered by the database.
   * order_number, customer_name, search_text and custom_values are columns on
   * the row (migrations 20261012110000 / 20261012130000), so the order and
   * customer embeds are gone and the custom-value table is no longer read for
   * the whole account.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      let q = sb
        .from('order_dispatches')
        .select(
          'id, dispatch_number, dispatched_at, invoice_no, order_number, customer_name, custom_values, dispatch_items(quantity, order_item:order_items(price))',
          { count: 'exact' },
        )
        .eq('account_id', accountId!);

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      q = applyInFilter(q, 'customer_name', filters.customerName);
      q = applyTextFilter(q, 'dispatch_number', filters.dispatch_number);
      q = applyTextFilter(q, 'order_number', filters.order_number);
      q = applyDateFilter(q, 'dispatched_at', filters.date);
      q = applyCustomFieldFilters(q, filters, customFields);

      // The columns Manage Column offers for the rest of the stored fields.

      q = applyExtraColumnFilters(q, filters, DISPATCH_EXTRA_COLUMNS);

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

  const toRow = (d: Record<string, any>): DispatchRow => {
    const dItems = (d.dispatch_items || []) as { quantity?: number; order_item?: { price?: number } }[];
    return {
      id: d.id,
      dispatch_number: d.dispatch_number,
      order_number: d.order_number || '\u2014',
      customerName: d.customer_name || 'Unknown',
      date: d.dispatched_at,
      itemCount: dItems.length,
      invoice_no: d.invoice_no || '\u2014',
      subAmount: dItems.reduce(
        (sum, di) => sum + Number(di.quantity || 0) * Number(di.order_item?.price || 0),
        0,
      ),
      ...(d.custom_values ?? {}),
    } as DispatchRow;
  };

  const rows = useMemo(
    () => table.rows.map((d) => toRow(d as Record<string, any>)),
    [table.rows],
  );

  const exportAll = useCallback(async () => {
    const { rows: all, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return { rows: all.map((d) => toRow(d as Record<string, any>)), truncated };
  }, [supabase, buildQuery, table.search, filterState]);

  const columns: ColumnDef<DispatchRow>[] = [
    { id: 'dispatch_number', label: 'Dispatch #', type: 'text', render: (d) => <span className="font-medium font-mono text-sm">{d.dispatch_number}</span> },
    { id: 'order_number', label: 'Order #', type: 'text', render: (d) => <span className="font-mono text-sm">{d.order_number}</span> },
    { id: 'customerName', label: 'Customer', type: 'select',
      valueSource: { kind: 'distinct', module: 'dispatch', column: 'customer_name' },
      render: (d) => <span className="font-medium">{d.customerName}</span> },
    { id: 'date', label: 'Date', type: 'date', render: (d) => <span className="text-sm text-muted-foreground">{d.date ? new Date(d.date).toLocaleDateString('en-IN') : '—'}</span> },
    { id: 'itemCount', label: 'Items', type: 'text', render: (d) => <span className="text-sm">{d.itemCount}</span> },
    { id: 'invoice_no', label: 'Invoice No', type: 'text', visibleByDefault: false, render: (d) => <span className="text-sm">{d.invoice_no}</span> },
    { id: 'subAmount', label: 'Sub Amount', type: 'text', render: (d) => <span className="font-medium">{formatCurrency(d.subAmount, defaultCurrency)}</span> },
    // The rest of what a dispatch stores, so Manage Column can offer it.
    ...extraColumns<DispatchRow>(DISPATCH_EXTRA_COLUMNS),
  ];

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, rows);
  }, [columns, customFields, rows]);

  /** buildQuery already applied the search and every column filter. */
  const filtered = rows;

  return (
    <PageLayout fill>
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

      <DataTable
        fill
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search by dispatch #, order #, or customer...",
        }}
        columns={visibleColumns}
        data={filtered}
        tableView={tableView}
        isLoading={loading}
        rowKey={(d) => d.id}
        onRowClick={(d) => router.push(`/dispatches/${d.id}`)}
        serverPagination={{ ...table.serverPagination, exportAll }}
      />
    </PageLayout>
  );
}
