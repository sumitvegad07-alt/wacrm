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
  MoreHorizontal,
  Copy,
  Archive,
  RotateCcw,
  CheckCircle2,
  Edit2,
  Users,
} from "lucide-react";
import { PageLayout, PageHeader, PageToolbar, BulkActionBar } from "@/components/shared";
import { DataTable } from "@/components/ui/data-table/data-table";
import { type ColumnDef, type FilterState } from "@/components/ui/data-table/data-table-types";

const PAGE_SIZE = 25;

type FilterKey = "active_draft" | "pending" | "archived" | "all";

const FILTERS: { key: FilterKey; label: string; statuses?: RouteStatus[] }[] = [
  { key: "active_draft", label: "Active + Draft", statuses: ["active", "draft"] },
  { key: "pending", label: "Pending approval", statuses: ["pending_approval"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
  { key: "all", label: "All" },
];

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
    return (data?.rows ?? []).slice();
  }, [data?.rows]);

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const hasNext = to < total;

  // Clear selection on page/filter change
  useEffect(() => {
    setSelectedIds([]);
  }, [filter, page, search]);

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

  const [filterState, setFilterState] = useState<FilterState>({});

  const columns: ColumnDef<any>[] = useMemo(() => [
    {
      id: "name",
      label: "Name",
      type: "text",
      render: (r) => (
        <span className="font-semibold text-foreground">{r.name}</span>
      ),
    },
    {
      id: "assignee",
      label: "Primary Assignee",
      type: "text",
      render: (r) => (
        <span className="text-muted-foreground">
          {r.primary_assignee_name ?? <span className="italic opacity-60">Unassigned</span>}
        </span>
      ),
    },
    {
      id: "status",
      label: "Status",
      type: "select",
      options: [
        { label: "Active", value: "active" },
        { label: "Draft", value: "draft" },
        { label: "Pending approval", value: "pending_approval" },
        { label: "Archived", value: "archived" },
      ],
      render: (r) => <RouteStatusPill status={r.status} />,
    },
    {
      id: "customers",
      label: "Customers",
      type: "text",
      render: (r) => (
        <span className="tabular-nums text-foreground font-medium">
          {r.customer_count}
        </span>
      ),
    },
    {
      id: "updated_at",
      label: "Updated",
      type: "date",
      render: (r) => {
        if (!r.updated_at) return <span className="text-muted-foreground">—</span>;
        const d = new Date(r.updated_at);
        if (isNaN(d.getTime())) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-muted-foreground tabular-nums">
            {d.toISOString().slice(0, 10)}
          </span>
        );
      },
    },
    {
      id: "actions",
      label: "",
      visibleByDefault: true,
      render: (r) => {
        const isArchived = r.status === "archived";
        const needsApproval = r.status === "pending_approval" || r.status === "draft";
        return (
          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            {needsApproval && (
              <Button
                size="sm"
                className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs px-2.5 shadow-sm transition-all flex items-center gap-1"
                onClick={(e) => handleApproveSingle(r.id, r.name, e)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Approve</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Route actions"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                {needsApproval && (
                  <DropdownMenuItem
                    onClick={(e) => handleApproveSingle(r.id, r.name, e)}
                    className="text-emerald-400 font-semibold focus:text-emerald-300 cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" /> Approve Route
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    if (onSelectRoute) onSelectRoute(r.id);
                    else router.push(`/routes/${r.id}`);
                  }}
                  className="cursor-pointer"
                >
                  <Users className="h-4 w-4 mr-2" /> Manage Customers
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push(`/routes/${r.id}`)}
                  className="cursor-pointer"
                >
                  <Edit2 className="h-4 w-4 mr-2" /> Edit Details
                </DropdownMenuItem>
                {canClone && (
                  <DropdownMenuItem onClick={() => onClone(r.id, r.name)} className="cursor-pointer">
                    <Copy className="h-4 w-4 mr-2" /> Clone
                  </DropdownMenuItem>
                )}
                {canArchive && (
                  <DropdownMenuItem onClick={() => onArchive(r.id, isArchived)} className="cursor-pointer">
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
          </div>
        );
      },
    },
  ], [onSelectRoute, router, canClone, canArchive]);

  const content = (
    <>
      {!hideHeader && (
        <PageHeader
          title="Routes"
          subtitle="Build and assign beats from your territory customers."
          actions={
            canAdd ? (
              <Button onClick={() => router.push("/routes/new")} className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="h-4 w-4" /> New Route
              </Button>
            ) : undefined
          }
        />
      )}

      <PageToolbar
        search={{
          value: searchInput,
          onChange: setSearchInput,
          placeholder: "Search routes by name...",
        }}
        actions={
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
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      <BulkActionBar
        selectedCount={selectedIds.length}
        onClear={() => setSelectedIds([])}
        actions={[
          {
            label: `Approve (${selectedIds.length})`,
            icon: <CheckCircle2 className="size-4" />,
            variant: "default",
            onClick: handleBulkApprove,
            disabled: bulkStatusMutation.isPending,
          },
          {
            label: "Archive",
            icon: <Archive className="size-4" />,
            variant: "outline",
            onClick: handleBulkArchive,
            disabled: bulkStatusMutation.isPending,
          },
        ]}
      />

      <DataTable
        columns={columns}
        data={rows}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        storageKey="wacrm_routes_table_columns"
        isLoading={isLoading}
        rowKey={(route) => route.id}
        onRowClick={(route) => {
          if (onSelectRoute) onSelectRoute(route.id);
          else router.push(`/routes/${route.id}`);
        }}
        selection={{
          selectedIds: new Set(selectedIds),
          onSelectAll: (checked) => setSelectedIds(checked ? rows.map((r: any) => r.id) : []),
          onSelect: (id, checked) => setSelectedIds(prev => {
            if (checked) {
              return prev.includes(id) ? prev : [...prev, id];
            } else {
              return prev.filter(x => x !== id);
            }
          }),
        }}
      />
    </>
  );

  return hideHeader ? <div className="space-y-4">{content}</div> : <PageLayout>{content}</PageLayout>;
}
