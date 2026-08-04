"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useRoutes } from "@/hooks/route/use-routes";
import {
  useCloneRoute,
  useUpdateRouteStatus,
  useBulkUpdateRouteStatus,
} from "@/hooks/route/use-route-mutations";
import { ROUTE_PERMISSIONS, type RouteStatus, type RouteError } from "@/lib/route";
import { RouteStatusPill } from "./route-status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  CheckCircle2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Edit2,
  Users,
} from "lucide-react";

const PAGE_SIZE = 25;

type FilterKey = "active_draft" | "pending" | "archived" | "all";

const FILTERS: { key: FilterKey; label: string; statuses?: RouteStatus[] }[] = [
  { key: "active_draft", label: "Active + Draft", statuses: ["active", "draft"] },
  { key: "pending", label: "Pending approval", statuses: ["pending_approval"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
  { key: "all", label: "All" },
];

type SortColumn = "name" | "assignee" | "customers" | "updated";
type SortDirection = "asc" | "desc";

export interface RouteListProps {
  hideHeader?: boolean;
  onSelectRoute?: (routeId: string) => void;
}

export function RouteList({ hideHeader, onSelectRoute }: RouteListProps = {}) {
  const router = useRouter();
  const { accountId, hasPermission } = useAuth();
  const canAdd = hasPermission(ROUTE_PERMISSIONS.ADD);
  const canClone = hasPermission(ROUTE_PERMISSIONS.CLONE);
  const canArchive = hasPermission(ROUTE_PERMISSIONS.ARCHIVE);

  const [filter, setFilter] = useState<FilterKey>("active_draft");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Sorting state
  const [sortCol, setSortCol] = useState<SortColumn>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const { data, isLoading, isError, error, isFetching, refetch } = useRoutes({
    accountId: accountId || "",
    search,
    statuses: activeFilter.statuses,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const cloneMutation = useCloneRoute(accountId);
  const statusMutation = useUpdateRouteStatus(accountId);
  const bulkStatusMutation = useBulkUpdateRouteStatus(accountId);

  const rows = useMemo(() => {
    const base = (data?.rows ?? []).slice();
    return base.sort((a: any, b: any) => {
      let comparison = 0;
      if (sortCol === "name") {
        comparison = (a.name || "").localeCompare(b.name || "");
      } else if (sortCol === "assignee") {
        const aName = a.primary_assignee_name || "";
        const bName = b.primary_assignee_name || "";
        comparison = aName.localeCompare(bName);
      } else if (sortCol === "customers") {
        comparison = (a.customer_count || 0) - (b.customer_count || 0);
      } else if (sortCol === "updated") {
        comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      }
      return sortDir === "asc" ? comparison : -comparison;
    });
  }, [data?.rows, sortCol, sortDir]);

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const hasNext = to < total;

  // Clear selection on page/filter change
  useEffect(() => {
    setSelectedIds([]);
  }, [filter, page, search]);

  const toggleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const renderSortIcon = (col: SortColumn) => {
    if (sortCol !== col) return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/60 inline" />;
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 h-3.5 w-3.5 text-primary inline" />
    ) : (
      <ArrowDown className="ml-1 h-3.5 w-3.5 text-primary inline" />
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === rows.length && rows.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(rows.map((r: any) => r.id));
    }
  };

  const toggleSelectId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleBulkApprove = () => {
    if (selectedIds.length === 0) return;
    bulkStatusMutation.mutate(
      { routeIds: selectedIds, status: "active", reason: "Approved via table selection" },
      {
        onSuccess: () => {
          toast.success(`Approved ${selectedIds.length} selected routes`);
          setSelectedIds([]);
          refetch();
        },
        onError: (err: any) => {
          toast.error(err.message || "Bulk approve failed");
        },
      }
    );
  };

  const handleBulkArchive = () => {
    if (selectedIds.length === 0) return;
    bulkStatusMutation.mutate(
      { routeIds: selectedIds, status: "archived", reason: "Archived via table selection" },
      {
        onSuccess: () => {
          toast.success(`Archived ${selectedIds.length} selected routes`);
          setSelectedIds([]);
          refetch();
        },
        onError: (err: any) => {
          toast.error(err.message || "Bulk archive failed");
        },
      }
    );
  };

  const handleApproveSingle = (routeId: string, routeName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    statusMutation.mutate(
      { routeId, status: "active", reason: "Approved via table action" },
      {
        onSuccess: () => {
          toast.success(`Approved "${routeName}"`);
          refetch();
        },
        onError: (err: any) => {
          toast.error(err.message || "Failed to approve route");
        },
      }
    );
  };

  const onClone = (routeId: string, name: string) => {
    const newName = `${name} (Copy)`;
    cloneMutation.mutate(
      { routeId, newName },
      {
        onSuccess: () => {
          toast.success("Route cloned successfully");
          refetch();
        },
        onError: (e: any) => toast.error(e.message || "Clone failed"),
      }
    );
  };

  const onArchive = (routeId: string, isArchived: boolean) => {
    const targetStatus: RouteStatus = isArchived ? "active" : "archived";
    statusMutation.mutate(
      { routeId, status: targetStatus, reason: isArchived ? "Restored from table" : "Archived from table" },
      {
        onSuccess: () => {
          toast.success(isArchived ? "Route restored" : "Route archived");
          refetch();
        },
        onError: (e: any) => toast.error(e.message || "Archive failed"),
      }
    );
  };

  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  return (
    <div className="space-y-4 animate-in fade-in-50 duration-200">
      {/* Header — ONLY displayed when hideHeader is false */}
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Routes</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Build and assign beats from your territory customers.
            </p>
          </div>
          {canAdd && (
            <Button onClick={() => router.push("/routes/new")}>
              <Plus className="h-4 w-4 mr-1.5" /> New Route
            </Button>
          )}
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setFilter(f.key);
                setPage(0);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[240px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search routes by name…"
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Batch Action Bar (Approve / Archive multi-select) */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 animate-in fade-in duration-200">
          <span className="text-sm font-semibold text-emerald-300">
            {selectedIds.length} {selectedIds.length === 1 ? "route" : "routes"} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleBulkApprove}
              disabled={bulkStatusMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
            >
              {bulkStatusMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
              )}
              Approve Selected ({selectedIds.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkArchive}
              disabled={bulkStatusMutation.isPending}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              <Archive className="h-4 w-4 mr-1.5" />
              Archive Selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])} className="text-xs">
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table / states */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all routes"
                  />
                </th>
                <th
                  className="px-4 py-3 font-semibold cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => toggleSort("name")}
                >
                  Name {renderSortIcon("name")}
                </th>
                <th
                  className="px-4 py-3 font-semibold cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => toggleSort("assignee")}
                >
                  Primary assignee {renderSortIcon("assignee")}
                </th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th
                  className="px-4 py-3 font-semibold text-right cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => toggleSort("customers")}
                >
                  Customers {renderSortIcon("customers")}
                </th>
                <th
                  className="px-4 py-3 font-semibold cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => toggleSort("updated")}
                >
                  Updated {renderSortIcon("updated")}
                </th>
                <th className="w-12 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-4 w-4 rounded bg-muted" /></td>
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
                  <td colSpan={7} className="px-4 py-12 text-center">
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
                  <td colSpan={7} className="px-4 py-16 text-center">
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
                      {/* ONLY show New Route button if header is visible (not inside employee route panel) */}
                      {canAdd && !search && filter === "active_draft" && !hideHeader && (
                        <Button onClick={() => router.push("/routes/new")} className="mt-2">
                          <Plus className="h-4 w-4 mr-1.5" /> New Route
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r: any) => {
                  const isArchived = r.status === "archived";
                  const isChecked = selectedIds.includes(r.id);
                  const needsApproval = r.status === "pending_approval" || r.status === "draft";

                  return (
                    <tr
                      key={r.id}
                      onClick={() => {
                        if (onSelectRoute) {
                          onSelectRoute(r.id);
                        } else {
                          router.push(`/routes/${r.id}`);
                        }
                      }}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-muted/40",
                        isChecked && "bg-emerald-500/5"
                      )}
                    >
                      <td className="px-4 py-3" onClick={(e) => toggleSelectId(r.id, e)}>
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => {}}
                          aria-label={`Select route ${r.name}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground">{r.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.primary_assignee_name ?? <span className="italic opacity-60">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3">
                        <RouteStatusPill status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground font-medium">
                        {r.customer_count}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(r.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Route actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {needsApproval && (
                              <DropdownMenuItem
                                onClick={(e) => handleApproveSingle(r.id, r.name, e)}
                                className="text-emerald-400 font-semibold focus:text-emerald-300"
                              >
                                <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Approve Route
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => {
                                if (onSelectRoute) onSelectRoute(r.id);
                                else router.push(`/routes/${r.id}`);
                              }}
                            >
                              <Users className="h-4 w-4 mr-2" /> Manage Customers
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => router.push(`/routes/${r.id}`)}
                            >
                              <Edit2 className="h-4 w-4 mr-2" /> Edit Details
                            </DropdownMenuItem>
                            {canClone && (
                              <DropdownMenuItem onClick={() => onClone(r.id, r.name)}>
                                <Copy className="h-4 w-4 mr-2" /> Clone
                              </DropdownMenuItem>
                            )}
                            {canArchive && (
                              <DropdownMenuItem onClick={() => onArchive(r.id, isArchived)}>
                                {isArchived ? (
                                  <>
                                    <RotateCcw className="h-4 w-4 mr-2" /> Restore
                                  </>
                                ) : (
                                  <>
                                    <Archive className="h-4 w-4 mr-2 text-red-400" /> Archive
                                  </>
                                )}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>
              <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
