'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Truck, PackageCheck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyDateFilter, applyInFilter, applyTextFilter } from '@/lib/table/apply-filters';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from '@/lib/date-filters';
import { PageLayout, PageHeader, StatusBadge } from '@/components/shared';
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

  const tableView = useTableView("wacrm_pending_dispatch_table_columns", {});
  const { filterState } = tableView;

  /**
   * One page of orders awaiting dispatch, searched and filtered by the database.
   *
   * An order is "pending dispatch" while its status is Approved or Part
   * Dispatch — the state machine flips it to Dispatched once every item ships,
   * so status is the source of truth for "not fully dispatched".
   *
   * customer_name and search_text are columns on orders (migration
   * 20261012100000), so this no longer embeds contacts or leads.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      let q = sb
        .from('orders')
        .select(
          'id, order_number, date, status, customer_name, order_items(quantity), order_dispatches(dispatch_items(quantity))',
          { count: 'exact' },
        )
        .eq('account_id', accountId!)
        .in('status', ['Approved', 'Part Dispatch']);

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      q = applyTextFilter(q, 'customer_name', filters.customerName);
      q = applyTextFilter(q, 'order_number', filters.order_number);
      q = applyInFilter(q, 'status', filters.status);
      q = applyDateFilter(q, 'date', filters.date);

      return q.order('created_at', { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [accountId],
  );

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    enabled: Boolean(accountId),
    deps: [accountId],
  });

  const fetchData = table.reload;
  const loading = table.loading;

  const toRow = (o: Record<string, any>): PendingRow => {
    const ordered = (o.order_items || []).reduce(
      (sum: number, it: { quantity?: number }) => sum + Number(it.quantity || 0), 0);
    const delivered = (o.order_dispatches || []).reduce(
      (sum: number, d: { dispatch_items?: { quantity?: number }[] }) =>
        sum + (d.dispatch_items || []).reduce((t: number, di) => t + Number(di.quantity || 0), 0), 0);
    return {
      id: o.id,
      order_number: o.order_number,
      customerName: o.customer_name || 'Unknown',
      date: o.date,
      status: o.status,
      ordered,
      delivered,
      difference: ordered - delivered,
    };
  };

  const rows = useMemo(() => table.rows.map((o) => toRow(o as Record<string, any>)), [table.rows]);

  const exportAll = useCallback(async () => {
    const { rows: all, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return { rows: all.map((o) => toRow(o as Record<string, any>)), truncated };
  }, [supabase, buildQuery, table.search, filterState]);

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

  /** buildQuery already applied the search and every column filter. */
  const filtered = rows;

  return (
    <PageLayout fill>
      <PageHeader
        title="Pending Dispatch"
        subtitle="Approved orders still awaiting full dispatch. Difference = ordered − delivered."
      />

      <DataTable
        fill
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search by order # or customer...",
        }}
        columns={columns}
        data={filtered}
        tableView={tableView}
        isLoading={loading}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        serverPagination={{ ...table.serverPagination, exportAll }}
      />
    </PageLayout>
  );
}
