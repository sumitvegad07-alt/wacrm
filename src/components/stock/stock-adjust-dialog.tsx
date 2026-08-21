'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { stockReasonsFor } from '@/lib/stock/financials';
import { Loader2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

interface StockAdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  closing: number;
  onDone: () => void;
}

/**
 * Manual Stock In / Stock Out. Writes through the `stock_adjust` RPC — which
 * re-checks `manage_stock` server-side, so this dialog being reachable is not a
 * permission bypass. Reason code is mandatory (enforced by the RPC + a DB CHECK).
 */
export function StockAdjustDialog({
  open,
  onOpenChange,
  productId,
  productName,
  closing,
  onDone,
}: StockAdjustDialogProps) {
  const supabase = createClient();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<string>(stockReasonsFor('in')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const reasons = stockReasonsFor(direction);

  // Switching direction swaps the reason list; keep the current reason only if
  // it's valid for the new direction (the two shared ones), else pick the first.
  function changeDirection(dir: 'in' | 'out') {
    setDirection(dir);
    if (!stockReasonsFor(dir).includes(reason as never)) {
      setReason(stockReasonsFor(dir)[0]);
    }
  }

  function reset() {
    setDirection('in');
    setQuantity('');
    setReason(stockReasonsFor('in')[0]);
    setNotes('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseFloat(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Enter a quantity greater than zero');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('stock_adjust', {
      p_product_id: productId,
      p_quantity: qty,
      p_direction: direction,
      p_reason_code: reason,
      p_notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(
        error.code === '42501'
          ? 'You do not have permission to manage stock'
          : error.message || 'Could not save the adjustment'
      );
      return;
    }
    const res = data as { closing_stock?: number; voucher_no?: string } | null;
    toast.success(
      `${res?.voucher_no ? `${res.voucher_no} · ` : ''}Stock ${direction === 'in' ? 'added' : 'removed'}${
        res?.closing_stock !== undefined ? ` — closing now ${res.closing_stock}` : ''
      }`
    );
    reset();
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            {productName} — current closing stock{' '}
            <span className={closing <= 0 ? 'text-red-500 font-medium' : 'font-medium'}>{closing}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => changeDirection('in')}
              className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
                direction === 'in' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
              }`}
            >
              <ArrowDownToLine className="h-4 w-4" /> Stock In
            </button>
            <button
              type="button"
              onClick={() => changeDirection('out')}
              className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
                direction === 'out' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
              }`}
            >
              <ArrowUpFromLine className="h-4 w-4" /> Stock Out
            </button>
          </div>

          <div className="grid gap-2">
            <Label>Quantity</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              autoFocus
              required
            />
          </div>

          <div className="grid gap-2">
            <Label>Reason</Label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {reasons.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reference, batch, remarks…"
              className="min-h-[60px]"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save adjustment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
