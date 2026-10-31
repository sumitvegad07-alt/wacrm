"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Pencil,
  Printer,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/currency";
import { gstStateName } from "@/lib/gst/states";
import { PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import { TERM_LABEL } from "@/lib/plans/pricing";
import { amountInWords, lineAmount } from "@/lib/invoices/totals";
import { isEditable, nextStatuses } from "@/lib/invoices/status";
import { SERIES_LABEL, type InvoiceRow, type InvoiceStatus } from "@/lib/invoices/types";
import { StatusBadge } from "../status-badge";
import { errorMessage } from '@/lib/errors/message';

// ============================================================
// One invoice.
//
// The action buttons come from nextStatuses(), so the screen can never offer a
// transition the API refuses. Every figure shown is read from the STORED
// columns rather than recomputed: this row is the record of what was printed.
// ============================================================

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return format(new Date(y, m - 1, d), "dd MMM yyyy");
}

/** A WhatsApp-ready number: digits only, with 91 added to a bare 10-digit one. */
function waNumber(phone: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

function whatsappText(inv: InvoiceRow): string {
  const seller = inv.data?.seller;
  return [
    `Invoice ${inv.invoice_no} from ${seller?.firmName ?? "OZZO"}`,
    inv.period_start && inv.period_end
      ? `Service period: ${fmtDate(inv.period_start)} to ${fmtDate(inv.period_end)}`
      : "",
    `Amount: ${formatCurrency(inv.total)}`,
    seller?.bankAccountNo
      ? `Bank: ${seller.bankName} · A/c ${seller.bankAccountNo} · IFSC ${seller.ifsc}`
      : "",
    seller?.upiId ? `UPI: ${seller.upiId}` : "",
    "The invoice PDF is attached.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What the toast says once a status change has gone through. */
const DONE_MESSAGE: Record<InvoiceStatus, string> = {
  draft: "Invoice back to draft",
  issued: "Invoice issued",
  part_paid: "Part payment recorded",
  paid: "Invoice marked paid",
  cancelled: "Invoice cancelled",
};

export default function InvoiceDetail({ invoice }: { invoice: InvoiceRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [partPaidOpen, setPartPaidOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [received, setReceived] = useState(
    String(Math.max(0, invoice.total - invoice.amount_received)),
  );

  const balance = invoice.total - invoice.amount_received;
  const available = nextStatuses(invoice.status);

  async function changeStatus(status: InvoiceStatus, amount?: number) {
    setBusy(status);
    try {
      const res = await fetch(`/api/admin/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          amount === undefined ? { status } : { status, amount_received: amount },
        ),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not update the invoice");

      toast.success(DONE_MESSAGE[status]);
      setPartPaidOpen(false);
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the invoice"));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/invoices/${invoice.id}`, { method: "DELETE" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not delete the invoice");

      toast.success("Draft deleted");
      router.push("/admin/invoices");
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete the invoice"));
    } finally {
      setBusy(null);
      setDeleteOpen(false);
    }
  }

  const wa = waNumber(invoice.data?.buyer?.phone ?? "");

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <button
          onClick={() => router.push("/admin/invoices")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </button>
      </div>

      {/* ---------------- header ---------------- */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{invoice.invoice_no}</h1>
              <StatusBadge status={invoice.status} />
              <span className="text-xs text-muted-foreground border border-border rounded-full px-2 py-1">
                {SERIES_LABEL[invoice.series]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {invoice.client_name}
              {invoice.customer_id ? ` · ${invoice.customer_id}` : ""} ·{" "}
              {fmtDate(invoice.invoice_date)}
            </p>
            {invoice.period_start && invoice.period_end ? (
              <p className="text-sm text-muted-foreground">
                Service period {fmtDate(invoice.period_start)} – {fmtDate(invoice.period_end)}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-2xl font-bold">{formatCurrency(invoice.total)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-6 pt-4 border-t border-border">
          {available.includes("issued") ? (
            <Button onClick={() => changeStatus("issued")} disabled={busy !== null}>
              {busy === "issued" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Issue
            </Button>
          ) : null}

          {available.includes("part_paid") ? (
            <Button
              variant="outline"
              onClick={() => setPartPaidOpen(true)}
              disabled={busy !== null}
            >
              <Wallet className="h-4 w-4 mr-2" />
              Mark Part Paid
            </Button>
          ) : null}

          {available.includes("paid") ? (
            <Button
              variant="outline"
              onClick={() => changeStatus("paid")}
              disabled={busy !== null}
            >
              {busy === "paid" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Mark Paid
            </Button>
          ) : null}

          <div className="flex-1" />

          <Button
            variant="outline"
            onClick={() => window.open(`/print/invoice/${invoice.id}`, "_blank")}
          >
            <Printer className="h-4 w-4 mr-2" />
            Print / PDF
          </Button>

          {wa ? (
            <Button
              variant="outline"
              onClick={() =>
                window.open(
                  `https://wa.me/${wa}?text=${encodeURIComponent(whatsappText(invoice))}`,
                  "_blank",
                )
              }
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              WhatsApp
            </Button>
          ) : null}

          {isEditable(invoice.status) ? (
            <Button
              variant="outline"
              onClick={() => router.push(`/admin/invoices/${invoice.id}/edit`)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          ) : null}

          {available.includes("cancelled") ? (
            <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy !== null}>
              <Ban className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          ) : null}

          {isEditable(invoice.status) ? (
            <Button variant="ghost" onClick={() => setDeleteOpen(true)} disabled={busy !== null}>
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        {wa ? (
          <p className="text-xs text-muted-foreground mt-3">
            Download the PDF first, then attach it in WhatsApp — the print page needs your login,
            so a link would not open for the customer.
          </p>
        ) : null}
      </div>

      {/* ---------------- payment ---------------- */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Invoiced", value: invoice.total, tone: "" },
          {
            label: "Received",
            value: invoice.amount_received,
            tone: "text-emerald-600 dark:text-emerald-400",
          },
          {
            label: "Balance",
            value: balance,
            tone: balance > 0 ? "text-amber-600 dark:text-amber-400" : "",
          },
        ].map((tile) => (
          <div key={tile.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <p className={`text-xl font-bold mt-1 ${tile.tone}`}>{formatCurrency(tile.value)}</p>
          </div>
        ))}
      </div>
      {invoice.paid_at ? (
        <p className="text-sm text-muted-foreground -mt-4">Paid on {fmtDate(invoice.paid_at)}.</p>
      ) : null}

      {/* ---------------- breakdown ---------------- */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">Breakdown</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Description</th>
                {invoice.gst_enabled ? <th className="py-2 pr-3 font-medium">SAC</th> : null}
                <th className="py-2 pr-3 font-medium text-right">Users</th>
                <th className="py-2 pr-3 font-medium text-right">Months</th>
                <th className="py-2 pr-3 font-medium text-right">Rate</th>
                <th className="py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.data?.lines ?? []).map((line, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{line.label}</span>
                    {line.description ? (
                      <span className="block text-xs text-muted-foreground">
                        {line.description}
                      </span>
                    ) : null}
                  </td>
                  {invoice.gst_enabled ? <td className="py-2 pr-3">{line.sac}</td> : null}
                  <td className="py-2 pr-3 text-right">{line.users}</td>
                  <td className="py-2 pr-3 text-right">{line.months}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(line.rate)}</td>
                  <td className="py-2 text-right">{formatCurrency(lineAmount(line))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto max-w-xs space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{formatCurrency(invoice.subtotal)}</dd>
          </div>
          {invoice.discount_amount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Discount</dt>
              <dd>− {formatCurrency(invoice.discount_amount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-border pt-2">
            <dt className="text-muted-foreground">Taxable value</dt>
            <dd>{formatCurrency(invoice.taxable_value)}</dd>
          </div>
          {invoice.cgst_amount > 0 ? (
            <>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">CGST @ {invoice.gst_rate / 2}%</dt>
                <dd>{formatCurrency(invoice.cgst_amount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">SGST @ {invoice.gst_rate / 2}%</dt>
                <dd>{formatCurrency(invoice.sgst_amount)}</dd>
              </div>
            </>
          ) : null}
          {invoice.igst_amount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">IGST @ {invoice.gst_rate}%</dt>
              <dd>{formatCurrency(invoice.igst_amount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatCurrency(invoice.total)}</dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          {amountInWords(invoice.total)}
        </p>

        <div className="grid gap-4 sm:grid-cols-3 border-t border-border pt-4 text-sm">
          <div>
            <p className="text-muted-foreground">Plan</p>
            <p className="font-medium">{PLAN_LABEL[invoice.plan as PlanId] ?? invoice.plan}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Term</p>
            <p className="font-medium">
              {TERM_LABEL[invoice.billing_term] ?? invoice.billing_term}
            </p>
          </div>
          {invoice.gst_enabled ? (
            <div>
              <p className="text-muted-foreground">Place of supply</p>
              <p className="font-medium">
                {gstStateName(invoice.place_of_supply_code) ?? "—"}
                {invoice.place_of_supply_code ? ` (${invoice.place_of_supply_code})` : ""}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------------- dialogs ---------------- */}
      <Dialog open={partPaidOpen} onOpenChange={setPartPaidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a part payment</DialogTitle>
            <DialogDescription>
              The balance stays outstanding until you mark the invoice paid.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Amount received (₹)</Label>
            <Input
              type="number"
              min={0}
              max={invoice.total}
              value={received}
              onChange={(e) => setReceived(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Invoice total {formatCurrency(invoice.total)}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartPaidOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => changeStatus("part_paid", Number(received) || 0)}
              disabled={busy !== null}
            >
              {busy === "part_paid" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {invoice.invoice_no}?</DialogTitle>
            <DialogDescription>
              The number stays in the {SERIES_LABEL[invoice.series]} series, so the series has no
              gap. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => changeStatus("cancelled")}
              disabled={busy !== null}
            >
              {busy === "cancelled" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Cancel invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              It has never been issued, so its number goes back to the pool. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy !== null}>
              {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
