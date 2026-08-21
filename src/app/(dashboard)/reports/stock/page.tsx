'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { fetchStockPositions, toNumber, type StockPosition } from '@/lib/stock/financials';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Boxes, Download } from 'lucide-react';

type Tab = 'position' | 'ledger' | 'low';

interface LedgerRow {
  id: string;
  quantity: number;
  entry_type: string;
  reason_code: string | null;
  source_type: string | null;
  source_ref: string | null;
  created_at: string;
  products: { name: string; sku: string | null } | null;
}

const TYPE_LABEL: Record<string, string> = {
  opening: 'Opening',
  manual_in: 'Stock In',
  manual_out: 'Stock Out',
  sale_out: 'Sale',
  reversal: 'Reversal',
};

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StockReportPage() {
  const supabase = createClient();
  const { accountId, isModuleEnabled, moduleSettingsLoaded, hasPermission } = useAuth();
  const canView = hasPermission(PERMISSIONS.STOCK.VIEW) || hasPermission(PERMISSIONS.STOCK.MANAGE);
  const enabled = isModuleEnabled('stock');

  const [tab, setTab] = useState<Tab>('position');
  const [positions, setPositions] = useState<StockPosition[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  const loadPositions = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setPositions(await fetchStockPositions(supabase, accountId));
    setLoading(false);
  }, [accountId, supabase]);

  const loadLedger = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('stock_ledger')
      .select('id, quantity, entry_type, reason_code, source_type, source_ref, created_at, products(name, sku)')
      .eq('account_id', accountId)
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .order('created_at', { ascending: false });
    setLedger((data as unknown as LedgerRow[]) ?? []);
    setLoading(false);
  }, [accountId, supabase, from, to]);

  useEffect(() => {
    if (!enabled || !canView) return;
    if (tab === 'ledger') loadLedger();
    else loadPositions();
  }, [enabled, canView, tab, loadPositions, loadLedger]);

  const lowStock = useMemo(() => positions.filter((p) => p.closing <= 0), [positions]);

  if (moduleSettingsLoaded && !enabled) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Stock Management is off. An admin can enable it in Settings → Catalogue Settings.
      </div>
    );
  }
  if (moduleSettingsLoaded && !canView) {
    return <div className="p-8 text-center text-sm text-muted-foreground">You don&apos;t have permission to view stock.</div>;
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'position', label: 'Closing position' },
    { key: 'ledger', label: 'Movement ledger' },
    { key: 'low', label: 'Low / out of stock' },
  ];

  return (
    <div className="w-full p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2"><Boxes className="h-5 w-5" /> Stock Report</h1>
          <p className="text-sm text-muted-foreground">Closing position, every movement, and what&apos;s run out.</p>
        </div>
        <Link href="/stock" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Manage stock</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ledger' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv('stock-ledger.csv', [
                ['Date', 'Product', 'SKU', 'Type', 'Qty', 'Reason', 'Source'],
                ...ledger.map((r) => [
                  new Date(r.created_at).toLocaleDateString(),
                  r.products?.name ?? '',
                  r.products?.sku ?? '',
                  TYPE_LABEL[r.entry_type] ?? r.entry_type,
                  toNumber(r.quantity),
                  r.reason_code ?? '',
                  r.source_ref ?? '',
                ]),
              ])
            }
          >
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </div>
      )}

      {(tab === 'position' || tab === 'low') && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const src = tab === 'low' ? lowStock : positions;
              downloadCsv(`stock-${tab}.csv`, [
                ['Product', 'SKU', 'Opening', 'In', 'Out', 'Closing'],
                ...src.map((p) => [p.productName, p.sku ?? '', p.opening, p.totalIn, p.totalOut, p.closing]),
              ]);
            }}
          >
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : tab === 'ledger' ? (
        ledger.length === 0 ? (
          <Empty>No stock movements in this period.</Empty>
        ) : (
          <TableWrap head={['Date', 'Product', 'Type', 'Qty', 'Reason / Source']}>
            {ledger.map((r) => {
              const qty = toNumber(r.quantity);
              return (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{r.products?.name ?? '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{TYPE_LABEL[r.entry_type] ?? r.entry_type}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${qty < 0 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {qty > 0 ? `+${qty}` : qty}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.source_ref || r.reason_code || '—'}</td>
                </tr>
              );
            })}
          </TableWrap>
        )
      ) : (
        (() => {
          const src = tab === 'low' ? lowStock : positions;
          if (src.length === 0) return <Empty>{tab === 'low' ? 'Nothing is low or out of stock.' : 'No stock-tracked products yet.'}</Empty>;
          return (
            <TableWrap head={['Product', 'SKU', 'Opening', 'In', 'Out', 'Closing']} numericFrom={2}>
              {src.map((p) => (
                <tr key={p.productId} className="border-t border-border/60">
                  <td className="px-4 py-2 font-medium">{p.productName}</td>
                  <td className="px-4 py-2 text-muted-foreground">{p.sku || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{p.opening}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{p.totalIn ? `+${p.totalIn}` : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-500">{p.totalOut ? `-${p.totalOut}` : '—'}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${p.closing <= 0 ? 'text-red-500' : ''}`}>{p.closing}</td>
                </tr>
              ))}
            </TableWrap>
          );
        })()
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

function TableWrap({ head, children, numericFrom }: { head: string[]; children: React.ReactNode; numericFrom?: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2.5 font-medium ${numericFrom !== undefined && i >= numericFrom ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
