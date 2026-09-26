"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/proposals/format";
import { formatLongDate } from "@/lib/proposals/format";
import type { ProposalListRow } from "@/lib/proposals/types";

export default function ProposalsClient() {
  const router = useRouter();
  const [rows, setRows] = useState<ProposalListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/proposals");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) setErr(payload.error || "Could not load proposals");
      setRows(payload.proposals ?? []);
      setLoading(false);
    })();
  }, []);

  const create = async (source?: ProposalListRow) => {
    setBusy(source ? source.id : "new");
    setErr(null);

    // Duplicating sends the stored payload back; the server always assigns a
    // fresh reference and today's date, so a clone can never go out carrying
    // the original's number.
    let body: Record<string, unknown> = { plan: "SFA" };
    if (source) {
      const res = await fetch(`/api/admin/proposals/${source.id}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(payload.error || "Could not read that proposal");
        setBusy(null);
        return;
      }
      body = { plan: payload.proposal.plan, data: payload.proposal.data };
    }

    const res = await fetch("/api/admin/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setErr(payload.error || "Could not create the proposal");
      return;
    }
    router.push(`/admin/proposals/${payload.id}`);
  };

  const remove = async (row: ProposalListRow) => {
    if (!window.confirm(`Delete proposal ${row.ref} for ${row.client_name || "—"}?`)) return;

    setBusy(row.id);
    const res = await fetch(`/api/admin/proposals/${row.id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setErr(payload.error || "Could not delete");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Sales Proposals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            OZZO&apos;s own proposals. Every price you have quoted is here — visible only to you.
          </p>
        </div>
        <Button onClick={() => create()} disabled={busy === "new"}>
          <Plus className="h-4 w-4 mr-1" />
          {busy === "new" ? "Creating…" : "New SFA proposal"}
        </Button>
      </div>

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-700 text-sm px-3 py-2">
          {err}
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium text-right">Users</th>
              <th className="px-3 py-2 font-medium text-right">Annual</th>
              <th className="px-3 py-2 font-medium text-right">Payable</th>
              <th className="px-3 py-2 font-medium">GST</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  No proposals yet. Create one, or duplicate an old one once it is here.
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr key={row.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{row.ref}</td>
                <td className="px-3 py-2">
                  <button
                    className="text-violet-600 hover:underline font-medium"
                    onClick={() => router.push(`/admin/proposals/${row.id}`)}
                  >
                    {row.client_name || "(unnamed)"}
                  </button>
                  <span className="text-muted-foreground text-xs ml-2">{row.plan}</span>
                </td>
                <td className="px-3 py-2">{formatLongDate(row.proposal_date)}</td>
                <td className="px-3 py-2 text-right">{row.users_total}</td>
                <td className="px-3 py-2 text-right">₹{inr(Number(row.annual_total))}</td>
                <td className="px-3 py-2 text-right font-semibold">
                  ₹{inr(Number(row.grand_total))}
                </td>
                <td className="px-3 py-2">
                  {row.gst_enabled ? (
                    <span className="text-xs rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">
                      +GST
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">none</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Open the printable proposal"
                      onClick={() => window.open(`/print/proposal/${row.id}`, "_blank")}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Duplicate for another company"
                      disabled={busy === row.id}
                      onClick={() => create(row)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Delete"
                      disabled={busy === row.id}
                      onClick={() => remove(row)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
