"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileDown, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { getByPath, getTemplate, setByPath } from "@/lib/proposals/registry";
import { computeTotals, isPricePageCrowded } from "@/lib/proposals/totals";
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

  const totals = useMemo(
    () =>
      computeTotals(data?.lineItems ?? [], {
        gstEnabled: !!data?.gstEnabled,
        gstRate: Number(data?.gstRate) || 0,
      }),
    [data],
  );

  const discountPct =
    template && template.listRatePerYear > 0
      ? (1 - totals.headlineRate / template.listRatePerYear) * 100
      : 0;

  const edit = (path: string, value: unknown) => {
    setData((prev) => (prev ? setByPath(prev, path, value) : prev));
    setDirty(true);
  };

  const editLine = (index: number, key: keyof LineItem, value: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const lineItems = prev.lineItems.map((item, i) =>
        i === index
          ? { ...item, [key]: key === "users" || key === "rate" ? Number(value) || 0 : value }
          : item,
      );
      return { ...prev, lineItems };
    });
    setDirty(true);
  };

  const addLine = () => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            lineItems: [...prev.lineItems, { label: "", subLabel: "", users: 1, rate: totals.headlineRate }],
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
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {data.ref} · {template.label}
          </p>
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
          {data.lineItems.map((item, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-5 space-y-1">
                <Input
                  placeholder="OZZO SFA — Field Salesman"
                  value={item.label}
                  onChange={(e) => editLine(i, "label", e.target.value)}
                />
                <Input
                  placeholder="Android app · full field toolkit"
                  className="text-xs"
                  value={item.subLabel}
                  onChange={(e) => editLine(i, "subLabel", e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input
                  type="number"
                  placeholder="Users"
                  value={item.users}
                  onChange={(e) => editLine(i, "users", e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input
                  type="number"
                  placeholder="Rate / user / yr"
                  value={item.rate}
                  onChange={(e) => editLine(i, "rate", e.target.value)}
                />
              </div>
              <div className="col-span-2 text-right pt-2 text-sm font-medium">
                ₹{inr(totals.lineAmounts[i] ?? 0)}
              </div>
              <div className="col-span-1 pt-1">
                <Button variant="ghost" size="sm" onClick={() => removeLine(i)} title="Remove row">
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4 mr-1" />
            Add row
          </Button>

          {/* The Investment page is one fixed A4 sheet that does not paginate:
              past this many rows it clips the tiles below the table out of the
              PDF without any error. Better a warning here than a truncated
              proposal in a client's inbox. */}
          {isPricePageCrowded(data.lineItems.length, !!data.gstEnabled) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-sm px-3 py-2">
              This price table is too long for the Investment page. Check page 6 of the PDF before
              sending — rows past the bottom of the sheet are cut off, not carried to a new page.
              {data.gstEnabled && " Turning GST off frees up two rows."}
            </div>
          )}
        </div>

        {/* The catalog list price, so a discount is something you can see
            yourself giving rather than something you discover later. */}
        {template.listRatePerYear > 0 && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex flex-wrap items-center gap-x-2">
            <span className="text-muted-foreground">
              {template.label} list price is <b>₹{inr(template.listRatePerYear)}</b> / user / year.
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
                          rate: template.listRatePerYear,
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
          <Row label="Headline rate (price hero)" value={`₹${inr(totals.headlineRate)} / user / year`} />
          <Row label="Shown as per month" value={`≈ ₹${inr(totals.perUserPerMonth)} / user / month`} />
          <Row label="Annual subtotal" value={`₹${inr(totals.subtotal)}`} />
          <Row
            label={data.gstEnabled ? `GST @ ${data.gstRate}% (charged)` : `GST @ ${data.gstRate}% (shown as saving)`}
            value={`₹${inr(totals.gstAmount)}`}
          />
          <div className="flex justify-between font-semibold border-t pt-1 mt-1">
            <span>Total payable</span>
            <span>₹{inr(totals.grandTotal)}</span>
          </div>
        </div>
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
