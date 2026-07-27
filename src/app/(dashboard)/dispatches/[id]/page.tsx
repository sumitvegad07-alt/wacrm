'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Loader2, Printer, Pencil, Phone, Mail, User as UserIcon, Truck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { Timeline } from '@/components/shared/timeline';

interface DItem {
  id: string;
  product_name: string;
  unit: string | null;
  quantity: number;
  order_item: { price: number | null; tax_rate: number | null; unit: string | null } | null;
}

export default function DispatchDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();
  const { defaultCurrency, hasPermission } = useAuth();
  const canEdit = hasPermission('edit_orders');

  const [dispatch, setDispatch] = useState<Record<string, any> | null>(null);
  const [order, setOrder] = useState<Record<string, any> | null>(null);
  const [items, setItems] = useState<DItem[]>([]);
  const [activities, setActivities] = useState<Record<string, any>[]>([]);
  const [tasks, setTasks] = useState<Record<string, any>[]>([]);
  const [createdBy, setCreatedBy] = useState('Unknown');
  const [loading, setLoading] = useState(true);

  const fetchDispatch = useCallback(async () => {
    setLoading(true);
    const { data: d, error } = await supabase
      .from('order_dispatches')
      .select('*, order:orders(*, contacts(*), leads(name)), dispatch_items(*, order_item:order_items(price, tax_rate, unit))')
      .eq('id', id)
      .maybeSingle();
    if (error || !d) { toast.error('Dispatch not found'); router.push('/dispatches'); return; }
    setDispatch(d);
    setOrder(d.order || null);
    setItems((d.dispatch_items || []) as DItem[]);

    const [{ data: activityData }, { data: taskData }, ownerRes] = await Promise.all([
      supabase.from('module_activities').select('*').eq('module_name', 'dispatch').eq('record_id', id).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('dispatch_id', id).order('created_at', { ascending: false }),
      d.order?.user_id
        ? supabase.from('profiles').select('full_name, email').eq('user_id', d.order.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // Enrich activities with the acting user's name (module_activities.user_id
    // FKs auth.users, not profiles, so it can't be embedded).
    const acts = (activityData || []) as Record<string, any>[];
    const userIds = Array.from(new Set(acts.map((a) => a.user_id).filter(Boolean)));
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
      const pmap = (profs || []).reduce((m: Record<string, any>, p: any) => { m[p.user_id] = p; return m; }, {});
      setActivities(acts.map((a) => ({ ...a, user: pmap[a.user_id] || null })));
    } else {
      setActivities(acts);
    }
    setTasks((taskData || []) as Record<string, any>[]);
    const owner = ownerRes?.data as { full_name?: string; email?: string } | null;
    setCreatedBy(owner?.full_name || owner?.email || 'Unknown');
    setLoading(false);
  }, [id, supabase, router]);

  useEffect(() => { fetchDispatch(); }, [fetchDispatch]);

  if (loading || !dispatch) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const cust = order?.contacts || {};
  const customerName = cust.company || cust.name || order?.leads?.name || 'Unknown';
  const custPhone = cust.phone || cust.whatsapp || '';
  const custEmail = cust.email || '';
  const custAddress = [cust.address, cust.city, cust.state, cust.country].filter(Boolean).join(', ');
  const lineTotal = (it: DItem) => Number(it.quantity) * Number(it.order_item?.price || 0);
  const subTotal = items.reduce((s, it) => s + lineTotal(it), 0);
  const dispNo = dispatch.dispatch_number || '';

  const Meta = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div><p className="text-xs text-muted-foreground mb-1">{label}</p><p className="font-medium">{value || '—'}</p></div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header card */}
      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/dispatches')} className="text-muted-foreground hover:text-foreground shrink-0"><ChevronLeft className="size-5" /></Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">{customerName}</h1>
              <div className="text-sm text-muted-foreground mt-1.5 flex items-center gap-4 flex-wrap">
                {custPhone && <span className="flex items-center gap-1.5"><Phone className="size-3 text-primary/70" /> {custPhone}</span>}
                {custEmail && <span className="flex items-center gap-1.5"><Mail className="size-3 text-primary/70" /> {custEmail}</span>}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold tracking-wide">DISPATCH <span className="text-primary">#{dispNo.split('-').pop() || dispNo}</span></div>
            <div className="flex items-center justify-end gap-2 mt-2">
              {canEdit && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push(`/dispatches/${id}/edit`)}>
                  <Pencil className="size-4" /> Edit
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-2" onClick={() => window.open(`/print/dispatch/${id}`, '_blank')}>
                <Printer className="size-4" /> Print
              </Button>
            </div>
          </div>
        </div>

        {/* Meta strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-border px-5 py-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground italic mb-1">Dispatch To</p>
            <p className="font-semibold text-primary">{customerName}</p>
            {custAddress && <p className="text-xs text-muted-foreground mt-0.5">{custAddress}</p>}
          </div>
          <Meta label="Date" value={dispatch.dispatched_at ? new Date(dispatch.dispatched_at).toLocaleDateString('en-IN') : '—'} />
          <Meta label="Order No" value={order?.order_number ? <button className="text-primary hover:underline" onClick={() => router.push(`/orders/${order.id}`)}>{order.order_number}</button> : '—'} />
          <Meta label="Created By" value={<span className="flex items-center gap-1.5"><UserIcon className="size-3.5 text-muted-foreground" /> {createdBy}</span>} />
          <Meta label="Dispatch Code" value={dispatch.dispatch_code} />
          <Meta label="Invoice No" value={dispatch.invoice_no} />
          <Meta label="Invoice Date" value={dispatch.invoice_date ? new Date(dispatch.invoice_date).toLocaleDateString('en-IN') : '—'} />
          <Meta label="Transport" value={dispatch.transport_name} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: LR + items */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg shadow-sm p-5">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">LR Details</h3>
            <div className="flex gap-12 text-sm">
              <div><span className="text-muted-foreground">LR No. </span>{dispatch.lr_no || '—'}</div>
              <div><span className="text-muted-foreground">LR Date </span>{dispatch.lr_date ? new Date(dispatch.lr_date).toLocaleDateString('en-IN') : '—'}</div>
              <div><span className="text-muted-foreground">Transport Contact </span>{dispatch.transport_contact_no || '—'}</div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg shadow-sm p-5">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Truck className="size-4" /> Dispatched Items</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left font-medium pb-2">Order No</th>
                    <th className="text-left font-medium pb-2">Item</th>
                    <th className="text-right font-medium pb-2">Quantity</th>
                    <th className="text-right font-medium pb-2">Price</th>
                    <th className="text-right font-medium pb-2">Sub Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b border-border/50">
                      <td className="py-2 font-mono text-xs">{order?.order_number || '—'}</td>
                      <td className="py-2">{it.product_name}{(it.unit || it.order_item?.unit) ? <span className="text-muted-foreground"> / {it.unit || it.order_item?.unit}</span> : null}</td>
                      <td className="py-2 text-right">{it.quantity}</td>
                      <td className="py-2 text-right">{formatCurrency(it.order_item?.price || 0, defaultCurrency)}</td>
                      <td className="py-2 text-right font-medium">{formatCurrency(lineTotal(it), defaultCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end mt-4 pt-3 border-t border-border">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-xl font-bold">{formatCurrency(subTotal, defaultCurrency)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Timeline */}
        <div className="w-full">
          <Timeline moduleName="dispatch" recordId={id} tasks={tasks} activities={activities} onRefresh={fetchDispatch} />
        </div>
      </div>
    </div>
  );
}
