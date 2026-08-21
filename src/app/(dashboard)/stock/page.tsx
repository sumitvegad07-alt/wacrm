'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { fetchStockPositions, type StockPosition } from '@/lib/stock/financials';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StockAdjustDialog } from '@/components/stock/stock-adjust-dialog';
import { StockLedgerSheet } from '@/components/stock/stock-ledger-sheet';
import { Loader2, Boxes, Search, History, SlidersHorizontal, AlertTriangle } from 'lucide-react';

export default function StockPage() {
  const supabase = createClient();
  const { accountId, isModuleEnabled, moduleSettingsLoaded, hasPermission } = useAuth();

  const canView = hasPermission(PERMISSIONS.STOCK.VIEW) || hasPermission(PERMISSIONS.STOCK.MANAGE);
  const canManage = hasPermission(PERMISSIONS.STOCK.MANAGE);
  const enabled = isModuleEnabled('stock');

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<StockPosition[]>([]);
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const [adjust, setAdjust] = useState<StockPosition | null>(null);
  const [ledger, setLedger] = useState<StockPosition | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const data = await fetchStockPositions(supabase, accountId);
    setRows(data);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    if (enabled && canView) load();
  }, [enabled, canView, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (lowOnly && r.closing > 0) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q);
    });
  }, [rows, query, lowOnly]);

  const outOfStock = useMemo(() => rows.filter((r) => r.closing <= 0).length, [rows]);

  // ── guards ──
  if (moduleSettingsLoaded && !enabled) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-md rounded-lg border border-dashed border-border p-8 text-center">
          <Boxes className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Stock Management is off</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An admin can turn it on in Settings → Catalogue Settings.
          </p>
          <Link href="/settings?tab=pricing" className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' mt-4'}>
            Open Catalogue Settings
          </Link>
        </div>
      </div>
    );
  }

  if (moduleSettingsLoaded && !canView) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        You don&apos;t have permission to view stock.
      </div>
    );
  }

  return (
    <div className="w-full p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Boxes className="h-5 w-5" /> Stock
          </h1>
          <p className="text-sm text-muted-foreground">
            Closing stock per product, calculated automatically from opening, orders, dispatches
            and adjustments.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {outOfStock > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" /> {outOfStock} out of stock
            </span>
          )}
          <Link href="/reports/stock" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Stock report
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search product or SKU…"
            className="pl-9"
          />
        </div>
        <Button
          variant={lowOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setLowOnly((v) => !v)}
        >
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          {lowOnly ? 'Showing low/out of stock' : 'Low / out of stock'}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? 'No stock-tracked products yet. Set “Maintain stock” and an opening figure on a product to start.'
            : 'No products match your filter.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Product</th>
                <th className="px-4 py-2.5 font-medium">SKU</th>
                <th className="px-4 py-2.5 font-medium text-right">Opening</th>
                <th className="px-4 py-2.5 font-medium text-right">In</th>
                <th className="px-4 py-2.5 font-medium text-right">Out</th>
                <th className="px-4 py-2.5 font-medium text-right">Closing</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.productId} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium">
                    {r.productName}
                    {r.active === false && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.sku || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.opening}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {r.totalIn ? `+${r.totalIn}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-500">
                    {r.totalOut ? `-${r.totalOut}` : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${r.closing <= 0 ? 'text-red-500' : ''}`}>
                    {r.closing}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setLedger(r)}>
                        <History className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setAdjust(r)}>
                          Adjust
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adjust && (
        <StockAdjustDialog
          open={!!adjust}
          onOpenChange={(o) => { if (!o) setAdjust(null); }}
          productId={adjust.productId}
          productName={adjust.productName}
          closing={adjust.closing}
          onDone={load}
        />
      )}
      {ledger && (
        <StockLedgerSheet
          open={!!ledger}
          onOpenChange={(o) => { if (!o) setLedger(null); }}
          productId={ledger.productId}
          productName={ledger.productName}
        />
      )}
    </div>
  );
}
