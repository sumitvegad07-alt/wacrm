"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileDown, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getByPath,
  getTemplate,
  listRatePerMonth,
  listTemplates,
  setByPath,
} from "@/lib/proposals/registry";
import { changePlan, changeTerm } from "@/lib/proposals/change-plan";
import { featuresForPlan } from "@/lib/proposals/plan-features";
import {
  computeTotals,
  isPricePageCrowded,
  lineMonths,
  offerLineCount,
  priceSheetClearance,
  type SheetContent,
} from "@/lib/proposals/totals";
import {
  BILLING_TERMS,
  MIN_USERS,
  TERM_LABEL,
  TERM_MONTHS,
  asTerm,
  type BillingTerm,
} from "@/lib/plans/pricing";
import { inr } from "@/lib/proposals/format";
import type { LineItem, ProposalData, ProposalField } from "@/lib/proposals/types";

export default function ProposalForm({ id }: { id: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState("SFA");
  const [data, setData] = useState<ProposalData | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  /**
   * Whether the bank block and the signature will print on page 2.
   *
   * They come from Invoice Settings, not from this form, but they take 104px
   * and 98px off the sheet — nearly two price rows between them. Without
   * reading them, uploading a signature would silently start clipping
   * quotations that fitted the day before, with no warning anywhere.
   */
  const [blocks, setBlocks] = useState<{ hasBankBlock: boolean; hasSignature: boolean }>({
    hasBankBlock: false,
    hasSignature: false,
  });

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/invoice-settings");
      const payload = await res.json().catch(() => ({}));
      // A settings row that cannot be read leaves both false: the warning then
      // under-reports rather than crying wolf on every quotation.
      if (!res.ok || !payload?.settings) return;
      const row = payload.settings;
      setBlocks({
        hasBankBlock: !!(row.bank_name || row.bank_account_no || row.upi_id),
        hasSignature: !!row.signature_url,
      });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/admin/proposals/${id}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(payload.error || "Could not load this proposal");
        return;
      }
      setPlan(payload.proposal.plan);
      setData(payload.proposal.data);
    })();
  }, [id]);

  const template = getTemplate(plan);

  const term = asTerm(data?.billingTerm);

  const totals = useMemo(
    () =>
      computeTotals(data?.lineItems ?? [], {
        gstEnabled: !!data?.gstEnabled,
        gstRate: Number(data?.gstRate) || 0,
        term,
      }),
    [data, term],
  );

  // List price for THIS proposal's term, so "at list price" means at list for
  // what is actually being sold rather than for the yearly rate.
  const listRate = template ? listRatePerMonth(template.plan, term) : 0;

  const discountPct =
    listRate > 0 ? (1 - totals.headlineRate / listRate) * 100 : 0;

  const minUsers = template ? MIN_USERS[template.plan] : 0;
  const belowMinUsers = totals.usersTotal > 0 && totals.usersTotal < minUsers;

  /**
   * Switching plan rewrites pages 2-6 and re-labels the plan's own price rows
   * at the new list price, so it confirms first rather than silently
   * rewriting numbers the founder may have negotiated.
   */
  const switchPlan = (next: string | null) => {
    if (!data || !next || next === plan) return;

    const target = getTemplate(next);
    if (!target) return;

    const ok = window.confirm(
      `Change this proposal from ${template?.label ?? plan} to ${target.label}?

` +
        `The document's wording and its feature list become ${target.label}'s ` +
        `(${featuresForPlan(target.plan).length} features), and the ${target.label} ` +
        `seat rows are re-priced to the list rate of ₹${inr(listRatePerMonth(target.plan, term))} ` +
        `per user / month.

Your client details, team size and any rows you added ` +
        `yourself are kept.`,
    );
    if (!ok) return;

    setData((prev) => (prev ? changePlan(prev, plan, next) : prev));
    setPlan(next);
    setDirty(true);
  };

  /**
   * Switching the billing term re-prices every seat row at the new term's rate.
   * Unlike switching plan this needs no confirmation: the price the client pays
   * per month changes by design, and a hand-negotiated discount is carried over
   * as a proportion rather than discarded.
   */
  const switchTerm = (next: BillingTerm) => {
    if (!data) return;

    // Picking a named term also narrows the PDF's comparison table to that one
    // row: "Yearly" means quote yearly and show yearly, which is what the
    // button says. "All periods" is the only way to widen it again.
    setData((prev) =>
      prev ? { ...(next === term ? prev : changeTerm(prev, next)), showAllTerms: false } : prev,
    );
    setDirty(true);
  };

  /**
   * Show all three terms side by side in the PDF.
   *
   * The charged term is untouched — a proposal still bills one period. This
   * only widens what the document prints, so the customer can see what a
   * longer commitment would save.
   */
  const showAllTerms = () => {
    if (!data) return;
    setData((prev) => (prev ? { ...prev, showAllTerms: true } : prev));
    setDirty(true);
  };

  const allTermsShown = !!data?.showAllTerms;

  /** Everything on page 2 that is not a price row, for the clipping guard. */
  const sheet: SheetContent = {
    showAllTerms: allTermsShown,
    offerLines: offerLineCount(data?.offer),
    ...blocks,
  };

  const edit = (path: string, value: unknown) => {
    setData((prev) => (prev ? setByPath(prev, path, value) : prev));
    setDirty(true);
  };

  const editLine = (index: number, key: keyof LineItem, value: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const lineItems = prev.lineItems.map((item, i) => {
        if (i !== index) return item;
        if (key === "users" || key === "rate") return { ...item, [key]: Number(value) || 0 };

        // A blank Months box means "follow the billing term", which is the key
        // being ABSENT — not zero. Storing 0 would silently make the row free,
        // and a deliberate 0 (a free row) has to survive a reload, so the two
        // cannot share a representation.
        if (key === "months") {
          const next = { ...item };
          if (value === "") delete next.months;
          else next.months = Math.max(0, Number(value) || 0);
          return next;
        }

        return { ...item, [key]: value };
      });
      return { ...prev, lineItems };
    });
    setDirty(true);
  };

  const addLine = () => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            // No `months`: a new row follows the billing term until the
            // founder types a period of its own, so adding a row to an
            // ordinary quotation needs no extra thought.
            lineItems: [
              ...prev.lineItems,
              { label: "", subLabel: "", users: 1, rate: totals.headlineRate },
            ],
          }
        : prev,
    );
    setDirty(true);
  };

  const removeLine = (index: number) => {
    setData((prev) =>
      prev ? { ...prev, lineItems: prev.lineItems.filter((_, i) => i !== index) } : prev,
    );
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (!data) return false;
    setSaving(true);
    setErr(null);

    const res = await fetch(`/api/admin/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, data }),
    });
    setSaving(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setErr(payload.error || "Could not save");
      return false;
    }
    setDirty(false);
    setSavedAt(new Date().toLocaleTimeString());
    return true;
  };

  /** Always saves first: the print route renders the stored row, not this form. */
  const saveAndOpen = async () => {
    if (await save()) window.open(`/print/proposal/${id}`, "_blank");
  };

  if (err && !data) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-300 bg-red-50 text-red-700 text-sm px-3 py-2">
          {err}
        </div>
      </div>
    );
  }

  if (!data) return <div className="p-6 text-muted-foreground">Loading…</div>;

  if (!template) {
    return (
      <div className="p-6 text-red-600">
        No proposal template exists for plan “{plan}”.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => router.push(`/admin/proposals/${id}`)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to proposal
          </button>
          <h1 className="text-xl font-semibold mt-1">
            {data.client?.name || "New proposal"}
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{data.ref}</p>

          <div className="flex items-center gap-2 mt-3">
            <span className="text-sm text-muted-foreground">Plan</span>
            <Select value={plan} onValueChange={switchPlan}>
              <SelectTrigger className="h-8 w-[230px]">
                {/* This Select renders the raw value unless given the label. */}
                <SelectValue placeholder="Plan">
                  {template.label} · ₹{inr(listRate)}/user/mo
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {listTemplates().map((t) => (
                  <SelectItem key={t.plan} value={t.plan}>
                    {t.label} · ₹{inr(listRatePerMonth(t.plan, term))}/user/mo
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {featuresForPlan(template.plan).length} features
            </span>
          </div>

          {/* Billing term. Changing it re-prices the seat rows at the new term's
              rate while keeping any discount proportional, so a negotiated price
              survives the switch — see changeTerm().

              The fourth button is not a fourth term: a proposal always bills one
              period. It widens the PDF's comparison table to all three, which is
              the annual close in one table. */}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-sm text-muted-foreground">Billed</span>
            <div className="flex gap-1">
              {BILLING_TERMS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchTerm(t)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    term === t && !allTermsShown
                      ? "bg-violet-600 text-white border-violet-600 font-semibold"
                      : term === t
                        ? "bg-violet-100 text-violet-800 border-violet-300 font-semibold"
                        : "bg-background border-border hover:bg-muted"
                  }`}
                >
                  {TERM_LABEL[t]}
                </button>
              ))}
              <button
                type="button"
                onClick={showAllTerms}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  allTermsShown
                    ? "bg-violet-600 text-white border-violet-600 font-semibold"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                All periods
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {allTermsShown ? (
              <>
                Charging <b>{TERM_LABEL[term]}</b> — {TERM_MONTHS[term]} months, and the list rate
                of ₹{inr(listRate)}/user/month, as the starting point for every row. The PDF shows
                all three periods with the saving on each.
              </>
            ) : (
              <>
                Charging <b>{TERM_LABEL[term]}</b> — {TERM_MONTHS[term]} months, and the list rate
                of ₹{inr(listRate)}/user/month, as the starting point for every row. The PDF shows
                this period only.
              </>
            )}{" "}
            Any row can set its own Months and its own rate.
          </p>

          {totals.mixedMonths && (
            <p className="text-xs text-violet-700 dark:text-violet-300 mt-2">
              Rows cover different periods, so the PDF prints each row&rsquo;s own months instead of
              one period for the whole quotation
              {allTermsShown ? ", and the three-period comparison table is left out — the same deal on another term is not a question this quotation can answer" : ""}
              .
            </p>
          )}

          {belowMinUsers && (
            <p className="text-xs text-amber-700 mt-2">
              {template.label} has a minimum of {minUsers} users — this proposal quotes{" "}
              {totals.usersTotal}.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          ) : savedAt ? (
            <span className="text-xs text-muted-foreground">Saved {savedAt}</span>
          ) : null}
          <Button variant="outline" onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={saveAndOpen} disabled={saving}>
            <FileDown className="h-4 w-4 mr-1" />
            Save &amp; open PDF
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-700 text-sm px-3 py-2">
          {err}
        </div>
      )}

      {/* Field groups come from the plan's template, so a CRM proposal later
          needs no changes to this form. */}
      {template.groups.map((group) => (
        <section key={group.title} className="rounded-lg border p-4 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {group.title}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {group.fields.map((field) => (
              <FieldInput
                key={field.path}
                field={field}
                value={getByPath(data, field.path)}
                onChange={(v) => edit(field.path, v)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Pricing
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="gst"
                checked={!!data.gstEnabled}
                onCheckedChange={(checked) => edit("gstEnabled", checked)}
              />
              <Label htmlFor="gst" className="text-sm">
                Charge GST
              </Label>
            </div>
            {data.gstEnabled && (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  className="w-16 h-8"
                  value={data.gstRate}
                  onChange={(e) => edit("gstRate", Number(e.target.value) || 0)}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {data.lineItems.map((item, i) => {
            const rowMonths = lineMonths(item, TERM_MONTHS[term]);
            const belowList = listRate > 0 && item.rate > 0 && item.rate < listRate;

            return (
              <div key={i} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Input
                    placeholder="OZZO SFA — Field Salesman"
                    value={item.label}
                    onChange={(e) => editLine(i, "label", e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(i)}
                    title="Remove row"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>

                {/* One open box per row. Every line you type prints as its own
                    line under the item name — plan, users, the period, a
                    condition. Text only: it never touches the amount. */}
                <Textarea
                  rows={3}
                  className="text-xs"
                  placeholder={"Android app · full field toolkit\nPERIOD: 1 Nov 2026 to 31 Jul 2027"}
                  value={item.subLabel}
                  onChange={(e) => editLine(i, "subLabel", e.target.value)}
                />

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                  <div className="space-y-1">
                    <Label className="text-xs">Users</Label>
                    <Input
                      type="number"
                      min={0}
                      value={item.users}
                      onChange={(e) => editLine(i, "users", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rate /user /month</Label>
                    <Input
                      type="number"
                      min={0}
                      value={item.rate}
                      onChange={(e) => editLine(i, "rate", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Months</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder={String(TERM_MONTHS[term])}
                      value={item.months ?? ""}
                      onChange={(e) => editLine(i, "months", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">From</Label>
                    <Input
                      type="date"
                      value={item.periodStart ?? ""}
                      onChange={(e) => editLine(i, "periodStart", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">To</Label>
                    <Input
                      type="date"
                      value={item.periodEnd ?? ""}
                      onChange={(e) => editLine(i, "periodEnd", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount</Label>
                    <div className="h-9 flex items-center justify-end text-sm font-medium">
                      ₹{inr(totals.lineAmounts[i] ?? 0)}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {item.users} user{item.users === 1 ? "" : "s"} × ₹{inr(item.rate)} ×{" "}
                  {rowMonths} month{rowMonths === 1 ? "" : "s"}
                  {item.months === undefined ? " (following the term)" : ""}
                  {belowList ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {" "}
                      · {Math.round(((listRate - item.rate) / listRate) * 100)}% below the{" "}
                      {TERM_LABEL[term]} list rate of ₹{inr(listRate)}
                    </span>
                  ) : null}
                </p>
              </div>
            );
          })}

          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4 mr-1" />
            Add row
          </Button>

          {/* The Investment page is one fixed A4 sheet that does not paginate:
              past this many rows it clips the tiles below the table out of the
              PDF without any error. Better a warning here than a truncated
              proposal in a client's inbox. */}
          {isPricePageCrowded(data.lineItems, sheet) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-sm px-3 py-2">
              This price table is too long for page 2 by about{" "}
              {Math.abs(priceSheetClearance(data.lineItems, sheet))}px.
              Check the PDF before sending — anything past the bottom of the sheet is cut off,
              not carried to a new page. Shorten a description, or drop a row.
              {allTermsShown && " Showing one billing period instead of all three frees up a row."}
            </div>
          )}
        </div>

        {/* The catalog list price, so a discount is something you can see
            yourself giving rather than something you discover later. */}
        {listRate > 0 && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex flex-wrap items-center gap-x-2">
            <span className="text-muted-foreground">
              {template.label} on {TERM_LABEL[term].toLowerCase()} is{" "}
              <b>₹{inr(listRate)}</b> / user / month.
            </span>
            {discountPct > 0.5 ? (
              <span className="text-amber-700">
                You are quoting {Math.round(discountPct)}% below list.
              </span>
            ) : discountPct < -0.5 ? (
              <span>You are quoting {Math.round(-discountPct)}% above list.</span>
            ) : (
              <span className="text-emerald-700">At list price.</span>
            )}
            <button
              type="button"
              className="ml-auto text-violet-600 hover:underline text-xs"
              onClick={() => {
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        lineItems: prev.lineItems.map((li) => ({
                          ...li,
                          rate: listRate,
                        })),
                      }
                    : prev,
                );
                setDirty(true);
              }}
            >
              Reset to list price
            </button>
          </div>
        )}

        {/* What the document will print — shown here so the numbers are checked
            before the PDF is sent, not after. */}
        <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
          <Row label="Total users" value={String(totals.usersTotal)} />
          <Row label="Headline rate (price hero)" value={`₹${inr(totals.headlineRate)} / user / month`} />
          {/* Meaningless once rows cover different periods — there is no single
              "per user for the term" when one row runs nine months and another
              twelve, so the line is dropped rather than printed wrong. */}
          {!totals.mixedMonths && (
            <Row
              label={`Per user for the ${TERM_LABEL[term].toLowerCase()} term`}
              value={`₹${inr(totals.headlineRate * totals.months)} / user / ${totals.months} months`}
            />
          )}
          <Row
            label={
              totals.mixedMonths
                ? "Subtotal per invoice (mixed periods)"
                : `Subtotal per invoice (${totals.months} months)`
            }
            value={`₹${inr(totals.subtotal)}`}
          />
          <Row label="Annualised run-rate" value={`₹${inr(totals.annualised)}`} />
          <Row
            label={data.gstEnabled ? `GST @ ${data.gstRate}% (charged)` : `GST @ ${data.gstRate}% (shown as saving)`}
            value={`₹${inr(totals.gstAmount)}`}
          />
          <div className="flex justify-between font-semibold border-t pt-1 mt-1">
            <span>Total payable</span>
            <span>₹{inr(totals.grandTotal)}</span>
          </div>
        </div>

        {/* Said here because it is not obvious: these print on the quotation but
            are not edited on it. They were being read as "missing". */}
        <p className="text-xs text-muted-foreground">
          Bank details and your signature print on the PDF and are filled in once, under{" "}
          <a href="/admin/invoice-settings" className="underline" target="_blank" rel="noreferrer">
            Invoice Settings
          </a>
          . Anything left blank there simply does not print.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ProposalField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const shared = {
    id: field.path,
    value: (value ?? "") as string | number,
  };

  return (
    <div className={field.kind === "textarea" ? "md:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label htmlFor={field.path}>{field.label}</Label>
      {field.kind === "textarea" ? (
        <Textarea {...shared} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          {...shared}
          type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
          onChange={(e) =>
            onChange(field.kind === "number" ? Number(e.target.value) || 0 : e.target.value)
          }
        />
      )}
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}
