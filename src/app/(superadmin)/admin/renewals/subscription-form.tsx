"use client";

import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { PLAN_IDS, PLAN_LABEL } from "@/lib/plans/catalog";
import { BILLING_TERMS, TERM_LABEL, type BillingTerm } from "@/lib/plans/pricing";
import { periodEnd } from "@/lib/renewals/next-period";
import {
  RENEWAL_STATUSES,
  RENEWAL_STATUS_LABEL,
  type RenewalStatus,
  type SubscriptionRow,
} from "@/lib/renewals/types";

// ============================================================
// Adding or editing one row of the register.
//
// The end date fills itself from the term and the start date, but stops once
// the founder types one: a later term change must not overwrite a date he set
// deliberately.
// ============================================================

interface FormState {
  customer_id: string;
  company_name: string;
  plan: string;
  billing_term: BillingTerm | "";
  users: string;
  amount: string;
  start_date: string;
  end_date: string;
  salesman_name: string;
  contact_person: string;
  phone: string;
  status: RenewalStatus;
  remarks: string;
  follow_up_date: string;
}

function isoToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function blank(): FormState {
  return {
    customer_id: "",
    company_name: "",
    plan: "",
    billing_term: "yearly",
    users: "",
    amount: "",
    start_date: isoToday(),
    end_date: periodEnd(isoToday(), "yearly"),
    salesman_name: "",
    contact_person: "",
    phone: "",
    status: "active",
    remarks: "",
    follow_up_date: "",
  };
}

function fromRow(row: SubscriptionRow): FormState {
  return {
    customer_id: row.customer_id ?? "",
    company_name: row.company_name ?? "",
    plan: row.plan ?? "",
    billing_term: row.billing_term ?? "",
    users: String(row.users ?? ""),
    amount: String(row.amount ?? ""),
    start_date: row.start_date ?? "",
    end_date: row.end_date ?? "",
    salesman_name: row.salesman_name ?? "",
    contact_person: row.contact_person ?? "",
    phone: row.phone ?? "",
    status: row.status ?? "active",
    remarks: row.remarks ?? "",
    follow_up_date: row.follow_up_date ?? "",
  };
}

export function SubscriptionForm({
  open,
  subscription,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  subscription?: SubscriptionRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(blank());
  const [saving, setSaving] = useState(false);
  // An existing row's end date was set by someone, so it is never auto-filled.
  const endTouched = useRef(false);

  useEffect(() => {
    if (!open) return;
    setForm(subscription ? fromRow(subscription) : blank());
    endTouched.current = !!subscription;
  }, [open, subscription]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function changeTerm(term: BillingTerm | "") {
    setForm((prev) => ({
      ...prev,
      billing_term: term,
      end_date:
        endTouched.current || !prev.start_date
          ? prev.end_date
          : periodEnd(prev.start_date, term || null),
    }));
  }

  function changeStart(start: string) {
    setForm((prev) => ({
      ...prev,
      start_date: start,
      end_date:
        endTouched.current || !start
          ? prev.end_date
          : periodEnd(start, prev.billing_term || null),
    }));
  }

  async function save() {
    if (!form.company_name.trim()) {
      toast.error("Company name is required");
      return;
    }
    if (!form.start_date) {
      toast.error("Start date is required");
      return;
    }

    setSaving(true);
    try {
      const body = {
        ...form,
        billing_term: form.billing_term || null,
        users: Number(form.users) || 0,
        amount: Number(form.amount) || 0,
        follow_up_date: form.follow_up_date || null,
      };

      const res = subscription
        ? await fetch(`/api/admin/renewals/${subscription.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/renewals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not save the subscription");

      toast.success(subscription ? "Subscription saved" : "Subscription added");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      // The dialog deliberately stays open with the values intact — never clear
      // a form the founder has just filled in.
      toast.error(err instanceof Error ? err.message : "Could not save the subscription");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {subscription ? "Edit subscription" : "Add subscription"}
          </DialogTitle>
          <DialogDescription>
            Your own record of who is on what, and when it ends.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Company name *</Label>
            <Input
              value={form.company_name}
              onChange={(e) => set("company_name", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Customer ID</Label>
            <Input
              value={form.customer_id}
              onChange={(e) => set("customer_id", e.target.value)}
              placeholder="001001"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Input
              value={form.plan}
              onChange={(e) => set("plan", e.target.value)}
              list="renewal-plan-options"
              placeholder="CRM_SFA, or anything you call it"
            />
            {/* Free text with the catalogue offered: a legacy or custom package
                has to be recordable in the founder's own book. */}
            <datalist id="renewal-plan-options">
              {PLAN_IDS.map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABEL[p]}
                </option>
              ))}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <Label>Billing term</Label>
            <select
              value={form.billing_term}
              onChange={(e) => changeTerm(e.target.value as BillingTerm | "")}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="">Not set</option>
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
              value={form.users}
              onChange={(e) => set("users", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Renewal amount (₹)</Label>
            <Input
              type="number"
              min={0}
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Start date *</Label>
            <Input
              type="date"
              value={form.start_date}
              onChange={(e) => changeStart(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>End date</Label>
            <Input
              type="date"
              value={form.end_date}
              onChange={(e) => {
                endTouched.current = true;
                set("end_date", e.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Fills itself from the term until you change it.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Salesman</Label>
            <Input
              value={form.salesman_name}
              onChange={(e) => set("salesman_name", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value as RenewalStatus)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              {RENEWAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RENEWAL_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Contact person</Label>
            <Input
              value={form.contact_person}
              onChange={(e) => set("contact_person", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Next follow-up</Label>
            <Input
              type="date"
              value={form.follow_up_date}
              onChange={(e) => set("follow_up_date", e.target.value)}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea
              rows={2}
              value={form.remarks}
              onChange={(e) => set("remarks", e.target.value)}
              placeholder="What the customer said last time."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {subscription ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
