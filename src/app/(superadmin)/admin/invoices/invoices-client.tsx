"use client";

import { useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/shared";
import { DataTable } from "@/components/ui/data-table/data-table";
import type { ColumnDef } from "@/components/ui/data-table/data-table-types";
import { useTableView } from "@/hooks/use-table-view";
import { matchesColumnFilters } from "@/lib/table/match-filters";
import { formatCurrency } from "@/lib/currency";
import { PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import { TERM_LABEL } from "@/lib/plans/pricing";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABEL,
  SERIES_LABEL,
  type InvoiceRow,
} from "@/lib/invoices/types";
import { StatusBadge } from "./status-badge";

// ============================================================
// OZZO's invoice history.
//
// The totals tiles follow the FILTERED rows, not the whole table: the question
// they answer is "what is outstanding in what I am looking at", and a figure
// that ignores the filter above it is worse than no figure.
// ============================================================

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  // Split rather than parse: a date-only column read through `new Date()` is a
  // UTC midnight, which prints as the previous day anywhere behind UTC.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return format(new Date(y, m - 1, d), "dd MMM yyyy");
}

export default function InvoicesClient() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);

  const tableView = useTableView("platform-invoices-table", {});
  const { filterState } = tableView;

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/admin/invoices");
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (String(payload?.error ?? "").includes("platform_invoices")) {
          setMigrationMissing(true);
        } else {
          toast.error(payload?.error ?? "Could not load invoices");
        }
        setLoading(false);
        return;
      }

      setInvoices((payload?.invoices ?? []) as InvoiceRow[]);
      setLoading(false);
    }
    load();
  }, []);

  // One entry per financial year present, newest first — the list grows by one
  // every April, so it cannot be a fixed array.
  const fyOptions = useMemo(
    () =>
      Array.from(new Set(invoices.map((i) => i.fy)))
        .sort()
        .reverse()
        .map((fy) => ({ label: `FY ${fy}`, value: fy })),
    [invoices],
  );

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(
    () => [
      {
        id: "invoice_no",
        label: "Invoice No",
        type: "text",
        sortable: true,
        render: (r) => <span className="font-medium">{r.invoice_no}</span>,
      },
      {
        id: "invoice_date",
        label: "Date",
        type: "date",
        sortable: true,
        render: (r) => fmtDate(r.invoice_date),
      },
      {
        id: "series",
        label: "Type",
        type: "select",
        options: [
          { label: "GST", value: "gst" },
          { label: "Non-GST", value: "non_gst" },
        ],
        render: (r) => SERIES_LABEL[r.series] ?? r.series,
      },
      { id: "client_name", label: "Customer", type: "text", sortable: true },
      { id: "customer_id", label: "Customer ID", type: "text" },
      {
        id: "plan",
        label: "Plan",
        type: "text",
        render: (r) => PLAN_LABEL[r.plan as PlanId] ?? r.plan ?? "—",
      },
      {
        id: "billing_term",
        label: "Term",
        type: "select",
        options: (["quarterly", "half_yearly", "yearly"] as const).map((t) => ({
          label: TERM_LABEL[t],
          value: t,
        })),
        render: (r) => TERM_LABEL[r.billing_term] ?? r.billing_term,
        visibleByDefault: false,
      },
      {
        id: "period",
        label: "Period",
        type: "text",
        sortable: false,
        filterValue: (r) => `${r.period_start ?? ""} ${r.period_end ?? ""}`,
        render: (r) =>
          r.period_start && r.period_end
            ? `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}`
            : "—",
      },
      { id: "users_billed", label: "Users", type: "range", sortable: true },
      {
        id: "taxable_value",
        label: "Taxable",
        type: "range",
        sortable: true,
        render: (r) => formatCurrency(r.taxable_value),
      },
      {
        id: "tax",
        label: "Tax",
        type: "range",
        sortable: true,
        filterValue: (r) => r.cgst_amount + r.sgst_amount + r.igst_amount,
        render: (r) => formatCurrency(r.cgst_amount + r.sgst_amount + r.igst_amount),
      },
      {
        id: "total",
        label: "Total",
        type: "range",
        sortable: true,
        render: (r) => <span className="font-semibold">{formatCurrency(r.total)}</span>,
      },
      {
        id: "amount_received",
        label: "Received",
        type: "range",
        sortable: true,
        render: (r) => formatCurrency(r.amount_received),
      },
      {
        id: "balance",
        label: "Balance",
        type: "range",
        sortable: true,
        filterValue: (r) => r.total - r.amount_received,
        render: (r) => {
          const balance = r.total - r.amount_received;
          return (
            <span className={balance > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
              {formatCurrency(balance)}
            </span>
          );
        },
      },
      {
        id: "status",
        label: "Status",
        type: "select",
        options: INVOICE_STATUSES.map((s) => ({
          label: INVOICE_STATUS_LABEL[s],
          value: s,
        })),
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        id: "fy",
        label: "FY",
        type: "select",
        options: fyOptions,
        visibleByDefault: false,
      },
    ],
    [fyOptions],
  );

  const filtered = useMemo(
    () => invoices.filter((row) => matchesColumnFilters(row, filterState, columns)),
    [invoices, filterState, columns],
  );

  // Cancelled invoices keep their number but are not money owed or earned, so
  // they are excluded from the tiles while staying visible in the table.
  const live = filtered.filter((i) => i.status !== "cancelled" && i.status !== "draft");
  const totals = {
    total: live.reduce((s, i) => s + i.total, 0),
    received: live.reduce((s, i) => s + i.amount_received, 0),
    balance: live.reduce((s, i) => s + (i.total - i.amount_received), 0),
  };

  if (migrationMissing) {
    return (
      <div className="max-w-xl bg-card border border-border rounded-xl p-6 space-y-2">
        <h1 className="text-lg font-semibold">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          The invoices migration has not been applied to the database yet. Run{" "}
          <code className="text-xs">
            supabase/migrations/20261020120000_platform_invoices.sql
          </code>{" "}
          and reload this page.
        </p>
      </div>
    );
  }

  return (
    <PageLayout fill>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            OZZO&apos;s own subscription invoices, GST and non-GST.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/admin/invoice-settings")}>
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button onClick={() => router.push("/admin/invoices/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Invoiced", value: totals.total, tone: "" },
          { label: "Received", value: totals.received, tone: "text-emerald-600 dark:text-emerald-400" },
          { label: "Outstanding", value: totals.balance, tone: "text-amber-600 dark:text-amber-400" },
        ].map((tile) => (
          <div key={tile.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <p className={`text-2xl font-bold mt-1 ${tile.tone}`}>
              {formatCurrency(tile.value)}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground -mt-4">
        Issued invoices only, across the rows shown. Drafts and cancelled invoices are listed but
        not counted.
      </p>

      <DataTable
        fill
          columns={columns}
          data={filtered}
          isLoading={loading}
          emptyMessage="No invoices yet. Raise the first one with New Invoice."
          tableView={tableView}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/admin/invoices/${row.id}`)}
      />
    </PageLayout>
  );
}
