'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ChevronLeft, Truck, Loader2, Package } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';

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

export default function OrderDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [order, setOrder] = useState<Record<string, any> | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customValues, setCustomValues] = useState<{ label: string; value: string }[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [statuses, setStatuses] = useState<{ id: string; name: string; color: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Dispatch dialog
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchQty, setDispatchQty] = useState<Record<string, string>>({});
  const [transport, setTransport] = useState('');
  const [tracking, setTracking] = useState('');
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split('T')[0]);
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [savingDispatch, setSavingDispatch] = useState(false);

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    const { data: o, error } = await supabase
      .from('orders')
      .select('*, contacts(company, name, phone), leads(name)')
      .eq('id', id)
      .maybeSingle();
    if (error || !o) { toast.error('Order not found'); router.push('/orders'); return; }
    setOrder(o);

    const [{ data: itemData }, { data: cvData }, { data: dispatchData }, { data: statusData }] = await Promise.all([
      supabase.from('order_items').select('*').eq('order_id', id).order('position'),
      supabase.from('order_custom_values').select('value, custom_fields(field_name)').eq('order_id', id),
      supabase.from('order_dispatches').select('*, dispatch_items(*)').eq('order_id', id).order('created_at', { ascending: false }),
      supabase.from('order_statuses').select('id, name, color').eq('account_id', o.account_id).order('position'),
    ]);

    setItems((itemData || []) as OrderItem[]);
    setCustomValues((cvData || []).map((c: Record<string, any>) => ({ label: c.custom_fields?.field_name || 'Field', value: c.value })).filter((c) => c.value));
    setDispatches((dispatchData || []).map((d: Record<string, any>) => ({ ...d, items: d.dispatch_items || [] })) as Dispatch[]);
    setStatuses(statusData || []);
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

  function openDispatch() {
    const init: Record<string, string> = {};
    items.forEach((it) => { init[it.id] = String(Math.max(0, remaining(it))); });
    setDispatchQty(init);
    setTransport(''); setTracking(''); setDispatchNotes('');
    setDispatchDate(new Date().toISOString().split('T')[0]);
    setDispatchOpen(true);
  }

  async function updateStatus(newStatus: string) {
    if (!order) return;
    setOrder({ ...order, status: newStatus });
    const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', id);
    if (error) { toast.error('Failed to update status'); return; }
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from('module_activities').insert({
      account_id: order.account_id, user_id: userData?.user?.id, module_name: 'order',
      record_id: id, action: 'status_changed', message: `Order status changed to ${newStatus}`,
    });
    toast.success(`Status updated to ${newStatus}`);
  }

  async function saveDispatch() {
    if (!order || !accountId) return;
    const rows = items
      .map((it) => ({ it, qty: parseFloat(dispatchQty[it.id] || '0') }))
      .filter((r) => r.qty > 0);
    if (rows.length === 0) { toast.error('Enter a quantity for at least one item'); return; }
    for (const r of rows) {
      if (r.qty > remaining(r.it) + 0.0001) { toast.error(`${r.it.product_name}: cannot dispatch more than remaining (${remaining(r.it)})`); return; }
    }

    setSavingDispatch(true);
    try {
      const { data: dispatch, error: dErr } = await supabase
        .from('order_dispatches')
        .insert({
          account_id: accountId, order_id: id,
          dispatched_at: dispatchDate,
          transport_name: transport.trim() || null,
          tracking_number: tracking.trim() || null,
          notes: dispatchNotes.trim() || null,
        })
        .select()
        .single();
      if (dErr || !dispatch) throw dErr;

      const { error: diErr } = await supabase.from('dispatch_items').insert(
        rows.map((r) => ({
          dispatch_id: dispatch.id, order_item_id: r.it.id,
          product_name: r.it.product_name, unit: r.it.unit, quantity: r.qty,
        }))
      );
      if (diErr) throw diErr;

      toast.success(`Dispatch ${dispatch.dispatch_number} created`);
      setDispatchOpen(false);

      // Offer to mark the order Dispatched if everything is now shipped.
      const fullyDispatched = items.every((it) => {
        const nowSent = dispatchedSoFar(it.id) + (parseFloat(dispatchQty[it.id] || '0'));
        return nowSent >= Number(it.quantity) - 0.0001;
      });
      const dispatchedStatus = statuses.find((s) => s.name.toLowerCase() === 'dispatched');
      if (fullyDispatched && dispatchedStatus && order.status !== dispatchedStatus.name) {
        if (confirm('All items are now dispatched. Mark this order as "Dispatched"?')) {
          await updateStatus(dispatchedStatus.name);
        }
      }
      fetchOrder();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create dispatch');
    } finally {
      setSavingDispatch(false);
    }
  }

  if (loading || !order) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const customerName = order.contacts?.company || order.contacts?.name || order.leads?.name || 'Unknown';
  const statusColor = statuses.find((s) => s.name === order.status)?.color || '#6b7280';
  const anyRemaining = items.some((it) => remaining(it) > 0.0001);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/orders')}><ChevronLeft className="size-5" /></Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              {order.order_number}
              <Badge variant="outline" className={`capitalize text-xs ${CLASS_BADGE[order.classification]}`}>{order.classification}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {customerName} · {new Date(order.date).toLocaleDateString('en-IN')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={order.status}
            onChange={(e) => updateStatus(e.target.value)}
            className="text-sm rounded-md border px-3 py-2 font-medium cursor-pointer bg-transparent"
            style={{ color: statusColor, borderColor: statusColor + '55' }}
          >
            {statuses.length === 0 && <option>{order.status}</option>}
            {statuses.map((s) => <option key={s.id} value={s.name} className="text-foreground bg-background">{s.name}</option>)}
          </select>
          {anyRemaining && (
            <Button onClick={openDispatch} className="gap-2"><Truck className="size-4" /> Create Dispatch</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Items + custom fields */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-lg font-semibold mb-4">Order Items</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left font-medium pb-2">Product</th>
                  <th className="text-right font-medium pb-2">Qty</th>
                  <th className="text-right font-medium pb-2">Dispatched</th>
                  <th className="text-right font-medium pb-2">Price</th>
                  <th className="text-right font-medium pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-border/50">
                    <td className="py-2">{it.product_name}{it.unit ? <span className="text-muted-foreground"> / {it.unit}</span> : null}</td>
                    <td className="py-2 text-right">{it.quantity}</td>
                    <td className="py-2 text-right text-muted-foreground">{dispatchedSoFar(it.id)}</td>
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
            <div className="bg-card border border-border rounded-lg p-5">
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
        </div>

        {/* Dispatches */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Truck className="size-4" /> Dispatches</h3>
            {dispatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not dispatched yet.</p>
            ) : (
              <div className="space-y-4">
                {dispatches.map((d) => (
                  <div key={d.id} className="border border-border rounded-md p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm font-medium">{d.dispatch_number}</span>
                      <span className="text-xs text-muted-foreground">{new Date(d.dispatched_at).toLocaleDateString('en-IN')}</span>
                    </div>
                    {(d.transport_name || d.tracking_number) && (
                      <p className="text-xs text-muted-foreground mb-2">
                        {d.transport_name}{d.transport_name && d.tracking_number ? ' · ' : ''}{d.tracking_number ? `Tracking: ${d.tracking_number}` : ''}
                      </p>
                    )}
                    <div className="space-y-1">
                      {d.items.map((di) => (
                        <div key={di.id} className="flex justify-between text-xs">
                          <span className="flex items-center gap-1"><Package className="size-3 text-muted-foreground" /> {di.product_name}</span>
                          <span className="font-medium">{di.quantity}{di.unit ? ` ${di.unit}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Dispatch dialog */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Create Dispatch</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              {items.map((it) => {
                const rem = remaining(it);
                return (
                  <div key={it.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{it.product_name}</p>
                      <p className="text-xs text-muted-foreground">Remaining: {rem}{it.unit ? ` ${it.unit}` : ''}</p>
                    </div>
                    <Input
                      type="number"
                      value={dispatchQty[it.id] ?? ''}
                      onChange={(e) => setDispatchQty((p) => ({ ...p, [it.id]: e.target.value }))}
                      className="w-24 h-8"
                      disabled={rem <= 0}
                    />
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
              <div className="space-y-1"><Label>Transport</Label><Input value={transport} onChange={(e) => setTransport(e.target.value)} placeholder="Transport / courier" /></div>
              <div className="space-y-1"><Label>Tracking / LR No.</Label><Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number" /></div>
              <div className="space-y-1"><Label>Date</Label><Input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>Notes</Label><Input value={dispatchNotes} onChange={(e) => setDispatchNotes(e.target.value)} placeholder="Optional" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchOpen(false)}>Cancel</Button>
            <Button onClick={saveDispatch} disabled={savingDispatch}>
              {savingDispatch ? <Loader2 className="size-4 mr-1 animate-spin" /> : null} Save Dispatch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
