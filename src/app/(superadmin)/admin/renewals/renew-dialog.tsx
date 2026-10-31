"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/currency";
import { BILLING_TERMS, TERM_LABEL, type BillingTerm } from "@/lib/plans/pricing";
import { nextPeriod, periodEnd } from "@/lib/renewals/next-period";
import type { PeriodRow, SubscriptionRow } from "@/lib/renewals/types";
import { errorMessage } from '@/lib/errors/message';

// ============================================================
// Renewing one subscription.
//
// Pre-filled with the next period — the day after the current one ends,
// running one whole term — and showing the history it is about to add to, so
// the founder can see nothing is being lost.
// ============================================================

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

export function RenewDialog({
  open,
  subscription,
  onOpenChange,
  onRenewed,
}: {
  open: boolean;
  subscription: SubscriptionRow | null;
  onOpenChange: (open: boolean) => void;
  onRenewed: () => void;
}) {
  const [term, setTerm] = useState<BillingTerm>("yearly");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [users, setUsers] = useState("");
  const [amount, setAmount] = useState("");
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [endTouched, setEndTouched] = useState(false);

  useEffect(() => {
    if (!open || !subscription) return;

    const nextTerm = subscription.billing_term ?? "yearly";
    const proposed = nextPeriod(subscription.end_date, nextTerm);

    setTerm(nextTerm);
    setStartDate(proposed.start);
    setEndDate(proposed.end);
    setUsers(String(subscription.users ?? ""));
    setAmount(String(subscription.amount ?? ""));
    setEndTouched(false);
    setPeriods([]);

    // The history is loaded, not assumed: this is the panel that promises the
    // ending period will be kept.
    fetch(`/api/admin/renewals/${subscription.id}`)
      .then((res) => res.json())
      .then((payload) => setPeriods((payload?.periods ?? []) as PeriodRow[]))
      .catch(() => setPeriods([]));
  }, [open, subscription]);

  function changeTerm(next: BillingTerm) {
    setTerm(next);
    if (!endTouched && startDate) setEndDate(periodEnd(startDate, next));
  }

  function changeStart(next: string) {
    setStartDate(next);
    if (!endTouched && next) setEndDate(periodEnd(next, term));
  }

  async function confirm() {
    if (!subscription) return;
    if (!startDate || !endDate) {
      toast.error("The new period needs a start and an end date");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/renewals/${subscription.id}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: subscription.plan,
          billing_term: term,
          users: Number(users) || 0,
          amount: Number(amount) || 0,
          start_date: startDate,
          end_date: endDate,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not renew the subscription");

      toast.success("Renewed");
      onRenewed();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not renew the subscription"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Renew {subscription?.company_name}</DialogTitle>
          <DialogDescription>
            Current period: {fmt(subscription?.start_date ?? null)} to{" "}
            {fmt(subscription?.end_date ?? null)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Billing term</Label>
            <select
              value={term}
              onChange={(e) => changeTerm(e.target.value as BillingTerm)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              {BILLING_TERMS.map((t) => (
                <option key={t} value={t}>
                  {TERM_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Users</Label>
            <Input
              type="number"
              min={0}
              value={users}
              onChange={(e) => setUsers(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>New start date</Label>
            <Input type="date" value={startDate} onChange={(e) => changeStart(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>New end date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndTouched(true);
                setEndDate(e.target.value);
              }}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Renewal amount (₹)</Label>
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground border-t border-border pt-3">
          The period ending {fmt(subscription?.end_date ?? null)} will be saved to this
          customer&apos;s history.
        </p>

        <div className="space-y-2">
          <p className="text-sm font-medium">Earlier periods</p>
          {periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No earlier periods.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {periods.map((p) => (
                <li key={p.id}>
                  {fmt(p.start_date)} – {fmt(p.end_date)}
                  {p.plan ? ` · ${p.plan}` : ""} · {p.users} users ·{" "}
                  {formatCurrency(p.amount)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {/* Disabled while in flight: a double click must not try to archive
              the same period twice, and the row lock should not be the only
              thing standing in the way. */}
          <Button onClick={confirm} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Renew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
