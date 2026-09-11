'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { logModuleActivity } from '@/lib/activities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Plus, Trash2, AlertTriangle, ShoppingCart, Tag } from 'lucide-react';
import { FormPageShell, FormSection } from '@/components/shared';
import { CustomFieldsSectionRenderer } from '@/components/custom-fields/custom-fields-section-renderer';
import { validateRequiredCustomFields, ensureDefaultSectionsAndFields } from '@/lib/custom-fields';
import { CustomField } from '@/types';
import { cn } from '@/lib/utils';
import { CustomerFinancialCard, type FinancialData } from '@/components/payments/customer-financial-card';
import { formatCurrency } from '@/lib/currency';
import { fetchClosingStock, exceedsAvailable } from '@/lib/stock/financials';
import { gstStateCode, gstStateCodeFromGstin, determineGstType } from '@/lib/gst/states';

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
  asPage?: boolean;
  onSaved: () => void;
  /** Optional prefill when an order is started from a customer site visit. */
  prefillContactId?: string | null;
  prefillSiteVisitId?: string | null;
  /**
   * When set, the form is in EDIT mode: it loads this order, prices existing
   * lines at their agreed (locked) price, and saves via update_order. Omit for
   * create mode (create_order). Editing is online-only.
   */
  orderId?: string | null;
}

interface UnitConversion {
  unit_id: string;
  name: string;
  factor: number;
}
interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  unit: string | null;
  /** Multi Unit: the base unit id (factor 1) and the alternate units. */
  base_unit_id?: string | null;
  conversions?: UnitConversion[];
}

type DiscountType = 'percent' | 'amount';

