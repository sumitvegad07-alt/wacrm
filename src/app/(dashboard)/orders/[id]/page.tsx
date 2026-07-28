'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronLeft, Truck, Loader2, Package, AlertTriangle, CheckCircle2, XCircle, Ban,
  Printer, Phone, Mail, User as UserIcon, Plus,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { Timeline } from '@/components/shared/timeline';

/** PostgREST errors are plain objects — pull the real reason out. */
function supaErr(e: unknown): string {
  if (!e) return 'Unknown error';
  if (e instanceof Error) return e.message;
  const o = e as { message?: string; details?: string; hint?: string; code?: string };
  return [o.message, o.details, o.hint].filter(Boolean).join(' — ') || 'Unknown error';
}

// Legal next transitions per the SQL state machine (migration 086). Dispatched
// is reached only via Create Dispatch (auto-advance), so it's not a button here.
const NEXT_STATUS: Record<string, { to: string; label: string; icon: typeof CheckCircle2; variant: 'default' | 'outline' | 'destructive' }[]> = {
  Pending: [
    { to: 'Approved', label: 'Approve', icon: CheckCircle2, variant: 'default' },
    { to: 'Rejected', label: 'Reject', icon: XCircle, variant: 'destructive' },
    { to: 'Cancelled', label: 'Cancel', icon: Ban, variant: 'outline' },
  ],
  Approved: [
    { to: 'Rejected', label: 'Reject', icon: XCircle, variant: 'destructive' },
    { to: 'Cancelled', label: 'Cancel', icon: Ban, variant: 'outline' },
  ],
  'Part Dispatch': [
    { to: 'Cancelled', label: 'Cancel', icon: Ban, variant: 'outline' },
  ],
};

const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  Approved: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  'Part Dispatch': 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  Dispatched: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  Rejected: 'bg-red-500/10 text-red-600 border-red-500/30',
  Cancelled: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
};

// Statuses from which more items can still be dispatched.
const DISPATCHABLE = new Set(['Approved', 'Part Dispatch']);

interface OrderItem {
  id: string;
  product_name: string;
  unit: string | null;
  quantity: number;
  price: number;
  total: number;
}
interface DispatchItem { id: string; order_item_id: string | null; product_name: string; unit: string | null; quantity: number; }
interface Dispatch {
  id: string;
  dispatch_number: string;
  dispatched_at: string;
  transport_name: string | null;
  tracking_number: string | null;
  notes: string | null;
  items: DispatchItem[];
}

