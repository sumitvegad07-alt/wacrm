'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { formatCurrency } from '@/lib/currency';
import { buildDefaultConfig, type DocumentTemplateConfig } from '@/lib/document-templates/schema';
import { resolveTemplateConfig } from '@/lib/document-templates/repository';
import { fetchLetterhead, type CompanyLetterhead } from '@/lib/document-templates/company-profile';
import {
  DocumentTemplatePreview,
  type DocumentRenderData,
  type ItemRowData,
} from '@/components/settings/document-templates/document-template-preview';

/**
 * Print / PDF view for a single order, rendered from the account's default Order template
 * (Settings → Document Templates). Also the source the mobile app turns into a PDF via
 * PdfService (generateAndShareFromUrl → /print/order/<id>).
 *
 * The layout lives in DocumentTemplatePreview, the same component the template editor
 * previews with. That is the point: the editor cannot show one thing and the PDF print
 * another, because there is only one implementation.
 *
 * Falls back to the module's built-in default config when no template has been created, so
 * an account that has never opened the editor still gets a sensible document.
 */
export default function OrderPrintView() {
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();

  const [data, setData] = useState<DocumentRenderData | null>(null);
  const [config, setConfig] = useState<DocumentTemplateConfig>(() => buildDefaultConfig('order'));
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function loadData() {
      const { data: order } = await supabase
        .from('orders')
        .select('*, contacts(*), leads(*)')
        // maybeSingle, not single: a missing or unreadable order is a "not found" page, not
        // a 406 in the console on the way to the same screen.
        .eq('id', id)
        .maybeSingle();

      if (!order) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // The template is resolved for whoever is printing, not whoever created the order —
      // an assigned template is meant to change what *I* produce.
      const { data: auth } = await supabase.auth.getUser();

      const [{ data: items }, { data: profile }, templateConfig, letterhead] = await Promise.all([
        supabase.from('order_items').select('*').eq('order_id', id).order('position'),
        order.user_id
          ? supabase.from('profiles').select('full_name, email, phone').eq('user_id', order.user_id).maybeSingle()
          : Promise.resolve({ data: null }),
        resolveTemplateConfig(supabase, order.account_id, 'order', auth?.user?.id ?? null),
        fetchLetterhead(supabase, order.account_id),
      ]);

      const orderItems = items ?? [];

      // Item code, HSN, category and image live on `products`, never on `order_items`.
      // Fetched in one query rather than per row, and tolerant of a product that has since
      // been deleted — the line still prints, just without its catalogue extras.
      const productIds = [...new Set(orderItems.map((i: any) => i.product_id).filter(Boolean))];
      const productsById = new Map<string, any>();
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, sku, hsn_code, category, image')
          .in('id', productIds);
        for (const p of products ?? []) productsById.set(p.id, p);
      }

      const customFieldValues = await loadCustomFieldValues(
        supabase,
        order.account_id,
        id,
        templateConfig.customFieldIds
      );

      setConfig(templateConfig);
      setData(
        buildOrderRenderData(order, orderItems, productsById, profile, letterhead, customFieldValues)
      );
      setLoading(false);

      // Let fonts and images settle before the browser print dialog captures layout.
      setTimeout(() => window.print(), 500);
    }

    if (id) loadData();
  }, [id, supabase]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (notFound || !data) {
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Order not found</div>;
  }

  return (
    <div className="min-h-screen bg-white text-black font-sans print:bg-white print:p-0 p-8">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
          @page { margin: 10mm; size: A4 portrait; }
          .print-hide { display: none !important; }
        }
      ` }} />

      <div className="max-w-[900px] mx-auto bg-white p-8 border border-gray-200 shadow-sm print:border-none print:shadow-none print:max-w-none print:p-0 flex flex-col min-h-[1100px]">
        <div className="fixed top-4 right-4 print-hide">
          <button
            onClick={() => window.print()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-md text-sm font-medium transition-colors"
          >
            Print PDF
          </button>
        </div>

        <DocumentTemplatePreview module="order" config={config} data={data} />
      </div>
    </div>
  );
}

async function loadCustomFieldValues(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  orderId: string,
  fieldIds: string[]
): Promise<{ label: string; value: string }[]> {
  if (fieldIds.length === 0) return [];

  // `field_name`, not `label` — custom_fields has no label column, and asking for one
  // makes PostgREST reject the query, which silently printed no custom fields at all.
  const [{ data: fields }, { data: values }] = await Promise.all([
    supabase.from('custom_fields').select('id, field_name').in('id', fieldIds),
    supabase.from('order_custom_values').select('custom_field_id, value').eq('order_id', orderId),
  ]);

  const valueById = new Map((values ?? []).map((v: any) => [v.custom_field_id, v.value]));

  // Ordered by the template's own list, and blank values are dropped rather than printed as
  // an empty labelled slot.
  return fieldIds
    .map((fid) => {
      const field = (fields ?? []).find((f: any) => f.id === fid);
      const value = valueById.get(fid);
      if (!field || !value || String(value).trim() === '') return null;
      return { label: field.field_name || 'Field', value: String(value) };
    })
    .filter((x): x is { label: string; value: string } => x !== null);
}

function buildOrderRenderData(
  order: any,
  items: any[],
  productsById: Map<string, any>,
  profile: any,
  letterhead: CompanyLetterhead,
  customFieldValues: { label: string; value: string }[]
): DocumentRenderData {
  const currency = order.currency || undefined;
  const money = (v: any) => formatCurrency(Number(v || 0), currency);
  const cust = order.contacts || order.leads || {};

  const itemRows: ItemRowData[] = items.map((item, idx) => {
    const product = item.product_id ? productsById.get(item.product_id) : undefined;
    const qty = Number(item.quantity) || 0;
    const catalogue = Number(item.catalogue_price || 0);
    const charged = Number(item.price || 0);

    // Rendered the way the customer was told it: "5%" or "₹5.00 / unit". The amount type is
    // per-unit in this product (₹5 off on qty 101 is ₹505), so the suffix is not decoration.
    let discount = '';
    if (Number(item.discount_value) > 0) {
      discount =
        item.discount_type === 'amount'
          ? `${money(item.discount_value)} / unit`
          : `${Number(item.discount_value)}%`;
    }

    return {
      itemNo: String(idx + 1),
      imageUrl: product?.image ?? null,
      itemCode: product?.sku ?? '',
      hsnCode: product?.hsn_code ?? '',
      category: product?.category ?? '',
      item: item.product_name ?? '',
      unit: item.unit || 'PCS',
      quantity: String(item.quantity ?? ''),
      // Only worth printing when it differs from what was charged — a struck-through price
      // identical to the price beside it just looks like a rendering fault.
      mrp: catalogue > 0 && catalogue !== charged ? money(catalogue) : '',
      price: money(charged),
      discount,
      tax: `${item.tax_rate || 0}%`,
      // Derived from the stored line total rather than recomputed from the rate, so it holds
      // for inclusive and exclusive tax lines alike without this file knowing the mode.
      rateInclTax: qty > 0 ? money(Number(item.total || 0) / qty) : '',
      subAmount: money(item.sub_total),
      netAmount: money(item.total),
    };
  });

  // Grouped by unit because "Total 42" across kilograms and pieces is a meaningless number.
  const byUnit = new Map<string, { qty: number; lines: number }>();
  for (const item of items) {
    const unit = (item.unit || 'PCS').trim();
    const entry = byUnit.get(unit) ?? { qty: 0, lines: 0 };
    entry.qty += Number(item.quantity) || 0;
    entry.lines += 1;
    byUnit.set(unit, entry);
  }
  const quantitySummary = [...byUnit.entries()].map(
    ([unit, { qty, lines }]) =>
      `Total ${unit} : ${qty} (${lines} ${lines === 1 ? 'item' : 'items'})`
  );

  const orderDate = order.date ? new Date(order.date) : null;

  return {
    documentTitle: 'ORDER',
    documentNumber: order.order_number || `ORD-${String(order.id).substring(0, 6)}`,
    letterhead,
    billTo: {
      code: cust.customer_id || undefined,
      name: cust.name || undefined,
      companyName: cust.company || cust.name || undefined,
      address: cust.address || undefined,
      area: cust.area || undefined,
      city: cust.city || undefined,
      state: cust.state || undefined,
      pincode: cust.pincode || undefined,
      phone: cust.phone || undefined,
      email: cust.email || undefined,
      gstNumber: cust.gst_number || undefined,
    },
    // No separate delivery address is captured on an order today, so the ship-to block
    // repeats the customer rather than inventing an address that was never entered.
    shipTo: {
      code: cust.customer_id || undefined,
      name: cust.name || undefined,
      companyName: cust.company || cust.name || undefined,
      address: cust.address || undefined,
      area: cust.area || undefined,
      city: cust.city || undefined,
      state: cust.state || undefined,
      pincode: cust.pincode || undefined,
      phone: cust.phone || undefined,
      gstNumber: cust.gst_number || undefined,
    },
    infoRows: {
      documentDate: orderDate
        ? orderDate.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
        : '',
      documentStatus: order.status || '',
      notes: order.notes || '',
      createdBy: profile?.full_name || profile?.email || 'System',
      createdByEmail: profile?.email || '',
      createdByContact: profile?.phone || '',
    },
    items: itemRows,
    totals: {
      subTotal: money(order.sub_total),
      discount: Number(order.discount_total || 0) > 0 ? money(order.discount_total) : '',
      taxSummary: Number(order.tax_total || 0) > 0 ? money(order.tax_total) : '',
      total: money(order.total_amount),
    },
    quantitySummary,
    customFieldValues,
    headlineAmount: null,
  };
}
