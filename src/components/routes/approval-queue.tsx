"use client";

// Approval Queue (Phase 2e) — the manager's inbox for routes awaiting approval.
// Supports status filtering (Pending/Approved/Rejected/All), rich enterprise table
// (creator, assignee, schedule, health, customer count), bulk approve/reject action bar,
// slide-over preview sheet, and optimistic concurrency error handling.

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useApprovalQueue } from "@/hooks/route/use-routes";
import { useUpdateRouteStatus, useBulkUpdateRouteStatus } from "@/hooks/route/use-route-mutations";
import { ROUTE_PERMISSIONS, type RouteError, type RouteStatus, type RouteApprovalRow } from "@/lib/route";
import { ApprovalPreviewSheet } from "./approval-preview-sheet";
import { RouteStatusPill } from "./route-status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Search, Loader2, CheckCircle2, XCircle, Inbox, AlertCircle, ChevronLeft, ChevronRight,
  Check, Eye, Calendar, UserCheck, ShieldAlert,
} from "lucide-react";

const PAGE = 25;
const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type StatusTab = "pending_approval" | "active" | "rejected" | "all";

const STATUS_TABS: { id: StatusTab; label: string; statuses?: RouteStatus[] }[] = [
  { id: "pending_approval", label: "Pending Approval", statuses: ["pending_approval"] },
  { id: "active", label: "Approved", statuses: ["active"] },
  { id: "rejected", label: "Rejected", statuses: ["rejected"] },
  { id: "all", label: "All Routes", statuses: ["pending_approval", "active", "rejected", "draft", "archived"] },
];