const CLASS_BADGE: Record<string, string> = {
  direct: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  primary: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  secondary: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

type Tab = 'details' | 'dispatches' | 'summary';

export default function OrderDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();
  const { defaultCurrency, hasPermission } = useAuth();
  const canManageStatus = hasPermission('manage_order_status');

  const [order, setOrder] = useState<Record<string, any> | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customValues, setCustomValues] = useState<{ label: string; value: string }[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [activities, setActivities] = useState<Record<string, any>[]>([]);
  const [tasks, setTasks] = useState<Record<string, any>[]>([]);
  const [createdBy, setCreatedBy] = useState('Unknown');
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('details');

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    const { data: o, error } = await supabase
      .from('orders')
      .select('*, contacts(*), leads(name)')
      .eq('id', id)
      .maybeSingle();
    if (error || !o) { toast.error('Order not found'); router.push('/orders'); return; }
    setOrder(o);

    const [{ data: itemData }, { data: cvData }, { data: dispatchData }, { data: activityData }, { data: taskData }, ownerRes] = await Promise.all([
      supabase.from('order_items').select('*').eq('order_id', id).order('position'),
      supabase.from('order_custom_values').select('value, custom_fields(field_name)').eq('order_id', id),
      supabase.from('order_dispatches').select('*, dispatch_items(*)').eq('order_id', id).order('created_at', { ascending: false }),
      // NOTE: module_activities.user_id FKs auth.users, not profiles, so it can't
      // be embedded. Fetch plainly and enrich with profiles below (same pattern
      // as the lead detail page).
      supabase.from('module_activities').select('*').eq('module_name', 'order').eq('record_id', id).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('order_id', id).order('created_at', { ascending: false }),
      o.user_id
        ? supabase.from('profiles').select('full_name, email').eq('user_id', o.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    setItems((itemData || []) as OrderItem[]);
    setCustomValues((cvData || []).map((c: Record<string, any>) => ({ label: c.custom_fields?.field_name || 'Field', value: c.value })).filter((c) => c.value));
    setDispatches((dispatchData || []).map((d: Record<string, any>) => ({ ...d, items: d.dispatch_items || [] })) as Dispatch[]);
    setTasks((taskData || []) as Record<string, any>[]);

    // Enrich activities with the acting user's name via a separate profiles query.
    const acts = (activityData || []) as Record<string, any>[];
    const userIds = Array.from(new Set(acts.map((a) => a.user_id).filter(Boolean)));
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
      const pmap = (profs || []).reduce((m: Record<string, any>, p: any) => { m[p.user_id] = p; return m; }, {});
      setActivities(acts.map((a) => ({ ...a, user: pmap[a.user_id] || null })));
    } else {
      setActivities(acts);
    }
    const owner = ownerRes?.data as { full_name?: string; email?: string } | null;
    setCreatedBy(owner?.full_name || owner?.email || 'Unknown');
    setLoading(false);
  }, [id, supabase, router]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  // Remaining-to-dispatch per order item = ordered qty − already dispatched.
  function dispatchedSoFar(orderItemId: string): number {
    let sum = 0;
    dispatches.forEach((d) => d.items.forEach((di) => { if (di.order_item_id === orderItemId) sum += Number(di.quantity); }));
    return sum;
  }
  function remaining(item: OrderItem): number {
    return Number(item.quantity) - dispatchedSoFar(item.id);
  }

  // Dispatch creation now lives in the standalone Dispatch module.
  function goCreateDispatch() {
    router.push(`/dispatches/new?orderId=${id}`);
  }

  // Status changes go through the RPC only — it validates the transition,
  // checks manage_order_status, writes, and logs. (No direct update; the DB
  // trigger backstop would reject an illegal or unpermitted raw write anyway.)
  async function updateStatus(newStatus: string) {
    if (!order) return;
    setStatusSaving(newStatus);
    const { error } = await supabase.rpc('update_order_status', { p_order_id: id, p_new_status: newStatus });
    setStatusSaving(null);
    if (error) { toast.error(supaErr(error)); return; }
    toast.success(`Status updated to ${newStatus}`);
    fetchOrder();
  }

  if (loading || !order) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const cust = order.contacts || {};
  const customerName = cust.company || cust.name || order.leads?.name || 'Unknown';
  const custPhone = cust.phone || cust.whatsapp || '';
  const custEmail = cust.email || '';
  const custAddress = [cust.address, cust.city, cust.state, cust.country].filter(Boolean).join(', ');
  const anyRemaining = items.some((it) => remaining(it) > 0.0001);

  const TabBtn = ({ value, label }: { value: Tab; label: string }) => (
    <button
      onClick={() => setTab(value)}
      className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
        tab === value
          ? 'text-primary border-b-2 border-primary bg-primary/5'
          : 'text-muted-foreground border-b-2 border-transparent hover:text-foreground hover:bg-muted/40'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6 w-full max-w-none">
      {/* Header card */}
      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/orders')} className="text-muted-foreground hover:text-foreground shrink-0"><ChevronLeft className="size-5" /></Button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-foreground">{customerName}</h1>
                <Badge variant="outline" className={`text-xs px-2.5 py-1 ${STATUS_BADGE[order.status] || ''}`}>{order.status}</Badge>
                <Badge variant="outline" className={`capitalize text-xs ${CLASS_BADGE[order.classification]}`}>{order.classification}</Badge>
              </div>
              <div className="text-sm text-muted-foreground mt-1.5 flex items-center gap-4 flex-wrap">
                {custPhone && <span className="flex items-center gap-1.5"><Phone className="size-3 text-primary/70" /> {custPhone}</span>}
                {custEmail && <span className="flex items-center gap-1.5"><Mail className="size-3 text-primary/70" /> {custEmail}</span>}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold tracking-wide">ORDER <span className="text-primary">#{(order.order_number || '').split('-').pop() || order.order_number}</span></div>
            <Button variant="outline" size="sm" className="gap-2 mt-2" onClick={() => window.open(`/print/order/${id}`, '_blank')}>
              <Printer className="size-4" /> Print
            </Button>
          </div>
        </div>

        {/* Meta strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-border px-5 py-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground italic mb-1">Order From</p>
            <p className="font-semibold text-primary">{customerName}</p>
            {custAddress && <p className="text-xs text-muted-foreground mt-0.5">{custAddress}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Order Date</p>
            <p className="font-medium">{new Date(order.date).toLocaleDateString('en-IN')}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Order Status</p>
            <p className="font-medium capitalize">{order.status}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Created By</p>
            <p className="font-medium flex items-center gap-1.5"><UserIcon className="size-3.5 text-muted-foreground" /> {createdBy}</p>
          </div>
        </div>

        {/* Status actions */}
        {((canManageStatus && NEXT_STATUS[order.status]?.length) || (DISPATCHABLE.has(order.status) && anyRemaining)) ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
            {canManageStatus && (NEXT_STATUS[order.status] || []).map((t) => {
              const Icon = t.icon;
              return (
                <Button key={t.to} variant={t.variant} size="sm" className="gap-1.5" disabled={statusSaving !== null} onClick={() => updateStatus(t.to)}>
                  {statusSaving === t.to ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                  {t.label}
                </Button>
              );
            })}
            {DISPATCHABLE.has(order.status) && anyRemaining && (
              <Button onClick={goCreateDispatch} className="gap-2" size="sm"><Truck className="size-4" /> Create Dispatch</Button>
            )}
          </div>
        ) : null}
      </div>

      {/* Pricing review banner — set by create_order when the quoted price the
          field team submitted drifted from the server-calculated price. */}
      {order.pricing_status === 'review' && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="size-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-700">Pricing needs review</p>
            <p className="text-amber-700/90 mt-0.5">
              The price submitted for this order differs from the current catalog price. Review before approving.
            </p>
            {(() => {
              const v = order.pricing_variance;
              const reasons: string[] = Array.isArray(v)
                ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
                : v && typeof v === 'object'
                ? Object.entries(v).map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
                : v
                ? [String(v)]
                : [];
              return reasons.length > 0 ? (
                <ul className="list-disc list-inside mt-2 space-y-0.5 text-amber-700/90">
                  {reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              ) : null;
            })()}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: tabbed content */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-border">
              <TabBtn value="details" label="Details" />
              <TabBtn value="dispatches" label={`Dispatches${dispatches.length ? ` (${dispatches.length})` : ''}`} />
              <TabBtn value="summary" label="Summary" />
            </div>

            {/* DETAILS TAB */}
            {tab === 'details' && (
              <div className="p-5 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Order Items</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left font-medium pb-2">Product</th>
                        <th className="text-right font-medium pb-2">Qty</th>
                        <th className="text-right font-medium pb-2">Price</th>
                        <th className="text-right font-medium pb-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-b border-border/50">
                          <td className="py-2">{it.product_name}{it.unit ? <span className="text-muted-foreground"> / {it.unit}</span> : null}</td>
                          <td className="py-2 text-right">{it.quantity}</td>
                          <td className="py-2 text-right">{formatCurrency(it.price, defaultCurrency)}</td>
                          <td className="py-2 text-right font-medium">{formatCurrency(it.total, defaultCurrency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-end mt-4 pt-3 border-t border-border">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Total</p>
                      <p className="text-xl font-bold">{formatCurrency(order.total_amount, defaultCurrency)}</p>
                    </div>
                  </div>
                </div>

                {customValues.length > 0 && (
                  <div className="border-t border-border pt-5">
                    <h3 className="text-lg font-semibold mb-4">Additional Details</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {customValues.map((cv, i) => (
                        <div key={i}>
                          <p className="text-sm text-muted-foreground mb-1">{cv.label}</p>
                          <p className="font-medium">{cv.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {order.notes && (
                  <div className="border-t border-border pt-5">
                    <h3 className="text-lg font-semibold mb-2">Notes</h3>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* DISPATCHES TAB */}
            {tab === 'dispatches' && (
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2"><Truck className="size-4" /> Dispatches</h3>
                  {DISPATCHABLE.has(order.status) && anyRemaining && (
                    <Button onClick={goCreateDispatch} size="sm" className="gap-2"><Plus className="size-4" /> Add</Button>
                  )}
                </div>
                {dispatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Not dispatched yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left font-medium pb-2">Dispatch #</th>
                          <th className="text-left font-medium pb-2">Date</th>
                          <th className="text-left font-medium pb-2">Items</th>
                          <th className="text-left font-medium pb-2">Transport / Tracking</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dispatches.map((d) => (
                          <tr key={d.id} className="border-b border-border/50 align-top cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/dispatches/${d.id}`)}>
                            <td className="py-3 font-mono font-medium text-primary">{d.dispatch_number}</td>
                            <td className="py-3 text-muted-foreground">{new Date(d.dispatched_at).toLocaleDateString('en-IN')}</td>
                            <td className="py-3">
                              <div className="space-y-1">
                                {d.items.map((di) => (
                                  <div key={di.id} className="flex items-center gap-1 text-xs">
                                    <Package className="size-3 text-muted-foreground" /> {di.product_name}
                                    <span className="font-medium">· {di.quantity}{di.unit ? ` ${di.unit}` : ''}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 text-xs text-muted-foreground">
                              {d.transport_name || '—'}{d.tracking_number ? <><br />Tracking: {d.tracking_number}</> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* SUMMARY TAB */}
            {tab === 'summary' && (
              <div className="p-5 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Basic Details</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><p className="text-muted-foreground mb-1">Order #</p><p className="font-medium">{order.order_number}</p></div>
                    <div><p className="text-muted-foreground mb-1">Customer</p><p className="font-medium text-primary">{customerName}</p></div>
                    <div><p className="text-muted-foreground mb-1">Date</p><p className="font-medium">{new Date(order.date).toLocaleDateString('en-IN')}</p></div>
                    <div><p className="text-muted-foreground mb-1">Status</p><p className="font-medium capitalize">{order.status}</p></div>
                  </div>
                </div>
                <div className="border-t border-border pt-5">
                  <h3 className="text-lg font-semibold mb-4">Product Details</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left font-medium pb-2">Name</th>
                          <th className="text-right font-medium pb-2">Ordered</th>
                          <th className="text-right font-medium pb-2">Delivered</th>
                          <th className="text-right font-medium pb-2">Difference</th>
                          <th className="text-right font-medium pb-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <tr key={it.id} className="border-b border-border/50">
                            <td className="py-2">{it.product_name}</td>
                            <td className="py-2 text-right">{it.quantity}{it.unit ? ` ${it.unit}` : ''}</td>
                            <td className="py-2 text-right text-emerald-600">{dispatchedSoFar(it.id)}</td>
                            <td className="py-2 text-right text-amber-600">{remaining(it)}</td>
                            <td className="py-2 text-right font-medium">{formatCurrency(it.total, defaultCurrency)}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td className="py-2 text-right" colSpan={1}>Total</td>
                          <td className="py-2 text-right">{items.reduce((s, it) => s + Number(it.quantity), 0)}</td>
                          <td className="py-2 text-right text-emerald-600">{items.reduce((s, it) => s + dispatchedSoFar(it.id), 0)}</td>
                          <td className="py-2 text-right text-amber-600">{items.reduce((s, it) => s + remaining(it), 0)}</td>
                          <td className="py-2 text-right">{formatCurrency(order.total_amount, defaultCurrency)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Timeline */}
        <div className="w-full">
          <Timeline moduleName="order" recordId={id} tasks={tasks} activities={activities} onRefresh={fetchOrder} />
        </div>
      </div>
    </div>
  );
}
