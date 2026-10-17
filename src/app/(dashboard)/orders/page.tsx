'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, TrendingUp, Pencil, CheckCircle2, XCircle, Ban, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { useDataScope } from '@/hooks/use-data-scope';
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { RowActions } from '@/components/ui/data-table/row-actions';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { dateFilterToRange } from '@/lib/date-filters';
import { formatCurrency } from '@/lib/currency';
import { extraColumns } from '@/lib/table/extra-columns';
import { OrderForm } from '@/components/orders/order-form';
import { getVisibleTableColumns } from '@/lib/custom-fields';
import { CustomField } from '@/types';
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, StatusBadge, ConfirmDialog } from '@/components/shared';
import { ORDER_STATUSES } from '@/lib/orders/statuses';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';

/** Exactly the columns buildQuery selects. */
interface OrderQueryRow {
  id: string;
  order_number: string;
  date: string;
  total_amount: number | null;
  status: string;
  classification: 'direct' | 'primary' | 'secondary';
  user_id: string;
  contact_id: string | null;
  lead_id: string | null;
  customer_name: string | null;
  salesman_name: string | null;
  order_items?: { count: number }[] | null;
}

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
  Closed: 'bg-zinc-800 text-white shadow-sm border-transparent',
};

// Legal transitions for BULK actions only — a bulk action applies solely to
// rows where that transition is legal from their current status. Deliberately
// narrower than ORDER_STATUS_TRANSITIONS (the full SQL state machine): reaching
// 'Dispatched' goes through the per-order dispatch flow, never a bulk button.
const LEGAL_TO: Record<string, string[]> = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Rejected', 'Cancelled', 'Closed', 'Dispatched'],
  'Part Dispatch': ['Cancelled', 'Closed', 'Dispatched'],
  Dispatched: ['Closed'],
};
// Order status is fixed, not configurable — see src/lib/orders/statuses.ts.
const ALL_STATUSES: readonly string[] = ORDER_STATUSES;

// Bulk status actions (deliberately no bulk Dispatch — that's per-order).
const BULK_ACTIONS: { to: string; label: string; icon: typeof CheckCircle2; variant: 'default' | 'outline' | 'destructive' }[] = [
  { to: 'Approved', label: 'Approve', icon: CheckCircle2, variant: 'default' },
  { to: 'Rejected', label: 'Reject', icon: XCircle, variant: 'destructive' },
  { to: 'Cancelled', label: 'Cancel', icon: Ban, variant: 'outline' },
  { to: 'Closed', label: 'Close Order', icon: CheckCircle2, variant: 'outline' },
];

