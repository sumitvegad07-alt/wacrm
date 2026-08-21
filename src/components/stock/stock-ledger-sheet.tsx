'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Loader2 } from 'lucide-react';
import { toNumber } from '@/lib/stock/financials';

interface StockLedgerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
}

interface Row {
  id: string;
  quantity: number;
  entry_type: string;
  reason_code: string | null;
  source_type: string | null;
  source_id: string | null;
  source_ref: string | null;
  notes: string | null;
  created_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  opening: 'Opening',
  manual_in: 'Stock In',
  manual_out: 'Stock Out',
  sale_out: 'Sale',
  reversal: 'Reversal',
};

function sourceHref(row: Row): string | null {
  if (!row.source_id) return null;
  if (row.source_type === 'order') return `/orders/${row.source_id}`;
  if (row.source_type === 'dispatch') return `/dispatches/${row.source_id}`;
  return null;
}

export function StockLedgerSheet({ open, onOpenChange, productId, productName }: StockLedgerSheetProps) {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !productId) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('stock_ledger')
      .select('id, quantity, entry_type, reason_code, source_type, source_id, source_ref, notes, created_at')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data as Row[]) ?? []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, productId, supabase]);

  let running = 0;
  // Compute running balance oldest→newest so we can show it against each row.
  const withBalance = [...rows]
    .reverse()
    .map((r) => {
      running += toNumber(r.quantity);
      return { ...r, balance: running };
    })
    .reverse();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Stock ledger</SheetTitle>
          <SheetDescription>{productName} — every movement, newest first</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : withBalance.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No stock movements yet.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium text-right">Qty</th>
                  <th className="py-2 pr-3 font-medium text-right">Balance</th>
                  <th className="py-2 pr-3 font-medium">Reason / Source</th>
                </tr>
              </thead>
              <tbody>
                {withBalance.map((r) => {
                  const qty = toNumber(r.quantity);
                  const href = sourceHref(r);
                  return (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{TYPE_LABEL[r.entry_type] ?? r.entry_type}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${qty < 0 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {qty > 0 ? `+${qty}` : qty}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.balance}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {href && r.source_ref ? (
                          <Link href={href} className="text-primary hover:underline">{r.source_ref}</Link>
                        ) : (
                          <>{r.reason_code ?? '—'}</>
                        )}
                        {r.notes ? <span className="block text-xs opacity-70">{r.notes}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
