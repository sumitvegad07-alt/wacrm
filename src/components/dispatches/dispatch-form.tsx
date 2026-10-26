'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Loader2, Truck } from 'lucide-react';
import {
  FormPageShell,
  FormActions,
  FormGrid,
  FormField,
  FORM_GRID_PAGE,
  DetailSection,
  LineItemsTable,
  LineItemsHead,
  LineItemsRow,
  LineItemsCell,
} from '@/components/shared';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { logModuleActivity } from '@/lib/activities';
import { CustomFieldsSectionRenderer } from '@/components/custom-fields/custom-fields-section-renderer';
import { validateRequiredCustomFields, ensureDefaultSectionsAndFields } from '@/lib/custom-fields';
import { CustomField } from '@/types';

function supaErr(e: unknown): string {
  if (!e) return 'Unknown error';
  if (e instanceof Error) return e.message;
  const o = e as { message?: string; details?: string; hint?: string; code?: string };
  return [o.message, o.details, o.hint].filter(Boolean).join(' — ') || 'Unknown error';
}

interface Line {
  orderItemId: string;
  productName: string;
  unit: string | null;
  price: number;
  remaining: number; // max dispatchable for this edit context
  qty: string;
}

interface DispatchFormProps {
  isEdit?: boolean;
  dispatchId?: string;
  prefillOrderId?: string;
}

/**
 * Full-page dispatch create/edit form (reference: Dispatch > Create). A dispatch
 * is created against ONE approved order; lines are that order's items capped at
 * remaining quantity, and prices are inherited from the order (read-only). On
 * the first dispatch, the order's lock/Dispatched trigger fires server-side.
 */
