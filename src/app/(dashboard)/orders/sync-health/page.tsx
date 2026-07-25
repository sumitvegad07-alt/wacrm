'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/currency';
import { AlertTriangle, Loader2, ShieldAlert, TrendingUp } from 'lucide-react';

/**
 * Order Sync Health — read-only admin monitoring of order pricing/sync issues.
 *
 * SCOPE (Option A, approved 26 Jul 2026): this shows the SERVER-SIDE signals of
 * a problematic order:
 *   1. Orders flagged pricing_status='review' by create_order/update_order —
 *      quoted-vs-server price drift on offline sync, or a customer/product that
 *      was deleted before the order synced.
 *   2. pricing_drift_log — where an ONLINE client's total disagreed with the
 *      server recompute on identical inputs (a TS-mirror bug signal).
 *
 * It deliberately does NOT show orders still stuck unsynced on a rep's phone —
 * those live only in that device's local queue and the server has no record of
 * them. Reporting device dead-letters up to the server is a separate follow-up
 * (Option B).
 */

interface ReviewOrder {
  id: string;
  order_number: string | null;
  date: string | null;
  total_amount: number | null;
  expected_total: number | null;
  variance: { kind?: string; note?: string; quoted_total?: number; expected_total?: number }[];
  customer: string;
  salesman: string;
}

interface DriftRow {
  id: string;
  order_id: string | null;
  platform: string | null;
  app_version: string | null;
  engine_version: number | null;
  server_engine_version: number | null;
  client_total: number | null;
  server_total: number | null;
  created_at: string;
}

const VARIANCE_LABEL: Record<string, string> = {
  price_changed: 'Price changed after quote',
  floor_breach: 'Below price floor',
  contact_detached: 'Customer no longer exists',
  product_detached: 'Product no longer exists',
};

export default function OrderSyncHealthPage() {
  const supabase = createClient();
  const { accountId, defaultCurrency, isAdmin, isOwner } = useAuth();
  const canView = isAdmin || isOwner;

  const [loading, setLoading] = useState(true);
  const [reviewOrders, setReviewOrders] = useState<ReviewOrder[]>([]);
  const [drift, setDrift] = useState<DriftRow[]>([]);

  const money = useMemo(() => (v: number | null | undefined) => formatCurrency(Number(v) || 0, defaultCurrency), [defaultCurrency]);

  const fetchData = useCallback(async () => {
    if (!accountId || !canView) return;
    setLoading(true);
    const [{ data: orderData }, { data: profiles }, { data: driftData }] = await Promise.all([
      supabase
        .from('orders')
        .select('id, order_number, date, total_amount, expected_total, pricing_variance, user_id, contacts(company, name), leads(name)')
        .eq('account_id', accountId)
        .eq('pricing_status', 'review')
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').eq('account_id', accountId),
      supabase
        .from('pricing_drift_log')
        .select('id, order_id, platform, app_version, engine_version, server_engine_version, client_total, server_total, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const profileMap: Record<string, string> = {};
    (profiles ?? []).forEach((p: { id: string; full_name: string }) => { profileMap[p.id] = p.full_name; });

    setReviewOrders(((orderData ?? []) as Record<string, any>[]).map((o) => ({
      id: o.id,
      order_number: o.order_number,
      date: o.date,
      total_amount: o.total_amount,
      expected_total: o.expected_total,
      variance: Array.isArray(o.pricing_variance) ? o.pricing_variance : [],
      customer: o.contacts?.company || o.contacts?.name || o.leads?.name || 'Unknown',
      salesman: profileMap[o.user_id] || 'Unknown',
    })));
    setDrift((driftData ?? []) as DriftRow[]);
    setLoading(false);
  }, [accountId, canView, supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (!canView) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShieldAlert className="size-5" />
          <span>This page is available to admins only.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="size-6" /> Order Sync Health
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Orders the system flagged for review, and pricing disagreements logged on save. Read-only.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* Orders needing review */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" /> Orders needing review
              <Badge variant="secondary">{reviewOrders.length}</Badge>
            </h2>
            {reviewOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders are flagged for review. 🎉</p>
            ) : (
              <div className="space-y-3">
                {reviewOrders.map((o) => (
                  <div key={o.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium">{o.order_number || '(pending number)'} · {o.customer}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {o.date || ''} · by {o.salesman}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold tabular-nums">{money(o.total_amount)}</div>
                        {o.expected_total != null && Math.abs((o.expected_total || 0) - (o.total_amount || 0)) > 0.01 && (
                          <div className="text-xs text-muted-foreground tabular-nums">server: {money(o.expected_total)}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {o.variance.length === 0 ? (
                        <Badge variant="outline">Flagged for review</Badge>
                      ) : (
                        o.variance.map((v, i) => (
                          <Badge key={i} variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                            {VARIANCE_LABEL[v.kind ?? ''] || v.kind || 'Review'}
                          </Badge>
                        ))
                      )}
                    </div>
                    {o.variance.some((v) => v.note) && (
                      <ul className="mt-2 space-y-1">
                        {o.variance.filter((v) => v.note).map((v, i) => (
                          <li key={i} className="text-xs text-muted-foreground">• {v.note}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Pricing drift log */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              Pricing drift log
              <Badge variant="secondary">{drift.length}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground -mt-1">
              Where an online client&apos;s total disagreed with the server on identical inputs — a signal the
              app&apos;s pricing mirror may have drifted from the database. Money is unaffected (the server figure is used).
            </p>
            {drift.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pricing drift recorded.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="text-left font-medium px-3 py-2">When</th>
                      <th className="text-left font-medium px-3 py-2">Platform</th>
                      <th className="text-right font-medium px-3 py-2">Client total</th>
                      <th className="text-right font-medium px-3 py-2">Server total</th>
                      <th className="text-right font-medium px-3 py-2">Engine (client/server)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drift.map((d) => (
                      <tr key={d.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(d.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2">{d.platform || '—'}{d.app_version ? ` (${d.app_version})` : ''}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(d.client_total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(d.server_total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.engine_version ?? '?'} / {d.server_engine_version ?? '?'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
