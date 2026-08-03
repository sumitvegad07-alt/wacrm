"use client";

// Route Workspace (Phase 2b) — a working surface, not just an edit form. Header + tabs:
// Overview (health + stats + Next Scheduled), Customers (drag reorder + bulk actions + add),
// Planning (this route's planner slots — full grid is the Planner screen, 2c), History
// (grouped by date). Edits happen in a Sheet. UI → hooks → SDK only.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  useRoute,
  useRouteCustomers,
  useRouteHealth,
  useRouteHistory,
  usePlanner,
} from "@/hooks/route/use-routes";
import {
  useReorderCustomers,
  useRemoveCustomer,
  useImportCustomers,
  useUpdateRouteStatus,
  useCloneRoute,
} from "@/hooks/route/use-route-mutations";
import { useAccountEmployees, useRouteSettings } from "@/hooks/route/use-route-refdata";
import { ROUTE_PERMISSIONS, type RouteError, type RouteStatus } from "@/lib/route";
import { RouteStatusPill } from "./route-status-pill";
import { RouteHealthSummary } from "./route-health-summary";
import { RouteHistory } from "./route-history";
import { RouteEditSheet } from "./route-edit-sheet";
import { SortableCustomerList, type SortableCustomer } from "./sortable-customer-list";
import { CustomerImportPicker } from "./customer-import-picker";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2, Pencil, Copy, Send, CheckCircle2, XCircle, Archive, Undo2,
  Plus, Trash2, CalendarClock, Users, Route as RouteIcon,
} from "lucide-react";

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type TabKey = "overview" | "customers" | "planning" | "history";

function nextDateForDow(dow: number): Date {
  const today = new Date();
  const todayIso = ((today.getDay() + 6) % 7) + 1; // JS 0=Sun → ISO 1=Mon..7=Sun
  const delta = (dow - todayIso + 7) % 7;
  const d = new Date(today);
  d.setDate(today.getDate() + delta);
  return d;
}

