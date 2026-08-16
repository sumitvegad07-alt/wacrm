import { createClient } from '@/lib/supabase/server';
import { formatCurrency } from '@/lib/currency';
import { resolveTemplateConfig } from '@/lib/document-templates/repository';
import { fetchLetterhead } from '@/lib/document-templates/company-profile';
import {
  DocumentTemplatePreview,
  type DocumentRenderData,
} from '@/components/settings/document-templates/document-template-preview';
import { PrintButton } from './print-button';

/**
 * Print / PDF view for a payment receipt, rendered from the account's Payment template
 * (Settings → Document Templates).
 *
 * A receipt has no line items — `payments` is one row with an amount — so the shared
 * renderer shows the headline amount block instead of a table. That is the same
 * capability rule the editor uses to hide the Item Table section for this module.
 *
 * Server component, unlike the order route, because it already was one. The shared
 * renderer is a client component receiving plain serialisable data, which works from here.
 */
export default async function PaymentPrintView(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: payment } = await supabase
    .from('payments')
    .select('*, contacts(*), leads(*), payment_types(name)')
    .eq('id', id)
    .maybeSingle();

  if (!payment) {
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Payment not found</div>;
  }

  const { data: auth } = await supabase.auth.getUser();

  const [{ data: profile }, config, letterhead] = await Promise.all([
    payment.user_id
      ? supabase.from('profiles').select('full_name, email, phone').eq('user_id', payment.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    resolveTemplateConfig(supabase, payment.account_id, 'payment', auth?.user?.id ?? null),
    fetchLetterhead(supabase, payment.account_id),
  ]);

  const customFieldValues = await loadPaymentCustomFields(supabase, id, config.customFieldIds);

  const money = (v: unknown) => formatCurrency(Number(v || 0));
  const cust = payment.contacts || payment.leads || {};

  // Finance verifies against the counted amount, so the receipt must show what was actually
  // credited — the same COALESCE the outstanding calculation uses.
  const finalAmount = payment.verified_amount != null ? payment.verified_amount : payment.amount;

  const paymentDate = payment.payment_date ? new Date(payment.payment_date) : null;

  const data: DocumentRenderData = {
    documentTitle: 'PAYMENT RECEIPT',
    documentNumber: payment.payment_number || `PAY-${String(payment.id).substring(0, 6)}`,
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
    // A receipt is issued to one party. The ship-to block is off by default for this module
    // and would repeat the payer if switched on, so it is left empty.
    shipTo: {},
    infoRows: {
      documentDate: paymentDate
        ? paymentDate.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
        : '',
      documentStatus: payment.status || '',
      paymentType: payment.payment_types?.name || payment.payment_type || '',
      referenceNumber: payment.reference_number || '',
      notes: payment.notes || '',
      createdBy: profile?.full_name || profile?.email || 'System',
      createdByEmail: profile?.email || '',
      createdByContact: profile?.phone || '',
    },
    items: [],
    totals: {},
    quantitySummary: [],
    customFieldValues,
    headlineAmount: { label: 'Amount Received', value: money(finalAmount) },
  };

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
        <PrintButton />
        <DocumentTemplatePreview module="payment" config={config} data={data} />
      </div>
    </div>
  );
}

async function loadPaymentCustomFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paymentId: string,
  fieldIds: string[]
): Promise<{ label: string; value: string }[]> {
  if (fieldIds.length === 0) return [];

  const [{ data: fields }, { data: values }] = await Promise.all([
    supabase.from('custom_fields').select('id, field_name').in('id', fieldIds),
    supabase.from('payment_custom_values').select('custom_field_id, value').eq('payment_id', paymentId),
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
