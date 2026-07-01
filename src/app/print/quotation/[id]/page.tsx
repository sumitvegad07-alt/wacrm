'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';

export default function QuotationPrintView() {
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();
  
  const [quotation, setQuotation] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      // Fetch quotation
      const { data: qData } = await supabase
        .from('quotations')
        .select('*, contact:contacts!quotations_contact_id_fkey(*)')
        .eq('id', id)
        .single();
        
      if (qData) {
        setQuotation(qData);
        // Fetch items
        const { data: iData } = await supabase
          .from('quotation_items')
          .select('*')
          .eq('quotation_id', id)
          .order('position');
        if (iData) setItems(iData);
      }
      setLoading(false);
      
      // Delay printing slightly to ensure images/fonts load before browser print dialog captures the layout
      setTimeout(() => {
        window.print();
      }, 500);
    }
    
    if (id) {
      loadData();
    }
  }, [id, supabase]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (!quotation) {
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
      
      <div className="max-w-[900px] mx-auto bg-white p-8 border border-gray-200 shadow-sm print:border-none print:shadow-none print:max-w-none print:p-0">
        
        {/* Floating Print Button for when preview is closed */}
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
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">KOOPS CRM DEMO</h1>
            <p className="text-xs text-gray-800 mt-1 font-medium">9081733354 | koopscrm@gmail.com</p>
            <p className="text-xs text-gray-800 font-medium">GST No : </p>
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-semibold text-blue-600 tracking-wide uppercase">
              QUOTATION #{quotation.quotation_number?.split('-').pop() || quotation.id.substring(0, 6)}
            </h2>
          </div>
        </div>

        {/* METADATA */}
        <div className="flex justify-between mb-8 border-t border-gray-200 pt-4">
          <div>
            <h3 className="text-[11px] font-semibold text-gray-600 italic mb-1">Quotation To,</h3>
            <p className="font-bold text-gray-900 text-sm">{quotation.contact?.company || 'Unknown Company'}</p>
            <p className="text-xs text-gray-800 font-medium">{quotation.contact?.name}</p>
            <p className="text-xs text-gray-600">{quotation.contact?.city || 'Punjab'}, {quotation.contact?.country || 'India'}</p>
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs"><span className="font-semibold text-gray-800">Quotation Date : </span> <span className="font-bold">{new Date(quotation.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')}</span></p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Quotation Status : </span> <span className="capitalize">{quotation.status}</span></p>
            <p className="text-xs"><span className="font-semibold text-gray-800">Created By : </span> System</p>
          </div>
        </div>

        {/* TABLE */}
        <div className="mb-8 border border-gray-300">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="text-gray-900 font-bold border-b border-gray-300">
              <tr>
                <th className="px-2 py-2 border-r border-gray-300 text-center w-8">#</th>
                <th className="px-2 py-2 border-r border-gray-300 w-12 text-center">Image</th>
                <th className="px-2 py-2 border-r border-gray-300">Item</th>
                <th className="px-2 py-2 border-r border-gray-300">Category</th>
                <th className="px-2 py-2 border-r border-gray-300 text-center">Quantity</th>
                <th className="px-2 py-2 border-r border-gray-300 text-right">Cost</th>
                <th className="px-2 py-2 border-r border-gray-300 text-center">Tax</th>
                <th className="px-2 py-2 border-r border-gray-300 text-center">Discount</th>
                <th className="px-2 py-2 border-r border-gray-300 text-right">Net Price</th>
                <th className="px-2 py-2 border-r border-gray-300 text-right">Sub<br/>Amount</th>
                <th className="px-2 py-2 text-right">Net Amount</th>
              </tr>
            </thead>
            <tbody className="text-gray-800 font-medium">
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-gray-300 last:border-b-0 align-top">
                  <td className="px-2 py-2 border-r border-gray-300 text-center">{idx + 1}</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-center align-middle">
                    <div className="w-8 h-8 bg-gray-200 mx-auto overflow-hidden">
                      {/* Placeholder for image */}
                    </div>
                  </td>
                  <td className="px-2 py-2 border-r border-gray-300">
                    <div className="font-bold">{item.product_name}</div>
                  </td>
                  <td className="px-2 py-2 border-r border-gray-300 text-gray-600">Blower</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-center">{item.quantity} {item.unit || 'PCS'}</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-right">₹ {Number(item.price).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-center text-[10px]">
                    {item.tax_rate}%<br/>
                    <span className="text-gray-500">(₹{Number(item.tax_amount).toLocaleString('en-IN')})</span>
                  </td>
                  <td className="px-2 py-2 border-r border-gray-300 text-center">{item.discount || '0.00'} %</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-right">₹ {Number(item.price).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                  <td className="px-2 py-2 border-r border-gray-300 text-right">₹ {Number(item.sub_total).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                  <td className="px-2 py-2 text-right font-bold">₹ {Number(item.total).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
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
              <div className="w-1/2 p-2 text-right text-xs font-bold">₹ {Number(quotation.sub_total || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
            </div>
            {Number(quotation.tax_total || 0) > 0 && (
              <div className="flex border-b border-gray-300">
                <div className="w-1/2 p-2 text-right text-xs font-bold text-gray-800 border-r border-gray-300">Tax</div>
                <div className="w-1/2 p-2 text-right text-xs font-bold">₹ {Number(quotation.tax_total || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
              </div>
            )}
            <div className="flex bg-gray-50">
              <div className="w-1/2 p-2 text-right text-xs font-bold text-gray-800 border-r border-gray-300">Total</div>
              <div className="w-1/2 p-2 text-right text-xs font-bold">₹ {Number(quotation.total_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
            </div>
          </div>
        </div>

        {/* FOOTER / TERMS */}
        <div className="space-y-6">
          <div>
            <h4 className="text-xs font-bold text-gray-800 mb-2">Terms & Conditions</h4>
            <div className="text-xs text-gray-700 whitespace-pre-wrap font-medium">
              {quotation.terms_conditions || 'No terms specified.'}
            </div>
          </div>
          
          <div className="text-xs font-bold text-gray-600 pt-8 mt-12">
            Dummy Footer
          </div>
        </div>

      </div>
    </div>
  );
}
