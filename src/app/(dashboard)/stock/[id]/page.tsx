'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { toNumber, type StockPosition } from '@/lib/stock/financials';
import { Timeline } from '@/components/shared/timeline';
import { StockAdjustDialog } from '@/components/stock/stock-adjust-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Loader2, Boxes, ArrowLeft, SlidersHorizontal, BarChart3 } from 'lucide-react';

interface LedgerRow {
  id: string;
  quantity: number;
  entry_type: string;
  reason_code: string | null;
  source_type: string | null;
  source_id: string | null;
  source_ref: string | null;
  voucher_no: string | null;
  notes: string | null;
  created_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  opening: 'Opening', manual_in: 'Stock In', manual_out: 'Stock Out', sale_out: 'Sale', reversal: 'Reversal',
};

function refHref(row: LedgerRow): string | null {
  if (!row.source_id) return null;
  if (row.source_type === 'order') return `/orders/${row.source_id}`;
  if (row.source_type === 'dispatch') return `/dispatches/${row.source_id}`;
  return null;
}

export default function StockDetailPage() {
  const supabase = createClient();
  const router = useRouter();
  const { id: productId } = useParams<{ id: string }>();
  const { accountId, isModuleEnabled, moduleSettingsLoaded, hasPermission } = useAuth();
  const canView = hasPermission(PERMISSIONS.STOCK.VIEW) || hasPermission(PERMISSIONS.STOCK.MANAGE);
  const canManage = hasPermission(PERMISSIONS.STOCK.MANAGE);
  const enabled = isModuleEnabled('stock');

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<{ name: string; sku: string | null; unit: string | null } | null>(null);
  const [position, setPosition] = useState<StockPosition | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [activities, setActivities] = useState<Record<string, any>[]>([]);
  const [tasks, setTasks] = useState<Record<string, any>[]>([]);
  const [tab, setTab] = useState<'overview' | 'ledger'>('overview');
  const [adjustOpen, setAdjustOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId || !productId) return;
    setLoading(true);
    const [prodRes, posRes, ledgerRes, actRes, taskRes] = await Promise.all([
      supabase.from('products').select('name, sku, unit').eq('id', productId).single(),
      supabase.from('stock_positions').select('*').eq('account_id', accountId).eq('product_id', productId).maybeSingle(),
      supabase.from('stock_ledger').select('id, quantity, entry_type, reason_code, source_type, source_id, source_ref, voucher_no, notes, created_at').eq('product_id', productId).order('created_at', { ascending: false }),
      // module_activities.user_id FKs auth.users, not profiles — fetch plainly, enrich below.
      supabase.from('module_activities').select('*').eq('module_name', 'product').eq('record_id', productId).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('product_id', productId).order('created_at', { ascending: false }),
    ]);

    setProduct(prodRes.data as any);
    setPosition(posRes.data ? {
      productId, productName: (posRes.data as any).product_name, sku: (posRes.data as any).sku,
      unit: (posRes.data as any).unit, active: (posRes.data as any).active,
      opening: toNumber((posRes.data as any).opening), totalIn: toNumber((posRes.data as any).total_in),
      totalOut: toNumber((posRes.data as any).total_out), closing: toNumber((posRes.data as any).closing),
      lastMovementAt: (posRes.data as any).last_movement_at,
    } : null);
    setLedger((ledgerRes.data as LedgerRow[]) ?? []);
    setTasks((taskRes.data as Record<string, any>[]) ?? []);

    const acts = (actRes.data as Record<string, any>[]) ?? [];
    const userIds = Array.from(new Set(acts.map((a) => a.user_id).filter(Boolean)));
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
      const pmap = (profs ?? []).reduce((m: Record<string, any>, p: any) => { m[p.user_id] = p; return m; }, {});
      setActivities(acts.map((a) => ({ ...a, user: pmap[a.user_id] || null })));
    } else {
      setActivities(acts);
    }
    setLoading(false);
  }, [accountId, productId, supabase]);

  useEffect(() => { if (enabled && canView) load(); }, [enabled, canView, load]);

  const withBalance = useMemo(() => {
    let running = 0;
    return [...ledger].reverse().map((r) => { running += toNumber(r.quantity); return { ...r, balance: running }; }).reverse();
  }, [ledger]);

  if (moduleSettingsLoaded && (!enabled || !canView)) {
    return <div className="p-8 text-center text-sm text-muted-foreground">
      {!enabled ? 'Stock Management is off. Enable it in Settings → Catalogue Settings.' : "You don't have permission to view stock."}
    </div>;
  }
  if (loading) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!product) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Product not found.</div>;
  }

  const closing = position?.closing ?? 0;

  return (
    <div className="w-full p-4 sm:p-6 space-y-5">
      <button onClick={() => router.push('/stock')} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Stock
      </button>

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-lg bg-primary/10 grid place-items-center"><Boxes className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-semibold">{product.name}</h1>
            <p className="text-sm text-muted-foreground">{product.sku ? `SKU ${product.sku}` : 'No SKU'}{product.unit ? ` · ${product.unit}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/reports/stock" className={buttonVariants({ variant: 'outline', size: 'sm' })}><BarChart3 className="h-4 w-4 mr-1" /> Report</Link>
          {canManage && (
            <Button size="sm" onClick={() => setAdjustOpen(true)}><SlidersHorizontal className="h-4 w-4 mr-1" /> Adjust stock</Button>
          )}
        </div>
      </div>

      {/* Two-column body: left tabs, right timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-1 border-b border-border">
            {(['overview', 'ledger'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                {t === 'overview' ? 'Overview' : 'Movement Ledger'}
              </button>
            ))}
          </div>

          {tab === 'overview' ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Opening', value: position?.opening ?? 0, tone: 'muted' },
                { label: 'In', value: position?.totalIn ?? 0, tone: 'pos' },
                { label: 'Out', value: position?.totalOut ?? 0, tone: 'neg' },
                { label: 'Closing', value: closing, tone: closing <= 0 ? 'neg' : 'closing' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${s.tone === 'neg' ? 'text-red-500' : s.tone === 'pos' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                    {s.tone === 'pos' && Number(s.value) > 0 ? `+${s.value}` : s.tone === 'neg' && s.label === 'Out' && Number(s.value) > 0 ? `-${s.value}` : s.value}
                  </p>
                </div>
              ))}
            </div>
          ) : withBalance.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No stock movements yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 font-medium text-right">Qty</th>
                    <th className="px-3 py-2.5 font-medium text-right">Balance</th>
                    <th className="px-3 py-2.5 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {withBalance.map((r) => {
                    const qty = toNumber(r.quantity);
                    const href = refHref(r);
                    const ref = r.voucher_no || r.source_ref;
                    return (
                      <tr key={r.id} className="border-t border-border/60">
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{TYPE_LABEL[r.entry_type] ?? r.entry_type}{r.reason_code && r.entry_type.startsWith('manual') ? <span className="text-muted-foreground"> · {r.reason_code}</span> : null}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${qty < 0 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>{qty > 0 ? `+${qty}` : qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.balance}</td>
                        <td className="px-3 py-2">
                          {href && ref ? <Link href={href} className="text-primary hover:underline font-mono text-xs">{ref}</Link>
                            : ref ? <span className="font-mono text-xs text-muted-foreground">{ref}</span> : <span className="text-muted-foreground">—</span>}
                          {r.notes ? <span className="block text-xs text-muted-foreground/70">{r.notes}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: shared Timeline (activity + tasks linked to this product) */}
        <div className="lg:col-span-1">
          <Timeline moduleName="product" recordId={productId} tasks={tasks} activities={activities} onRefresh={load} />
        </div>
      </div>

      {adjustOpen && position && (
        <StockAdjustDialog
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          productId={productId}
          productName={product.name}
          closing={closing}
          onDone={load}
        />
      )}
    </div>
  );
}
