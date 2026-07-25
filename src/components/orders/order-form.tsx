'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';

/**
 * Web order creation. The ONE pricing authority is the SQL function
 * calculate_order_pricing — this form calls it (debounced) for the live
 * breakdown and never does its own money maths, and saves through the
 * create_order RPC. Web is always online, so p_source='online': the server
 * compute is authoritative and there is no drift/quoted-wins path here
 * (that's the mobile offline concern).
 *
 * Create only. Edit + re-attachment land in a later step.
 */

interface OrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Optional prefill when an order is started from a customer site visit. */
  prefillContactId?: string | null;
  prefillSiteVisitId?: string | null;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  unit: string | null;
}

type DiscountType = 'percent' | 'amount';

interface LineInput {
  key: string;
  product_id: string;
  quantity: string;
  discount_type: DiscountType;
  discount_value: string;
}

interface PricedLine {
  position: number;
  product_id: string | null;
  product_name: string;
  quantity: number;
  catalogue_price: number;
  price_list_price: number;
  discount_amount: number;
  order_discount_share: number;
  sub_total: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  effective_unit_price: number;
  floor_breached: boolean;
}

interface PricingResult {
  lines: PricedLine[];
  sub_total: number;
  discount_total: number;
  order_discount: number;
  tax_total: number;
  total_amount: number;
  classification: string;
  floor_violations: { product_name: string; min_price: number; attempted_price: number }[];
  enforce_floor: boolean;
  valid: boolean;
}

type DiscountMode = 'off' | 'item' | 'order' | 'both';

const newLine = (): LineInput => ({
  key: crypto.randomUUID(),
  product_id: '',
  quantity: '1',
  discount_type: 'percent',
  discount_value: '',
});

/**
 * Supabase/PostgREST errors are plain objects ({message, details, hint,
 * code}), NOT Error instances — so `err instanceof Error` is false and
 * `err.message` gets silently discarded. Pull the real reason out.
 */
function supaErr(e: unknown): string {
  if (!e) return 'Unknown error';
  if (e instanceof Error) return e.message;
  const o = e as { message?: string; details?: string; hint?: string; code?: string };
  return (
    [o.message, o.details, o.hint, o.code ? `(${o.code})` : null].filter(Boolean).join(' — ') ||
    'Unknown error'
  );
}

