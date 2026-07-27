'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';

/**
 * Print / PDF view for a single dispatch. Mirrors the order/quotation print
 * templates for house-style parity. Line prices are inherited from the linked
 * order item (dispatches don't carry their own pricing).
 */
export default function DispatchPrintView() {
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();

  const [dispatch, setDispatch] = useState<any>(null);
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [account, setAccount] = useState<any>(null);
  const [createdBy, setCreatedBy] = useState('System');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const { data: d } = await supabase
        .from('order_dispatches')
        .select('*, order:orders(*, contacts(*), leads(*)), dispatch_items(*, order_item:order_items(price, tax_rate, unit))')
        .eq('id', id)
        .single();

      if (d) {
        setDispatch(d);
        setOrder(d.order || null);
        setItems((d.dispatch_items || []) as any[]);
        const [{ data: acct }, prof] = await Promise.all([
          d.account_id ? supabase.from('accounts').select('*').eq('id', d.account_id).single() : Promise.resolve({ data: null }),
          d.order?.user_id
            ? supabase.from('profiles').select('full_name, email').eq('user_id', d.order.user_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (acct) setAccount(acct);
        const p = prof?.data as { full_name?: string; email?: string } | null;
        if (p) setCreatedBy(p.full_name || p.email || 'System');
      }
      setLoading(false);
      setTimeout(() => { window.print(); }, 500);
    }
    if (id) loadData();
  }, [id, supabase]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-white"><Loader2 className="h-8 w-8 animate-spin text-gray-500" /></div>;
  }
  if (!dispatch) {
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Dispatch not found</div>;
  }

  const cust = order?.contacts || order?.leads || {};
  const companyName = cust.company || cust.name || 'Unknown Company';
  const inr = (v: any) => `₹ ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const dispNo = dispatch.dispatch_number || `DSP-${String(dispatch.id).substring(0, 6)}`;
  const lineTotal = (it: any) => Number(it.quantity || 0) * Number(it.order_item?.price || 0);
  const subTotal = items.reduce((s, it) => s + lineTotal(it), 0);

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
          <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-md text-sm font-medium transition-colors">Print PDF</button>
        </div>

        {/* HEADER */}
        <div className="flex justify-between items-start mb-8 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">{account?.business_name || account?.name || 'Company'}</h1>
            <p className="text-xs text-gray-800 mt-1 font-medium">{[account?.phone, account?.email].filter(Boolean).join(' | ')}</p>
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-semibold text-blue-600 tracking-wide uppercase">DISPATCH #{dispNo.split('-').pop()}</h2>
          </div>
        </div>

        {/* METADATA */}
        <div className="flex justify-between mb-6 border-t border-gray-200 pt-4">
          <div>
            <h3 className="text-[11px] font-semibold text-gray-600 italic mb-1">Dispatch To,</h3>
            <p className="font-bold text-gray-900 text-sm">{companyName}</p>
            {cust.name && <p className="text-xs text-gray-800 font-medium">{cust.name}</p>}
            {(cust.address || cust.city || cust.country) && (
              <p className="text-xs text-gray-600">{[cust.address, cust.city, cust.state, cust.country].filter(Boolean).join(', ')}</p>
            )}
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs"><span className="font-semibold text-gray-800">Date : </span><span className="font-bold">{dispatch.dispatched_at ? new Date(dispatch.dispatched_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-') : '-'}</span></p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Order No : </span>{order?.order_number || '-'}</p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Created By : </span>{createdBy}</p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Dispatch Code : </span>{dispatch.dispatch_code || '-'}</p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Invoice No : </span>{dispatch.invoice_no || '-'}</p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Invoice Date : </span>{dispatch.invoice_date ? new Date(dispatch.invoice_date).toLocaleDateString('en-IN') : '-'}</p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Transport : </span>{dispatch.transport_name || '-'}</p>
          </div>
        </div>

        {/* LR DETAILS */}
        <div className="mb-6">
          <h4 className="text-xs font-bold text-gray-800 mb-1">LR DETAILS</h4>
          <div className="flex gap-12 text-xs text-gray-700">
            <div><span className="font-semibold">LR No.</span> {dispatch.lr_no || '-'}</div>
            <div><span className="font-semibold">LR Date</span> {dispatch.lr_date ? new Date(dispatch.lr_date).toLocaleDateString('en-IN') : '-'}</div>
          </div>
        </div>

        {/* TABLE */}
        <div className="mb-8 border border-gray-300">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="text-gray-900 font-bold border-b border-gray-300">
              <tr>
                <th className="px-2 py-2 border-r border-gray-300 text-center w-8">#</th>
                <th className="px-2 py-2 border-r border-gray-300">Order No</th>
                <th className="px-2 py-2 border-r border-gray-300">Item</th>
                <th className="px-2 py-2 border-r border-gray-300 text-center">Quantity</th>
                <th className="px-2 py-2 border-r border-gray-300 text-right">Price</th>
                <th className="px-2 py-2 text-right">Sub Amount</th>
              </tr>
            </thead>
            <tbody className="text-gray-800 font-medium">
              {items.map((it, idx) => (
                <tr key={idx} className="border-b border-gray-300 last:border-b-0 align-top">
                  <td className="px-2 py-2 border-r border-gray-300 text-center">{idx + 1}</td>
                  <td className="px-2 py-2 border-r border-gray-300">{order?.order_number || '-'}</td>
                  <td className="px-2 py-2 border-r border-gray-300"><div className="font-bold">{it.product_name}</div></td>
                  <td className="px-2 py-2 border-r border-gray-300 text-center">{it.quantity} {it.unit || it.order_item?.unit || 'PCS'}</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-right">{inr(it.order_item?.price)}</td>
                  <td className="px-2 py-2 text-right font-bold">{inr(lineTotal(it))}</td>
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
              <div className="w-1/2 p-2 text-right text-xs font-bold">{inr(subTotal)}</div>
            </div>
            <div className="flex bg-gray-50">
              <div className="w-1/2 p-2 text-right text-xs font-bold text-gray-800 border-r border-gray-300">Total</div>
              <div className="w-1/2 p-2 text-right text-xs font-bold">{inr(subTotal)}</div>
            </div>
          </div>
        </div>

        {dispatch.notes && (
          <div>
            <h4 className="text-xs font-bold text-gray-800 mb-2">Notes</h4>
            <div className="text-xs text-gray-700 whitespace-pre-wrap font-medium">{dispatch.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
