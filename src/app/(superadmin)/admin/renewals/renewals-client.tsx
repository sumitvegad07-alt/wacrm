"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Phone, Plus, RefreshCw } from "lucide-react";
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
import { DataTable } from "@/components/ui/data-table/data-table";
import type { ColumnDef } from "@/components/ui/data-table/data-table-types";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { useTableView } from "@/hooks/use-table-view";
import { matchesColumnFilters } from "@/lib/table/match-filters";
import { formatCurrency } from "@/lib/currency";
import { BILLING_TERMS, TERM_LABEL } from "@/lib/plans/pricing";
import { daysUntil, type BucketFigure } from "@/lib/renewals/buckets";
import {
  BUCKET_LABEL,
  BUCKETS,
  RENEWAL_STATUSES,
  RENEWAL_STATUS_LABEL,
  type RenewalBucket,
  type RenewalStatus,
  type SubscriptionRow,
} from "@/lib/renewals/types";
import { RenewDialog } from "./renew-dialog";
import { SubscriptionForm } from "./subscription-form";

// ============================================================
// The screen the founder opens every morning.
//
// It lands on Due Today, because that is the job. Every date shown is counted
// from the IST date the SERVER returned — never from the browser's clock, which
// is the bug the attendance tabs still carry.
// ============================================================

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

