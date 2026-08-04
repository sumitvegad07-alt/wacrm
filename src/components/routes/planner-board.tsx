"use client";

// Weekly Route Planner (Phase 2c). Salesman rows × Mon–Sun; enterprise scale via paginated
// salesman rows + assignments fetched only for the visible page. RPC-driven (assign/move/clear
// via existing planner RPCs); move is atomic (single RPC). UI → hooks → SDK; no business logic
// here. Future-proof: nothing here blocks Route Templates, Temporary Assignment (date-bounded
// rows already supported by the schema), Business Calendar, or multiple schedules.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { usePlannerAssignments } from "@/hooks/route/use-routes";
import { useRoutes } from "@/hooks/route/use-routes";
import { useAccountEmployees, useAccountEmployeesPaged } from "@/hooks/route/use-route-refdata";
import { usePlannerSet, usePlannerClear, usePlannerMove } from "@/hooks/route/use-route-mutations";
import { routeKeys } from "@/hooks/route/query-keys";
import { ROUTE_PERMISSIONS, type RouteError, type RoutePlanAssignmentWithRoute, type IsoDayOfWeek } from "@/lib/route";
import { plannerCellKey, applyOptimisticMove } from "@/lib/route/planner-ops";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub,
  DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Search, X, Plus, MoreVertical, ChevronLeft, ChevronRight, CalendarRange, Copy, Loader2, GripVertical,
} from "lucide-react";

const DAYS: { dow: IsoDayOfWeek; short: string; long: string }[] = [
  { dow: 1, short: "Mon", long: "Monday" },
  { dow: 2, short: "Tue", long: "Tuesday" },
  { dow: 3, short: "Wed", long: "Wednesday" },
  { dow: 4, short: "Thu", long: "Thursday" },
  { dow: 5, short: "Fri", long: "Friday" },
  { dow: 6, short: "Sat", long: "Saturday" },
  { dow: 7, short: "Sun", long: "Sunday" },
];
const PAGE = 20;
const cellId = plannerCellKey;

type Assignment = RoutePlanAssignmentWithRoute;

