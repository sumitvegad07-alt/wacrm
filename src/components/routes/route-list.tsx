"use client";

// Route List (Phase 2b). Server-paginated + filterable so it scales to 500+ routes.
// UI → hooks → SDK only. Permissions gate affordances; the server re-checks every action.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useRoutes } from "@/hooks/route/use-routes";
import { useCloneRoute, useUpdateRouteStatus } from "@/hooks/route/use-route-mutations";
import { ROUTE_PERMISSIONS, type RouteStatus, type RouteError } from "@/lib/route";
import { RouteStatusPill } from "./route-status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus,
  Search,
  MoreHorizontal,
  Copy,
  Archive,
  RotateCcw,
  Loader2,
  Route as RouteIcon,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

const PAGE_SIZE = 25;

type FilterKey = "active_draft" | "pending" | "archived" | "all";

const FILTERS: { key: FilterKey; label: string; statuses?: RouteStatus[] }[] = [
  { key: "active_draft", label: "Active + Draft", statuses: ["active", "draft"] },
  { key: "pending", label: "Pending approval", statuses: ["pending_approval"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
  { key: "all", label: "All" },
];

export function RouteList() {
  const router = useRouter();
  const { accountId, hasPermission } = useAuth();
  const canAdd = hasPermission(ROUTE_PERMISSIONS.ADD);
  const canClone = hasPermission(ROUTE_PERMISSIONS.CLONE);
  const canArchive = hasPermission(ROUTE_PERMISSIONS.ARCHIVE);

  const [filter, setFilter] = useState<FilterKey>("active_draft");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Debounce search → server query; reset to first page on new search/filter.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(0), [search, filter]);

  const statuses = useMemo(() => FILTERS.find((f) => f.key === filter)?.statuses, [filter]);

  const { data, isLoading, isError, error, isFetching, refetch } = useRoutes(
    accountId ? { accountId, statuses, search, limit: PAGE_SIZE, offset: page * PAGE_SIZE } : null
  );

  const clone = useCloneRoute(accountId);
  const setStatus = useUpdateRouteStatus(accountId);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const hasNext = (page + 1) * PAGE_SIZE < total;

  const onClone = async (id: string, name: string) => {
    try {
      const res = await clone.mutateAsync({ routeId: id, newName: `${name} (Copy)` });
      toast.success("Route cloned");
      router.push(`/routes/${res.id}`);
    } catch (e) {
      toast.error((e as RouteError).message ?? "Failed to clone");
    }
  };
  const onArchive = async (id: string, archived: boolean) => {
    try {
      await setStatus.mutateAsync({ routeId: id, status: archived ? "active" : "archived" });
      toast.success(archived ? "Route restored" : "Route archived");
    } catch (e) {
      toast.error((e as RouteError).message ?? "Failed");
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Routes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build and assign beats from your territory customers.
          </p>
        </div>
        {canAdd && (
          <Button onClick={() => router.push("/routes/new")}>
            <Plus className="h-4 w-4" /> New Route
          </Button>
        )}
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search routes by name…"
            className="pl-9"
          />
        </div>
      </div>

      {/* Table / states */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Primary assignee</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Customers</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 w-40 rounded bg-muted" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-muted" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 rounded-full bg-muted" /></td>
                    <td className="px-4 py-3"><div className="ml-auto h-4 w-8 rounded bg-muted" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 rounded bg-muted" /></td>
                    <td className="px-4 py-3" />
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                      <AlertCircle className="h-8 w-8 text-red-500" />
                      <p className="text-sm text-muted-foreground">
                        {(error as RouteError)?.message ?? "Failed to load routes."}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                        <RouteIcon className="h-7 w-7 text-primary" />
                      </div>
                      <p className="text-base font-semibold text-foreground">
                        {search || filter !== "active_draft" ? "No routes match" : "No routes yet"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {search || filter !== "active_draft"
                          ? "Try a different filter or search term."
                          : "Create your first beat from your territory customers."}
                      </p>
                      {canAdd && !search && filter === "active_draft" && (
                        <Button onClick={() => router.push("/routes/new")} className="mt-1">
                          <Plus className="h-4 w-4" /> New Route
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isArchived = r.status === "archived";
                  return (
                    <tr
                      key={r.id}
                      onClick={() => router.push(`/routes/${r.id}`)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.primary_assignee_name ?? <span className="italic opacity-60">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3"><RouteStatusPill status={r.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.customer_count}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(r.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {(canClone || canArchive) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label="Route actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canClone && (
                                <DropdownMenuItem onClick={() => onClone(r.id, r.name)}>
                                  <Copy className="h-4 w-4" /> Clone
                                </DropdownMenuItem>
                              )}
                              {canArchive && (
                                <DropdownMenuItem onClick={() => onArchive(r.id, isArchived)}>
                                  {isArchived ? (
                                    <><RotateCcw className="h-4 w-4" /> Restore</>
                                  ) : (
                                    <><Archive className="h-4 w-4" /> Archive</>
                                  )}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!isLoading && !isError && total > 0 && (
          <div className="flex items-center justify-between border-t border-border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {from}–{to} of {total}
              {isFetching && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
