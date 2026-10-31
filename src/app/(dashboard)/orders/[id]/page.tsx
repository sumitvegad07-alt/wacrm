'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMarkRecordSeen } from "@/hooks/use-record-views";
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Truck, Loader2, Package, AlertTriangle, CheckCircle2, XCircle, Ban,
  Phone, Mail, User as UserIcon, Plus,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { PrintSizeMenu } from '@/components/print/print-size-menu';
import { formatCurrency } from '@/lib/currency';
import { Timeline } from '@/components/shared/timeline';
import {
  DetailPageLayout,
  DetailSection,
  DetailGrid,
  DetailItem,
  LineItemsTable,
  LineItemsHead,
  LineItemsRow,
  LineItemsCell,
} from '@/components/shared';

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
    { to: 'Closed', label: 'Close Order', icon: CheckCircle2, variant: 'outline' },
  ],
  'Part Dispatch': [
    { to: 'Cancelled', label: 'Cancel', icon: Ban, variant: 'outline' },
    { to: 'Closed', label: 'Close Order', icon: CheckCircle2, variant: 'outline' },
  ],
  Dispatched: [
    { to: 'Closed', label: 'Close Order', icon: CheckCircle2, variant: 'outline' },
  ],
};

const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-amber-600 text-white shadow-sm border-transparent',
  Approved: 'bg-blue-600 text-white shadow-sm border-transparent',
  'Part Dispatch': 'bg-orange-600 text-white shadow-sm border-transparent',
  Dispatched: 'bg-emerald-600 text-white shadow-sm border-transparent',
  Rejected: 'bg-red-600 text-white shadow-sm border-transparent',
  Cancelled: 'bg-slate-600 text-white shadow-sm border-transparent',
  Closed: 'bg-zinc-800 text-white shadow-sm border-transparent',
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
  is_scheme_goods?: boolean;
  scheme_id?: string | null;
  schemes?: { name: string } | null;
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
  direct: 'bg-slate-600 text-white shadow-sm border-transparent',
  primary: 'bg-blue-600 text-white shadow-sm border-transparent',
  secondary: 'bg-amber-600 text-white shadow-sm border-transparent',
};

type Tab = 'details' | 'dispatches' | 'summary';

