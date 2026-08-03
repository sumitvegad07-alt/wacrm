"use client";

// Route Wizard (Phase 2b). Create-early draft (D1): the route is saved as a `draft` at step 1
// so import/reorder run against a real id. Sequencing is OPTIONAL (happy path = Import All →
// Review → Activate, no dragging). Final step is a preview before activation (refinement 4).
// Abandoned drafts (created but never activated) are cleaned up by a future maintenance job
// (see route-management-ui-review.md D1 note) — not this screen's concern.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  useSaveRoute,
  useImportCustomers,
  useReorderCustomers,
  useRemoveCustomer,
  useUpdateRouteStatus,
} from "@/hooks/route/use-route-mutations";
import { useRouteCustomers, useRouteHealth } from "@/hooks/route/use-routes";
import { useAccountEmployees, useImportableContacts, useRouteSettings } from "@/hooks/route/use-route-refdata";
import { ROUTE_PERMISSIONS, type RouteError } from "@/lib/route";
import { SortableCustomerList, type SortableCustomer } from "./sortable-customer-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  Users,
  ListOrdered,
  ClipboardCheck,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const STEPS = [
  { n: 1, label: "Details", Icon: ClipboardCheck },
  { n: 2, label: "Customers", Icon: Users },
  { n: 3, label: "Sequence", Icon: ListOrdered },
  { n: 4, label: "Review", Icon: Check },
];
const PICK_PAGE = 20;