const STATUS_TONE: Record<RenewalStatus, string> = {
  active: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  renewed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  in_discussion: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  lost: "bg-red-500/10 text-red-600 dark:text-red-400",
  on_hold: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: RenewalStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${STATUS_TONE[status] ?? STATUS_TONE.on_hold}`}
    >
      {RENEWAL_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function DaysLeftBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted-foreground">—</span>;

  const tone =
    days < 0
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : days === 0
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : days <= 7
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground";

  const label =
    days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`;

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

/** A WhatsApp-ready number: digits only, with 91 added to a bare 10-digit one. */
function waNumber(phone: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export default function RenewalsClient() {
  const [bucket, setBucket] = useState<RenewalBucket>("today");
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [summary, setSummary] = useState<Record<RenewalBucket, BucketFigure> | null>(null);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionRow | null>(null);
  const [renewTarget, setRenewTarget] = useState<SubscriptionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const tableView = useTableView("platform-subscriptions-table", {});
  const { filterState } = tableView;

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/renewals?bucket=${bucket}`);
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (String(payload?.error ?? "").includes("platform_subscriptions")) {
        setMigrationMissing(true);
      } else {
        toast.error(payload?.error ?? "Could not load the renewal register");
      }
      setLoading(false);
      return;
    }

    setRows((payload?.subscriptions ?? []) as SubscriptionRow[]);
    setSummary(payload?.summary ?? null);
    // The server's IST date. Everything on screen counts from this.
    setToday(payload?.today ?? "");
    setLoading(false);
  }, [bucket]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/renewals/${deleteTarget.id}`, { method: "DELETE" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not delete the subscription");

      toast.success("Subscription deleted");
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the subscription");
    } finally {
      setDeleting(false);
    }
  }

  const columns = useMemo<ColumnDef<SubscriptionRow>[]>(
    () => [
      {
        id: "actions",
        label: "Action",
        type: "text",
        render: (row) => (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              title="Renew"
              onClick={(e) => {
                e.stopPropagation();
                setRenewTarget(row);
              }}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <RowActions
              onEdit={() => {
                setEditing(row);
                setFormOpen(true);
              }}
              onDelete={() => setDeleteTarget(row)}
              editTitle="Edit subscription"
              deleteTitle="Delete subscription"
            />
          </div>
        ),
      },
      { id: "customer_id", label: "Customer ID", type: "text", sortable: true },
      {
        id: "company_name",
        label: "Company",
        type: "text",
        sortable: true,
        render: (r) => <span className="font-medium">{r.company_name}</span>,
      },
      { id: "plan", label: "Plan", type: "text", sortable: true },
      {
        id: "billing_term",
        label: "Term",
        type: "select",
        options: BILLING_TERMS.map((t) => ({ label: TERM_LABEL[t], value: t })),
        render: (r) => (r.billing_term ? TERM_LABEL[r.billing_term] : "—"),
      },
      { id: "users", label: "Users", type: "range", sortable: true },
      {
        id: "amount",
        label: "Amount",
        type: "range",
        sortable: true,
        render: (r) => formatCurrency(r.amount),
      },
      {
        id: "start_date",
        label: "Start",
        type: "date",
        sortable: true,
        render: (r) => fmt(r.start_date),
      },
      {
        id: "end_date",
        label: "End",
        type: "date",
        sortable: true,
        render: (r) => fmt(r.end_date),
      },
      {
        id: "days_left",
        label: "Days Left",
        type: "range",
        sortable: true,
        filterValue: (r) => daysUntil(r.end_date, today) ?? 0,
        render: (r) => <DaysLeftBadge days={daysUntil(r.end_date, today)} />,
      },
      { id: "salesman_name", label: "Salesman", type: "text", sortable: true },
      { id: "contact_person", label: "Contact Person", type: "text" },
      {
        id: "phone",
        label: "Phone",
        type: "text",
        render: (r) => {
          const wa = waNumber(r.phone);
          if (!r.phone) return "—";
          return (
            <div className="flex items-center gap-1">
              <span>{r.phone}</span>
              {wa ? (
                <>
                  <a
                    href={`https://wa.me/${wa}`}
                    target="_blank"
                    rel="noreferrer"
                    title="WhatsApp"
                    onClick={(e) => e.stopPropagation()}
                    className="text-emerald-600 dark:text-emerald-400"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </a>
                  <a
                    href={`tel:${r.phone}`}
                    title="Call"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                </>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "status",
        label: "Status",
        type: "select",
        options: RENEWAL_STATUSES.map((s) => ({
          label: RENEWAL_STATUS_LABEL[s],
          value: s,
        })),
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        id: "follow_up_date",
        label: "Follow Up",
        type: "date",
        sortable: true,
        render: (r) => fmt(r.follow_up_date),
      },
      {
        id: "remarks",
        label: "Remarks",
        type: "text",
        render: (r) => <span className="line-clamp-2">{r.remarks || "—"}</span>,
      },
    ],
    [today],
  );

  const filtered = useMemo(
    () => rows.filter((row) => matchesColumnFilters(row, filterState, columns)),
    [rows, filterState, columns],
  );

  if (migrationMissing) {
    return (
      <div className="max-w-xl bg-card border border-border rounded-xl p-6 space-y-2">
        <h1 className="text-lg font-semibold">Renewals</h1>
        <p className="text-sm text-muted-foreground">
          The renewals migration has not been applied to the database yet. Run{" "}
          <code className="text-xs">
            supabase/migrations/20261020130000_platform_subscriptions.sql
          </code>{" "}
          and reload this page.
        </p>
      </div>
    );
  }

  const tiles: Array<{ bucket: RenewalBucket; label: string; tone: string }> = [
    { bucket: "today", label: "Due Today", tone: "text-amber-600 dark:text-amber-400" },
    { bucket: "overdue", label: "Overdue", tone: "text-red-600 dark:text-red-400" },
    { bucket: "next_7", label: "Next 7 Days", tone: "" },
    { bucket: "next_30", label: "Next 30 Days", tone: "" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Renewals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {today ? `Today is ${fmt(today)}.` : ""} Who needs renewing, and when.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Subscription
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => {
          const figure = summary?.[tile.bucket] ?? { count: 0, amount: 0 };
          const active = bucket === tile.bucket;
          return (
            <button
              key={tile.bucket}
              onClick={() => setBucket(tile.bucket)}
              className={`text-left bg-card border rounded-xl p-4 transition-colors hover:border-primary/50 ${
                active ? "border-primary" : "border-border"
              }`}
            >
              <p className="text-sm text-muted-foreground">{tile.label}</p>
              <p className={`text-2xl font-bold mt-1 ${tile.tone}`}>{figure.count}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(figure.amount)}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {BUCKETS.map((b) => (
          <button
            key={b}
            onClick={() => setBucket(b)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              bucket === b
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {BUCKET_LABEL[b]}
            {summary ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {summary[b].count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <DataTable
          columns={columns}
          data={filtered}
          isLoading={loading}
          emptyMessage={
            bucket === "today"
              ? "Nobody is due today."
              : bucket === "overdue"
                ? "Nothing is overdue."
                : bucket === "all"
                  ? "No subscriptions yet. Add your first with Add Subscription."
                  : "Nothing due in this window."
          }
          tableView={tableView}
          rowKey={(row) => row.id}
        />
      </div>

      <SubscriptionForm
        open={formOpen}
        subscription={editing}
        onOpenChange={setFormOpen}
        onSaved={load}
      />

      <RenewDialog
        open={renewTarget !== null}
        subscription={renewTarget}
        onOpenChange={(open) => {
          if (!open) setRenewTarget(null);
        }}
        onRenewed={load}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.company_name}?</DialogTitle>
            <DialogDescription>
              Every past period saved for this customer goes with it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={remove} disabled={deleting}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
