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
 * Print / PDF view for a dispatch, rendered from the account's Dispatch template.
 *
 * `dispatch_items` stores no price of its own, but every row carries `order_item_id`, and
 * the dispatch creation screen already shows Price and Sub Total by following it. This does
 * the same. A line whose order item has since gone still prints its quantity — the delivery
 * happened either way — it just carries no money.
 *
 * The template's Document Info section offers every field the dispatch form captures:
 * dispatch code, invoice number and date, LR number and date, transport and tracking.
 */
export default function DispatchPrintView() {
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();

  const [data, setData] = useState<DocumentRenderData | null>(null);
  const [config, setConfig] = useState<DocumentTemplateConfig>(() => buildDefaultConfig('dispatch'));
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function loadData() {
      const { data: dispatch } = await supabase
        .from('order_dispatches')
        .select(
          '*, order:orders(*, contacts(*), leads(*)), dispatch_items(*, order_item:order_items(product_id, price, tax_rate, unit, sub_total, total, quantity))'
        )
        .eq('id', id)
        .maybeSingle();

      if (!dispatch) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();

      const [{ data: profile }, templateConfig, letterhead] = await Promise.all([
        dispatch.order?.user_id
          ? supabase.from('profiles').select('full_name, email, phone').eq('user_id', dispatch.order.user_id).maybeSingle()
          : Promise.resolve({ data: null }),
        resolveTemplateConfig(supabase, dispatch.account_id, 'dispatch', auth?.user?.id ?? null),
        fetchLetterhead(supabase, dispatch.account_id),
      ]);

      const lines = (dispatch.dispatch_items ?? []) as any[];

      const productIds = [
        ...new Set(lines.map((l) => l.order_item?.product_id).filter(Boolean)),
      ];
      const productsById = new Map<string, any>();
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, sku, hsn_code, category, image')
          .in('id', productIds);
        for (const p of products ?? []) productsById.set(p.id, p);
      }

      const customFieldValues = await loadCustomFieldValues(supabase, id, templateConfig.customFieldIds);

      setConfig(templateConfig);
      setData(build(dispatch, lines, productsById, profile, letterhead, customFieldValues));
      setLoading(false);

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
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Dispatch not found</div>;
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

        <DocumentTemplatePreview module="dispatch" config={config} data={data} />
      </div>
    </div>
  );
}

async function loadCustomFieldValues(
  supabase: ReturnType<typeof createClient>,
  dispatchId: string,
  fieldIds: string[]
): Promise<{ label: string; value: string }[]> {
  if (fieldIds.length === 0) return [];

  const [{ data: fields }, { data: values }] = await Promise.all([
    supabase.from('custom_fields').select('id, field_name').in('id', fieldIds),
    supabase.from('dispatch_custom_values').select('custom_field_id, value').eq('dispatch_id', dispatchId),
  ]);

  const valueById = new Map((values ?? []).map((v: any) => [v.custom_field_id, v.value]));

  return fieldIds
    .map((fid) => {
      const field = (fields ?? []).find((f: any) => f.id === fid);
      const value = valueById.get(fid);
      if (!field || !value || String(value).trim() === '') return null;
      return { label: field.field_name || 'Field', value: String(value) };
    })
    .filter((x): x is { label: string; value: string } => x !== null);
}

function build(
  dispatch: any,
  lines: any[],
  productsById: Map<string, any>,
  profile: any,
  letterhead: CompanyLetterhead,
  customFieldValues: { label: string; value: string }[]
): DocumentRenderData {
  const money = (v: unknown) => formatCurrency(Number(v || 0));
  const order = dispatch.order || {};
  const cust = order.contacts || order.leads || {};

  let subTotal = 0;

  const itemRows: ItemRowData[] = lines.map((line, idx) => {
    const oi = line.order_item;
    const product = oi?.product_id ? productsById.get(oi.product_id) : undefined;
    const qty = Number(line.quantity) || 0;
    const unitPrice = Number(oi?.price || 0);
    // Priced on the quantity actually dispatched, not the quantity ordered — a part
    // dispatch must not print the whole order's value.
    const lineValue = unitPrice * qty;
    subTotal += lineValue;

    return {
      itemNo: String(idx + 1),
      imageUrl: product?.image ?? null,
      itemCode: product?.sku ?? '',
      hsnCode: product?.hsn_code ?? '',
      category: product?.category ?? '',
      item: line.product_name ?? '',
      unit: line.unit || oi?.unit || 'PCS',
      quantity: String(line.quantity ?? ''),
      price: oi ? money(unitPrice) : '',
      subAmount: oi ? money(lineValue) : '',
    };
  });

  const byUnit = new Map<string, { qty: number; lines: number }>();
  for (const line of lines) {
    const unit = (line.unit || line.order_item?.unit || 'PCS').trim();
    const entry = byUnit.get(unit) ?? { qty: 0, lines: 0 };
    entry.qty += Number(line.quantity) || 0;
    entry.lines += 1;
    byUnit.set(unit, entry);
  }

  const fmtDate = (v: any) =>
    v
      ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
      : '';

  return {
    documentTitle: 'DISPATCH',
    documentNumber: dispatch.dispatch_number || dispatch.dispatch_code || `DSP-${String(dispatch.id).substring(0, 6)}`,
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
    shipTo: {
      code: cust.customer_id || undefined,
      companyName: cust.company || cust.name || undefined,
      address: cust.address || undefined,
      area: cust.area || undefined,
      city: cust.city || undefined,
      state: cust.state || undefined,
      pincode: cust.pincode || undefined,
      phone: cust.phone || undefined,
    },
    infoRows: {
      documentDate: fmtDate(dispatch.dispatched_at),
      dispatchCode: dispatch.dispatch_code || '',
      invoiceNo: dispatch.invoice_no || '',
      invoiceDate: fmtDate(dispatch.invoice_date),
      lrNo: dispatch.lr_no || '',
      lrDate: fmtDate(dispatch.lr_date),
      transportName: dispatch.transport_name || '',
      transportContact: dispatch.transport_contact_no || '',
      trackingNumber: dispatch.tracking_number || '',
      notes: dispatch.notes || '',
      createdBy: profile?.full_name || profile?.email || 'System',
      createdByEmail: profile?.email || '',
      createdByContact: profile?.phone || '',
    },
    items: itemRows,
    totals: {
      subTotal: money(subTotal),
      total: money(subTotal),
    },
    quantitySummary: [...byUnit.entries()].map(
      ([unit, { qty, lines: n }]) => `Total ${unit} : ${qty} (${n} ${n === 1 ? 'item' : 'items'})`
    ),
    customFieldValues,
    headlineAmount: null,
  };
}
