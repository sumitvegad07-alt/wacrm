"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/currency";
import { determineGstType, GST_STATES, gstStateCodeFromGstin } from "@/lib/gst/states";
import { PLAN_IDS, PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import {
  BILLING_TERMS,
  DEFAULT_GST_RATE,
  renewalDate,
  TERM_LABEL,
  type BillingTerm,
} from "@/lib/plans/pricing";
import { planLine } from "@/lib/invoices/denormalise";
import { amountInWords, invoiceTotals, lineAmount } from "@/lib/invoices/totals";
import { placeOfSupply } from "@/lib/invoices/tax";
import {
  DEFAULT_SAC,
  sellerFromSettings,
  type BuyerSnapshot,
  type InvoiceLine,
  type InvoiceRow,
  type InvoiceSeries,
  type InvoiceSettingsRow,
} from "@/lib/invoices/types";

// ============================================================
// Raising and editing an invoice.
//
// The live totals panel is computed with the SAME functions the server uses to
// derive the stored columns — invoiceTotals() and determineGstType() — so the
// preview can never disagree with the saved row. The place-of-supply warning
// says exactly what the API will refuse at the issue step, so the founder is
// never surprised after typing the whole thing.
// ============================================================

interface Company {
  id: string;
  customer_id: string | null;
  name: string;
  subscription_plan: string | null;
  seat_count: number;
}

const BLANK_BUYER: BuyerSnapshot = {
  name: "",
  address: "",
  pincode: "",
  state: "",
  gstStateCode: "",
  gstin: "",
  contactPerson: "",
  phone: "",
  email: "",
};

/** yyyy-mm-dd for a local Date, without going through toISOString(). */
function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The last day of a period that starts on `start` and runs one whole term.
 *
 * renewalDate() gives the date one term later; the period ENDS the day before
 * that, so 01 Nov 2026 on a yearly term ends 31 Oct 2027, not 01 Nov.
 */
function periodEndFor(start: string, term: BillingTerm): string {
  const [y, m, d] = start.split("-").map(Number);
  if (!y || !m || !d) return "";
  const end = renewalDate(new Date(y, m - 1, d), term);
  end.setDate(end.getDate() - 1);
  return isoDate(end);
}

function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

export default function InvoiceForm({
  mode,
  invoice,
}: {
  mode: "create" | "edit";
  invoice?: InvoiceRow;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<InvoiceSettingsRow | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const today = isoDate(new Date());

  const [series, setSeries] = useState<InvoiceSeries>(invoice?.series ?? "gst");
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoice_date ?? today);
  const [accountId, setAccountId] = useState<string | null>(invoice?.account_id ?? null);
  const [customerId, setCustomerId] = useState(invoice?.customer_id ?? "");
  const [plan, setPlan] = useState<PlanId>(
    invoice && isPlanId(invoice.plan) ? invoice.plan : "CRM_SFA",
  );
  const [term, setTerm] = useState<BillingTerm>(invoice?.billing_term ?? "yearly");
  const [periodStart, setPeriodStart] = useState(invoice?.period_start ?? today);
  const [periodEnd, setPeriodEnd] = useState(
    invoice?.period_end ?? periodEndFor(today, invoice?.billing_term ?? "yearly"),
  );
  const [gstRate, setGstRate] = useState(invoice?.gst_rate ?? DEFAULT_GST_RATE);
  const [buyer, setBuyer] = useState<BuyerSnapshot>(invoice?.data?.buyer ?? BLANK_BUYER);
  const [lines, setLines] = useState<InvoiceLine[]>(
    invoice?.data?.lines ?? [planLine("CRM_SFA", 1, "yearly")],
  );
  const [discountPct, setDiscountPct] = useState(invoice?.data?.discountPct ?? 0);
  const [discountAmount, setDiscountAmount] = useState(invoice?.data?.discountAmount ?? 0);
  const [notes, setNotes] = useState(invoice?.data?.notes ?? "");
  const [terms, setTerms] = useState(invoice?.data?.terms ?? "");

  // Once the founder types an end date himself, a later term change must not
  // overwrite it.
  const endTouched = useRef(mode === "edit");
  // Likewise the plan line's rate: he may have agreed something off list.
  const rateTouched = useRef(mode === "edit");

  useEffect(() => {
    async function load() {
      const [settingsRes, companiesRes] = await Promise.all([
        fetch("/api/admin/invoice-settings"),
        fetch("/api/admin/companies"),
      ]);

      const settingsPayload = await settingsRes.json().catch(() => ({}));
      if (settingsRes.ok && settingsPayload?.settings) {
        setSettings(settingsPayload.settings as InvoiceSettingsRow);
        if (mode === "create" && settingsPayload.settings.default_terms) {
          setTerms(settingsPayload.settings.default_terms);
        }
      } else if (!settingsRes.ok) {
        toast.error(settingsPayload?.error ?? "Could not load the invoice settings");
      }

      const companiesPayload = await companiesRes.json().catch(() => ({}));
      setCompanies((companiesPayload?.companies ?? []) as Company[]);
      setLoading(false);
    }
    load();
    // `mode` never changes for a mounted form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pre-fill from a tenant: its company profile, plan and seats. */
  async function pickAccount(id: string) {
    setAccountId(id || null);
    if (!id) return;

    const company = companies.find((c) => c.id === id);
    if (company) {
      setCustomerId(company.customer_id ?? "");
      if (company.subscription_plan && isPlanId(company.subscription_plan)) {
        setPlan(company.subscription_plan);
      }
    }

    const res = await fetch(`/api/admin/accounts/${id}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(payload?.error ?? "Could not load that company's details");
      return;
    }

    const profile = (payload?.account?.settings?.company_profile ?? {}) as Record<
      string,
      string | undefined
    >;

    setBuyer({
      name: profile.name || company?.name || "",
      address: profile.address ?? "",
      pincode: profile.pincode ?? "",
      state: profile.state ?? "",
      gstStateCode: profile.gst_state_code ?? "",
      gstin: profile.gst_number ?? "",
      contactPerson: profile.contact_person_name ?? "",
      phone: profile.registered_contact_no ?? "",
      email: profile.registered_email ?? "",
    });

    const seats = Math.max(1, company?.seat_count ?? 1);
    const nextPlan =
      company?.subscription_plan && isPlanId(company.subscription_plan)
        ? company.subscription_plan
        : plan;
    rebuildPlanLine(nextPlan, seats, term);
  }

  /** The subscription line, re-priced. Keeps a hand-edited rate and label. */
  function rebuildPlanLine(nextPlan: PlanId, users: number, nextTerm: BillingTerm) {
    const fresh = planLine(nextPlan, users, nextTerm);
    setLines((prev) => {
      const current = prev[0];
      const kept: InvoiceLine = {
        ...fresh,
        label: rateTouched.current && current?.label ? current.label : fresh.label,
        rate: rateTouched.current && current ? current.rate : fresh.rate,
      };
      return [kept, ...prev.slice(1)];
    });
  }

  function changeTerm(next: BillingTerm) {
    setTerm(next);
    rebuildPlanLine(plan, lines[0]?.users ?? 1, next);
    if (!endTouched.current) setPeriodEnd(periodEndFor(periodStart, next));
  }

  function changePlan(next: PlanId) {
    setPlan(next);
    rebuildPlanLine(next, lines[0]?.users ?? 1, term);
  }

  function changeUsers(users: number) {
    rebuildPlanLine(plan, Math.max(0, users), term);
  }

  function changeStart(next: string) {
    setPeriodStart(next);
    if (!endTouched.current) setPeriodEnd(periodEndFor(next, term));
  }

  function changeSeries(next: InvoiceSeries) {
    setSeries(next);
    setGstRate(next === "gst" ? DEFAULT_GST_RATE : 0);
  }

  function updateLine(index: number, patch: Partial<InvoiceLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  const listRate = useMemo(() => planLine(plan, lines[0]?.users ?? 1, term).rate, [
    plan,
    lines,
    term,
  ]);

  // Exactly the server's derivation, so the preview and the stored row agree.
  const posCode = series === "gst" ? placeOfSupply(buyer.gstin, buyer.state) : null;
  const supplierCode =
    gstStateCodeFromGstin(settings?.gstin) || settings?.gst_state_code || null;
  const gstType = series === "gst" ? determineGstType(supplierCode, posCode) : null;

  const totals = invoiceTotals(lines, {
    gstEnabled: series === "gst",
    gstRate,
    gstType,
    discountPct,
    discountAmount,
  });

  const noPlaceOfSupply = series === "gst" && (!gstType || gstType === "unknown");

  async function save() {
    if (!buyer.name.trim()) {
      toast.error("The customer's name is required");
      return;
    }
    if (!settings) {
      toast.error("Fill in Invoice Settings first — the invoice needs your own details on it.");
      return;
    }

    setSaving(true);
    try {
      const body = {
        data: {
          seller: sellerFromSettings(settings),
          buyer,
          lines,
          discountPct,
          discountAmount,
          notes,
          terms,
        },
        meta: {
          series,
          invoiceDate,
          accountId,
          customerId,
          plan,
          billingTerm: term,
          periodStart,
          periodEnd,
          gstRate,
        },
      };

      const res =
        mode === "create"
          ? await fetch("/api/admin/invoices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch(`/api/admin/invoices/${invoice!.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not save the invoice");

      toast.success(mode === "create" ? "Invoice created" : "Invoice saved");
      router.push(`/admin/invoices/${mode === "create" ? payload.id : invoice!.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the invoice");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {mode === "create" ? "New Invoice" : `Edit ${invoice?.invoice_no}`}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "create"
              ? "The number is assigned when you save."
              : "Only a draft can be edited."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {mode === "create" ? "Create Draft" : "Save"}
          </Button>
        </div>
      </div>

      {!settings?.firm_name ? (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <TriangleAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            Your firm name is not set. Fill in{" "}
            <a href="/admin/invoice-settings" className="underline">
              Invoice Settings
            </a>{" "}
            first, or the invoice will print without your details, GSTIN and bank account.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* ---------------- type + dates ---------------- */}
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Invoice</h2>

            <div className="flex gap-2">
              {(["gst", "non_gst"] as const).map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={series === s ? "default" : "outline"}
                  onClick={() => changeSeries(s)}
                >
                  {s === "gst" ? "GST Invoice" : "Non-GST Invoice"}
                </Button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Invoice date</Label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>
              {series === "gst" ? (
                <div className="space-y-1.5">
                  <Label>GST rate (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={gstRate}
                    onChange={(e) => setGstRate(Number(e.target.value) || 0)}
                  />
                </div>
              ) : null}
            </div>
          </div>

          {/* ---------------- customer ---------------- */}
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Billed to</h2>

            <div className="space-y-1.5">
              <Label>Pick a company</Label>
              <select
                value={accountId ?? ""}
                onChange={(e) => pickAccount(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="">Type the details by hand…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.customer_id ? ` (${c.customer_id})` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Fills the address, GSTIN, plan and seats from that company. Everything stays
                editable, and what you save is frozen on the invoice.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Customer name</Label>
                <Input
                  value={buyer.name}
                  onChange={(e) => setBuyer({ ...buyer, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Address</Label>
                <Textarea
                  rows={2}
                  value={buyer.address}
                  onChange={(e) => setBuyer({ ...buyer, address: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pincode</Label>
                <Input
                  value={buyer.pincode}
                  onChange={(e) => setBuyer({ ...buyer, pincode: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <select
                  value={buyer.state}
                  onChange={(e) => {
                    const match = GST_STATES.find((s) => s.name === e.target.value);
                    setBuyer({
                      ...buyer,
                      state: e.target.value,
                      gstStateCode: match?.code ?? "",
                    });
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Select a state…</option>
                  {GST_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
              {series === "gst" ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Customer GSTIN</Label>
                  <Input
                    value={buyer.gstin}
                    onChange={(e) =>
                      setBuyer({ ...buyer, gstin: e.target.value.toUpperCase() })
                    }
                    placeholder="24BBBBB1111B1Z5"
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label>Contact person</Label>
                <Input
                  value={buyer.contactPerson}
                  onChange={(e) => setBuyer({ ...buyer, contactPerson: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={buyer.phone}
                  onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Customer ID</Label>
                <Input value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
              </div>
            </div>

            {noPlaceOfSupply ? (
              <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                <TriangleAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <p>
                  <strong>No place of supply.</strong> Add the customer&apos;s GSTIN, or pick
                  their state. This invoice can be saved as a draft but cannot be issued — without
                  it the tax split would be wrong.
                </p>
              </div>
            ) : null}
          </div>

          {/* ---------------- subscription + lines ---------------- */}
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">What is being billed</h2>

            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <select
                  value={plan}
                  onChange={(e) => changePlan(e.target.value as PlanId)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  {PLAN_IDS.map((p) => (
                    <option key={p} value={p}>
                      {PLAN_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Term</Label>
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
                <Label>Period start</Label>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => changeStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Period end</Label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => {
                    endTouched.current = true;
                    setPeriodEnd(e.target.value);
                  }}
                />
              </div>
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-3 sm:grid-cols-12 items-end border-t border-border pt-3 first:border-0 first:pt-0"
                >
                  <div className="sm:col-span-4 space-y-1.5">
                    <Label>{index === 0 ? "Subscription" : "Charge"}</Label>
                    <Input
                      value={line.label}
                      onChange={(e) => {
                        if (index === 0) rateTouched.current = true;
                        updateLine(index, { label: e.target.value });
                      }}
                      placeholder={index === 0 ? "" : "One-time setup"}
                    />
                  </div>
                  {series === "gst" ? (
                    <div className="sm:col-span-2 space-y-1.5">
                      <Label>SAC</Label>
                      <Input
                        value={line.sac}
                        onChange={(e) => updateLine(index, { sac: e.target.value })}
                      />
                    </div>
                  ) : null}
                  <div className="sm:col-span-1 space-y-1.5">
                    <Label>Users</Label>
                    <Input
                      type="number"
                      min={0}
                      value={line.users}
                      onChange={(e) =>
                        index === 0
                          ? changeUsers(Number(e.target.value) || 0)
                          : updateLine(index, { users: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="sm:col-span-1 space-y-1.5">
                    <Label>Months</Label>
                    <Input
                      type="number"
                      min={0}
                      value={line.months}
                      onChange={(e) => updateLine(index, { months: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label>Rate</Label>
                    <Input
                      type="number"
                      min={0}
                      value={line.rate}
                      onChange={(e) => {
                        if (index === 0) rateTouched.current = true;
                        updateLine(index, { rate: Number(e.target.value) || 0 });
                      }}
                    />
                    {index === 0 && line.rate !== listRate ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        List {formatCurrency(listRate)}
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:col-span-1 text-right text-sm font-medium">
                    {formatCurrency(lineAmount(line))}
                  </div>
                  <div className="sm:col-span-1">
                    {index > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  {
                    label: "",
                    description: "",
                    sac: DEFAULT_SAC,
                    users: 1,
                    months: 1,
                    rate: 0,
                  },
                ])
              }
            >
              <Plus className="h-4 w-4 mr-2" />
              Add charge
            </Button>

            <div className="grid gap-4 sm:grid-cols-2 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label>Discount (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={discountPct}
                  onChange={(e) => setDiscountPct(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Discount (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  value={discountAmount}
                  disabled={discountPct > 0}
                  onChange={(e) => setDiscountAmount(Number(e.target.value) || 0)}
                />
                <p className="text-xs text-muted-foreground">
                  A percent, if given, is used instead of the flat amount.
                </p>
              </div>
            </div>
          </div>

          {/* ---------------- notes ---------------- */}
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Notes &amp; terms</h2>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Terms</Label>
              <Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ---------------- live totals ---------------- */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6 space-y-3 lg:sticky lg:top-4">
            <h2 className="text-lg font-semibold">Totals</h2>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{formatCurrency(totals.subtotal)}</dd>
              </div>
              {totals.discountAmount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd>− {formatCurrency(totals.discountAmount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-border pt-2">
                <dt className="text-muted-foreground">Taxable value</dt>
                <dd>{formatCurrency(totals.taxableValue)}</dd>
              </div>

              {totals.cgst > 0 ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">CGST @ {gstRate / 2}%</dt>
                    <dd>{formatCurrency(totals.cgst)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">SGST @ {gstRate / 2}%</dt>
                    <dd>{formatCurrency(totals.sgst)}</dd>
                  </div>
                </>
              ) : null}
              {totals.igst > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">IGST @ {gstRate}%</dt>
                  <dd>{formatCurrency(totals.igst)}</dd>
                </div>
              ) : null}

              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatCurrency(totals.total)}</dd>
              </div>
            </dl>

            <p className="text-xs text-muted-foreground border-t border-border pt-3">
              {amountInWords(totals.total)}
            </p>

            {series === "gst" ? (
              <p className="text-xs text-muted-foreground">
                {gstType === "intrastate"
                  ? "Same state as yours — CGST + SGST."
                  : gstType === "interstate"
                    ? "Different state — IGST."
                    : "Place of supply unknown — no tax can be charged yet."}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Non-GST invoice — no tax, no GSTIN printed.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
