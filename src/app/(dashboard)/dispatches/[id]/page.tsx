'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Loader2, Pencil, Phone, Mail, User as UserIcon, Truck } from 'lucide-react';
import { PrintSizeMenu } from '@/components/print/print-size-menu';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
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
    <DetailPageLayout
      title={customerName}
      onBack={() => router.push('/dispatches')}
      // The dispatch number was a `text-2xl` block floated to the right of the
      // header, competing with the customer name for the role of title. It is
      // the record's identifier, so it reads as a badge beside the name.
      badges={
        <Badge variant="secondary" className="font-mono font-semibold">
          DISPATCH #{dispNo.split('-').pop() || dispNo}
        </Badge>
      }
      meta={
        <>
          {custPhone && <span className="flex items-center gap-1.5"><Phone className="size-3 text-primary/70" /> {custPhone}</span>}
          {custEmail && <span className="flex items-center gap-1.5"><Mail className="size-3 text-primary/70" /> {custEmail}</span>}
        </>
      }
      actions={
        <>
          {canEdit && (
            <Button size="sm" className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm" onClick={() => router.push(`/dispatches/${id}/edit`)}>
              <Pencil className="size-4" /> Edit
            </Button>
          )}
          <PrintSizeMenu href={`/print/dispatch/${id}`} />
        </>
      }
    >
      <DetailSection>
        <DetailGrid cols={4}>
          <DetailItem label="Dispatch To">
            <span className="text-primary">{customerName}</span>
            {custAddress && <p className="mt-0.5 text-caption font-normal text-muted-foreground">{custAddress}</p>}
          </DetailItem>
          <Meta label="Date" value={dispatch.dispatched_at ? new Date(dispatch.dispatched_at).toLocaleDateString('en-IN') : '—'} />
          <Meta label="Order No" value={order?.order_number ? <button className="text-primary hover:underline" onClick={() => router.push(`/orders/${order.id}`)}>{order.order_number}</button> : '—'} />
          <Meta label="Created By" value={<span className="flex items-center gap-1.5"><UserIcon className="size-3.5 text-muted-foreground" /> {createdBy}</span>} />
          <Meta label="Dispatch Code" value={dispatch.dispatch_code} />
          <Meta label="Invoice No" value={dispatch.invoice_no} />
          <Meta label="Invoice Date" value={dispatch.invoice_date ? new Date(dispatch.invoice_date).toLocaleDateString('en-IN') : '—'} />
          <Meta label="Transport" value={dispatch.transport_name} />
        </DetailGrid>
      </DetailSection>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: LR + items */}
        <div className="lg:col-span-2 space-y-6">
          <DetailSection title="LR Details">
            <div className="flex flex-wrap gap-x-12 gap-y-2 text-body">
              <div><span className="text-muted-foreground">LR No. </span>{dispatch.lr_no || '—'}</div>
              <div><span className="text-muted-foreground">LR Date </span>{dispatch.lr_date ? new Date(dispatch.lr_date).toLocaleDateString('en-IN') : '—'}</div>
              <div><span className="text-muted-foreground">Transport Contact </span>{dispatch.transport_contact_no || '—'}</div>
            </div>
          </DetailSection>

          <DetailSection
            title={
              <span className="flex items-center gap-2">
                <Truck className="size-4" /> Dispatched Items
              </span>
            }
          >
            <LineItemsTable
              minWidth="34rem"
              head={
                <tr>
                  <LineItemsHead>Order No</LineItemsHead>
                  <LineItemsHead>Item</LineItemsHead>
                  <LineItemsHead className="text-right">Quantity</LineItemsHead>
                  <LineItemsHead className="text-right">Price</LineItemsHead>
                  <LineItemsHead className="text-right">Sub Amount</LineItemsHead>
                </tr>
              }
            >
              {items.map((it) => (
                <LineItemsRow key={it.id}>
                  <LineItemsCell className="font-mono text-caption">{order?.order_number || '—'}</LineItemsCell>
                  <LineItemsCell>{it.product_name}{(it.unit || it.order_item?.unit) ? <span className="text-muted-foreground"> / {it.unit || it.order_item?.unit}</span> : null}</LineItemsCell>
                  <LineItemsCell className="text-right">{it.quantity}</LineItemsCell>
                  <LineItemsCell className="text-right">{formatCurrency(it.order_item?.price || 0, defaultCurrency)}</LineItemsCell>
                  <LineItemsCell className="text-right font-medium">{formatCurrency(lineTotal(it), defaultCurrency)}</LineItemsCell>
                </LineItemsRow>
              ))}
            </LineItemsTable>
            <div className="mt-4 flex justify-end border-t border-border pt-3">
              <div className="text-right">
                <p className="text-body text-muted-foreground">Total</p>
                <p className="text-page-title font-bold">{formatCurrency(subTotal, defaultCurrency)}</p>
              </div>
            </div>
          </DetailSection>
        </div>

        {/* Right: Timeline */}
        <div className="w-full">
          <Timeline moduleName="dispatch" recordId={id} tasks={tasks} activities={activities} onRefresh={fetchDispatch} />
        </div>
      </div>
    </DetailPageLayout>
  );
}
