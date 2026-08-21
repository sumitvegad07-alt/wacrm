'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { STOCK_REASON_CODES } from '@/lib/stock/financials';
import { Loader2, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';

interface StockImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

interface ParsedRow {
  raw: string;
  productId: string | null;
  productName: string;
  direction: 'in' | 'out';
  quantity: number;
  reason: string;
  notes: string;
  error: string | null;
}

const VALID_REASONS = new Set(STOCK_REASON_CODES.map((r) => r.toLowerCase()));

/** Minimal CSV line splitter that respects double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function StockImportDialog({ open, onOpenChange, onDone }: StockImportDialogProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const [products, setProducts] = useState<{ id: string; name: string; sku: string | null }[]>([]);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    supabase
      .from('products')
      .select('id, name, sku')
      .eq('account_id', accountId)
      .eq('active', true)
      .then(({ data }) => setProducts((data as any) ?? []));
  }, [open, accountId, supabase]);

  const bySku = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const p of products) if (p.sku) m.set(p.sku.toLowerCase(), { id: p.id, name: p.name });
    return m;
  }, [products]);
  const byName = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const p of products) m.set(p.name.toLowerCase(), { id: p.id, name: p.name });
    return m;
  }, [products]);

  const parsed: ParsedRow[] = useMemo(() => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    // Drop a header row if it looks like one.
    const first = lines[0].toLowerCase();
    const start = /product|sku|quantity|qty|direction|reason/.test(first) ? 1 : 0;
    return lines.slice(start).map((raw) => {
      const [ident = '', qtyStr = '', dirStr = '', reasonStr = '', notes = ''] = splitCsvLine(raw);
      const match = bySku.get(ident.toLowerCase()) || byName.get(ident.toLowerCase()) || null;
      const quantity = parseFloat(qtyStr);
      const direction: 'in' | 'out' = dirStr.toLowerCase().startsWith('out') ? 'out' : 'in';
      const reason = reasonStr.trim() || (direction === 'in' ? 'Purchase' : 'Stock Correction');
      let error: string | null = null;
      if (!ident) error = 'no product';
      else if (!match) error = `product not found: "${ident}"`;
      else if (!Number.isFinite(quantity) || quantity <= 0) error = 'bad quantity';
      else if (!VALID_REASONS.has(reason.toLowerCase())) error = `invalid reason: "${reason}"`;
      return { raw, productId: match?.id ?? null, productName: match?.name ?? ident, direction, quantity, reason, notes, error };
    });
  }, [text, bySku, byName]);

  const ok = parsed.filter((r) => !r.error);
  const bad = parsed.filter((r) => r.error);

  async function handleImport() {
    if (ok.length === 0) { toast.error('Nothing valid to import'); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc('stock_bulk_adjust', {
      p_rows: ok.map((r) => ({
        product_id: r.productId, quantity: r.quantity, direction: r.direction,
        reason_code: r.reason, notes: r.notes || null,
      })),
    });
    setSaving(false);
    if (error) {
      toast.error(error.code === '42501' ? 'You do not have permission to manage stock' : error.message || 'Import failed');
      return;
    }
    const res = data as { inserted?: number; errors?: unknown[] } | null;
    toast.success(`Imported ${res?.inserted ?? 0} stock movement${res?.inserted === 1 ? '' : 's'}`);
    setText('');
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import stock</DialogTitle>
          <DialogDescription>
            Paste rows from your accounting export. One movement per line:
            <span className="font-mono text-xs block mt-1 text-foreground">SKU or Product Name, Quantity, Direction (in/out), Reason, Notes</span>
            Direction defaults to <b>in</b> and Reason to <b>Purchase</b> when left blank.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'SKU-100, 50, in, Purchase, GRN #4521\nSKU-101, 12, out, Damage,\nAmul Butter 500g, 30, in, Purchase,'}
          className="min-h-[140px] font-mono text-xs"
        />

        {parsed.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center gap-4 px-3 py-2 bg-muted/40 text-xs">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {ok.length} ready</span>
              {bad.length > 0 && <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500"><AlertTriangle className="h-3.5 w-3.5" /> {bad.length} skipped</span>}
            </div>
            <div className="max-h-52 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {parsed.map((r, i) => (
                    <tr key={i} className={`border-t border-border/50 ${r.error ? 'bg-amber-500/5' : ''}`}>
                      <td className="px-3 py-1.5">{r.productName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.direction === 'in' ? '+' : '-'}{Number.isFinite(r.quantity) ? r.quantity : '?'}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.reason}</td>
                      <td className="px-3 py-1.5">{r.error ? <span className="text-amber-600 dark:text-amber-500">{r.error}</span> : <span className="text-emerald-600 dark:text-emerald-400">ok</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={handleImport} disabled={saving || ok.length === 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Import {ok.length > 0 ? ok.length : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
