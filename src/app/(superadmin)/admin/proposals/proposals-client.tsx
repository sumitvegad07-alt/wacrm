"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatLongDate, inr } from "@/lib/proposals/format";
import { listTemplates } from "@/lib/proposals/registry";
import { featuresForPlan } from "@/lib/proposals/plan-features";
import { STATUS_CLASS, STATUS_LABEL, type ProposalStatus } from "@/lib/proposals/status";
import type { ProposalListRow } from "@/lib/proposals/types";

export default function ProposalsClient() {
  const router = useRouter();
  const [rows, setRows] = useState<ProposalListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/admin/proposals");
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      // A missing status column means migration 20260926170000 has not been
      // applied yet. Say so plainly rather than showing a raw Postgres error.
      const raw = String(payload.error ?? "");
      setErr(
        /status|sent_at|decided_at/.test(raw) && /does not exist|column/i.test(raw)
          ? "The proposals table is missing the status columns — apply migration 20260926170000_platform_proposals_status.sql in Supabase, then reload."
          : raw || "Could not load proposals",
      );
    }
    setRows(payload.proposals ?? []);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  const create = async (plan: string, source?: ProposalListRow) => {
    setBusy(source ? source.id : "new");
    setErr(null);

    // Duplicating sends the stored payload back; the server always assigns a
    // fresh reference and today's date, so a clone can never go out carrying
    // the original's number.
    let body: Record<string, unknown> = { plan };
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
    router.push(`/admin/proposals/${payload.id}/edit`);
  };

  const setStatus = async (row: ProposalListRow, status: ProposalStatus) => {
    setBusy(row.id);
    const res = await fetch(`/api/admin/proposals/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setErr(payload.error || "Could not update the status");
      return;
    }
    await load();
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

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/admin/forecast")}>
            <BarChart3 className="h-4 w-4 mr-1" />
            Forecast
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              className={buttonVariants()}
              disabled={busy === "new"}
            >
              <Plus className="h-4 w-4 mr-1" />
              {busy === "new" ? "Creating…" : "New proposal"}
            </DropdownMenuTrigger>
            {/* Fixed width and nowrap: at the menu's natural width "CRM + WFA"
                wrapped onto three lines and the price was cut off. */}
            <DropdownMenuContent align="end" className="w-[330px] p-1.5">
              <div className="px-2.5 pt-1.5 pb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Start a proposal for
              </div>
              {listTemplates().map((t) => (
                <DropdownMenuItem
                  key={t.plan}
                  onClick={() => create(t.plan)}
                  className="flex items-center gap-3 rounded-md px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium whitespace-nowrap">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {t.content.eyebrow.replace(" · Proposal", "")} ·{" "}
                      {featuresForPlan(t.plan).length} features
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums whitespace-nowrap">
                      ₹{inr(t.listRatePerYear)}
                    </div>
                    <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                      per user / year
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium text-right">Users</th>
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
                  No proposals yet. Pick a plan under New proposal, or duplicate an old one once it
                  is here.
                </td>
              </tr>
            )}

            {rows.map((row) => {
              const status = (row.status ?? "draft") as ProposalStatus;
              const decided = status === "won" || status === "lost";

              return (
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
                  <td className="px-3 py-2">
                    <span className={`text-xs rounded px-2 py-0.5 ${STATUS_CLASS[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">{formatLongDate(row.proposal_date)}</td>
                  <td className="px-3 py-2 text-right">{row.users_total}</td>
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
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        title={decided ? "Already decided — reopen from the detail page" : "Mark won"}
                        disabled={busy === row.id || decided}
                        onClick={() => setStatus(row, "won")}
                      >
                        <ThumbsUp
                          className={`h-4 w-4 ${status === "won" ? "text-emerald-600" : ""}`}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={decided ? "Already decided — reopen from the detail page" : "Mark lost"}
                        disabled={busy === row.id || decided}
                        onClick={() => setStatus(row, "lost")}
                      >
                        <ThumbsDown
                          className={`h-4 w-4 ${status === "lost" ? "text-red-600" : ""}`}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit"
                        onClick={() => router.push(`/admin/proposals/${row.id}/edit`)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
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
                        onClick={() => create(row.plan, row)}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
