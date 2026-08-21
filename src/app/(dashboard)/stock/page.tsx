'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { fetchStockPositions, type StockPosition } from '@/lib/stock/financials';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StockImportDialog } from '@/components/stock/stock-import-dialog';
import { Boxes, Search, SlidersHorizontal, AlertTriangle, Upload, BarChart3 } from 'lucide-react';

export default function StockPage() {
  const supabase = createClient();
  const router = useRouter();
  const { accountId, isModuleEnabled, moduleSettingsLoaded, hasPermission } = useAuth();

  const canView = hasPermission(PERMISSIONS.STOCK.VIEW) || hasPermission(PERMISSIONS.STOCK.MANAGE);
  const canManage = hasPermission(PERMISSIONS.STOCK.MANAGE);
  const enabled = isModuleEnabled('stock');

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<StockPosition[]>([]);
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>({});
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setRows(await fetchStockPositions(supabase, accountId));
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { if (enabled && canView) load(); }, [enabled, canView, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (lowOnly && r.closing > 0) return false;
      if (q && !(r.productName.toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q))) return false;
      for (const [colId, val] of Object.entries(filterState)) {
        if (!val) continue;
        const cell = String((r as any)[colId] ?? '').toLowerCase();
        if (!cell.includes(String(val).toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, query, lowOnly, filterState]);

  const outOfStock = useMemo(() => rows.filter((r) => r.closing <= 0).length, [rows]);

  const columns: ColumnDef<StockPosition>[] = [
    {
      id: 'productName', label: 'Product', sortable: true, type: 'text',
      render: (r) => (
        <span className="font-medium">
          {r.productName}
          {r.active === false && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">inactive</span>}
        </span>
      ),
    },
    { id: 'sku', label: 'SKU', sortable: true, type: 'text', render: (r) => <span className="text-muted-foreground">{r.sku || '—'}</span> },
    { id: 'opening', label: 'Opening', sortable: true, render: (r) => <span className="tabular-nums text-muted-foreground">{r.opening}</span> },
    { id: 'totalIn', label: 'In', sortable: true, render: (r) => <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{r.totalIn ? `+${r.totalIn}` : '—'}</span> },
    { id: 'totalOut', label: 'Out', sortable: true, render: (r) => <span className="tabular-nums text-red-500">{r.totalOut ? `-${r.totalOut}` : '—'}</span> },
    { id: 'closing', label: 'Closing', sortable: true, render: (r) => <span className={`tabular-nums font-semibold ${r.closing <= 0 ? 'text-red-500' : ''}`}>{r.closing}</span> },
  ];

  if (moduleSettingsLoaded && !enabled) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-md rounded-lg border border-dashed border-border p-8 text-center">
          <Boxes className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Stock Management is off</h2>
          <p className="mt-1 text-sm text-muted-foreground">An admin can turn it on in Settings → Catalogue Settings.</p>
          <Link href="/settings?tab=pricing" className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' mt-4'}>Open Catalogue Settings</Link>
        </div>
      </div>
    );
  }
  if (moduleSettingsLoaded && !canView) {
    return <div className="p-8 text-center text-sm text-muted-foreground">You don&apos;t have permission to view stock.</div>;
  }

  return (
    <div className="w-full p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2"><Boxes className="h-5 w-5" /> Stock</h1>
          <p className="text-sm text-muted-foreground">Closing stock per product, calculated automatically. Click a product for its full ledger and activity.</p>
        </div>
        {outOfStock > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" /> {outOfStock} out of stock
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState((p) => ({ ...p, [id]: val }))}
        storageKey="wacrm_stock_table_columns"
        isLoading={loading}
        rowKey={(r) => r.productId}
        onRowClick={(r) => router.push(`/stock/${r.productId}`)}
        emptyMessage={rows.length === 0 ? 'No stock-tracked products yet. Turn on “Maintain stock” and set an opening figure on a product to start.' : 'No products match your filter.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product or SKU…" className="h-9 w-52 pl-8" />
            </div>
            <Button variant={lowOnly ? 'default' : 'outline'} size="sm" onClick={() => setLowOnly((v) => !v)}>
              <SlidersHorizontal className="mr-1.5 h-4 w-4" /> {lowOnly ? 'Low / out only' : 'Low / out'}
            </Button>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="mr-1.5 h-4 w-4" /> Import
              </Button>
            )}
            <Link href="/reports/stock" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <BarChart3 className="mr-1.5 h-4 w-4" /> Report
            </Link>
          </div>
        }
      />

      {importOpen && (
        <StockImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={load} />
      )}
    </div>
  );
}