export default function OrderDetailPage() {
  const { id } = useParams() as { id: string };

  // Opening the record is what clears its highlight on the list.
  useMarkRecordSeen("order", id);
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
      supabase.from('order_items').select('*, schemes(name)').eq('order_id', id).order('position'),
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
    <DetailPageLayout
      title={customerName}
      onBack={() => router.push('/orders')}
      // The order number was a `text-2xl` block on the right of the header,
      // competing with the customer name for the role of title. It is the
      // record's identifier, so it reads as a badge beside the name.
      badges={
        <>
          <Badge variant="secondary" className="font-mono font-semibold">
            ORDER #{(order.order_number || '').split('-').pop() || order.order_number}
          </Badge>
          <Badge variant="outline" className={`text-caption px-2.5 py-1 ${STATUS_BADGE[order.status] || ''}`}>{order.status}</Badge>
          <Badge variant="outline" className={`capitalize text-caption ${CLASS_BADGE[order.classification]}`}>{order.classification}</Badge>
        </>
      }
      meta={
        <>
          {custPhone && <span className="flex items-center gap-1.5"><Phone className="size-3 text-primary/70" /> {custPhone}</span>}
          {custEmail && <span className="flex items-center gap-1.5"><Mail className="size-3 text-primary/70" /> {custEmail}</span>}
        </>
      }
      actions={<PrintSizeMenu href={`/print/order/${id}`} />}
    >
      <DetailSection>
        <DetailGrid cols={4}>
          <DetailItem label="Order From">
            <span className="text-primary">{customerName}</span>
            {custAddress && <p className="mt-0.5 text-caption font-normal text-muted-foreground">{custAddress}</p>}
          </DetailItem>
          <DetailItem label="Order Date" value={new Date(order.date).toLocaleDateString('en-IN')} />
          <DetailItem label="Order Status">
            <span className="capitalize">{order.status}</span>
          </DetailItem>
          <DetailItem label="Created By">
            <span className="flex items-center gap-1.5"><UserIcon className="size-3.5 text-muted-foreground" /> {createdBy}</span>
          </DetailItem>
        </DetailGrid>

        {/* Status actions */}
        {((canManageStatus && NEXT_STATUS[order.status]?.length) || (DISPATCHABLE.has(order.status) && anyRemaining)) ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
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
      </DetailSection>

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
                  <h3 className="mb-4 text-section font-semibold text-foreground">Order Items</h3>
                  <LineItemsTable
                    minWidth="30rem"
                    head={
                      <tr>
                        <LineItemsHead>Product</LineItemsHead>
                        <LineItemsHead className="text-right">Qty</LineItemsHead>
                        <LineItemsHead className="text-right">Price</LineItemsHead>
                        <LineItemsHead className="text-right">Total</LineItemsHead>
                      </tr>
                    }
                  >
                    {items.map((it) => (
                      <LineItemsRow key={it.id}>
                        <LineItemsCell>
                          {it.product_name}{it.unit ? <span className="text-muted-foreground"> / {it.unit}</span> : null}
                          {it.is_scheme_goods && (
                            <span className="ml-2 align-middle rounded bg-primary/15 px-1.5 py-0.5 text-micro font-bold text-primary">FREE</span>
                          )}
                          {it.schemes?.name && (
                            <span className="block text-caption text-muted-foreground">Scheme: {it.schemes.name}</span>
                          )}
                        </LineItemsCell>
                        <LineItemsCell className="text-right">{it.quantity}</LineItemsCell>
                        <LineItemsCell className="text-right">{formatCurrency(it.price, defaultCurrency)}</LineItemsCell>
                        <LineItemsCell className="text-right font-medium">{formatCurrency(it.total, defaultCurrency)}</LineItemsCell>
                      </LineItemsRow>
                    ))}
                  </LineItemsTable>
                  {/* The line totals are tax-inclusive, so quantity x price does not equal
                      the order total. Without the breakdown the detail view looks like it has
                      dropped money — 100 x ₹150 reading as ₹15,300. Same figures the creation
                      screen shows, taken from the stored order. */}
                  <div className="flex justify-end mt-4 pt-3 border-t border-border">
                    <div className="w-full max-w-xs space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Sub-total</span>
                        <span>{formatCurrency(order.sub_total ?? 0, defaultCurrency)}</span>
                      </div>
                      {Number(order.discount_total ?? 0) > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Discount</span>
                          <span>&minus;{formatCurrency(order.discount_total, defaultCurrency)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Tax</span>
                        <span>{formatCurrency(order.tax_total ?? 0, defaultCurrency)}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-border">
                        <span className="font-semibold">Total</span>
                        <span className="text-xl font-bold">{formatCurrency(order.total_amount, defaultCurrency)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {customValues.length > 0 && (
                  <div className="border-t border-border pt-5">
                    <h3 className="mb-4 text-section font-semibold text-foreground">Additional Details</h3>
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
                    <h3 className="mb-2 text-section font-semibold text-foreground">Notes</h3>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* DISPATCHES TAB */}
            {tab === 'dispatches' && (
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="flex items-center gap-2 text-section font-semibold text-foreground"><Truck className="size-4" /> Dispatches</h3>
                  {DISPATCHABLE.has(order.status) && anyRemaining && (
                    <Button onClick={goCreateDispatch} size="sm" className="gap-2"><Plus className="size-4" /> Add</Button>
                  )}
                </div>
                {dispatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Not dispatched yet.</p>
                ) : (
                  <LineItemsTable
                    minWidth="38rem"
                    head={
                      <tr>
                        <LineItemsHead>Dispatch #</LineItemsHead>
                        <LineItemsHead>Date</LineItemsHead>
                        <LineItemsHead>Items</LineItemsHead>
                        <LineItemsHead>Transport / Tracking</LineItemsHead>
                      </tr>
                    }
                  >
                    {dispatches.map((d) => (
                      <LineItemsRow key={d.id} onClick={() => router.push(`/dispatches/${d.id}`)} className="align-top">
                        <LineItemsCell className="font-mono font-medium text-primary">{d.dispatch_number}</LineItemsCell>
                        <LineItemsCell className="text-muted-foreground">{new Date(d.dispatched_at).toLocaleDateString('en-IN')}</LineItemsCell>
                        <LineItemsCell className="whitespace-normal">
                          <div className="space-y-1">
                            {d.items.map((di) => (
                              <div key={di.id} className="flex items-center gap-1 text-caption">
                                <Package className="size-3 text-muted-foreground" /> {di.product_name}
                                <span className="font-medium">· {di.quantity}{di.unit ? ` ${di.unit}` : ''}</span>
                              </div>
                            ))}
                          </div>
                        </LineItemsCell>
                        <LineItemsCell className="whitespace-normal text-caption text-muted-foreground">
                          {d.transport_name || '—'}{d.tracking_number ? <><br />Tracking: {d.tracking_number}</> : null}
                        </LineItemsCell>
                      </LineItemsRow>
                    ))}
                  </LineItemsTable>
                )}
              </div>
            )}

            {/* SUMMARY TAB */}
            {tab === 'summary' && (
              <div className="p-5 space-y-6">
                <div>
                  <h3 className="mb-4 text-section font-semibold text-foreground">Basic Details</h3>
                  <DetailGrid cols={4}>
                    <DetailItem label="Order #" value={order.order_number} />
                    <DetailItem label="Customer"><span className="text-primary">{customerName}</span></DetailItem>
                    <DetailItem label="Date" value={new Date(order.date).toLocaleDateString('en-IN')} />
                    <DetailItem label="Status"><span className="capitalize">{order.status}</span></DetailItem>
                  </DetailGrid>
                </div>
                <div className="border-t border-border pt-5">
                  <h3 className="mb-4 text-section font-semibold text-foreground">Product Details</h3>
                  <LineItemsTable
                    minWidth="34rem"
                    head={
                      <tr>
                        <LineItemsHead>Name</LineItemsHead>
                        <LineItemsHead className="text-right">Ordered</LineItemsHead>
                        <LineItemsHead className="text-right">Delivered</LineItemsHead>
                        <LineItemsHead className="text-right">Difference</LineItemsHead>
                        <LineItemsHead className="text-right">Total</LineItemsHead>
                      </tr>
                    }
                  >
                    {items.map((it) => (
                      <LineItemsRow key={it.id}>
                        <LineItemsCell>{it.product_name}</LineItemsCell>
                        <LineItemsCell className="text-right">{it.quantity}{it.unit ? ` ${it.unit}` : ''}</LineItemsCell>
                        <LineItemsCell className="text-right text-emerald-600">{dispatchedSoFar(it.id)}</LineItemsCell>
                        <LineItemsCell className="text-right text-amber-600">{remaining(it)}</LineItemsCell>
                        <LineItemsCell className="text-right font-medium">{formatCurrency(it.total, defaultCurrency)}</LineItemsCell>
                      </LineItemsRow>
                    ))}
                    <LineItemsRow className="font-semibold">
                      <LineItemsCell className="text-right">Total</LineItemsCell>
                      <LineItemsCell className="text-right">{items.reduce((s, it) => s + Number(it.quantity), 0)}</LineItemsCell>
                      <LineItemsCell className="text-right text-emerald-600">{items.reduce((s, it) => s + dispatchedSoFar(it.id), 0)}</LineItemsCell>
                      <LineItemsCell className="text-right text-amber-600">{items.reduce((s, it) => s + remaining(it), 0)}</LineItemsCell>
                      <LineItemsCell className="text-right">{formatCurrency(order.total_amount, defaultCurrency)}</LineItemsCell>
                    </LineItemsRow>
                  </LineItemsTable>
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
    </DetailPageLayout>
  );
}