export function DispatchForm({ dispatchId, prefillOrderId }: { dispatchId?: string; prefillOrderId?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const { user, accountId, defaultCurrency } = useAuth();
  const isEdit = !!dispatchId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [customers, setCustomers] = useState<{ id: string; label: string; address: string }[]>([]);
  const [orders, setOrders] = useState<{ id: string; order_number: string; contact_id: string }[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [dispatchNumber, setDispatchNumber] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dispatchCode, setDispatchCode] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [transport, setTransport] = useState('');
  const [transportContact, setTransportContact] = useState('');
  const [lrNo, setLrNo] = useState('');
  const [lrDate, setLrDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const billingAddress = useMemo(() => customers.find((c) => c.id === customerId)?.address || '', [customers, customerId]);

  // Build dispatch lines for an order: its items, capped at remaining quantity.
  // `excludeDispatchId` lets edit mode ignore this dispatch's own shipped qty.
  const loadOrderLines = useCallback(async (ordId: string, excludeDispatchId?: string, presetQty?: Record<string, number>) => {
    const { data: orderItems } = await supabase.from('order_items').select('id, product_name, unit, price, quantity').eq('order_id', ordId).order('position');
    const { data: shipped } = await supabase
      .from('dispatch_items')
      .select('order_item_id, quantity, dispatch:order_dispatches!inner(id, order_id)')
      .eq('dispatch.order_id', ordId);

    const shippedByItem: Record<string, number> = {};
    (shipped || []).forEach((s: any) => {
      if (excludeDispatchId && s.dispatch?.id === excludeDispatchId) return;
      shippedByItem[s.order_item_id] = (shippedByItem[s.order_item_id] || 0) + Number(s.quantity);
    });

    const rows: Line[] = (orderItems || []).map((it: any) => {
      const remaining = Number(it.quantity) - (shippedByItem[it.id] || 0);
      return {
        orderItemId: it.id,
        productName: it.product_name,
        unit: it.unit,
        price: Number(it.price || 0),
        remaining: Math.max(0, remaining),
        qty: presetQty && presetQty[it.id] != null ? String(presetQty[it.id]) : '',
      };
    });
    setLines(rows);
  }, [supabase]);

  // Initial load
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      await ensureDefaultSectionsAndFields(accountId, 'dispatch', user?.id, supabase);
      const [{ data: contactData }, { data: orderData }, { data: fieldsData }] = await Promise.all([
        supabase.from('contacts').select('id, company, name, address, city, state, country').eq('account_id', accountId).order('company'),
        // Dispatchable orders: approved or partially dispatched.
        supabase.from('orders').select('id, order_number, contact_id, status').eq('account_id', accountId).in('status', ['Approved', 'Part Dispatch', 'Dispatched']).order('created_at', { ascending: false }),
        supabase.from('custom_fields').select('*').eq('account_id', accountId).eq('module_name', 'dispatch').order('created_at'),
      ]);
      if (!alive) return;
      setCustomFields(fieldsData || []);
      setCustomers(((contactData ?? []) as any[]).map((c) => ({
        id: c.id, label: c.company || c.name || 'Unnamed',
        address: [c.address, c.city, c.state, c.country].filter(Boolean).join(', '),
      })));
      setOrders(((orderData ?? []) as any[]).map((o) => ({ id: o.id, order_number: o.order_number, contact_id: o.contact_id })));

      if (isEdit && dispatchId) {
        const { data: d, error } = await supabase
          .from('order_dispatches')
          .select('*, order:orders(id, order_number, contact_id), dispatch_items(order_item_id, quantity)')
          .eq('id', dispatchId).maybeSingle();
        if (error || !d) { toast.error('Dispatch not found'); router.push('/dispatches'); return; }
        setDispatchNumber(d.dispatch_number || '');
        setCustomerId(d.order?.contact_id || '');
        setOrderId(d.order_id || '');
        setDate(d.dispatched_at ? d.dispatched_at.split('T')[0] : new Date().toISOString().split('T')[0]);
        setDispatchCode(d.dispatch_code || '');
        setInvoiceNo(d.invoice_no || '');
        setInvoiceDate(d.invoice_date ? d.invoice_date.split('T')[0] : '');
        setTransport(d.transport_name || '');
        setTransportContact(d.transport_contact_no || '');
        setLrNo(d.lr_no || '');
        setLrDate(d.lr_date ? d.lr_date.split('T')[0] : '');
        setNotes(d.notes || '');
        const preset: Record<string, number> = {};
        (d.dispatch_items || []).forEach((di: any) => { preset[di.order_item_id] = Number(di.quantity); });
        if (d.order_id) await loadOrderLines(d.order_id, dispatchId, preset);
        const { data: cvData } = await supabase.from('dispatch_custom_values').select('*').eq('dispatch_id', dispatchId);
        if (cvData) {
          const vals: Record<string, string> = {};
          cvData.forEach((row: any) => { vals[row.custom_field_id] = row.value; });
          setCustomValues(vals);
        } else {
          setCustomValues({});
        }
      } else if (prefillOrderId) {
        setCustomValues({});
        const ord = ((orderData ?? []) as any[]).find((o) => o.id === prefillOrderId);
        if (ord) { setCustomerId(ord.contact_id || ''); setOrderId(prefillOrderId); await loadOrderLines(prefillOrderId); }
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [accountId, dispatchId, isEdit, prefillOrderId, supabase, loadOrderLines, router]);

  const ordersForCustomer = useMemo(() => orders.filter((o) => !customerId || o.contact_id === customerId), [orders, customerId]);
  const subTotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * l.price, 0);

  function onCustomerChange(v: string) {
    setCustomerId(v);
    setOrderId('');
    setLines([]);
  }
  async function onOrderChange(v: string) {
    setOrderId(v);
    if (v) await loadOrderLines(v);
    else setLines([]);
  }

  async function handleSave() {
    if (!accountId) return;
    if (!orderId) { toast.error('Select an order'); return; }
    const shipping = lines.filter((l) => Number(l.qty) > 0);
    if (shipping.length === 0) { toast.error('Enter a quantity for at least one item'); return; }
    for (const l of shipping) {
      if (Number(l.qty) > l.remaining + 0.0001) { toast.error(`${l.productName}: cannot dispatch more than remaining (${l.remaining})`); return; }
    }

    const cfError = validateRequiredCustomFields(customFields, customValues, {
      dispatch_date: date,
      lr_number: lrNo,
      transporter_name: transport,
    });
    if (cfError) {
      toast.error(cfError);
      return;
    }

    setSaving(true);
    try {
      const header = {
        dispatched_at: date,
        dispatch_code: dispatchCode.trim() || null,
        invoice_no: invoiceNo.trim() || null,
        invoice_date: invoiceDate || null,
        transport_name: transport.trim() || null,
        transport_contact_no: transportContact.trim() || null,
        lr_no: lrNo.trim() || null,
        lr_date: lrDate || null,
        notes: notes.trim() || null,
      };

      let savedId = dispatchId as string | undefined;
      let savedNumber = dispatchNumber;

      // Header write must land first (a NEW dispatch needs its id/number for the
      // child rows and logs below).
      if (isEdit && dispatchId) {
        const { error } = await supabase.from('order_dispatches').update(header).eq('id', dispatchId);
        if (error) throw error;
        savedId = dispatchId;
      } else {
        const { data: created, error } = await supabase
          .from('order_dispatches')
          .insert({ account_id: accountId, order_id: orderId, ...header })
          .select('id, dispatch_number')
          .single();
        if (error || !created) throw error;
        savedId = created.id; savedNumber = created.dispatch_number;
      }

      const did = savedId!;
      // Items, custom values, and the two activity logs are independent of each
      // other → run them together (was ~5 sequential round-trips). Supabase
      // builders are thenable (PromiseLike), not real Promises.
      const post: PromiseLike<unknown>[] = [];

      // Dispatch items: replace-all (delete-then-insert on edit; insert on create).
      post.push((async () => {
        if (isEdit) await supabase.from('dispatch_items').delete().eq('dispatch_id', did);
        const { error: diErr } = await supabase.from('dispatch_items').insert(
          shipping.map((l) => ({ dispatch_id: did, order_item_id: l.orderItemId, product_name: l.productName, unit: l.unit, quantity: Number(l.qty) }))
        );
        if (diErr) throw diErr;
      })());

      // Custom values (dispatch_custom_values has no unique key → delete-then-
      // insert within one task).
      if (Object.keys(customValues).length > 0) {
        post.push((async () => {
          await supabase.from('dispatch_custom_values').delete().eq('dispatch_id', did);
          const toInsert = Object.entries(customValues)
            .filter(([_, v]) => v !== undefined && v !== '')
            .map(([fId, v]) => ({ account_id: accountId, dispatch_id: did, custom_field_id: fId, value: v }));
          if (toInsert.length > 0) {
            await supabase.from('dispatch_custom_values').insert(toInsert);
          }
        })());
      }

      // Activity logs (dispatch + mirrored on the order timeline) — bookkeeping;
      // never fail the save on a log write.
      const dAction = isEdit ? 'dispatch_edited' : 'dispatch_created';
      const label = isEdit ? `Dispatch ${savedNumber} updated` : `Dispatch ${savedNumber} generated.`;
      post.push(logModuleActivity(supabase, { moduleName: 'dispatch', recordId: did, action: dAction, message: label }).catch(() => {}));
      post.push(logModuleActivity(supabase, { moduleName: 'order', recordId: orderId, action: dAction, message: label, details: { dispatch_id: did, dispatch_number: savedNumber } }).catch(() => {}));

      await Promise.all(post);

      toast.success(isEdit ? 'Dispatch updated' : `Dispatch ${savedNumber} created`);
      router.push(`/dispatches/${savedId}`);
    } catch (err: unknown) {
      toast.error(`Couldn't ${isEdit ? 'update' : 'create'} dispatch: ${supaErr(err)}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <FormPageShell
      icon={Truck}
      title={isEdit ? `Edit Dispatch ${dispatchNumber}` : 'Create Dispatch'}
      subtitle={isEdit ? 'Update the dispatch details below.' : 'Record a dispatch against a confirmed order.'}
      onBack={() => router.back()}
      card={false}
      actions={
        <Button onClick={handleSave} data-shortcut="save" disabled={saving} className="gap-2">
          {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save
        </Button>
      }
    >
      <div className="space-y-6 w-full">

      {/* Basic Details */}
      <DetailSection bare className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <h3 className="mb-4 text-section font-semibold text-foreground">Basic Details</h3>
        {/* The two `*` suffixes were typed into the label text. FormField's
            `required` draws the one shared marker and adds the screen-reader
            "(required)" these never had. The `h-10 bg-background` overrides
            on the selects are gone — they are the shared control height now. */}
        <FormGrid variant="dialog" className="md:grid-cols-3">
          <FormField label="Customer" required>
            <SearchableSelect value={customerId} onChange={onCustomerChange} placeholder="Select customer..." searchPlaceholder="Search customers..."
              options={customers.map((c) => ({ value: c.id, label: c.label }))} disabled={isEdit} />
          </FormField>
          <FormField label="Order" required>
            <SearchableSelect value={orderId} onChange={onOrderChange} placeholder="Select order..." searchPlaceholder="Search orders..."
              options={ordersForCustomer.map((o) => ({ value: o.id, label: o.order_number }))} disabled={isEdit} />
          </FormField>
          <FormField label="Dispatch Code"><Input value={dispatchCode} onChange={(e) => setDispatchCode(e.target.value)} placeholder="Dispatch Code" /></FormField>
          <FormField label="Invoice No."><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Invoice No." /></FormField>
          <FormField label="Invoice Date"><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></FormField>
          <FormField label="Transport Contact No."><Input value={transportContact} onChange={(e) => setTransportContact(e.target.value)} placeholder="Contact number" /></FormField>
          <FormField label="LR Date"><Input type="date" value={lrDate} onChange={(e) => setLrDate(e.target.value)} /></FormField>
        </FormGrid>
      </DetailSection>

      {/* Billing */}
      {billingAddress && (
        <DetailSection bare className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <h3 className="mb-2 text-section font-semibold text-foreground">Billing Details</h3>
          <p className="text-sm text-muted-foreground">{billingAddress}</p>
        </DetailSection>
      )}

      {/* Dispatch Information & Custom Fields */}
      <DetailSection bare className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <CustomFieldsSectionRenderer
          accountId={accountId}
          moduleName="dispatch"
          fieldGridClassName={FORM_GRID_PAGE}
          customFields={customFields}
          customValues={customValues}
          onChange={(id, val) => setCustomValues({ ...customValues, [id]: val })}
          formData={{
            dispatch_date: date,
            lr_number: lrNo,
            transporter_name: transport,
          }}
          onFormDataChange={(key, val) => {
            if (key === 'dispatch_date') setDate(val);
            if (key === 'lr_number') setLrNo(val);
            if (key === 'transporter_name') setTransport(val);
          }}
        />
      </DetailSection>

      {/* Product Details */}
      <DetailSection bare className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <h3 className="mb-4 text-section font-semibold text-foreground">Product Details</h3>
        {!orderId ? (
          <p className="text-sm text-muted-foreground py-4">Select an order to load its items.</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">This order has no items.</p>
        ) : (
          <div>
            <LineItemsTable
              minWidth="34rem"
              head={
                <tr>
                  <LineItemsHead>Product</LineItemsHead>
                  <LineItemsHead className="text-right">Remaining</LineItemsHead>
                  <LineItemsHead className="text-right">Quantity</LineItemsHead>
                  <LineItemsHead className="text-right">Price</LineItemsHead>
                  <LineItemsHead className="text-right">Sub Total</LineItemsHead>
                </tr>
              }
            >
              {lines.map((l, i) => (
                <LineItemsRow key={l.orderItemId}>
                  <LineItemsCell>{l.productName}{l.unit ? <span className="text-muted-foreground"> / {l.unit}</span> : null}</LineItemsCell>
                  <LineItemsCell className="text-right text-muted-foreground">{l.remaining}</LineItemsCell>
                  <LineItemsCell className="text-right">
                    <Input type="number" value={l.qty} disabled={l.remaining <= 0}
                      onChange={(e) => setLines((prev) => prev.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                      className="ml-auto w-24" />
                  </LineItemsCell>
                  <LineItemsCell className="text-right">{formatCurrency(l.price, defaultCurrency)}</LineItemsCell>
                  <LineItemsCell className="text-right font-medium">{formatCurrency((Number(l.qty) || 0) * l.price, defaultCurrency)}</LineItemsCell>
                </LineItemsRow>
              ))}
            </LineItemsTable>
            <div className="mt-4 flex justify-end border-t border-border pt-3">
              <div className="text-right">
                <p className="text-body text-muted-foreground">Sub Total</p>
                <p className="text-page-title font-bold">{formatCurrency(subTotal, defaultCurrency)}</p>
              </div>
            </div>
          </div>
        )}
      </DetailSection>
      </div>
    </FormPageShell>
  );
}