export function RouteWizard() {
  const router = useRouter();
  const { accountId, hasPermission } = useAuth();
  const canActivate = hasPermission(ROUTE_PERMISSIONS.EDIT);

  const [routeId] = useState(() => crypto.randomUUID());
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [created, setCreated] = useState(false);
  const [step, setStep] = useState(1);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  const [mode, setMode] = useState<"all" | "select">("all");
  const [pickSearchInput, setPickSearchInput] = useState("");
  const [pickPage, setPickPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const employees = useAccountEmployees(accountId);
  const settings = useRouteSettings();
  const saveRoute = useSaveRoute(accountId);
  const importCustomers = useImportCustomers(accountId);
  const reorder = useReorderCustomers();
  const removeCustomer = useRemoveCustomer();
  const setStatus = useUpdateRouteStatus(accountId);
  const customers = useRouteCustomers(created ? routeId : null);
  const health = useRouteHealth(step === 4 && created ? routeId : null);

  const importable = useImportableContacts(
    step === 2 && mode === "select" && accountId
      ? { accountId, search: pickSearchInput.trim(), limit: PICK_PAGE, offset: pickPage * PICK_PAGE }
      : null
  );

  const maxCustomers = settings.data?.capacity.max_customers ?? 50;
  const approvalMode = settings.data?.approval_mode ?? "none";
  const custRows = customers.data ?? [];
  const overCapacity = custRows.length > maxCustomers;

  const sortableItems: SortableCustomer[] = useMemo(
    () =>
      custRows.map((c) => ({
        id: c.contact_id,
        primary: c.company || c.name || "Unnamed",
        secondary: c.address,
        flagged: c.needs_territory_review,
      })),
    [custRows]
  );

  // ── step 1 ──────────────────────────────────────────────────
  const handleDetails = async () => {
    if (!name.trim()) return toast.error("Route name is required");
    if (!assigneeId) return toast.error("Choose a primary assignee (needed to import their customers)");
    try {
      const route = await saveRoute.mutateAsync({
        routeId,
        name: name.trim(),
        description: description.trim() || null,
        primaryAssigneeId: assigneeId,
        expectedVersion: created ? version ?? null : null,
      });
      setVersion(route.version);
      setCreated(true);
      setStep(2);
    } catch (e) {
      toast.error((e as RouteError).message ?? "Failed to save route");
    }
  };

  // ── step 2 ──────────────────────────────────────────────────
  const handleImportAll = async () => {
    try {
      const res = await importCustomers.mutateAsync({ routeId, mode: "all" });
      const extra = [
        res.skipped_already_routed ? `${res.skipped_already_routed} already on a route` : "",
        res.skipped_ineligible ? `${res.skipped_ineligible} outside territory` : "",
      ].filter(Boolean).join(", ");
      toast.success(`Imported ${res.added} customer${res.added === 1 ? "" : "s"}${extra ? ` · skipped ${extra}` : ""}`);
    } catch (e) {
      toast.error((e as RouteError).message ?? "Import failed");
    }
  };
  const handleImportSelected = async () => {
    if (selected.size === 0) return;
    try {
      const res = await importCustomers.mutateAsync({ routeId, mode: "select", contactIds: [...selected] });
      toast.success(`Imported ${res.added}${res.skipped_ineligible ? ` · ${res.skipped_ineligible} outside territory` : ""}`);
      setSelected(new Set());
    } catch (e) {
      toast.error((e as RouteError).message ?? "Import failed");
    }
  };

  // ── step 4 ──────────────────────────────────────────────────
  const handleFinish = async (activate: boolean) => {
    if (!activate) {
      router.push(`/routes/${routeId}`);
      return;
    }
    const target = approvalMode === "none" ? "active" : "pending_approval";
    try {
      await setStatus.mutateAsync({ routeId, status: target });
      toast.success(target === "active" ? "Route activated" : "Submitted for approval");
      router.push(`/routes/${routeId}`);
    } catch (e) {
      toast.error((e as RouteError).message ?? "Failed");
    }
  };

  const pickTotal = importable.data?.total ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New Route</h1>
        <p className="mt-1 text-sm text-muted-foreground">Build a beat from a salesman&apos;s territory customers.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                step === s.n
                  ? "border-primary bg-primary text-primary-foreground"
                  : step > s.n
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground"
              )}
            >
              {step > s.n ? <Check className="h-4 w-4" /> : s.n}
            </div>
            <span className={cn("text-sm font-medium", step >= s.n ? "text-foreground" : "text-muted-foreground")}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        {/* STEP 1 — Details */}
        {step === 1 && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-foreground">Route name *</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Route" className="mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-foreground">Description</span>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" className="mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-foreground">Primary assignee *</span>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Select an employee…</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name ?? "Unnamed"}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">
                Customers are imported from this salesman&apos;s assigned territory.
              </span>
            </label>
            <div className="flex justify-end pt-2">
              <Button onClick={handleDetails} disabled={saveRoute.isPending}>
                {saveRoute.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save draft &amp; continue
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2 — Customers */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
              {(["all", "select"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {m === "all" ? "Import all (recommended)" : "Select customers"}
                </button>
              ))}
            </div>

            {mode === "all" ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Imports every customer in the assignee&apos;s territory that isn&apos;t already on a route.
                </p>
                <Button className="mt-3" onClick={handleImportAll} disabled={importCustomers.isPending}>
                  {importCustomers.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Import all customers
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={pickSearchInput}
                    onChange={(e) => { setPickSearchInput(e.target.value); setPickPage(0); }}
                    placeholder="Search customers…"
                    className="pl-9"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                  {importable.isLoading ? (
                    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : (importable.data?.rows ?? []).length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No customers found.</p>
                  ) : (
                    (importable.data?.rows ?? []).map((c) => {
                      const on = selected.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (on) next.delete(c.id); else next.add(c.id);
                              return next;
                            })
                          }
                          className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
                        >
                          <span className={cn("flex h-4 w-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {c.company || c.name || "Unnamed"}
                          </span>
                          {!c.territory_id && <span className="text-[10px] text-amber-500">no territory</span>}
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{selected.size} selected · {pickTotal} total</span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" disabled={pickPage === 0} onClick={() => setPickPage((p) => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={(pickPage + 1) * PICK_PAGE >= pickTotal} onClick={() => setPickPage((p) => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button onClick={handleImportSelected} disabled={selected.size === 0 || importCustomers.isPending}>
                  {importCustomers.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Import {selected.size} selected
                </Button>
              </div>
            )}

            <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm">
              <span className="font-medium text-foreground">{custRows.length}</span>{" "}
              <span className="text-muted-foreground">customer{custRows.length === 1 ? "" : "s"} on this route</span>
              {overCapacity && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">— over the {maxCustomers} capacity guideline</span>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>Continue</Button>
            </div>
          </div>
        )}

        {/* STEP 3 — Sequence (optional) */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              <strong className="text-foreground">Optional.</strong> Customers are visited top to bottom.
              Drag to reorder if you want a specific sequence — otherwise just continue.
            </div>
            {custRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No customers yet — go back and import some.</p>
            ) : (
              <SortableCustomerList
                items={sortableItems}
                onReorder={(ids) => reorder.mutate({ routeId, orderedContactIds: ids })}
                onRemove={(id) => removeCustomer.mutate({ routeId, contactId: id })}
              />
            )}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)}>Continue</Button>
            </div>
          </div>
        )}

        {/* STEP 4 — Review & Preview */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="rounded-lg border border-border p-4">
              <h3 className="text-base font-semibold text-foreground">{name}</h3>
              {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Primary assignee</dt>
                  <dd className="text-foreground">{employees.data?.find((e) => e.id === assigneeId)?.full_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Customers</dt>
                  <dd className="text-foreground">{custRows.length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Route health</dt>
                  <dd className="text-foreground">
                    {health.isLoading ? "…" : `${health.data?.score ?? 0}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">On activation</dt>
                  <dd className="text-foreground">
                    {approvalMode === "none" ? "Goes active immediately" : `Needs ${approvalMode} approval`}
                  </dd>
                </div>
              </dl>
              {health.data && health.data.checks.some((c) => !c.ok) && (
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-amber-600 dark:text-amber-400">
                  {health.data.checks.filter((c) => !c.ok).map((c) => (
                    <li key={c.code}>⚠ {c.code.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-border">
              <p className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                First stops (preview)
              </p>
              <ul className="divide-y divide-border">
                {custRows.slice(0, 5).map((c, i) => (
                  <li key={c.contact_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="truncate text-foreground">{c.company || c.name || "Unnamed"}</span>
                  </li>
                ))}
                {custRows.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No customers.</li>}
              </ul>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleFinish(false)} disabled={setStatus.isPending}>
                  Save as draft
                </Button>
                {canActivate && (
                  <Button onClick={() => handleFinish(true)} disabled={setStatus.isPending}>
                    {setStatus.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {approvalMode === "none" ? "Activate route" : "Submit for approval"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