export default function OrdersPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId, defaultCurrency, hasPermission, isAdmin, isOwner } = useAuth();
  const scope = useDataScope();

  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const tableView = useTableView("wacrm_orders_table_columns", {});
  /** Custom field values for the rows on the CURRENT page only, keyed by order id. */
  const [customValues, setCustomValues] = useState<Record<string, Record<string, unknown>>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [hierarchyEnabled, setHierarchyEnabled] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<OrderRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const canCreateOrder = hasPermission(PERMISSIONS.CRM.CREATE_ORDERS);
  const canEditOrder = hasPermission(PERMISSIONS.CRM.EDIT_ORDERS);
  const canManageStatus = hasPermission(PERMISSIONS.CRM.MANAGE_ORDER_STATUS);

  // Reference data, loaded once. Small, fixed-size, and needed to render the
  // custom-field columns — not something to re-fetch per page of orders.
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void (async () => {
      const [{ data: fieldsData }, { data: acctData }] = await Promise.all([
        supabase.from('custom_fields').select('*').eq('account_id', accountId).eq('module_name', 'order'),
        supabase.from('accounts').select('settings').eq('id', accountId).single(),
      ]);
      if (!alive) return;
      setCustomFields(fieldsData || []);
      setHierarchyEnabled(!!acctData?.settings?.order_settings?.hierarchy_enabled);
    })();
    return () => { alive = false; };
  }, [accountId, supabase]);

  /**
   * One page of orders, searched and filtered by the database.
   *
   * This screen used to download every order in the account, join contacts,
   * leads and profiles in the browser to work out a customer and salesman
   * name, pull every order_custom_values row, and then search and filter the
   * lot in JavaScript. `customer_name`, `salesman_name` and `search_text` are
   * now columns on the row (migration 20261012100000), kept current by
   * triggers, so all of that is one indexed query.
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      // Directional data-scoping (app-level; RLS is the real boundary).
      let q = scope.apply(
        sb
          .from('orders')
          .select(
            'id, order_number, date, total_amount, status, classification, user_id, contact_id, lead_id, customer_name, salesman_name, order_items(count)',
            { count: 'exact' },
          )
          .eq('account_id', accountId!),
        'user_id',
      );

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      const f = filters as FilterState;
      // Customer and Salesman are value lists, so they match exactly.
      if (Array.isArray(f.customerName) && f.customerName.length) {
        q = q.in('customer_name', f.customerName as string[]);
      }
      if (Array.isArray(f.salesmanName) && f.salesmanName.length) {
        q = q.in('salesman_name', f.salesmanName as string[]);
      }
      if (f.order_number) q = q.ilike('order_number', `%${String(f.order_number)}%`);
      if (Array.isArray(f.classification) && f.classification.length) {
        q = q.in('classification', f.classification as string[]);
      }
      if (Array.isArray(f.status) && f.status.length) {
        q = q.in('status', f.status as string[]);
      }
      if (f.date) {
        const { gte, lte } = dateFilterToRange(f.date as string | string[]);
        if (gte) q = q.gte('date', gte);
        if (lte) q = q.lte('date', lte);
      }

      return q.order('created_at', { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    [accountId, scope],
  );

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    enabled: Boolean(accountId) && scope.ready,
    deps: [accountId, scope.key],
  });

  const fetchData = table.reload;

  /**
   * Custom field values for the twenty rows on screen, not for the whole table.
   * Runs after each page lands; `cf_<id>` is the shape the column renderers and
   * the export expect.
   */
  const pageIds = useMemo(
    () => table.rows.map((o) => String(o.id)).join(','),
    [table.rows],
  );
  useEffect(() => {
    if (!pageIds) {
      setCustomValues({});
      return;
    }
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from('order_custom_values')
        .select('order_id, custom_field_id, value')
        .in('order_id', pageIds.split(','));
      if (!alive) return;
      const byOrder: Record<string, Record<string, unknown>> = {};
      (data || []).forEach((v: { order_id: string; custom_field_id: string; value: unknown }) => {
        (byOrder[v.order_id] ??= {})[`cf_${v.custom_field_id}`] = v.value;
      });
      setCustomValues(byOrder);
    })();
    return () => { alive = false; };
  }, [pageIds, supabase]);

  const orders: OrderRow[] = useMemo(
    () =>
      table.rows.map((o) => {
        const row = o as unknown as OrderQueryRow;
        return {
          id: row.id,
          order_number: row.order_number,
          date: row.date,
          total_amount: row.total_amount || 0,
          status:
            Object.keys(LEGAL_TO).find((k) => k.toLowerCase() === (row.status || '').toLowerCase()) ||
            row.status,
          classification: row.classification,
          user_id: row.user_id,
          contact_id: row.contact_id,
          lead_id: row.lead_id,
          customerName: row.customer_name || 'Unknown',
          itemCount: row.order_items?.[0]?.count ?? 0,
          salesmanName: row.salesman_name || 'Unknown',
          ...(customValues[row.id] ?? {}),
        } as OrderRow;
      }),
    [table.rows, customValues],
  );

  const loading = table.loading;
  const { filterState } = tableView;

  // Selecting rows is per-page now, so a new page must not keep stale ticks.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [pageIds]);

  useRealtimeRefresh('orders', fetchData);

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

  // The "dustbin" for an order is a Cancel — orders are never deleted, and only
  // certain statuses can transition to Cancelled (LEGAL_TO).
  const doCancelOrder = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    const { error } = await supabase.rpc('update_order_status', { p_order_id: cancelTarget.id, p_new_status: 'Cancelled' });
    setCancelling(false);
    if (error) toast.error('Failed to cancel order');
    else { toast.success('Order cancelled'); fetchData(); }
    setCancelTarget(null);
  };

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
      type: 'select',
      valueSource: { kind: 'distinct', module: 'order', column: 'customer_name' },
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
    ...(hierarchyEnabled ? [{
      id: 'classification',
      label: 'Sales Type',
      type: 'select' as const,
      options: [
        { label: 'Primary', value: 'primary' },
        { label: 'Secondary', value: 'secondary' },
      ],
      render: (o: OrderRow) => (
        <Badge variant="outline" className={`capitalize text-xs ${CLASS_BADGE[o.classification]}`}>
          {o.classification}
        </Badge>
      ),
    }] : []),
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      options: ALL_STATUSES.map((s) => ({ label: s, value: s })),
      render: (o) => (
        <StatusBadge status={o.status.toLowerCase()} label={o.status} />
      ),
    },
    {
      id: 'salesmanName',
      label: 'Salesman',
      type: 'select',
      valueSource: { kind: 'distinct', module: 'order', column: 'salesman_name' },
      visibleByDefault: false,
      render: (o) => <span className="text-sm">{o.salesmanName}</span>,
    },
    ...(canEditOrder ? [{
      id: 'actions',
      label: 'Action',
      type: 'text' as const,
      // Uniform Action column: Edit + Cancel (the order "dustbin"). Cancel is
      // only offered when the current status can legally move to Cancelled.
      render: (o: OrderRow) => {
        const canCancel = (LEGAL_TO[o.status] || []).includes('Cancelled');
        return (
          <RowActions
            onEdit={() => setEditOrderId(o.id)}
            onDelete={canCancel ? () => setCancelTarget(o) : undefined}
            deleteTitle="Cancel order"
          />
        );
      },
    }] : []),
    // The rest of what an order stores, so Manage Column can offer it. All
    // hidden until somebody ticks one.
    ...extraColumns<OrderRow>([
      ['sub_total', 'Sub Total', 'currency'],
      ['discount_total', 'Discount', 'currency'],
      ['tax_total', 'Tax', 'currency'],
      ['notes', 'Notes', 'text'],
      ['gst_type', 'GST Type', 'text'],
      ['party_gstin', 'Party GSTIN', 'text'],
      ['created_at', 'Created', 'date'],
    ]),
  ];

  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, orders);
  }, [columns, customFields, orders]);

  /**
   * Nothing to filter here any more — `buildQuery` pushed the search, the
   * per-column filters and the date range into the query, so every row the
   * server returned is a row that belongs on screen.
   */
  const filtered = orders;

  /**
   * Export CSV must still mean "everything matching the current search and
   * filters", not "the twenty rows on screen", so it walks the same query.
   */
  const exportAll = useCallback(async () => {
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return {
      rows: rows.map((o) => {
        const row = o as unknown as OrderQueryRow;
        return {
          ...row,
          customerName: row.customer_name || 'Unknown',
          salesmanName: row.salesman_name || 'Unknown',
          itemCount: row.order_items?.[0]?.count ?? 0,
        };
      }),
      truncated,
    };
  }, [supabase, buildQuery, table.search, filterState]);

  return (
    <PageLayout>
      <PageHeader
        title="Orders"
        subtitle="Orders placed by your field team. Update status and create dispatches here."
        actions={
          <>
            {(isAdmin || isOwner) && (
              <Button variant="outline" className="gap-2" onClick={() => router.push('/orders/sync-health')}>
                <TrendingUp className="size-4" /> Sync Health
              </Button>
            )}
            {canCreateOrder && (
              <Button data-tour="order-add" onClick={() => router.push('/orders/new')} className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="size-4" /> Create Order
              </Button>
            )}
          </>
        }
      />

      <PageToolbar
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search by order #, customer, or salesman...",
        }}
      />

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={
          canManageStatus
            ? BULK_ACTIONS.map((a) => {
                const Icon = a.icon;
                // How many of the currently-selected orders are actually in a
                // state this transition is legal from. When it's zero, the
                // button is disabled with a tooltip instead of letting the
                // user click into the confusing "None of the selected orders
                // can be moved to X" error.
                const eligible = orders.filter(
                  (o) => selectedIds.has(o.id) && (LEGAL_TO[o.status] || []).includes(a.to),
                ).length;
                return {
                  label: eligible > 0 ? `${a.label} (${eligible})` : a.label,
                  icon: <Icon className="size-4" />,
                  variant: a.variant,
                  onClick: () => handleBulkStatus(a.to),
                  disabled: bulkLoading || eligible === 0,
                  title:
                    eligible === 0
                      ? `None of the selected orders can be moved to ${a.to}.`
                      : eligible < selectedIds.size
                        ? `${eligible} of ${selectedIds.size} selected order(s) can be moved to ${a.to}; the rest will be skipped.`
                        : undefined,
                };
              })
            : []
        }
      />

      <DataTable
        columns={visibleColumns}
        data={filtered}
        tableView={tableView}
        isLoading={loading}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        serverPagination={{ ...table.serverPagination, exportAll }}
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

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        title="Cancel order"
        description={
          <>
            Cancel order <span className="font-medium text-foreground">{cancelTarget?.order_number}</span>? This sets its status to Cancelled.
          </>
        }
        variant="danger"
        confirmLabel="Cancel order"
        loading={cancelling}
        onConfirm={doCancelOrder}
      />
    </PageLayout>
  );
}