export function RouteWorkspace({ routeId, readOnly = false }: { routeId: string; readOnly?: boolean }) {
  const router = useRouter();
  const { accountId, hasPermission } = useAuth();
  const [tab, setTab] = useState<TabKey>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const routeQ = useRoute(routeId);
  const customersQ = useRouteCustomers(routeId);
  const healthQ = useRouteHealth(routeId);
  const historyQ = useRouteHistory(tab === "history" ? routeId : null);
  const plannerQ = usePlanner(accountId);
  const employees = useAccountEmployees(accountId);
  const settings = useRouteSettings();

  const reorder = useReorderCustomers();
  const removeCustomer = useRemoveCustomer();
  const importCustomers = useImportCustomers(accountId);
  const setStatus = useUpdateRouteStatus(accountId);
  const clone = useCloneRoute(accountId);

  const route = routeQ.data;
  const custRows = customersQ.data ?? [];
  const approvalMode = settings.data?.approval_mode ?? "none";

  const canEdit = hasPermission(ROUTE_PERMISSIONS.EDIT);
  const canApprove = hasPermission(ROUTE_PERMISSIONS.APPROVE);
  const canArchive = hasPermission(ROUTE_PERMISSIONS.ARCHIVE);
  const canClone = hasPermission(ROUTE_PERMISSIONS.CLONE);
  const canAddCust = hasPermission(ROUTE_PERMISSIONS.ADD_CUSTOMERS);
  const canRemoveCust = hasPermission(ROUTE_PERMISSIONS.REMOVE_CUSTOMERS);
  const canReorder = hasPermission(ROUTE_PERMISSIONS.REORDER_CUSTOMERS);

  const empName = (id: string | null) => (id ? employees.data?.find((e) => e.id === id)?.full_name ?? null : null);

  const routeAssignments = useMemo(
    () => (plannerQ.data ?? []).filter((a) => a.route_id === routeId && a.is_active),
    [plannerQ.data, routeId]
  );
  const nextScheduled = useMemo(() => {
    if (routeAssignments.length === 0) return null;
    const dated = routeAssignments
      .map((a) => ({ date: nextDateForDow(a.day_of_week), a }))
      .sort((x, y) => x.date.getTime() - y.date.getTime());
    return dated[0];
  }, [routeAssignments]);

  const sortableItems: SortableCustomer[] = useMemo(
    () => custRows.map((c) => ({
      id: c.contact_id,
      primary: c.company || c.name || "Unnamed",
      secondary: c.address,
      flagged: c.needs_territory_review,
    })),
    [custRows]
  );

  if (routeQ.isLoading) {
    return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading route…</div>;
  }
  if (routeQ.isError || !route) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <RouteIcon className="mb-2 h-10 w-10 text-muted-foreground opacity-40" />
        <p className="text-base font-semibold text-foreground">Route not found</p>
        <Button variant="outline" className="mt-3" onClick={() => router.push("/routes")}>Back to routes</Button>
      </div>
    );
  }

  const isArchived = route.status === "archived";

  const doStatus = async (status: RouteStatus, reason?: string) => {
    try {
      await setStatus.mutateAsync({ routeId, status, reason });
      toast.success("Route updated");
    } catch (e) {
      toast.error((e as RouteError).message ?? "Failed");
    }
  };
  const onReject = () => {
    const reason = window.prompt("Reason for rejection (optional):") ?? undefined;
    if (reason === undefined) return; // cancelled prompt
    void doStatus("rejected", reason);
  };
  const onClone = async () => {
    try {
      const res = await clone.mutateAsync({ routeId, newName: `${route.name} (Copy)` });
      toast.success("Route cloned");
      router.push(`/routes/${res.id}`);
    } catch (e) {
      toast.error((e as RouteError).message ?? "Failed to clone");
    }
  };

  const onImportAll = async () => {
    try {
      const res = await importCustomers.mutateAsync({ routeId, mode: "all" });
      toast.success(`Imported ${res.added}${res.skipped_already_routed ? ` · ${res.skipped_already_routed} already routed` : ""}${res.skipped_ineligible ? ` · ${res.skipped_ineligible} outside territory` : ""}`);
      setAddOpen(false);
    } catch (e) { toast.error((e as RouteError).message ?? "Import failed"); }
  };
  const onImportSelected = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const res = await importCustomers.mutateAsync({ routeId, mode: "select", contactIds: ids });
      toast.success(`Imported ${res.added}${res.skipped_ineligible ? ` · ${res.skipped_ineligible} outside territory` : ""}`);
    } catch (e) { toast.error((e as RouteError).message ?? "Import failed"); }
  };
  const bulkRemove = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Remove ${ids.length} customer${ids.length === 1 ? "" : "s"} from this route?`)) return;
    try {
      for (const id of ids) await removeCustomer.mutateAsync({ routeId, contactId: id });
      toast.success(`Removed ${ids.length} customer${ids.length === 1 ? "" : "s"}`);
      setSelected(new Set());
      setSelectMode(false);
    } catch (e) { toast.error((e as RouteError).message ?? "Failed to remove"); }
  };

  const renderStatusActions = () => (
    <>
      {route?.status === "draft" && canEdit && (
        approvalMode === "none" ? (
          <Button size="sm" onClick={() => doStatus("active")}><CheckCircle2 className="h-4 w-4" /> Activate</Button>
        ) : (
          <Button size="sm" onClick={() => doStatus("pending_approval")}><Send className="h-4 w-4" /> Submit for approval</Button>
        )
      )}
      {route?.status === "pending_approval" && canApprove && (
        <>
          <Button size="sm" onClick={() => doStatus("active")}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
          <Button size="sm" variant="outline" onClick={onReject}><XCircle className="h-4 w-4" /> Reject</Button>
        </>
      )}
      {route?.status === "active" && canArchive && (
        <Button size="sm" variant="outline" onClick={() => doStatus("archived")}><Archive className="h-4 w-4" /> Archive</Button>
      )}
      {route?.status === "archived" && canArchive && (
        <Button size="sm" variant="outline" onClick={() => doStatus("active")}><Undo2 className="h-4 w-4" /> Restore</Button>
      )}
    </>
  );

  if (routeQ.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading route workspace…
      </div>
    );
  }
  if (routeQ.isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">{((routeQ as any).error as RouteError)?.message ?? "Failed to load route."}</p>
        <Button size="sm" variant="outline" onClick={() => (routeQ as any).refetch()}>Retry</Button>
      </div>
    );
  }
  if (!route) return <div className="py-12 text-sm text-muted-foreground">Not found.</div>;

  const TABS: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "customers", label: `Customers${custRows.length ? ` (${custRows.length})` : ""}` },
    { key: "planning", label: "Planning" },
    { key: "history", label: "History" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{route.name}</h1>
            <RouteStatusPill status={route.status} />
            {healthQ.data && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  healthQ.data.score >= 80 ? "bg-green-500/10 text-green-600" : healthQ.data.score >= 50 ? "bg-amber-500/10 text-amber-600" : "bg-red-500/10 text-red-600"
                )}
              >
                Health {healthQ.data.score}%
              </span>
            )}
          </div>
          {route.description && <p className="mt-1 text-sm text-muted-foreground">{route.description}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            Primary assignee: <span className="text-foreground">{empName(route.primary_assignee_id) ?? "Unassigned"}</span>
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && !isArchived && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>
            )}
            {renderStatusActions()}
            {canClone && (
              <Button size="sm" variant="ghost" onClick={onClone}><Copy className="h-4 w-4" /> Clone</Button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <RouteHealthSummary health={healthQ.data} isLoading={healthQ.isLoading} />
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">At a glance</h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Customers</dt><dd className="text-foreground">{custRows.length}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="text-foreground capitalize">{route.status.replace(/_/g, " ")}</dd></div>
              <div className="col-span-2">
                <dt className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="h-3 w-3" /> Next scheduled</dt>
                <dd className="text-foreground">
                  {nextScheduled
                    ? `${DAY_NAMES[nextScheduled.a.day_of_week]} (${empName(nextScheduled.a.assignee_id) ?? "—"}) — ${nextScheduled.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                    : "Not on the planner yet"}
                </dd>
              </div>
              <div className="col-span-2"><dt className="text-xs text-muted-foreground">Created</dt><dd className="text-foreground">{new Date(route.created_at).toLocaleDateString()}</dd></div>
            </dl>
          </div>
        </div>
      )}

      {/* Customers */}
      {tab === "customers" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {custRows.length} customer{custRows.length === 1 ? "" : "s"}. Visited top to bottom.
            </p>
            {!isArchived && !readOnly && (
              <div className="flex items-center gap-2">
                {canRemoveCust && custRows.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => { setSelectMode((s) => !s); setSelected(new Set()); }}>
                    {selectMode ? "Done" : "Select"}
                  </Button>
                )}
                {selectMode && selected.size > 0 && (
                  <Button size="sm" variant="outline" className="text-red-600" onClick={bulkRemove}>
                    <Trash2 className="h-4 w-4" /> Remove {selected.size}
                  </Button>
                )}
                {canAddCust && (
                  <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add customers</Button>
                )}
              </div>
            )}
          </div>

          {customersQ.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : custRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
              <Users className="mb-2 h-8 w-8 text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">No customers on this route yet.</p>
              {canAddCust && !isArchived && !readOnly && (
                <Button size="sm" className="mt-3" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add customers</Button>
              )}
            </div>
          ) : (
            <SortableCustomerList
              items={sortableItems}
              disabled={isArchived || readOnly || !canReorder}
              onReorder={(ids) => reorder.mutate({ routeId, orderedContactIds: ids })}
              onRemove={!isArchived && !readOnly && canRemoveCust && !selectMode ? (id) => removeCustomer.mutate({ routeId, contactId: id }) : undefined}
              selectable={selectMode}
              selectedIds={selected}
              onToggleSelect={(id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            />
          )}
        </div>
      )}

      {/* Planning */}
      {tab === "planning" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Weekday assignments for this route.</p>
            {!readOnly && (
              <Button size="sm" variant="outline" onClick={() => router.push("/routes/planner")}>Open Planner</Button>
            )}
          </div>
          {plannerQ.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : routeAssignments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              {route.status === "active"
                ? "Not scheduled yet. Assign it to a weekday in the Planner."
                : "Only active routes can be scheduled."}
            </div>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-border">
              {routeAssignments
                .slice()
                .sort((a, b) => a.day_of_week - b.day_of_week)
                .map((a) => (
                  <li key={a.id} className="flex items-center justify-between border-b border-border bg-card px-4 py-3 last:border-b-0">
                    <span className="text-sm font-medium text-foreground">{DAY_NAMES[a.day_of_week]}</span>
                    <span className="text-sm text-muted-foreground">{empName(a.assignee_id) ?? "—"}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {/* History */}
      {tab === "history" && <RouteHistory entries={historyQ.data} isLoading={historyQ.isLoading} />}

      {/* Edit Sheet */}
      <RouteEditSheet route={route} accountId={accountId} open={editOpen} onOpenChange={setEditOpen} />

      {/* Add customers Sheet */}
      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>Add customers</SheetTitle></SheetHeader>
          <div className="px-4">
            <CustomerImportPicker
              accountId={accountId}
              importing={importCustomers.isPending}
              onImportAll={onImportAll}
              onImportSelected={onImportSelected}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
