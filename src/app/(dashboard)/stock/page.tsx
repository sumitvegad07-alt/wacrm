'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from "@/components/ui/link";
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { fetchStockPositions, type StockPosition } from '@/lib/stock/financials';
import { PageLayout, PageHeader } from '@/components/shared';
import { DataTable } from '@/components/ui/data-table/data-table';
import { useTableView } from '@/hooks/use-table-view';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StockImportDialog } from '@/components/stock/stock-import-dialog';
import { Boxes, Search, SlidersHorizontal, AlertTriangle, Upload, BarChart3, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { previewRecalculate, type RecalculatePreview } from '@/lib/stock/recalculate-preview';

export default function StockPage() {
  const supabase = createClient();
  const { accountId, isModuleEnabled, moduleSettingsLoaded, hasPermission } = useAuth();

  const [recalculating, setRecalculating] = useState(false);
  const [preview, setPreview] = useState<RecalculatePreview | null>(null);

  const canView = hasPermission(PERMISSIONS.STOCK.VIEW) || hasPermission(PERMISSIONS.STOCK.MANAGE);
  const canManage = hasPermission(PERMISSIONS.STOCK.MANAGE);
  const enabled = isModuleEnabled('stock');

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<StockPosition[]>([]);
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const tableView = useTableView("wacrm_stock_table_columns", {});
  const { filterState } = tableView;
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setRows(await fetchStockPositions(supabase, accountId));
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { if (enabled && canView) load(); }, [enabled, canView, load]);

  /**
   * Re-run the stock reconciliation over the whole account.
   *
   * Everything that moves stock is a trigger that begins "if the module is off,
   * do nothing", and nothing goes back over what it skipped. So an account that
   * switches Stock Management on — the default is off — has a ledger that
   * ignores every order closed before that moment, and ticking "Maintain stock"
   * on a product that has already been ordered leaves those orders unposted.
   * This asks the database to work out the difference and post it.
   */
  /**
   * Show what recalculating would post, BEFORE posting it.
   *
   * Recalculating reconciles orders the ledger has never seen, which includes
   * every order closed before Stock Management was switched on. If the opening
   * balance or a manual stock-in was counted AFTER those orders shipped, that
   * figure already accounts for them and posting them again subtracts the same
   * sale twice. Only the person who counted the stock knows which it is, so
   * they get the list and the oldest date first.
   */
  const openRecalculate = useCallback(async () => {
    if (!accountId) return;
    setRecalculating(true);
    try {
      const { data: account } = await supabase
        .from('accounts')
        .select('settings')
        .eq('id', accountId)
        .maybeSingle();
      const event =
        ((account as { settings?: { stock_settings?: { stock_out_event?: string } } } | null)
          ?.settings?.stock_settings?.stock_out_event) ?? 'order_closed';
      setPreview(await previewRecalculate(supabase, accountId, event));
    } catch {
      toast.error('Could not work out what would change.');
    } finally {
      setRecalculating(false);
    }
  }, [accountId, supabase]);

  const recalculate = useCallback(async () => {
    setPreview(null);
    setRecalculating(true);
    try {
      const { data, error } = await supabase.rpc('stock_recalculate_account');
      if (error) throw error;
      const added = Number((data as { entries_added?: number } | null)?.entries_added ?? 0);
      toast.success(
        added > 0
          ? `Stock recalculated — ${added} ${added === 1 ? 'entry' : 'entries'} added.`
          : 'Stock recalculated — everything was already up to date.',
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : 'Could not recalculate stock.',
      );
    } finally {
      setRecalculating(false);
    }
  }, [supabase, load]);

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
    <PageLayout fill>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2"><Boxes className="h-5 w-5" /> Stock</h1>
          <p className="text-sm text-muted-foreground">Closing stock per product, calculated automatically. Click a product for its full ledger and activity.</p>
        </div>
        {outOfStock > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" /> {outOfStock} out of stock
          </span>
        )}
        {/* Hosts the table's controls, which used to sit on a line of their
            own below this one. */}
        <PageHeader title="Stock" className="py-0" />
      </div>

      <DataTable
        fill
        columns={columns}
        data={filtered}
        tableView={tableView}
        isLoading={loading}
        rowKey={(r) => r.productId}
        rowHref={(r) => `/stock/${r.productId}`}
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
            {/* Catch-up. Stock only moves automatically while the module is ON
                and "Maintain stock" is ticked on the product, and nothing ever
                goes back for what happened before either was true — so an
                account that switches Stock Management on starts from whatever
                the ledger happens to hold. This re-runs the reconciliation over
                every order, dispatch and opening balance. Safe to press twice:
                the reconcile posts only the difference, so a second run adds
                nothing. */}
            {canManage && (
              <Button variant="outline" size="sm" onClick={openRecalculate} disabled={recalculating}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${recalculating ? 'animate-spin' : ''}`} />
                {recalculating ? 'Recalculating…' : 'Recalculate'}
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

      {/* Mounted only while there is something to confirm, the same shape as
          StockImportDialog above. Left permanently mounted with
          `open={preview !== null}`, this dialog would not close: clearing the
          state emptied its body but the dialog stayed on screen. */}
      {preview !== null && (
      <Dialog open onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recalculate stock</DialogTitle>
          </DialogHeader>
          {preview && preview.orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every order is already counted in your stock. There is nothing to recalculate.
            </p>
          ) : preview ? (
            <div className="space-y-3 text-sm">
              <p>
                This will count{' '}
                <strong>
                  {preview.orders.length} {preview.orders.length === 1 ? 'order' : 'orders'}
                </strong>{' '}
                into your stock that are not counted yet
                {preview.oldest ? <>, the oldest from <strong>{preview.oldest}</strong></> : null}.
              </p>
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="font-medium text-amber-700 dark:text-amber-400">Check this first</p>
                <p className="mt-1 text-muted-foreground">
                  If you counted your opening stock, or added stock by hand, <em>after</em> these
                  orders went out, that figure already has them taken off. Counting them again
                  would take the same goods off twice. If you are not sure, leave it.
                </p>
              </div>
              <div className="max-h-40 overflow-auto rounded-md border border-border p-2">
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Orders</p>
                <p className="text-muted-foreground">
                  {preview.orders.map((o) => `${o.orderNumber} (${o.closedOn ?? '—'})`).join(', ')}
                </p>
                {preview.products.length > 0 && (
                  <>
                    <p className="mt-2 mb-1 text-xs font-medium uppercase text-muted-foreground">
                      Products
                    </p>
                    <p className="text-muted-foreground">
                      {preview.products
                        .map((p) => (p.tracked ? p.name : `${p.name} (stock not tracked — skipped)`))
                        .join(', ')}
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {/* DialogClose, not a Button with an onClick: this is Base UI, and
                a plain button inside the footer does not dismiss the dialog —
                the first version of this left Cancel dead. */}
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            {preview && preview.orders.length > 0 && (
              <Button onClick={recalculate} disabled={recalculating}>
                {recalculating ? 'Recalculating…' : 'Yes, count them'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </PageLayout>
  );
}