export function ApprovalQueue() {
  const { accountId, hasPermission } = useAuth();
  const canViewApprovals = hasPermission(ROUTE_PERMISSIONS.VIEW_APPROVALS) || hasPermission(ROUTE_PERMISSIONS.VIEW);
  const canApprove = hasPermission(ROUTE_PERMISSIONS.APPROVE);

  const [statusTab, setStatusTab] = useState<StatusTab>("pending_approval");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [search, statusTab]);

  const activeTabObj = STATUS_TABS.find((t) => t.id === statusTab) ?? STATUS_TABS[0];
  const q = useApprovalQueue(
    accountId ? {
      accountId,
      statuses: activeTabObj.statuses,
      search,
      limit: PAGE,
      offset: page * PAGE,
    } : null
  );

  const setStatus = useUpdateRouteStatus(accountId);
  const bulkMutation = useBulkUpdateRouteStatus(accountId);

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allOnPageSelected) rows.forEach((r) => n.delete(r.id));
      else rows.forEach((r) => n.add(r.id));
      return n;
    });

  const inlineAction = async (routeId: string, newStatus: RouteStatus) => {
    let reason: string | undefined;
    if (newStatus === "rejected") {
      reason = window.prompt("Reason for rejection (optional):") ?? undefined;
      if (reason === undefined) return;
    }
    try {
      await setStatus.mutateAsync({ routeId, status: newStatus, reason });
      toast.success(newStatus === "active" ? "Route approved" : "Route rejected");
    } catch (e) {
      toast.error((e as RouteError).message ?? "Action failed");
    }
  };

  const bulkAction = async (newStatus: "active" | "rejected") => {
    const ids = [...selected];
    if (ids.length === 0) return;
    let reason: string | undefined;
    if (newStatus === "rejected") {
      reason = window.prompt("Reason for rejecting selected routes (optional):") ?? undefined;
      if (reason === undefined) return;
    } else {
      reason = "Bulk approved";
    }
    setBulkBusy(true);
    try {
      const res = await bulkMutation.mutateAsync({
        routeIds: ids,
        status: newStatus,
        reason,
      });
      const conflictErrors = res.errors.filter((e) => e.code === "40001" || e.error.toLowerCase().includes("concurrency") || e.error.toLowerCase().includes("version"));
      if (conflictErrors.length > 0) {
        toast.error(`${conflictErrors.length} route(s) were modified by another user and could not be updated.`);
      }
      const otherErrors = res.errors.filter((e) => !conflictErrors.includes(e));
      if (otherErrors.length > 0) {
        toast.error(`${otherErrors.length} route(s) failed to update.`);
      }
      if (res.ok_ids.length > 0) {
        toast.success(`${newStatus === "active" ? "Approved" : "Rejected"} ${res.ok_ids.length} route${res.ok_ids.length === 1 ? "" : "s"}.`);
      }
      setSelected(new Set());
    } catch (e) {
      toast.error((e as RouteError).message ?? "Bulk action failed");
    } finally {
      setBulkBusy(false);
    }
  };

  if (!canViewApprovals) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
        <ShieldAlert className="mb-2 h-8 w-8 text-muted-foreground opacity-40" />
        <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">You do not have permission to view route approvals.</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Manager Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review, inspect, and approve field sales routes across your organization.
          </p>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusTab(tab.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                statusTab === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.id === "pending_approval" && statusTab === "pending_approval" && total > 0 && (
                <span className="ml-1.5 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-xs font-semibold">
                  {total}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search routes by name…"
            className="pl-9"
          />
        </div>
      </div>

      {/* Enterprise Queue Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                {canApprove && (
                  <th className="w-10 px-4 py-3">
                    <button
                      type="button"
                      onClick={toggleAll}
                      aria-label="Select all"
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        allOnPageSelected ? "border-primary bg-primary text-primary-foreground" : "border-input"
                      )}
                    >
                      {allOnPageSelected && <Check className="h-3 w-3" />}
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Creator</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">Schedule</th>
                <th className="px-4 py-3 font-medium text-center">Health</th>
                <th className="px-4 py-3 font-medium text-right">Customers</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="w-36 px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: canApprove ? 9 : 8 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-20 rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : q.isError ? (
                <tr>
                  <td colSpan={canApprove ? 9 : 8} className="px-4 py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                      <AlertCircle className="h-8 w-8 text-red-500" />
                      <p className="text-sm text-muted-foreground">
                        {(q.error as RouteError)?.message ?? "Failed to load approval queue."}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={canApprove ? 9 : 8} className="px-4 py-16 text-center">
                    {statusTab === "pending_approval" && !search ? (
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-600">
                          <CheckCircle2 className="h-6 w-6" />
                        </div>
                        <p className="text-lg font-semibold text-foreground">Inbox Zero</p>
                        <p className="text-sm text-muted-foreground">
                          All pending route approvals have been processed. Great job!
                        </p>
                      </div>
                    ) : (
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                        <Inbox className="h-8 w-8 text-muted-foreground opacity-40" />
                        <p className="text-base font-semibold text-foreground">No matching routes</p>
                        <p className="text-sm text-muted-foreground">
                          {search ? "No routes match your search query." : "No routes found for this status filter."}
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r: RouteApprovalRow) => {
                  const isPending = r.status === "pending_approval";
                  const score = r.health_score;
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-muted/40">
                      {canApprove && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggle(r.id)}
                            aria-label="Select"
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded border",
                              selected.has(r.id)
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input"
                            )}
                          >
                            {selected.has(r.id) && <Check className="h-3 w-3" />}
                          </button>
                        </td>
                      )}
                      <td
                        className="cursor-pointer px-4 py-3 font-medium text-foreground"
                        onClick={() => setPreviewId(r.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span>{r.name}</span>
                          {statusTab === "all" && <RouteStatusPill status={r.status} />}
                        </div>
                        {r.description && (
                          <p className="max-w-xs truncate text-xs text-muted-foreground">{r.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.created_by_name ?? <span className="italic opacity-60">—</span>}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {r.primary_assignee_name ? (
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                            {r.primary_assignee_name}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.next_scheduled_day ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                            <Calendar className="h-3 w-3" />
                            {DAY_NAMES[r.next_scheduled_day] ?? `Day ${r.next_scheduled_day}`}
                          </span>
                        ) : (
                          <span className="italic text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {score != null ? (
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-xs font-semibold",
                              score >= 80
                                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                : score >= 50
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "bg-red-500/10 text-red-600 dark:text-red-400"
                            )}
                          >
                            {score}%
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground font-medium">
                        {r.customer_count}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {new Date(r.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5"
                            onClick={() => setPreviewId(r.id)}
                            title="Preview route details"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                          </Button>
                          {isPending && canApprove && (
                            <>
                              <Button
                                size="sm"
                                className="h-8 bg-green-600 px-2.5 text-white hover:bg-green-700"
                                onClick={() => inlineAction(r.id, "active")}
                                disabled={setStatus.isPending}
                                title="Approve route"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
                                onClick={() => inlineAction(r.id, "rejected")}
                                disabled={setStatus.isPending}
                                title="Reject route"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {!q.isLoading && !q.isError && total > PAGE && (
          <div className="flex items-center justify-between border-t border-border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
              {q.isFetching && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * PAGE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Action Sticky Bar */}
      {canApprove && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full border border-border bg-foreground px-6 py-3 text-background shadow-2xl">
          <span className="text-sm font-semibold">
            {selected.size} route{selected.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-transparent bg-red-600/90 text-white hover:bg-red-700"
              onClick={() => bulkAction("rejected")}
              disabled={bulkBusy}
            >
              <XCircle className="h-4 w-4 mr-1.5" /> Reject Selected
            </Button>
            <Button
              size="sm"
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={() => bulkAction("active")}
              disabled={bulkBusy}
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
              Approve Selected
            </Button>
          </div>
        </div>
      )}

      {/* Preview Sheet */}
      <ApprovalPreviewSheet
        routeId={previewId}
        accountId={accountId}
        open={!!previewId}
        onClose={() => setPreviewId(null)}
      />
    </div>
  );
}