export function OrderForm({ open, onOpenChange, onSaved, prefillContactId, prefillSiteVisitId }: OrderFormProps) {
  const supabase = createClient();
  const { accountId, defaultCurrency, hasPermission } = useAuth();

  const money = useMemo(() => {
    const code = (defaultCurrency || 'USD').trim();
    return (v: number) => {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
      } catch {
        return `${code} ${(Number(v) || 0).toFixed(2)}`;
      }
    };
  }, [defaultCurrency]);

  const canDiscount = hasPermission('apply_order_discount');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState<{ id: string; label: string }[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('off');

  const [contactId, setContactId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineInput[]>([newLine()]);
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>('percent');
  const [orderDiscountValue, setOrderDiscountValue] = useState('');

  const [pricing, setPricing] = useState<PricingResult | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);

  const itemDiscountAllowed = canDiscount && (discountMode === 'item' || discountMode === 'both');
  const orderDiscountAllowed = canDiscount && (discountMode === 'order' || discountMode === 'both');

  // ---- load dependencies ----
  useEffect(() => {
    if (!open || !accountId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [{ data: contactData }, { data: productData }, { data: acct }] = await Promise.all([
        supabase.from('contacts').select('id, company, name').eq('account_id', accountId).order('company'),
        supabase.from('products').select('id, name, sku, price, unit').eq('account_id', accountId).eq('active', true).order('name'),
        supabase.from('accounts').select('settings').eq('id', accountId).single(),
      ]);
      if (!alive) return;
      setContacts((contactData ?? []).map((c: Record<string, unknown>) => ({
        id: c.id as string,
        label: (c.company as string) || (c.name as string) || 'Unnamed',
      })));
      setProducts((productData ?? []) as ProductOption[]);
      setDiscountMode(((acct?.settings?.order_settings?.discount_mode as DiscountMode) ?? 'off'));
      setContactId(prefillContactId ?? '');
      setDate(new Date().toISOString().split('T')[0]);
      setNotes('');
      setLines([newLine()]);
      setOrderDiscountValue('');
      setPricing(null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, accountId, supabase, prefillContactId]);

  // ---- inputs the pricing function needs ----
  const pricingInputs = useMemo(() => {
    const priced = lines
      .filter((l) => l.product_id && Number(l.quantity) > 0)
      .map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity) || 0,
        discount_type: itemDiscountAllowed && Number(l.discount_value) > 0 ? l.discount_type : null,
        discount_value: itemDiscountAllowed ? (Number(l.discount_value) || 0) : 0,
      }));
    const orderDiscount = orderDiscountAllowed && Number(orderDiscountValue) > 0
      ? { type: orderDiscountType, value: Number(orderDiscountValue) }
      : null;
    return { priced, orderDiscount };
  }, [lines, itemDiscountAllowed, orderDiscountAllowed, orderDiscountType, orderDiscountValue]);

  // ---- debounced live pricing via the ONE authority ----
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!accountId) return;
    if (pricingInputs.priced.length === 0) { setPricing(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPricingBusy(true);
    debounceRef.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc('calculate_order_pricing', {
        p_account_id: accountId,
        p_contact_id: contactId || null,
        p_lines: pricingInputs.priced,
        p_order_discount: pricingInputs.orderDiscount,
        p_as_of: new Date().toISOString(),
      });
      setPricingBusy(false);
      if (error) {
        // Surface the real reason instead of a silent "—".
        console.error('pricing failed', error);
        setPricingError(supaErr(error));
        setPricing(null);
        return;
      }
      setPricingError(null);
      setPricing(data as PricingResult);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [accountId, contactId, pricingInputs, supabase]);

  // priced line aligned to each product-bearing input row, in order
  const pricedByKey = useMemo(() => {
    const map = new Map<string, PricedLine>();
    if (!pricing) return map;
    const productRows = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
    productRows.forEach((row, i) => { if (pricing.lines[i]) map.set(row.key, pricing.lines[i]); });
    return map;
  }, [pricing, lines]);

  function updateLine(key: string, patch: Partial<LineInput>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? [newLine()] : prev.filter((l) => l.key !== key)));
  }

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.sku ? `${p.name} (${p.sku})` : p.name })),
    [products],
  );

  const unitOf = useCallback(
    (pid: string) => products.find((p) => p.id === pid)?.unit || '',
    [products],
  );

  async function handleSave() {
    if (!accountId) return;
    if (!contactId) { toast.error('Select a customer'); return; }
    if (pricingInputs.priced.length === 0) { toast.error('Add at least one product'); return; }
    if (pricing && !pricing.valid) {
      const names = pricing.floor_violations.map((v) => v.product_name).join(', ');
      toast.error(`Below the price floor: ${names}. Reduce the discount to save.`);
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('create_order', {
        p_order_id: crypto.randomUUID(),
        p_account_id: accountId,
        p_contact_id: contactId,
        p_site_visit_id: prefillSiteVisitId ?? null,
        p_date: date,
        p_lines: pricingInputs.priced,
        p_order_discount: pricingInputs.orderDiscount,
        p_client_breakdown: null,  // web is online; server compute is authoritative
        p_source: 'online',
        p_notes: notes.trim() || null,
        p_platform: 'web',
        p_app_version: null,
      });
      if (error) throw error;
      const num = (data as Record<string, unknown>)?.order_number as string | undefined;
      toast.success(num ? `Order ${num} created` : 'Order created');
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      // Show the actual reason, not a generic message (see supaErr).
      toast.error(`Couldn't create order: ${supaErr(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Order</DialogTitle>
          <DialogDescription>
            Prices are calculated live by the server. The standard price is struck through when a
            discount applies, so you can show the customer exactly what they&apos;re getting.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5">
            {/* Customer + date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Customer <span className="text-red-400">*</span></Label>
                <SearchableSelect
                  options={contacts.map((c) => ({ value: c.id, label: c.label }))}
                  value={contactId}
                  onChange={setContactId}
                  placeholder="Select a customer"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Products</Label>
                {pricingBusy && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> pricing…</span>}
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="text-left font-medium px-3 py-2 min-w-[190px]">Product</th>
                      <th className="text-left font-medium px-2 py-2">Unit</th>
                      <th className="text-right font-medium px-2 py-2">Qty</th>
                      <th className="text-right font-medium px-2 py-2">Price</th>
                      <th className="text-right font-medium px-2 py-2">Rate incl. tax</th>
                      <th className="text-right font-medium px-2 py-2">Line total incl.</th>
                      {itemDiscountAllowed && <th className="text-left font-medium px-2 py-2">Discount</th>}
                      <th className="text-right font-medium px-2 py-2">Tax</th>
                      <th className="text-right font-medium px-3 py-2">Line Total</th>
                      <th className="w-8 px-1 py-2" aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const priced = pricedByKey.get(line.key);
                      // Standard struck through when the rate actually charged is below catalogue
                      // (a discount now; a price list once Phase 3 lands).
                      const discounted = priced ? priced.effective_unit_price < priced.catalogue_price - 0.001 : false;
                      const unit = unitOf(line.product_id);
                      // Display-only. Current mode is tax-EXCLUSIVE (price is pre-tax), so the
                      // per-unit rate WITH tax is price*(1+rate), and the line total WITH tax
                      // before any line discount is that × qty. Derived from figures the pricing
                      // function already returns — no new calculation.
                      // NOTE: when tax inclusive/exclusive mode ships (planned), these must read
                      // explicit incl/excl fields from the function so they stay correct in both modes.
                      const rateInclUnit = priced ? priced.catalogue_price * (1 + Number(priced.tax_rate) / 100) : null;
                      const lineInclPreDiscount = priced && rateInclUnit != null ? rateInclUnit * priced.quantity : null;
                      return (
                        <tr key={line.key} className="border-b border-border/60 last:border-0 align-top">
                          <td className="px-3 py-2">
                            <SearchableSelect
                              options={productOptions}
                              value={line.product_id}
                              onChange={(v) => updateLine(line.key, { product_id: v })}
                              placeholder="Select a product"
                            />
                          </td>
                          <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{unit || '—'}</td>
                          <td className="px-2 py-2">
                            <Input
                              type="number" min="0" step="1" value={line.quantity}
                              onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                              className="w-16 text-right ml-auto" aria-label="Quantity"
                            />
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            {priced ? (
                              discounted ? (
                                <div className="flex flex-col items-end leading-tight">
                                  <span className="line-through text-muted-foreground text-xs">{money(priced.catalogue_price)}</span>
                                  <span className="font-medium">{money(priced.effective_unit_price)}</span>
                                </div>
                              ) : (
                                <span>{money(priced.catalogue_price)}</span>
                              )
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            {rateInclUnit != null ? money(rateInclUnit) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap text-muted-foreground">
                            {lineInclPreDiscount != null ? money(lineInclPreDiscount) : '—'}
                          </td>
                          {itemDiscountAllowed && (
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => updateLine(line.key, {
                                    discount_type: line.discount_type === 'percent' ? 'amount' : 'percent',
                                    discount_value: '',  // switching type clears the value: % and amount are mutually exclusive
                                  })}
                                  className="h-8 w-8 shrink-0 rounded-md border border-border text-xs font-medium hover:bg-muted"
                                  title="Toggle percentage or amount"
                                >
                                  {line.discount_type === 'percent' ? '%' : defaultCurrency}
                                </button>
                                <Input
                                  type="number" min="0" step="0.01" value={line.discount_value}
                                  onChange={(e) => updateLine(line.key, { discount_value: e.target.value })}
                                  placeholder="0" className="w-16 h-8" aria-label="Discount"
                                />
                              </div>
                            </td>
                          )}
                          {/* Tax is READ-ONLY, resolved from the product's tax slab. Never editable. */}
                          <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">
                            {priced ? `${Number(priced.tax_rate)}%` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                            {priced ? money(priced.total) : '—'}
                            {priced?.floor_breached && (
                              <div className="text-[11px] text-red-500 font-normal flex items-center justify-end gap-0.5">
                                <AlertTriangle className="size-3" /> below floor
                              </div>
                            )}
                          </td>
                          <td className="px-1 py-2">
                            <Button variant="ghost" size="icon" onClick={() => removeLine(line.key)} className="size-8 text-muted-foreground hover:text-red-500">
                              <Trash2 className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Button variant="outline" size="sm" onClick={() => setLines((p) => [...p, newLine()])} className="gap-1">
                <Plus className="size-4" /> Add product
              </Button>
            </div>

            {/* Whole-order discount */}
            {orderDiscountAllowed && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">Whole-order discount</Label>
                <button
                  type="button"
                  onClick={() => { setOrderDiscountType((t) => (t === 'percent' ? 'amount' : 'percent')); setOrderDiscountValue(''); }}
                  className="h-9 w-9 rounded-md border border-border text-sm font-medium hover:bg-muted"
                  title="Toggle % or amount"
                >
                  {orderDiscountType === 'percent' ? '%' : defaultCurrency}
                </button>
                <Input
                  type="number" min="0" step="0.01" value={orderDiscountValue}
                  onChange={(e) => setOrderDiscountValue(e.target.value)}
                  placeholder="0" className="w-28"
                />
                <span className="text-xs text-muted-foreground">Spread across lines so each line&apos;s tax reduces correctly.</span>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>

            {/* Pricing error — never fail silently to a "—" */}
            {pricingError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <span>Couldn&apos;t price this order: {pricingError}</span>
              </div>
            )}

            {/* Totals */}
            <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-1.5 text-sm">
              <Row label="Sub-total" value={pricing ? money(pricing.sub_total) : '—'} />
              {pricing && pricing.discount_total > 0 && (
                <Row label="Discount" value={`− ${money(pricing.discount_total)}`} accent />
              )}
              <Row label="Tax" value={pricing ? money(pricing.tax_total) : '—'} />
              <div className="border-t border-border pt-2 mt-1">
                <Row label="Total" value={pricing ? money(pricing.total_amount) : '—'} bold />
              </div>
              {pricing && (
                <p className="text-xs text-muted-foreground pt-1">
                  Classification: <span className="capitalize font-medium">{pricing.classification}</span>
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading || (pricing != null && !pricing.valid)}>
            {saving && <Loader2 className="size-4 mr-1 animate-spin" />} Create Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={bold ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold text-base' : ''} ${accent ? 'text-emerald-600 dark:text-emerald-500' : ''}`}>{value}</span>
    </div>
  );
}
