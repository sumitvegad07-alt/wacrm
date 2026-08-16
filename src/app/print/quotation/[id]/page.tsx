'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { formatCurrency } from '@/lib/currency';
import { buildDefaultConfig, type DocumentTemplateConfig } from '@/lib/document-templates/schema';
import { resolveTemplateConfig } from '@/lib/document-templates/repository';
import { fetchLetterhead, type CompanyLetterhead } from '@/lib/document-templates/company-profile';
import { fetchCustomFieldValues } from '@/lib/document-templates/custom-fields';
import {
  DocumentTemplatePreview,
  type DocumentRenderData,
  type ItemRowData,
} from '@/components/settings/document-templates/document-template-preview';

/**
 * Print / PDF view for a quotation, rendered from the account's Quotation template.
 *
 * `quotation_items` carries no discount and no catalogue price, so the Quotation template
 * offers neither — the same "only what the module can fill" rule the editor applies.
 * `terms_conditions` on the quotation itself takes precedence over the template footer:
 * terms typed for one specific quotation are more specific than a house default.
 */
export default function QuotationPrintView() {
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();

  const [data, setData] = useState<DocumentRenderData | null>(null);
  const [config, setConfig] = useState<DocumentTemplateConfig>(() => buildDefaultConfig('quotation'));
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function loadData() {
      const { data: quotation } = await supabase
        .from('quotations')
        .select('*, contact:contacts!quotations_contact_id_fkey(*)')
        .eq('id', id)
        .maybeSingle();

      if (!quotation) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();

      const [{ data: items }, { data: profile }, templateConfig, letterhead] = await Promise.all([
        supabase.from('quotation_items').select('*').eq('quotation_id', id).order('position'),
        quotation.user_id
          ? supabase.from('profiles').select('full_name, email, phone').eq('user_id', quotation.user_id).maybeSingle()
          : Promise.resolve({ data: null }),
        resolveTemplateConfig(supabase, quotation.account_id, 'quotation', auth?.user?.id ?? null),
        fetchLetterhead(supabase, quotation.account_id),
      ]);

      const quotationItems = items ?? [];

      const productIds = [...new Set(quotationItems.map((i: any) => i.product_id).filter(Boolean))];
      const productsById = new Map<string, any>();
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, sku, hsn_code, category, image')
          .in('id', productIds);
        for (const p of products ?? []) productsById.set(p.id, p);
      }

      const customFieldValues = await fetchCustomFieldValues(supabase, 'quotation', id, templateConfig.customFieldIds);

      // Terms typed on this quotation beat the template's house footer.
      const effectiveConfig: DocumentTemplateConfig = quotation.terms_conditions?.trim()
        ? {
            ...templateConfig,
            bottomSections: {
              ...templateConfig.bottomSections,
              footer: { enabled: true, text: quotation.terms_conditions },
            },
          }
        : templateConfig;

      setConfig(effectiveConfig);
      setData(build(quotation, quotationItems, productsById, profile, letterhead, customFieldValues));
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
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Quotation not found</div>;
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

        <DocumentTemplatePreview module="quotation" config={config} data={data} />
      </div>
    </div>
  );
}

function build(
  quotation: any,
  items: any[],
  productsById: Map<string, any>,
  profile: any,
  letterhead: CompanyLetterhead,
  customFieldValues: { label: string; value: string }[]
): DocumentRenderData {
  const money = (v: unknown) => formatCurrency(Number(v || 0));
  const cust = quotation.contact || {};

  const itemRows: ItemRowData[] = items.map((item, idx) => {
    const product = item.product_id ? productsById.get(item.product_id) : undefined;
    return {
      itemNo: String(idx + 1),
      imageUrl: product?.image ?? null,
      itemCode: product?.sku ?? '',
      hsnCode: product?.hsn_code ?? '',
      category: product?.category ?? '',
      item: item.product_name ?? '',
      unit: item.unit || 'PCS',
      quantity: String(item.quantity ?? ''),
      price: money(item.price),
      tax: `${item.tax_rate || 0}%`,
      subAmount: money(item.sub_total),
      netAmount: money(item.total),
    };
  });

  const byUnit = new Map<string, { qty: number; lines: number }>();
  for (const item of items) {
    const unit = (item.unit || 'PCS').trim();
    const entry = byUnit.get(unit) ?? { qty: 0, lines: 0 };
    entry.qty += Number(item.quantity) || 0;
    entry.lines += 1;
    byUnit.set(unit, entry);
  }

  const fmtDate = (v: any) =>
    v
      ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
      : '';

  return {
    documentTitle: 'QUOTATION',
    documentNumber: quotation.quotation_number || `QT-${String(quotation.id).substring(0, 6)}`,
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
      city: cust.city || undefined,
      state: cust.state || undefined,
      pincode: cust.pincode || undefined,
    },
    infoRows: {
      documentDate: fmtDate(quotation.date),
      documentStatus: quotation.status || '',
      validUntil: fmtDate(quotation.valid_until),
      createdBy: profile?.full_name || profile?.email || 'System',
      createdByEmail: profile?.email || '',
      createdByContact: profile?.phone || '',
    },
    items: itemRows,
    totals: {
      subTotal: money(quotation.sub_total),
      taxSummary: Number(quotation.tax_total || 0) > 0 ? money(quotation.tax_total) : '',
      total: money(quotation.total_amount),
    },
    quantitySummary: [...byUnit.entries()].map(
      ([unit, { qty, lines }]) => `Total ${unit} : ${qty} (${lines} ${lines === 1 ? 'item' : 'items'})`
    ),
    customFieldValues,
    headlineAmount: null,
  };
}