// ── chip (draggable) ──────────────────────────────────────────
function Chip({
  a, canEdit, onClear, onCopyToDay, onOpen,
}: {
  a: Assignment;
  canEdit: boolean;
  onClear: () => void;
  onCopyToDay: (dow: IsoDayOfWeek) => void;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `chip:${a.id}`,
    data: { assigneeId: a.assignee_id, dow: a.day_of_week, routeId: a.route_id },
    disabled: !canEdit,
  });
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined}
      className={cn(
        "group flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-300 shadow-sm transition-colors hover:bg-emerald-500/20",
        isDragging && "opacity-70 shadow-lg"
      )}
    >
      {canEdit && (
        <button {...attributes} {...listeners} className="cursor-grab touch-none text-emerald-400/80 hover:text-emerald-300 active:cursor-grabbing" aria-label="Drag route">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      <button onClick={onOpen} className="min-w-0 flex-1 truncate text-left font-semibold text-emerald-200 hover:underline" title={a.route_name ?? ""}>
        {a.route_name ?? "Route"}
      </button>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger className="shrink-0 text-emerald-400/70 hover:text-emerald-200" aria-label="Route actions">
            <MoreVertical className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onOpen}>View Route Details</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Copy to Day...</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {DAYS.filter((d) => d.dow !== a.day_of_week).map((d) => (
                  <DropdownMenuItem key={d.dow} onClick={() => onCopyToDay(d.dow)}>{d.long}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => toast.info("Recurrence settings can be managed in Route details")}>Set Recurrence...</DropdownMenuItem>
            <DropdownMenuItem onClick={onClear} className="text-red-500 focus:text-red-500">Remove Assignment</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ── droppable cell ────────────────────────────────────────────
function Cell({
  assigneeId, dow, assignment, canEdit, onAssign, onClear, onCopyToDay, onOpen,
}: {
  assigneeId: string;
  dow: IsoDayOfWeek;
  assignment?: Assignment;
  canEdit: boolean;
  onAssign: () => void;
  onClear: () => void;
  onCopyToDay: (dow: IsoDayOfWeek) => void;
  onOpen: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId(assigneeId, dow), data: { assigneeId, dow } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[52px] rounded-lg border border-dashed border-border/60 p-1",
        isOver && "border-primary bg-primary/5"
      )}
    >
      {assignment ? (
        <Chip a={assignment} canEdit={canEdit} onClear={onClear} onCopyToDay={onCopyToDay} onOpen={onOpen} />
      ) : canEdit ? (
        <button
          onClick={onAssign}
          className="flex h-full min-h-[44px] w-full items-center justify-center rounded-md text-muted-foreground/50 hover:bg-muted hover:text-foreground"
          aria-label="Assign route"
        >
          <Plus className="h-4 w-4" />
        </button>
      ) : (
        <div className="flex h-full min-h-[44px] items-center justify-center text-xs text-muted-foreground/40">Off</div>
      )}
    </div>
  );
}

export function PlannerBoard({ initialAssigneeId }: { initialAssigneeId?: string } = {}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { accountId, hasPermission } = useAuth();
  const canEdit =
    hasPermission(ROUTE_PERMISSIONS.ASSIGN) || hasPermission(ROUTE_PERMISSIONS.MANAGE_SCHEDULE);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [assignTarget, setAssignTarget] = useState<{ assigneeId: string; dow: IsoDayOfWeek } | null>(null);
  const [copyWeekOpen, setCopyWeekOpen] = useState(false);

  const allEmps = useAccountEmployees(accountId);
  const emps = useAccountEmployeesPaged({ accountId, search, limit: PAGE, offset: page * PAGE });
  const rows = useMemo(() => {
    if (initialAssigneeId && allEmps.data) {
      const found = allEmps.data.find((e) => e.id === initialAssigneeId);
      if (found) return [found];
    }
    return emps.data?.rows ?? [];
  }, [initialAssigneeId, allEmps.data, emps.data?.rows]);
  const total = initialAssigneeId ? rows.length : (emps.data?.total ?? 0);
  const assigneeIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const sig = assigneeIds.slice().sort().join(",");
  const boardKey = routeKeys.planner(accountId ?? "none", sig || "none");

  const assignmentsQ = usePlannerAssignments(accountId, assigneeIds);
  const byCell = useMemo(() => {
    const m = new Map<string, Assignment>();
    (assignmentsQ.data ?? []).forEach((a) => { if (a.is_active) m.set(cellId(a.assignee_id, a.day_of_week), a); });
    return m;
  }, [assignmentsQ.data]);

  const plannerSet = usePlannerSet(accountId);
  const plannerClear = usePlannerClear(accountId);
  const plannerMove = usePlannerMove(accountId);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const doClear = (assigneeId: string, dow: IsoDayOfWeek) =>
    plannerClear.mutate(
      { assigneeId, dayOfWeek: dow },
      { onError: (e) => toast.error((e as RouteError).message ?? "Failed to clear") }
    );
  const doCopyToDay = (routeId: string, assigneeId: string, toDow: IsoDayOfWeek) =>
    plannerSet.mutate(
      { routeId, assigneeId, dayOfWeek: toDow },
      {
        onSuccess: () => toast.success("Copied"),
        onError: (e) => toast.error((e as RouteError).message ?? "Failed to copy"),
      }
    );

  const onDragEnd = async (e: DragEndEvent) => {
    const from = e.active.data.current as { assigneeId: string; dow: IsoDayOfWeek; routeId: string } | undefined;
    const to = e.over?.data.current as { assigneeId: string; dow: IsoDayOfWeek } | undefined;
    if (!from || !to) return;
    if (from.assigneeId === to.assigneeId && from.dow === to.dow) return;

    // optimistic: move the assignment to the target cell, drop it from the source
    const prev = qc.getQueryData<Assignment[]>(boardKey);
    if (prev) {
      qc.setQueryData(
        boardKey,
        applyOptimisticMove(
          prev,
          { assigneeId: from.assigneeId, dayOfWeek: from.dow },
          { assigneeId: to.assigneeId, dayOfWeek: to.dow }
        )
      );
    }
    try {
      await plannerMove.mutateAsync({
        routeId: from.routeId,
        fromAssigneeId: from.assigneeId,
        fromDayOfWeek: from.dow,
        toAssigneeId: to.assigneeId,
        toDayOfWeek: to.dow,
      });
    } catch (err) {
      if (prev) qc.setQueryData(boardKey, prev); // rollback
      toast.error((err as RouteError).message ?? "Move failed");
    }
  };

  // ── states ──────────────────────────────────────────────────
  const loading = emps.isLoading;
  const error = emps.isError || assignmentsQ.isError;

  return (
    <div className="w-full space-y-4">
      {!initialAssigneeId && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Route Planner</h1>
              <p className="mt-1 text-sm text-muted-foreground">Assign active routes to each salesman&apos;s week.</p>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setCopyWeekOpen(true)}>
                <CalendarRange className="h-4 w-4" /> Copy week
              </Button>
            )}
          </div>

          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search salesmen…" className="pl-9" />
          </div>
        </>
      )}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          Failed to load the planner.{" "}
          <button className="underline" onClick={() => { emps.refetch(); assignmentsQ.refetch(); }}>Retry</button>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading planner…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          {search ? "No salesmen match." : "No active employees to plan for."}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {/* Desktop grid */}
          <div className="hidden overflow-x-auto lg:block">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[180px_repeat(7,1fr)] gap-2">
                <div />
                {DAYS.map((d) => (
                  <div key={d.dow} className="px-1 pb-1 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {d.short}
                  </div>
                ))}
                {rows.map((emp) => (
                  <FragmentRow
                    key={emp.id}
                    name={emp.full_name ?? "Unnamed"}
                    assigneeId={emp.id}
                    byCell={byCell}
                    canEdit={canEdit}
                    onAssign={(dow) => setAssignTarget({ assigneeId: emp.id, dow })}
                    onClear={doClear}
                    onCopyToDay={doCopyToDay}
                    onOpen={(routeId) => router.push(`/routes/${routeId}`)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Responsive per-salesman cards */}
          <div className="space-y-4 lg:hidden">
            {rows.map((emp) => (
              <div key={emp.id} className="rounded-xl border border-border bg-card p-3">
                <p className="mb-2 text-sm font-semibold text-foreground">{emp.full_name ?? "Unnamed"}</p>
                <div className="space-y-2">
                  {DAYS.map((d) => (
                    <div key={d.dow} className="flex items-center gap-2">
                      <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground">{d.short}</span>
                      <div className="flex-1">
                        <Cell
                          assigneeId={emp.id}
                          dow={d.dow}
                          assignment={byCell.get(cellId(emp.id, d.dow))}
                          canEdit={canEdit}
                          onAssign={() => setAssignTarget({ assigneeId: emp.id, dow: d.dow })}
                          onClear={() => doClear(emp.id, d.dow)}
                          onCopyToDay={(toDow) => {
                            const a = byCell.get(cellId(emp.id, d.dow));
                            if (a) doCopyToDay(a.route_id, emp.id, toDow);
                          }}
                          onOpen={() => {
                            const a = byCell.get(cellId(emp.id, d.dow));
                            if (a) router.push(`/routes/${a.route_id}`);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DndContext>
      )}

      {/* Pagination */}
      {!loading && !error && total > PAGE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total} salesmen</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /> Prev</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* Assign route sheet */}
      {assignTarget && (
        <AssignRouteSheet
          accountId={accountId}
          open={!!assignTarget}
          onOpenChange={(o) => !o && setAssignTarget(null)}
          onPick={(routeId) => {
            plannerSet.mutate(
              { routeId, assigneeId: assignTarget.assigneeId, dayOfWeek: assignTarget.dow },
              {
                onSuccess: () => { toast.success("Route assigned"); setAssignTarget(null); },
                onError: (e) => toast.error((e as RouteError).message ?? "Failed to assign"),
              }
            );
          }}
        />
      )}

      {/* Copy week dialog */}
      {copyWeekOpen && (
        <CopyWeekDialog
          accountId={accountId}
          open={copyWeekOpen}
          onOpenChange={setCopyWeekOpen}
          onDone={() => qc.invalidateQueries({ queryKey: routeKeys.plannerAll() })}
          plannerSet={plannerSet}
        />
      )}
    </div>
  );
}

// One salesman's grid row (desktop): name cell + 7 day cells.
function FragmentRow({
  name, assigneeId, byCell, canEdit, onAssign, onClear, onCopyToDay, onOpen,
}: {
  name: string;
  assigneeId: string;
  byCell: Map<string, Assignment>;
  canEdit: boolean;
  onAssign: (dow: IsoDayOfWeek) => void;
  onClear: (assigneeId: string, dow: IsoDayOfWeek) => void;
  onCopyToDay: (routeId: string, assigneeId: string, toDow: IsoDayOfWeek) => void;
  onOpen: (routeId: string) => void;
}) {
  return (
    <>
      <div className="flex items-center px-1 text-sm font-medium text-foreground">{name}</div>
      {DAYS.map((d) => {
        const a = byCell.get(cellId(assigneeId, d.dow));
        return (
          <Cell
            key={d.dow}
            assigneeId={assigneeId}
            dow={d.dow}
            assignment={a}
            canEdit={canEdit}
            onAssign={() => onAssign(d.dow)}
            onClear={() => onClear(assigneeId, d.dow)}
            onCopyToDay={(toDow) => a && onCopyToDay(a.route_id, assigneeId, toDow)}
            onOpen={() => a && onOpen(a.route_id)}
          />
        );
      })}
    </>
  );
}

// ── assign-route sheet (active routes palette, searchable + paginated) ─────────
function AssignRouteSheet({
  accountId, open, onOpenChange, onPick,
}: {
  accountId: string | null | undefined;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (routeId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const q = useRoutes(accountId ? { accountId, statuses: ["active"], search, limit: 15, offset: page * 15 } : null);
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Assign a route</SheetTitle>
          <SheetDescription>Only active routes can be assigned.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search active routes…" className="pl-9" />
          </div>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border">
            {q.isLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : rows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No active routes found.</p>
            ) : (
              rows.map((r) => (
                <button key={r.id} onClick={() => onPick(r.id)} className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/40">
                  <span className="min-w-0 truncate text-sm text-foreground">{r.name}</span>
                  <span className="text-xs text-muted-foreground">{r.customer_count} cust.</span>
                </button>
              ))
            )}
          </div>
          {total > 15 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{page * 15 + 1}–{Math.min(total, (page + 1) * 15)} of {total}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" disabled={(page + 1) * 15 >= total} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── copy-week dialog (Raj → Amit) ──────────────────────────────
function CopyWeekDialog({
  accountId, open, onOpenChange, onDone, plannerSet,
}: {
  accountId: string | null | undefined;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  plannerSet: ReturnType<typeof usePlannerSet>;
}) {
  const employees = useAccountEmployees(accountId);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!fromId || !toId || fromId === toId) return toast.error("Pick two different salesmen");
    setBusy(true);
    try {
      const { getRouteSdk } = await import("@/lib/route");
      const source = (await getRouteSdk().getPlanner(accountId as string, [fromId])).filter((a) => a.is_active);
      if (source.length === 0) { toast.error("Source salesman has no assignments"); setBusy(false); return; }
      let copied = 0;
      for (const a of source) {
        await plannerSet.mutateAsync({ routeId: a.route_id, assigneeId: toId, dayOfWeek: a.day_of_week as IsoDayOfWeek });
        copied++;
      }
      toast.success(`Copied ${copied} assignment${copied === 1 ? "" : "s"}`);
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as RouteError).message ?? "Copy failed (partial changes may have applied)");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Copy an entire week</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">Copy from</span>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="">Select…</option>
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.full_name ?? "Unnamed"}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Copy to</span>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="">Select…</option>
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.full_name ?? "Unnamed"}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Copies each of the source&apos;s weekday routes to the target (overwrites the target&apos;s existing days).</p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button onClick={run} disabled={busy || !fromId || !toId}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Copy week
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
