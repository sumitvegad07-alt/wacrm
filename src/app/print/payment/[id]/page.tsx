import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { PrintButton } from './print-button';

export default async function PaymentPrintView(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();

  // Fetch payment with contacts, leads, and payment types
  const { data: payment } = await supabase
    .from('payments')
    .select('*, contacts(*), leads(*), payment_types(name)')
    .eq('id', id)
    .single();

  if (!payment) {
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Payment not found</div>;
  }

  // Fetch account details for header and profile for collected by
  const [{ data: account }, { data: profile }] = await Promise.all([
    supabase.from('accounts').select('*').eq('id', payment.account_id).single(),
    payment.user_id
      ? supabase.from('profiles').select('full_name, email').eq('user_id', payment.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const createdBy = profile?.full_name || profile?.email || 'System';
  const cust = payment.contacts || payment.leads || {};
  const companyName = cust.company || cust.name || 'Unknown Company';
  const inr = (v: any) => `₹ ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  
  // Outstanding calculations use COALESCE(verified_amount, amount) 
  const finalAmount = payment.verified_amount != null ? payment.verified_amount : payment.amount;
  const paymentNo = payment.payment_number || `PAY-${String(payment.id).substring(0, 6)}`;

  return (
    <div className="min-h-screen bg-white text-black font-sans print:bg-white print:p-0 p-8">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
          @page { margin: 10mm; size: A4 portrait; }
          .print-hide { display: none !important; }
        }
      ` }} />

      <div className="max-w-[900px] mx-auto bg-white p-8 border border-gray-200 shadow-sm print:border-none print:shadow-none print:max-w-none print:p-0">
        
        <PrintButton />

        {/* HEADER */}
        <div className="flex justify-between items-start mb-8 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">{account?.business_name || account?.name || 'Company'}</h1>
            <p className="text-xs text-gray-800 mt-1 font-medium">{[account?.phone, account?.email].filter(Boolean).join(' | ')}</p>
            <p className="text-xs text-gray-800 font-medium">GST No : {account?.gst_number || account?.gstin || ''}</p>
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-semibold text-blue-600 tracking-wide uppercase">
              PAYMENT RECEIPT
            </h2>
            <p className="text-sm font-bold text-gray-800 mt-1">{paymentNo}</p>
          </div>
        </div>

        {/* METADATA */}
        <div className="flex justify-between mb-8 border-t border-gray-200 pt-4">
          <div>
            <h3 className="text-[11px] font-semibold text-gray-600 italic mb-1">Received From,</h3>
            <p className="font-bold text-gray-900 text-sm">{companyName}</p>
            {cust.name && <p className="text-xs text-gray-800 font-medium">{cust.name}</p>}
            {(cust.address || cust.city || cust.country) && (
              <p className="text-xs text-gray-600">{[cust.address, cust.city, cust.state, cust.country].filter(Boolean).join(', ')}</p>
            )}
            {cust.gst_number && <p className="text-xs text-gray-600">GST : {cust.gst_number}</p>}
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs"><span className="font-semibold text-gray-800">Date : </span> <span className="font-bold">{new Date(payment.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')}</span></p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Status : </span> <span className="capitalize">{payment.status}</span></p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Collected By : </span> {createdBy}</p>
          </div>
        </div>

        {/* PAYMENT DETAILS */}
        <div className="mb-8 border border-gray-300">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="text-gray-900 font-bold border-b border-gray-300 bg-gray-50">
              <tr>
                <th className="px-3 py-2 border-r border-gray-300">Payment Mode</th>
                <th className="px-3 py-2 border-r border-gray-300">Reference Number</th>
                <th className="px-3 py-2 border-r border-gray-300 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Verified Amount</th>
              </tr>
            </thead>
            <tbody className="text-gray-800 font-medium">
              <tr className="align-top">
                <td className="px-3 py-3 border-r border-gray-300">{payment.payment_types?.name || 'Standard'}</td>
                <td className="px-3 py-3 border-r border-gray-300">{payment.reference_number || '—'}</td>
                <td className="px-3 py-3 border-r border-gray-300 text-right">{inr(payment.amount)}</td>
                <td className="px-3 py-3 text-right font-bold text-gray-900">
                  {payment.verified_amount != null ? inr(payment.verified_amount) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* TOTALS */}
        <div className="flex justify-end mb-12">
          <div className="w-64 border border-gray-300">
            <div className="flex bg-gray-50">
              <div className="w-1/2 p-2 text-right text-sm font-bold text-gray-800 border-r border-gray-300">Total Received</div>
              <div className="w-1/2 p-2 text-right text-sm font-bold">{inr(finalAmount)}</div>
            </div>
          </div>
        </div>

        {payment.notes && (
          <div className="space-y-6 mb-12">
            <div>
              <h4 className="text-xs font-bold text-gray-800 mb-2">Notes</h4>
              <div className="text-xs text-gray-700 whitespace-pre-wrap font-medium">{payment.notes}</div>
            </div>
          </div>
        )}
        
        {/* FOOTER */}
        <div className="mt-16 pt-4 border-t border-gray-200 text-center">
          <p className="text-[10px] text-gray-500 italic">This is a computer generated receipt and does not require a physical signature.</p>
        </div>
      </div>
    </div>
  );
}