interface LineInput {
  key: string;
  product_id: string;
  quantity: string;
  discount_type: DiscountType;
  discount_value: string;
  /**
   * Set for an EXISTING line being edited: its originally-agreed unit price,
   * sent as locked_price so re-pricing keeps that price. New lines (and
   * re-attached products, per the founder's decision) leave this null so they
   * price at the current catalogue rate.
   */
  locked_price?: number | null;
  /** Set for an existing line: its stored tax basis. New lines use the account default. */
  tax_mode?: 'exclusive' | 'inclusive';
  /** Multi Unit: the unit the rep picked. Defaults to the product's base unit. */
  unit_id?: string | null;
  /** True when this existing line's product was deleted (product_id null) and needs re-attaching. */
  detached?: boolean;
  /** Snapshot name of a detached line's original product, shown so the user knows what to replace. */
  detached_name?: string;
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
  rate_incl_unit: number;
  tax_mode: string;
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

// Scheme detection — shape returned by the detect_eligible_schemes RPC (snake_case).
interface LineSchemeSuggestion {
  position: number;
  product_id: string;
  scheme_id: string;
  scheme_name: string;
  scheme_type: string;
  reward_type: string;
  reward_value: number;
  scheme_discount_amount: number;
  free_product_id: string | null;
  free_product_name: string | null;
  free_qty: number;
  default_selected: boolean;
  nudge: { units_to_next?: number; value_to_next?: number; next_reward_label: string } | null;
}
interface OrderSchemeSuggestion {
  scheme_id: string;
  scheme_name: string;
  reward_type: string;
  reward_value: number;
  qualifying_subtotal: number;
  discount_amount: number;
  applies_to_positions: number[];
  default_selected: boolean;
  nudge: { value_to_next?: number; next_reward_label: string } | null;
}
interface SchemeDetection {
  line_schemes: LineSchemeSuggestion[];
  order_schemes: OrderSchemeSuggestion[];
}

type DiscountMode = 'off' | 'item' | 'order' | 'both';
type DiscountValueType = 'percent' | 'amount' | 'both';

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

export function OrderForm({ open, onOpenChange, asPage = false, onSaved, prefillContactId, prefillSiteVisitId, orderId }: OrderFormProps) {
  const supabase = createClient();
  const { user, accountId, defaultCurrency, hasPermission, isModuleEnabled } = useAuth();
  const paymentEnabled = isModuleEnabled('payment');
  const stockEnabled = isModuleEnabled('stock');
  const isEdit = !!orderId;

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
  // Stock Management: closing stock per product + the per-account block setting.
  // Advisory display always; hard block only when restrictStock is on.
  const [closingMap, setClosingMap] = useState<Map<string, number>>(new Map());
  const [restrictStock, setRestrictStock] = useState(false);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('off');
  const [discountValueType, setDiscountValueType] = useState<DiscountValueType>('both');
  const [taxMode, setTaxMode] = useState<'exclusive' | 'inclusive'>('exclusive');
  // Price Lists (v5): the account setting + whether the selected customer is on
  // an active price list. When on a list and the setting is off, salesman
  // discounts are hidden and stripped (the engine enforces the same).
  const [allowDiscOverPL, setAllowDiscOverPL] = useState(false);
  const [customerHasPriceList, setCustomerHasPriceList] = useState(false);
  const [multiUnitEnabled, setMultiUnitEnabled] = useState(false);
  const [gstEnabled, setGstEnabled] = useState(false);
  // GST place-of-supply preview. Compared as 2-digit GST STATE CODES, mirroring
  // the server (create_order): supplier code from the company profile, place of
  // supply from the customer's GSTIN (authoritative) or state-name fallback.
  const [companyStateCode, setCompanyStateCode] = useState('');
  const [placeOfSupplyCode, setPlaceOfSupplyCode] = useState('');

  const [contactId, setContactId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineInput[]>([newLine()]);
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>('percent');
  const [orderDiscountValue, setOrderDiscountValue] = useState('');

  const [pricing, setPricing] = useState<PricingResult | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);
  // Scheme suggestions (Phase 4). Detection runs on the salesman's product lines;
  // accepted schemes are injected into the pricing payload below. `schemeOverrides`
  // remembers the salesman's explicit accept/decline by a stable key so a schemes
  // that stops qualifying simply drops out, and toggles survive re-detection.
  const [schemeDetection, setSchemeDetection] = useState<SchemeDetection | null>(null);
  const [schemeOverrides, setSchemeOverrides] = useState<Record<string, boolean>>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  // Edit-mode: the loaded order's original customer (to detect a customer change
  // on save), whether it's locked (dispatched → read-only), and any load error.
  const [locked, setLocked] = useState(false);
  const [originalContactId, setOriginalContactId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [financialData, setFinancialData] = useState<FinancialData | null>(null);
  const [creditLimitAction, setCreditLimitAction] = useState<'ignore' | 'warn' | 'block'>('warn');
  const [creditDaysAction, setCreditDaysAction] = useState<'ignore' | 'warn' | 'block'>('warn');

  // A customer on a price list gets no manual discount unless the account opted
  // in — this hides the fields; the pricing engine enforces the same on save.
  const discountBlockedByPriceList = customerHasPriceList && !allowDiscOverPL;
  const itemDiscountAllowed = canDiscount && (discountMode === 'item' || discountMode === 'both') && !discountBlockedByPriceList;
  const orderDiscountAllowed = canDiscount && (discountMode === 'order' || discountMode === 'both') && !discountBlockedByPriceList;

  // Discount TYPE: when the admin restricts to percent- or amount-only, the
  // discount is forced to that type and the %/₹ toggle is hidden. 'both' keeps
  // the toggle (mutually exclusive — one clears the other). Not stored per
  // order; it only governs what may be entered now.
  const forcedDiscountType: DiscountType | null =
    discountValueType === 'percent' ? 'percent' : discountValueType === 'amount' ? 'amount' : null;

  // ---- load dependencies (+ the order itself in edit mode) ----
  useEffect(() => {
    if (!open || !accountId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setLocked(false);
      setLoadError(null);
      if (user?.id) {
        await ensureDefaultSectionsAndFields(accountId, 'order', user.id, supabase);
      }
      const [{ data: contactData }, { data: productData }, { data: acct }, { data: fieldsData }, { data: unitData }, { data: convData }] = await Promise.all([
        supabase.from('contacts').select('id, company, name').eq('account_id', accountId).order('company'),
        supabase.from('products').select('id, name, sku, price, unit, unit_id').eq('account_id', accountId).eq('active', true).order('name'),
        supabase.from('accounts').select('settings').eq('id', accountId).single(),
        supabase.from('custom_fields').select('*').eq('account_id', accountId).eq('module_name', 'order').order('position', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('product_units').select('id, name').eq('account_id', accountId),
        supabase.from('product_unit_conversions').select('product_id, unit_id, conversion_factor').eq('account_id', accountId).eq('active', true),
      ]);
      if (!alive) return;
      const multiUnit = !!acct?.settings?.extra_settings?.multi_unit_enabled;
      setMultiUnitEnabled(multiUnit);
      setCustomFields(fieldsData || []);
      setContacts((contactData ?? []).map((c: Record<string, unknown>) => ({
        id: c.id as string,
        label: (c.company as string) || (c.name as string) || 'Unnamed',
      })));
      // Product unit is stored as unit_id (FK to product_units); the legacy `unit`
      // text column is null for products created via the modern form — resolve the
      // unit name so the order line shows "Pcs" instead of "—".
      const unitMap: Record<string, string> = {};
      (unitData ?? []).forEach((u: { id: string; name: string }) => { unitMap[u.id] = u.name; });
      // Group Multi Unit conversions by product (base unit itself is implicit factor 1).
      const convByProduct = new Map<string, UnitConversion[]>();
      (convData ?? []).forEach((r: { product_id: string; unit_id: string; conversion_factor: number }) => {
        const list = convByProduct.get(r.product_id) ?? [];
        list.push({ unit_id: r.unit_id, name: unitMap[r.unit_id] || 'unit', factor: Number(r.conversion_factor) });
        convByProduct.set(r.product_id, list);
      });
      setProducts(((productData ?? []) as Record<string, unknown>[]).map((p) => ({
        ...p,
        unit: (p.unit as string) || (p.unit_id ? unitMap[p.unit_id as string] : '') || '',
        base_unit_id: (p.unit_id as string) ?? null,
        conversions: convByProduct.get(p.id as string) ?? [],
      })) as ProductOption[]);
      if (stockEnabled) {
        setRestrictStock(acct?.settings?.stock_settings?.restrict_on_insufficient === true);
        const prodIds = (productData ?? []).map((p: Record<string, unknown>) => p.id as string);
        const map = await fetchClosingStock(supabase, accountId, prodIds);
        if (alive) setClosingMap(map);
      }
      setDiscountMode(((acct?.settings?.order_settings?.discount_mode as DiscountMode) ?? 'off'));
      setDiscountValueType(((acct?.settings?.order_settings?.discount_value_type as DiscountValueType) ?? 'both'));
      setTaxMode(((acct?.settings?.order_settings?.tax_mode as 'exclusive' | 'inclusive') ?? 'exclusive'));
      setAllowDiscOverPL(acct?.settings?.order_settings?.allow_discount_over_price_list === true);
      setGstEnabled(!!acct?.settings?.gst_enabled);
      // Supplier state code for the live preview — GSTIN-first, matching the
      // exporter (which derives it from supplier_gstin); state dropdown fallback.
      setCompanyStateCode(
        gstStateCodeFromGstin(acct?.settings?.company_profile?.gst_number) ??
        (acct?.settings?.company_profile?.gst_state_code || '').trim(),
      );
      setCreditLimitAction((acct?.settings?.payments?.creditLimitAction as 'ignore' | 'warn' | 'block') ?? 'warn');
      setCreditDaysAction((acct?.settings?.payments?.creditDaysAction as 'ignore' | 'warn' | 'block') ?? 'warn');

      if (isEdit && orderId) {
        // ---- EDIT: load the order + its line items ----
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .select('id, contact_id, date, notes, locked_at, order_discount_type, order_discount_value, order_items(*)')
          .eq('id', orderId)
          .single();
        if (!alive) return;
        if (orderErr || !order) {
          setLoadError(supaErr(orderErr) || 'Order not found.');
          setLoading(false);
          return;
        }
        // Dispatched → read-only. update_order rejects a locked order (23514), so
        // we never show an edit form the user would only discover is blocked.
        if (order.locked_at) {
          setLocked(true);
          setLoading(false);
          return;
        }
        setOriginalContactId(order.contact_id ?? null);
        setContactId(order.contact_id ?? '');
        setDate(order.date ?? new Date().toISOString().split('T')[0]);
        setNotes(order.notes ?? '');
        setOrderDiscountType((order.order_discount_type as DiscountType) || 'percent');
        setOrderDiscountValue(order.order_discount_value ? String(order.order_discount_value) : '');

        const items = ((order.order_items ?? []) as Record<string, unknown>[])
          .slice()
          .sort((a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0));
        const editLines: LineInput[] = items.map((it) => ({
          key: crypto.randomUUID(),
          product_id: (it.product_id as string) ?? '',
          quantity: String((it.quantity as number) ?? 0),
          discount_type: ((it.discount_type as DiscountType) || 'percent'),
          discount_value: it.discount_value ? String(it.discount_value) : '',
          // Existing lines keep their agreed unit price + original tax basis.
          locked_price: (it.price_list_price as number) ?? null,
          tax_mode: ((it.tax_mode as 'exclusive' | 'inclusive') ?? 'exclusive'),
          unit_id: (it.entered_unit_id as string) ?? null,
          detached: !it.product_id,
          detached_name: (it.product_name as string) ?? undefined,
        }));
        setLines(editLines.length > 0 ? editLines : [newLine()]);
        setPricing(null);
        const { data: cvData } = await supabase.from('order_custom_values').select('*').eq('order_id', orderId);
        if (cvData) {
          const vals: Record<string, string> = {};
          cvData.forEach((row: any) => { vals[row.custom_field_id] = row.value; });
          setCustomValues(vals);
        } else {
          setCustomValues({});
        }
        setLoading(false);
        return;
      }

      // ---- CREATE ----
      setOriginalContactId(null);
      setContactId(prefillContactId ?? '');
      setDate(new Date().toISOString().split('T')[0]);
      setNotes('');
      setLines([newLine()]);
      setOrderDiscountValue('');
      setPricing(null);
      setCustomValues({});
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, accountId, supabase, prefillContactId, isEdit, orderId]);

  // Multi Unit: resolve a line's entered unit id, its conversion factor to the
  // base unit (base unit = factor 1), and the display name. When the feature is
  // off, or the product has no conversions, this collapses to base/factor 1 — so
  // every downstream number is identical to single-unit behaviour. Declared here
  // (before detection/pricing memos) because both use it.
  const unitInfoOf = useCallback(
    (l: LineInput) => {
      const p = products.find((pp) => pp.id === l.product_id);
      const baseId = p?.base_unit_id ?? null;
      const enteredId = l.unit_id ?? baseId ?? null;
      let factor = 1;
      let name = p?.unit || '';
      if (enteredId && enteredId !== baseId) {
        const c = p?.conversions?.find((x) => x.unit_id === enteredId);
        if (c) { factor = c.factor; name = c.name; }
      }
      return { enteredId, baseId, factor, name };
    },
    [products],
  );

  // ---- scheme detection (Phase 4): run on the salesman's product lines ----
  // A compact signature so detection only re-runs when a product or quantity
  // changes, not on every discount keystroke.
  // Signature carries the conversion factor too, so detection re-runs when the
  // rep switches units (scheme thresholds can be measured in base units).
  const detectionSignature = useMemo(
    () => lines.filter((l) => l.product_id && Number(l.quantity) > 0)
      .map((l) => `${l.product_id}:${Number(l.quantity) || 0}:${unitInfoOf(l).factor}`).join('|'),
    [lines, unitInfoOf],
  );
  const detectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!accountId || !contactId || !detectionSignature) { setSchemeDetection(null); return; }
    const base = detectionSignature.split('|').map((s) => {
      const [product_id, qty, factor] = s.split(':');
      return { product_id, quantity: Number(qty) || 0, conversion_factor: Number(factor) || 1 };
    });
    if (detectRef.current) clearTimeout(detectRef.current);
    detectRef.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc('detect_eligible_schemes', {
        p_account_id: accountId,
        p_contact_id: contactId,
        p_lines: base,
        p_as_of: new Date().toISOString(),
      });
      if (error) { console.error('scheme detection failed', error); setSchemeDetection(null); return; }
      setSchemeDetection(data as SchemeDetection);
    }, 400);
    return () => { if (detectRef.current) clearTimeout(detectRef.current); };
  }, [accountId, contactId, detectionSignature, supabase]);

  const isAccepted = useCallback(
    (key: string, dflt: boolean) => (key in schemeOverrides ? schemeOverrides[key] : dflt),
    [schemeOverrides],
  );

  // ---- inputs the pricing function needs, WITH confirmed schemes injected ----
  const pricingInputs = useMemo(() => {
    const productLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
    const priced = productLines.map((l, i) => {
      const info = unitInfoOf(l);
      const base: Record<string, unknown> = {
        product_id: l.product_id,
        quantity: Number(l.quantity) || 0,
        // Multi Unit: base_quantity = quantity × factor is derived server-side.
        conversion_factor: info.factor,
        entered_unit_id: info.enteredId,
        discount_type: itemDiscountAllowed && Number(l.discount_value) > 0 ? (forcedDiscountType ?? l.discount_type) : null,
        discount_value: itemDiscountAllowed ? (Number(l.discount_value) || 0) : 0,
        tax_mode: l.tax_mode ?? taxMode,
        ...(l.locked_price != null ? { locked_price: l.locked_price } : {}),
      };
      // A confirmed MONEY line-scheme for this position is attached to the line.
      const ls = schemeDetection?.line_schemes.find((s) => s.position === i + 1 && s.reward_type !== 'free_goods');
      if (ls && isAccepted(`line:${i + 1}:${ls.scheme_id}`, ls.default_selected)) {
        base.scheme_id = ls.scheme_id;
        base.scheme_discount_amount = ls.scheme_discount_amount;
      }
      return base;
    });
    // Confirmed FREE-GOODS schemes become their own ₹0 lines, appended AFTER the
    // product lines so value-slab positions (1..N) still map to the product lines.
    const freeLines = (schemeDetection?.line_schemes ?? [])
      .filter((s) => s.reward_type === 'free_goods' && s.free_product_id && s.free_qty > 0
        && isAccepted(`line:${s.position}:${s.scheme_id}`, s.default_selected))
      .map((s) => ({ product_id: s.free_product_id as string, quantity: s.free_qty, is_scheme_goods: true, scheme_id: s.scheme_id }));
    // Confirmed VALUE-SLAB schemes go to p_order_schemes.
    const orderSchemes = (schemeDetection?.order_schemes ?? [])
      .filter((s) => isAccepted(`order:${s.scheme_id}`, s.default_selected))
      .map((s) => ({ scheme_id: s.scheme_id, discount_amount: s.discount_amount, positions: s.applies_to_positions }));
    const orderDiscount = orderDiscountAllowed && Number(orderDiscountValue) > 0
      ? { type: forcedDiscountType ?? orderDiscountType, value: Number(orderDiscountValue) }
      : null;
    return { priced: [...priced, ...freeLines], orderDiscount, orderSchemes, productCount: productLines.length };
  }, [lines, schemeDetection, isAccepted, itemDiscountAllowed, orderDiscountAllowed, orderDiscountType, orderDiscountValue, forcedDiscountType, taxMode, unitInfoOf]);

  // ---- debounced live pricing via the ONE authority ----
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!accountId) return;
    if (pricingInputs.productCount === 0) { setPricing(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPricingBusy(true);
    debounceRef.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc('calculate_order_pricing', {
        p_account_id: accountId,
        p_contact_id: contactId || null,
        p_lines: pricingInputs.priced,
        p_order_discount: pricingInputs.orderDiscount,
        p_as_of: new Date().toISOString(),
        p_order_schemes: pricingInputs.orderSchemes,
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

  // ---- Price Lists (v5): does the selected customer have an ACTIVE price list? ----
  // Only used to gate the discount fields; the engine resolves prices itself.
  useEffect(() => {
    if (!contactId || !accountId) { setCustomerHasPriceList(false); return; }
    let alive = true;
    supabase
      .from('contacts')
      .select('price_list_id, price_lists(active)')
      .eq('id', contactId)
      .single()
      .then(({ data }) => {
        if (!alive) return;
        const hasId = !!(data as { price_list_id?: string | null } | null)?.price_list_id;
        const active = (data as { price_lists?: { active?: boolean } | null } | null)?.price_lists?.active === true;
        setCustomerHasPriceList(hasId && active);
      });
    return () => { alive = false; };
  }, [contactId, accountId, supabase]);

  // ---- Auto-compute GST place of supply (preview) ----
  // Load the customer's GSTIN + state and resolve a GST state code the same way
  // the server does: a registered party's code is its GSTIN's first two digits;
  // otherwise fall back to mapping the state name.
  useEffect(() => {
    if (!gstEnabled || !contactId || !accountId) {
      setPlaceOfSupplyCode('');
      return;
    }
    let alive = true;
    supabase
      .from('contacts')
      .select('state, gst_number')
      .eq('id', contactId)
      .single()
      .then(({ data }) => {
        if (!alive) return;
        const code =
          gstStateCodeFromGstin((data as { gst_number?: string | null } | null)?.gst_number) ??
          gstStateCode(data?.state) ??
          '';
        setPlaceOfSupplyCode(code);
      });
    return () => { alive = false; };
  }, [contactId, gstEnabled, accountId, supabase]);

  // Derived, mirroring the server: intrastate (SGST+CGST) when the two state
  // codes match, interstate (IGST) when they differ, and 'unknown' when either
  // is missing — NEVER a silent IGST.
  const gstType = determineGstType(companyStateCode, placeOfSupplyCode);
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
    if (pricingInputs.productCount === 0) { toast.error('Add at least one product'); return; }
    // A detached (deleted-product) line that hasn't been re-attached would be
    // silently dropped by the product_id filter — stop and make the user resolve it.
    if (lines.some((l) => l.detached && !l.product_id)) {
      toast.error('Re-attach or remove the deleted-product line before saving.');
      return;
    }
    if (pricing && !pricing.valid) {
      const names = pricing.floor_violations.map((v) => v.product_name).join(', ');
      toast.error(`Below the price floor: ${names}. Reduce the discount to save.`);
      return;
    }

    // Stock block (opt-in). Only for NEW orders: an edit re-checking against
    // already-consumed stock would wrongly block a legitimate correction. Only
    // stock-tracked products (present in closingMap) are checked — services and
    // untracked items are skipped.
    if (stockEnabled && restrictStock && !isEdit) {
      const need = new Map<string, { name: string; qty: number }>();
      for (const l of lines) {
        if (!l.product_id) continue;
        const q = parseFloat(l.quantity) || 0;
        if (q <= 0) continue;
        const prev = need.get(l.product_id);
        need.set(l.product_id, {
          name: products.find((p) => p.id === l.product_id)?.name ?? 'Product',
          qty: (prev?.qty ?? 0) + q,
        });
      }
      const short: string[] = [];
      for (const [pid, info] of need) {
        const closing = closingMap.get(pid);
        if (closing === undefined) continue; // not stock-tracked
        if (exceedsAvailable(closing, info.qty)) short.push(`${info.name} (need ${info.qty}, have ${closing})`);
      }
      if (short.length) {
        toast.error(`Not enough stock: ${short.join('; ')}.`);
        return;
      }
    }

    if (paymentEnabled && financialData) {
      // 1. Credit Days (Overdue) check
      if (financialData.isOverdue && creditDaysAction !== 'ignore') {
        if (creditDaysAction === 'block') {
          toast.error(`Customer has overdue invoices. Order cannot be saved.`);
          return;
        } else if (creditDaysAction === 'warn') {
          if (!confirm(`Warning: This customer has overdue invoices. Do you want to proceed?`)) {
            return;
          }
        }
      }

      // 2. Credit Limit check
      if (financialData.creditLimit !== null && creditLimitAction !== 'ignore') {
        const available = financialData.availableCredit ?? 0;
        const orderTotal = pricing ? pricing.total_amount : 0;
        if (orderTotal > available) {
          if (creditLimitAction === 'block') {
            toast.error(`Order amount (${formatCurrency(orderTotal, defaultCurrency || 'USD')}) exceeds available credit (${formatCurrency(available, defaultCurrency || 'USD')}).`);
            return;
          } else if (creditLimitAction === 'warn') {
            if (!confirm(`Warning: This order exceeds the customer's available credit. Do you want to proceed?`)) {
              return;
            }
          }
        }
      }
    }

    const cfError = validateRequiredCustomFields(customFields, customValues, {
      date,
    });
    if (cfError) {
      toast.error(cfError);
      return;
    }

    setSaving(true);
    try {
      if (isEdit && orderId) {
        // Customer change/re-attach goes through update_order's validated
        // p_contact_id (migration 085): it runs the same dispatch-lock check and
        // verifies the customer belongs to the account, all in one transaction —
        // no separate direct write to orders.
        const { data, error } = await supabase.rpc('update_order', {
          p_order_id: orderId,
          p_lines: pricingInputs.priced,
          p_order_discount: pricingInputs.orderDiscount,
          p_notes: notes.trim() || null,
          p_contact_id: contactId,
          p_order_schemes: pricingInputs.orderSchemes,
        });
        if (error) throw error;
        if (orderId && Object.keys(customValues).length > 0) {
          await supabase.from('order_custom_values').delete().eq('order_id', orderId);
          const toInsert = Object.entries(customValues)
            .filter(([_, v]) => v !== undefined && v !== '')
            .map(([fId, v]) => ({ account_id: accountId, order_id: orderId, custom_field_id: fId, value: v }));
          if (toInsert.length > 0) {
            await supabase.from('order_custom_values').insert(toInsert);
          }
        }
        const status = (data as Record<string, unknown>)?.pricing_status as string | undefined;
        // Log the edit on the order timeline (the RPC doesn't log this).
        await logModuleActivity(supabase, {
          moduleName: 'order', recordId: orderId, action: 'order_edited', message: 'Order updated',
        });
        toast.success(status === 'review' ? 'Order saved — flagged for review' : 'Order updated');
      } else {
        const newOrderId = crypto.randomUUID();
        const { data, error } = await supabase.rpc('create_order', {
          p_order_id: newOrderId,
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
          p_order_schemes: pricingInputs.orderSchemes,
        });
        if (error) throw error;
        if (newOrderId && Object.keys(customValues).length > 0) {
          const toInsert = Object.entries(customValues)
            .filter(([_, v]) => v !== undefined && v !== '')
            .map(([fId, v]) => ({ account_id: accountId, order_id: newOrderId, custom_field_id: fId, value: v }));
          if (toInsert.length > 0) {
            await supabase.from('order_custom_values').insert(toInsert);
          }
        }
        const num = (data as Record<string, unknown>)?.order_number as string | undefined;
        // Log creation on the order timeline (create_order doesn't log this).
        await logModuleActivity(supabase, {
          moduleName: 'order', recordId: newOrderId, action: 'order_created',
          message: num ? `Order ${num} created` : 'Order created',
        });
        toast.success(num ? `Order ${num} created` : 'Order created');
      }
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      // Show the actual reason, not a generic message (see supaErr).
      toast.error(`Couldn't ${isEdit ? 'update' : 'create'} order: ${supaErr(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const formContent = (
    <>
      {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : loadError ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-3 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /><span>{loadError}</span>
          </div>
        ) : locked ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>This order has been dispatched and can no longer be edited. Create a return or a new order instead.</span>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Customer & Order Information */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Customer <span className="text-red-400">*</span></Label>
                <SearchableSelect
                  options={contacts.map((c) => ({ value: c.id, label: c.label }))}
                  value={contactId}
                  onChange={setContactId}
                  placeholder="Select a customer"
                />
                {isEdit && !originalContactId && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    The original customer was removed — pick a replacement to fix this order.
                  </p>
                )}
                {customerHasPriceList && (
                  <p className="text-xs text-muted-foreground">
                    This customer is on a price list — its prices are applied automatically.
                    {discountBlockedByPriceList ? ' Manual discounts are turned off for price-list customers.' : ''}
                  </p>
                )}
              </div>

              {paymentEnabled && accountId && contactId && (
                <div className="mt-2">
                  <CustomerFinancialCard contactId={contactId} accountId={accountId} onDataLoaded={setFinancialData} />
                </div>
              )}

              <CustomFieldsSectionRenderer
                accountId={accountId}
                moduleName="order"
                fieldGridClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-4"
                customFields={customFields}
                customValues={customValues}
                onChange={(id, val) => setCustomValues({ ...customValues, [id]: val })}
                formData={{
                  date,
                }}
                onFormDataChange={(key, val) => {
                  if (key === 'date') setDate(val);
                }}
              />
            </div>

            {/* Line items */}
            <FormSection
              title="Product Details"
              action={pricingBusy ? <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> pricing…</span> : undefined}
            >
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
                      // Per-unit rate WITH tax comes straight from the pricing function
                      // (rate_incl_unit), so it's correct in both exclusive and inclusive
                      // modes. Line total incl. (before line discount) = that × qty.
                      const rateInclUnit = priced ? priced.rate_incl_unit : null;
                      const lineInclPreDiscount = priced && rateInclUnit != null ? rateInclUnit * priced.quantity : null;
                      // Multi Unit line context.
                      const prod = products.find((p) => p.id === line.product_id);
                      const info = unitInfoOf(line);
                      const showUnitPicker = multiUnitEnabled && !!prod && (prod.conversions?.length ?? 0) > 0;
                      const enteredQty = Number(line.quantity) || 0;
                      const baseQty = enteredQty * info.factor;
                      const baseUnitName = prod?.unit || '';
                      // Price is per BASE unit; when a bigger unit is picked, show the
                      // derived "per selected unit" price so the amount reads right.
                      const perSelectedUnit = priced && info.factor !== 1 ? priced.effective_unit_price * info.factor : null;
                      return (
                        <tr key={line.key} className="border-b border-border/60 last:border-0 align-top">
                          <td className="px-3 py-2">
                            <SearchableSelect
                              options={productOptions}
                              value={line.product_id}
                              // Changing/re-attaching a product clears the locked price so the
                              // line prices at the new product's current rate (founder's decision).
                              onChange={(v) => updateLine(line.key, { product_id: v, detached: false, locked_price: null, unit_id: null })}
                              placeholder={line.detached ? 'Re-attach a product' : 'Select a product'}
                            />
                            {line.detached && !line.product_id && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                                Was &ldquo;{line.detached_name || 'a deleted product'}&rdquo; (removed) — pick a replacement.
                              </p>
                            )}
                            {stockEnabled && line.product_id && closingMap.has(line.product_id) && (() => {
                              const closing = closingMap.get(line.product_id) ?? 0;
                              const q = parseFloat(line.quantity) || 0;
                              const over = q > 0 && exceedsAvailable(closing, q);
                              return (
                                <p className={`text-[11px] mt-1 ${closing <= 0 ? 'text-red-500' : over ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                                  In stock: {closing}
                                  {over ? (restrictStock ? ' — exceeds available (blocked)' : ' — exceeds available') : ''}
                                </p>
                              );
                            })()}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">
                            {showUnitPicker ? (
                              <select
                                value={info.enteredId ?? ''}
                                onChange={(e) => updateLine(line.key, { unit_id: e.target.value || null })}
                                aria-label="Unit"
                                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                              >
                                {prod?.base_unit_id && <option value={prod.base_unit_id}>{baseUnitName || 'Base'}</option>}
                                {(prod?.conversions ?? []).map((c) => (
                                  <option key={c.unit_id} value={c.unit_id}>{c.name}</option>
                                ))}
                              </select>
                            ) : (
                              unit || '—'
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number" min="0" step="any" value={line.quantity}
                              onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                              className="w-16 text-right ml-auto" aria-label="Quantity"
                            />
                            {showUnitPicker && info.factor !== 1 && enteredQty > 0 && (
                              <p className="mt-1 text-[11px] text-muted-foreground text-right whitespace-nowrap">
                                = {baseQty} {baseUnitName}
                              </p>
                            )}
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
                            {perSelectedUnit != null && (
                              <p className="mt-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                                = {money(perSelectedUnit)} / {info.name}
                              </p>
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
                                {forcedDiscountType ? (
                                  <span className="h-8 w-8 shrink-0 rounded-md border border-border text-xs font-medium flex items-center justify-center text-muted-foreground">
                                    {forcedDiscountType === 'percent' ? '%' : defaultCurrency}
                                  </span>
                                ) : (
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
                                )}
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

              <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, newLine()])}>
                <Plus className="mr-1.5 h-4 w-4" /> Add Product
              </Button>
            </FormSection>

            {/* Scheme suggestions (Phase 4) — suggest → confirm */}
            {schemeDetection && (schemeDetection.line_schemes.length > 0 || schemeDetection.order_schemes.length > 0) && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Tag className="size-4 text-primary" /> Schemes for this customer
                </div>
                <p className="text-xs text-muted-foreground">
                  Suggested — tick to apply. Nothing changes the order until you confirm. Free goods are added as ₹0 lines.
                </p>
                <div className="space-y-2">
                  {schemeDetection.line_schemes.map((s) => {
                    const key = `line:${s.position}:${s.scheme_id}`;
                    const accepted = isAccepted(key, s.default_selected);
                    const prodName = products.find((p) => p.id === s.product_id)?.name ?? 'this product';
                    const label = s.reward_type === 'free_goods'
                      ? `${s.free_qty} × ${s.free_product_name ?? 'free goods'} free`
                      : s.reward_type === 'discount_percent' ? `${s.reward_value}% off`
                      : s.reward_type === 'discount_amount' ? `${money(s.reward_value)}/unit off`
                      : `special price ${money(s.reward_value)}`;
                    return (
                      <label key={key} className="flex items-start gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={accepted}
                          onChange={() => setSchemeOverrides((prev) => ({ ...prev, [key]: !accepted }))}
                          className="mt-0.5 size-4 accent-primary"
                        />
                        <span>
                          <span className="font-medium">{s.scheme_name}</span>: {label}{' '}
                          <span className="text-muted-foreground">on {prodName}</span>
                          {s.reward_type !== 'free_goods' && s.scheme_discount_amount > 0 && (
                            <span className="text-muted-foreground"> (−{money(s.scheme_discount_amount)})</span>
                          )}
                          {s.nudge && (
                            <span className="block text-xs text-amber-600 dark:text-amber-500">
                              {s.nudge.units_to_next ? `Add ${s.nudge.units_to_next} more → ${s.nudge.next_reward_label}` : s.nudge.next_reward_label}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                  {schemeDetection.order_schemes.map((s) => {
                    const key = `order:${s.scheme_id}`;
                    const accepted = isAccepted(key, s.default_selected);
                    return (
                      <label key={key} className="flex items-start gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={accepted}
                          onChange={() => setSchemeOverrides((prev) => ({ ...prev, [key]: !accepted }))}
                          className="mt-0.5 size-4 accent-primary"
                        />
                        <span>
                          <span className="font-medium">{s.scheme_name}</span>: {money(s.discount_amount)} off the order
                          {s.nudge && s.nudge.value_to_next != null && (
                            <span className="block text-xs text-amber-600 dark:text-amber-500">
                              {money(s.nudge.value_to_next)} more → {s.nudge.next_reward_label}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Whole-order discount */}
            {orderDiscountAllowed && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">Whole-order discount</Label>
                {forcedDiscountType ? (
                  <span className="h-9 w-9 rounded-md border border-border text-sm font-medium flex items-center justify-center text-muted-foreground">
                    {forcedDiscountType === 'percent' ? '%' : defaultCurrency}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setOrderDiscountType((t) => (t === 'percent' ? 'amount' : 'percent')); setOrderDiscountValue(''); }}
                    className="h-9 w-9 rounded-md border border-border text-sm font-medium hover:bg-muted"
                    title="Toggle % or amount"
                  >
                    {orderDiscountType === 'percent' ? '%' : defaultCurrency}
                  </button>
                )}
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


            {/* GST Type — a READ-ONLY indicator of what the server will determine
                and freeze on the order (auto from company state vs place of
                supply). Not user-editable; correct it by fixing the states. */}
            {gstEnabled && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground font-medium">GST Type:</span>
                {gstType === 'interstate' && <span className="text-xs font-semibold text-foreground">IGST (Interstate)</span>}
                {gstType === 'intrastate' && <span className="text-xs font-semibold text-foreground">SGST + CGST (Intrastate)</span>}
                {gstType === 'unknown' && (
                  <span className="text-xs font-medium text-amber-600">
                    Not determined — set your company State (Settings → Company Profile)
                    {contactId ? ' and the customer’s State/GSTIN' : ''}.
                  </span>
                )}
              </div>
            )}

            {/* Totals */}
            <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-1.5 text-sm">
              <Row label="Sub-total" value={pricing ? money(pricing.sub_total) : '—'} />
              {pricing && pricing.discount_total > 0 && (
                <Row label="Discount" value={`− ${money(pricing.discount_total)}`} accent />
              )}
              {/* GST breakdown. intrastate → SGST+CGST (half each); interstate →
                  IGST; unknown/off → a single Tax row. Preview only — the split
                  amounts are derived at export time, never stored. */}
              {gstEnabled && pricing && pricing.tax_total > 0 && gstType === 'interstate' ? (
                <Row label="IGST" value={money(pricing.tax_total)} />
              ) : gstEnabled && pricing && pricing.tax_total > 0 && gstType === 'intrastate' ? (
                <>
                  <Row label="SGST" value={money(pricing.tax_total / 2)} />
                  <Row label="CGST" value={money(pricing.tax_total / 2)} />
                </>
              ) : (
                <Row label="Tax" value={pricing ? money(pricing.tax_total) : '—'} />
              )}
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

        <div className="flex justify-end gap-2 pt-4">
          {locked || loadError ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} data-shortcut="save" disabled={saving || loading || (pricing != null && !pricing.valid)}>
                {saving && <Loader2 className="size-4 mr-1 animate-spin" />} {isEdit ? 'Save Changes' : 'Create Order'}
              </Button>
            </>
          )}
        </div>
    </>
  );

  if (asPage) {
    return (
      <FormPageShell
        icon={ShoppingCart}
        title={isEdit ? 'Edit Order' : 'Add New Order'}
        subtitle={isEdit ? 'Update the order details below.' : 'Create a new sales order with live pricing and discounts.'}
        onBack={() => onOpenChange(false)}
        width="none"
      >
        {formContent}
      </FormPageShell>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Order' : 'New Order'}</DialogTitle>
          <DialogDescription>
            Prices are calculated live by the server. The standard price is struck through when a
            discount applies, so you can show the customer exactly what they&apos;re getting.
          </DialogDescription>
        </DialogHeader>
        {formContent}
        <DialogFooter>
          {locked || loadError ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} data-shortcut="save" disabled={saving || loading || (pricing != null && !pricing.valid)}>
                {saving && <Loader2 className="size-4 mr-1 animate-spin" />} {isEdit ? 'Save Changes' : 'Create Order'}
              </Button>
            </>
          )}
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
