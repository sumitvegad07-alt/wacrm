'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';

/**
 * Print / PDF view for a single order. Mirrors the quotation print template
 * (src/app/print/quotation/[id]) so orders share the same house style, and is
 * the source the mobile app renders to a PDF via PdfService
 * (generateAndShareFromUrl → /print/order/<id>).
 */
export default function OrderPrintView() {
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();

  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [account, setAccount] = useState<any>(null);
  const [createdBy, setCreatedBy] = useState<string>('System');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const { data: oData } = await supabase
        .from('orders')
        .select('*, contacts(*), leads(*)')
        .eq('id', id)
        .single();

      if (oData) {
        setOrder(oData);
        const [{ data: iData }, { data: acct }, { data: profile }] = await Promise.all([
          supabase.from('order_items').select('*').eq('order_id', id).order('position'),
          supabase.from('accounts').select('*').eq('id', oData.account_id).single(),
          oData.user_id
            ? supabase.from('profiles').select('full_name, email').eq('user_id', oData.user_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (iData) setItems(iData);
        if (acct) setAccount(acct);
        if (profile) setCreatedBy(profile.full_name || profile.email || 'System');
      }
      setLoading(false);

      // Let fonts/images settle before the browser print dialog captures layout.
      setTimeout(() => { window.print(); }, 500);
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

  if (!order) {
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Order not found</div>;
  }

  const cust = order.contacts || order.leads || {};
  const companyName = cust.company || cust.name || 'Unknown Company';
  const inr = (v: any) => `₹ ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const orderNo = order.order_number || `ORD-${String(order.id).substring(0, 6)}`;

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

        <div className="fixed top-4 right-4 print-hide">
          <button
            onClick={() => window.print()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-md text-sm font-medium transition-colors"
          >
            Print PDF
          </button>
        </div>

        {/* HEADER */}
        <div className="flex justify-between items-start mb-8 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">{account?.business_name || account?.name || 'Company'}</h1>
            <p className="text-xs text-gray-800 mt-1 font-medium">{[account?.phone, account?.email].filter(Boolean).join(' | ')}</p>
            <p className="text-xs text-gray-800 font-medium">GST No : {account?.gst_number || account?.gstin || ''}</p>
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-semibold text-blue-600 tracking-wide uppercase">
              ORDER #{orderNo.split('-').pop()}
            </h2>
          </div>
        </div>

        {/* METADATA */}
        <div className="flex justify-between mb-8 border-t border-gray-200 pt-4">
          <div>
            <h3 className="text-[11px] font-semibold text-gray-600 italic mb-1">Order From,</h3>
            <p className="font-bold text-gray-900 text-sm">{companyName}</p>
            {cust.name && <p className="text-xs text-gray-800 font-medium">{cust.name}</p>}
            {(cust.address || cust.city || cust.country) && (
              <p className="text-xs text-gray-600">{[cust.address, cust.city, cust.state, cust.country].filter(Boolean).join(', ')}</p>
            )}
            {cust.gst_number && <p className="text-xs text-gray-600">GST : {cust.gst_number}</p>}
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs"><span className="font-semibold text-gray-800">Order Date : </span> <span className="font-bold">{new Date(order.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')}</span></p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Order Status : </span> <span className="capitalize">{order.status}</span></p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Created By : </span> {createdBy}</p>
          </div>
        </div>

        {/* TABLE */}
        <div className="mb-8 border border-gray-300">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="text-gray-900 font-bold border-b border-gray-300">
              <tr>
                <th className="px-2 py-2 border-r border-gray-300 text-center w-8">#</th>
                <th className="px-2 py-2 border-r border-gray-300">Item</th>
                <th className="px-2 py-2 border-r border-gray-300 text-center">Quantity</th>
                <th className="px-2 py-2 border-r border-gray-300 text-right">Price</th>
                <th className="px-2 py-2 border-r border-gray-300 text-center">Tax</th>
                <th className="px-2 py-2 border-r border-gray-300 text-right">Sub Amount</th>
                <th className="px-2 py-2 text-right">Net Amount</th>
              </tr>
            </thead>
            <tbody className="text-gray-800 font-medium">
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-gray-300 last:border-b-0 align-top">
                  <td className="px-2 py-2 border-r border-gray-300 text-center">{idx + 1}</td>
                  <td className="px-2 py-2 border-r border-gray-300"><div className="font-bold">{item.product_name}</div></td>
                  <td className="px-2 py-2 border-r border-gray-300 text-center">{item.quantity} {item.unit || 'PCS'}</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-right">{inr(item.price)}</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-center text-[10px]">
                    {item.tax_rate || 0}%<br/>
                    <span className="text-gray-500">({inr(item.tax_amount)})</span>
                  </td>
                  <td className="px-2 py-2 border-r border-gray-300 text-right">{inr(item.sub_total)}</td>
                  <td className="px-2 py-2 text-right font-bold">{inr(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* TOTALS */}
        <div className="flex justify-end mb-12">
          <div className="w-64 border border-gray-300">
            <div className="flex border-b border-gray-300">
              <div className="w-1/2 p-2 text-right text-xs font-bold text-gray-800 border-r border-gray-300">Sub Total</div>
              <div className="w-1/2 p-2 text-right text-xs font-bold">{inr(order.sub_total)}</div>
            </div>
            {Number(order.discount_total || 0) > 0 && (
              <div className="flex border-b border-gray-300">
                <div className="w-1/2 p-2 text-right text-xs font-bold text-gray-800 border-r border-gray-300">Discount</div>
                <div className="w-1/2 p-2 text-right text-xs font-bold">− {inr(order.discount_total)}</div>
              </div>
            )}
            {Number(order.tax_total || 0) > 0 && (
              <div className="flex border-b border-gray-300">
                <div className="w-1/2 p-2 text-right text-xs font-bold text-gray-800 border-r border-gray-300">Tax</div>
                <div className="w-1/2 p-2 text-right text-xs font-bold">{inr(order.tax_total)}</div>
              </div>
            )}
            <div className="flex bg-gray-50">
              <div className="w-1/2 p-2 text-right text-xs font-bold text-gray-800 border-r border-gray-300">Total</div>
              <div className="w-1/2 p-2 text-right text-xs font-bold">{inr(order.total_amount)}</div>
            </div>
          </div>
        </div>

        {order.notes && (
          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-bold text-gray-800 mb-2">Notes</h4>
              <div className="text-xs text-gray-700 whitespace-pre-wrap font-medium">{order.notes}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
