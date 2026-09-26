"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  FileDown,
  Pencil,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTemplate } from "@/lib/proposals/registry";
import { computeTotals } from "@/lib/proposals/totals";
import { formatLongDate, inr } from "@/lib/proposals/format";
import { STATUS_CLASS, STATUS_LABEL, type ProposalStatus } from "@/lib/proposals/status";
import type { ProposalData } from "@/lib/proposals/types";

interface ProposalRow {
  id: string;
  ref: string;
  plan: string;
  client_name: string;
  proposal_date: string;
  status: ProposalStatus;
  sent_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  data: ProposalData;
}

export default function ProposalDetail({ id }: { id: string }) {
  const router = useRouter();
  const [row, setRow] = useState<ProposalRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/admin/proposals/${id}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(payload.error || "Could not load this proposal");
      return;
    }
    setRow(payload.proposal);
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const setStatus = async (status: ProposalStatus) => {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/admin/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setErr(payload.error || "Could not update the status");
    } else {
      await load();
    }
    setBusy(false);
  };

  const duplicate = async () => {
    if (!row) return;
    setBusy(true);
    const res = await fetch("/api/admin/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: row.plan, data: row.data }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(payload.error || "Could not duplicate");
      return;
    }
    router.push(`/admin/proposals/${payload.id}/edit`);
  };

  const remove = async () => {
    if (!row) return;
    if (!window.confirm(`Delete proposal ${row.ref} for ${row.client_name || "—"}?`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/proposals/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setErr("Could not delete");
      return;
    }
    router.push("/admin/proposals");
  };

  if (err && !row) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-300 bg-red-50 text-red-700 text-sm px-3 py-2">
          {err}
        </div>
      </div>
    );
  }

  if (!row) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const data = row.data;
  const totals = computeTotals(data.lineItems ?? [], {
    gstEnabled: !!data.gstEnabled,
    gstRate: Number(data.gstRate) || 0,
  });
  const template = getTemplate(row.plan);
  const listRate = template?.listRatePerYear ?? 0;
  const discount = listRate > 0 ? 1 - totals.headlineRate / listRate : 0;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => router.push("/admin/proposals")}
          >
            <ArrowLeft className="h-4 w-4" />
            All proposals
          </button>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="text-xl font-semibold">{row.client_name || "(unnamed)"}</h1>
            <span className={`text-xs rounded px-2 py-0.5 ${STATUS_CLASS[row.status]}`}>
              {STATUS_LABEL[row.status]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {row.ref} · {template?.label ?? row.plan}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={() => router.push(`/admin/proposals/${id}/edit`)}>
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <Button onClick={() => window.open(`/print/proposal/${id}`, "_blank")}>
            <FileDown className="h-4 w-4 mr-1" />
            Open PDF
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-700 text-sm px-3 py-2">
          {err}
        </div>
      )}

      {/* ── Status actions ─────────────────────────────────── */}
      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground mr-2">Move this proposal:</span>
          <Button
            variant={row.status === "sent" ? "default" : "outline"}
            size="sm"
            disabled={busy}
            onClick={() => setStatus("sent")}
          >
            <Send className="h-4 w-4 mr-1" />
            Mark sent
          </Button>
          <Button
            variant={row.status === "won" ? "default" : "outline"}
            size="sm"
            disabled={busy}
            onClick={() => setStatus("won")}
          >
            <ThumbsUp className="h-4 w-4 mr-1" />
            Won
          </Button>
          <Button
            variant={row.status === "lost" ? "default" : "outline"}
            size="sm"
            disabled={busy}
            onClick={() => setStatus("lost")}
          >
            <ThumbsDown className="h-4 w-4 mr-1" />
            Lost
          </Button>
          {row.status !== "draft" && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStatus("draft")}>
              Back to draft
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Only <b>Sent</b> proposals count as pipeline. Marking <b>Won</b> books the value in the
          month you mark it{row.decided_at ? ` — currently ${formatLongDate(row.decided_at.slice(0, 10))}` : ""}.
        </p>
      </section>

      {/* ── Facts ──────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border p-4 space-y-2 text-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Client
          </h2>
          <Fact label="Company" value={data.client?.name} />
          <Fact label="Short name" value={data.client?.shortName} />
          <Fact label="Industry" value={data.client?.industry} />
          <Fact label="Website" value={data.client?.website} />
          <Fact label="Address" value={data.client?.address} />
        </section>

        <section className="rounded-lg border p-4 space-y-2 text-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Proposal
          </h2>
          <Fact label="Date" value={formatLongDate(data.proposalDate)} />
          <Fact label="Valid for" value={`${data.validDays} days`} />
          <Fact label="Prepared by" value={data.preparedBy?.name} />
          <Fact label="Contact" value={data.preparedBy?.email} />
          <Fact
            label="Sent"
            value={row.sent_at ? formatLongDate(row.sent_at.slice(0, 10)) : "—"}
          />
        </section>
      </div>

      {/* ── Pricing ────────────────────────────────────────── */}
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Pricing
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Item</th>
              <th className="pb-2 font-medium text-right">Users</th>
              <th className="pb-2 font-medium text-right">Rate / user / yr</th>
              <th className="pb-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(data.lineItems ?? []).map((item, i) => (
              <tr key={i} className="border-t">
                <td className="py-2">
                  <div className="font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.subLabel}</div>
                </td>
                <td className="py-2 text-right">{item.users}</td>
                <td className="py-2 text-right">₹{inr(Number(item.rate) || 0)}</td>
                <td className="py-2 text-right">₹{inr(totals.lineAmounts[i] ?? 0)}</td>
              </tr>
            ))}
            <tr className="border-t">
              <td className="py-2 font-medium">Annual subtotal</td>
              <td className="py-2 text-right">{totals.usersTotal}</td>
              <td />
              <td className="py-2 text-right">₹{inr(totals.subtotal)}</td>
            </tr>
            {data.gstEnabled && (
              <tr>
                <td className="py-1 text-muted-foreground">GST @ {data.gstRate}%</td>
                <td />
                <td />
                <td className="py-1 text-right">₹{inr(totals.gstAmount)}</td>
              </tr>
            )}
            <tr className="border-t">
              <td className="py-2 font-semibold">Total payable</td>
              <td />
              <td />
              <td className="py-2 text-right font-semibold">₹{inr(totals.grandTotal)}</td>
            </tr>
          </tbody>
        </table>

        {listRate > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            {template?.label} list price is ₹{inr(listRate)} / user / year.{" "}
            {discount > 0.0001 ? (
              <span className="text-amber-700">
                This proposal quotes ₹{inr(totals.headlineRate)} — {Math.round(discount * 100)}%
                below list.
              </span>
            ) : discount < -0.0001 ? (
              <span>
                This proposal quotes ₹{inr(totals.headlineRate)} — above list.
              </span>
            ) : (
              <span>This proposal is at list price.</span>
            )}
          </p>
        )}
      </section>

      {/* ── Industry wording ───────────────────────────────── */}
      <section className="rounded-lg border p-4 space-y-3 text-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Industry wording
        </h2>
        <Fact label="What they have built" value={data.voice?.built} />
        <Fact label="Industry, plural" value={data.voice?.industryPlural} />
        <Fact label="Built-for line" value={data.voice?.builtFor} />
      </section>

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">
          Created {new Date(row.created_at).toLocaleString()} · updated{" "}
          {new Date(row.updated_at).toLocaleString()}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={duplicate}>
            <Copy className="h-4 w-4 mr-1" />
            Duplicate
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>
            <Trash2 className="h-4 w-4 mr-1 text-red-500" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3">
      <span className="text-muted-foreground w-36 shrink-0">{label}</span>
      <span className="flex-1">{value || <span className="text-muted-foreground">—</span>}</span>
    </div>
  );
}
