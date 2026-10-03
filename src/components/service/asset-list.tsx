"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  EyeOff,
  PackageSearch,
  Plus,
  Upload,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";
import type { AssetListRow } from "@/lib/service/assets/api";
import { archiveAssetAsUser, restoreAssetAsUser } from "@/lib/service/assets/browser";
import { AssetError } from "@/lib/service/assets/errors";
import {
  ASSET_STATUSES,
  assetFilterSummary,
  serializeAssetFilters,
  type AssetFilters,
  type WarrantyFilter,
} from "@/lib/service/assets/filters";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  assetCustomerLabel,
  assetStatusLabel,
  hasActiveFilters,
  humanize,
  type FilterOption,
  type ListState,
} from "@/lib/service/assets/list-view";
import { warrantyState } from "@/lib/service/settings";
import type { AssetStatus } from "@/lib/service/types";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DataTable } from "@/components/ui/data-table/data-table";
import { RowActions } from "@/components/ui/data-table/row-actions";
import type { ColumnDef } from "@/components/ui/data-table/data-table-types";
import { ImportWizard } from "@/components/import/import-wizard";
import { isImportModule } from "@/lib/import/registry";
import { ConfirmDialog, EmptyState, PageLayout, PageToolbar, StatusBadge } from "@/components/shared";
import { WarrantyPill } from "@/components/service/warranty-pill";
import { CustomerFilter, type CustomerOption } from "@/components/service/customer-filter";

export interface AssetListProps {
  /** What to show, decided once on the server by decideListState. */
  state: Exclude<ListState, "reset-page">;
  rows: AssetListRow[];
  /** Rows matching the filters across ALL pages. */
  total: number;
  page: number;
  pageSize: number;
  /** "Now" as the server saw it, so the pills and the warranty filter use the same day. */
  todayIso: string;
  filters: AssetFilters;
  /** Present when the main query failed; the table is NOT rendered then. */
  loadError: { message: string } | null;
  /** Names of filter lookups that failed to load; the table still renders (spec: partial error). */
  lookupFailures: string[];
  assetTypes: FilterOption[];
  territories: FilterOption[];
  /** The customer named by ?contactId, resolved server-side. Null when none or not visible. */
  selectedCustomer: CustomerOption | null;
}

const STATUS_VARIANT: Partial<Record<AssetStatus, "info">> = { under_repair: "info" };

const WARRANTY_OPTIONS: { value: WarrantyFilter; label: string }[] = [
  { value: "expiring", label: "Expiring in 30 days" },
  { value: "expired", label: "Expired" },
];

const SELECT_CLASS =
  "h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary";

export function AssetList({
  state,
  rows,
  total,
  page,
  pageSize,
  todayIso,
  filters,
  loadError,
  lookupFailures,
  assetTypes,
  territories,
  selectedCustomer,
}: AssetListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { hasPermission } = useAuth();
  const [isPending, startTransition] = useTransition();

  const canCreate = hasPermission(PERMISSIONS.SERVICE_ASSETS.CREATE);
  const canEdit = hasPermission(PERMISSIONS.SERVICE_ASSETS.EDIT);
  const canDelete = hasPermission(PERMISSIONS.SERVICE_ASSETS.DELETE);
  const canImport = hasPermission(PERMISSIONS.SERVICE_ASSETS.IMPORT);

  const today = useMemo(() => new Date(todayIso), [todayIso]);
  const filtersActive = hasActiveFilters(filters);

  // ── URL is the source of truth for filters and paging ────────────────────────
  const go = useCallback(
    (next: AssetFilters, paging: { page?: number; pageSize?: number } = {}, mode: "push" | "replace" = "push") => {
      const qs = serializeAssetFilters(next);
      const size = paging.pageSize ?? pageSize;
      if (size !== DEFAULT_PAGE_SIZE) qs.set("pageSize", String(size));
      if (paging.page && paging.page > 1) qs.set("page", String(paging.page));
      const s = qs.toString();
      const href = s ? `${pathname}?${s}` : pathname;
      startTransition(() => (mode === "replace" ? router.replace(href) : router.push(href)));
    },
    [pageSize, pathname, router],
  );

  // A filter change always goes back to page 1 (the page param is simply not carried over).
  const updateFilters = useCallback((patch: Partial<AssetFilters>) => go({ ...filters, ...patch }), [filters, go]);

  const clearFilters = useCallback(
    () => go({ showInactive: filters.showInactive }),
    [filters.showInactive, go],
  );

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  // ── Free-text search: debounced into the URL ─────────────────────────────────
  const [search, setSearch] = useState(filters.q ?? "");
  const lastQ = useRef(filters.q ?? "");
  useEffect(() => {
    // The URL changed from outside (Clear filters, back/forward): follow it.
    if ((filters.q ?? "") !== lastQ.current) {
      lastQ.current = filters.q ?? "";
      setSearch(filters.q ?? "");
    }
  }, [filters.q]);
  useEffect(() => {
    const t = search.trim();
    if (t === lastQ.current) return;
    const id = setTimeout(() => {
      lastQ.current = t;
      go({ ...filters, q: t || undefined }, {}, "replace");
    }, 350);
    return () => clearTimeout(id);
  }, [search, filters, go]);

  // ── Customer filter: show the chosen label at once, before the server round trip ──
  const [pickedCustomer, setPickedCustomer] = useState<CustomerOption | null | undefined>(undefined);
  useEffect(() => setPickedCustomer(undefined), [filters.contactId]);
  const customerValue =
    pickedCustomer !== undefined
      ? pickedCustomer
      : filters.contactId
        ? (selectedCustomer ?? { id: filters.contactId, label: "Selected customer" })
        : null;

  // ── Row actions ──────────────────────────────────────────────────────────────
  const [archiveTarget, setArchiveTarget] = useState<AssetListRow | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState<string | null>(null);

  const handleArchive = useCallback(async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await archiveAssetAsUser(archiveTarget.id);
      toast.success("Asset moved to Inactive");
      setArchiveTarget(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof AssetError ? err.message : "Could not move the asset to Inactive.");
    } finally {
      setArchiving(false);
    }
  }, [archiveTarget, refresh]);

  const handleRestore = useCallback(
    async (row: AssetListRow) => {
      try {
        await restoreAssetAsUser(row.id);
        toast.success("Asset re-activated");
        refresh();
      } catch (err) {
        toast.error(err instanceof AssetError ? err.message : "Could not re-activate the asset.");
      }
    },
    [refresh],
  );

  // NOTE: DataTable re-reads its saved column layout whenever `columns` changes identity, so this
  // MUST be memoised or the table re-renders in a loop.
  const columns = useMemo<ColumnDef<AssetListRow>[]>(
    () => [
      {
        id: "asset_code",
        label: "Asset Code",
        render: (a) => <span className="font-mono text-xs font-medium text-foreground">{a.asset_code}</span>,
      },
      {
        id: "name",
        label: "Name",
        render: (a) => <span className="font-medium text-foreground">{a.name}</span>,
      },
      {
        id: "customer",
        label: "Customer",
        render: (a) => {
          const label = assetCustomerLabel(a);
          // Link only when the live contact is readable; a hidden customer has nowhere to go.
          return a.contact ? (
            <Link
              href={`/contacts/${a.contact_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-foreground hover:text-primary hover:underline"
            >
              {label}
            </Link>
          ) : (
            <span className="text-muted-foreground">{label}</span>
          );
        },
      },
      {
        id: "type",
        label: "Type",
        render: (a) => <span className="text-muted-foreground">{a.asset_type?.name ?? "—"}</span>,
      },
      {
        id: "serial_no",
        label: "Serial No",
        render: (a) => <span className="text-muted-foreground">{a.serial_no ?? "—"}</span>,
      },
      {
        id: "warranty_end",
        label: "Warranty End",
        render: (a) => <WarrantyPill state={warrantyState(a, today)} endDate={a.warranty_end} />,
      },
      {
        id: "status",
        label: "Status",
        render: (a) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge
              status={a.status}
              label={assetStatusLabel(a.status)}
              variant={STATUS_VARIANT[a.status]}
            />
            {a.deleted_at && <StatusBadge status="archived" label="Archived" />}
          </div>
        ),
      },
      {
        id: "actions",
        label: "Action",
        visibleByDefault: true,
        render: (a) => (
          <RowActions
            editTitle={canEdit ? "Edit" : "View"}
            onEdit={() =>
              router.push(canEdit ? `/service/assets/${a.id}/edit` : `/service/assets/${a.id}`)
            }
            onDelete={canDelete ? () => setArchiveTarget(a) : undefined}
            onReactivate={canDelete ? () => handleRestore(a) : undefined}
            isInactive={a.deleted_at !== null}
            deleteTitle="Move to Inactive"
          />
        ),
      },
    ],
    [today, canEdit, canDelete, router, handleRestore],
  );

  // ── Pieces ───────────────────────────────────────────────────────────────────
  const addButton = canCreate ? (
    <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => router.push("/service/assets/new")}>
      <Plus className="size-3.5" /> Add Asset
    </Button>
  ) : null;
  // Also gated on the module actually being registered in the import framework.
  // Phase 1 Task 11 adds the `customer_assets` descriptor; until then ImportWizard
  // would open and render nothing, so the button would silently do nothing. Keying
  // on the registry rather than a flag means it appears by itself once Task 11 lands.
  const importButton = canImport && isImportModule("customer_assets") ? (
    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setImportOpen(true)}>
      <Upload className="size-3.5" /> Import Assets
    </Button>
  ) : null;

  const statusSelected = filters.status ?? [];
  const typeKnown = !filters.assetTypeId || assetTypes.some((t) => t.value === filters.assetTypeId);

  const toolbar = (
    <PageToolbar
      className="rounded-lg border-b"
      filters={
        <>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, serial or code"
            aria-label="Search assets"
            className="h-8 w-52 text-xs"
          />
          <CustomerFilter
            value={customerValue}
            onChange={(next) => {
              setPickedCustomer(next);
              updateFilters({ contactId: next?.id });
            }}
          />
          <select
            aria-label="Asset type"
            className={SELECT_CLASS}
            value={filters.assetTypeId ?? ""}
            onChange={(e) => updateFilters({ assetTypeId: e.target.value || undefined })}
          >
            <option value="">All types</option>
            {assetTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
            {!typeKnown && <option value={filters.assetTypeId}>Unknown type</option>}
          </select>
          <Popover>
            <PopoverTrigger
              className={`${SELECT_CLASS} flex items-center gap-1 ${statusSelected.length ? "border-primary text-primary" : ""}`}
            >
              {statusSelected.length === 0
                ? "All statuses"
                : statusSelected.length === 1
                  ? assetStatusLabel(statusSelected[0])
                  : `${statusSelected.length} statuses`}
              <ChevronDown className="size-3.5 opacity-60" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 border-border p-2">
              <div className="space-y-1">
                {ASSET_STATUSES.map((s) => (
                  <label
                    key={s}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={statusSelected.includes(s)}
                      onCheckedChange={(checked) => {
                        const next = checked ? [...statusSelected, s] : statusSelected.filter((v) => v !== s);
                        updateFilters({ status: next.length ? next : undefined });
                      }}
                      className="size-4"
                    />
                    {assetStatusLabel(s)}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <select
            aria-label="Warranty"
            className={SELECT_CLASS}
            value={filters.warranty ?? ""}
            onChange={(e) => updateFilters({ warranty: (e.target.value || undefined) as WarrantyFilter | undefined })}
          >
            <option value="">Any warranty</option>
            {WARRANTY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {territories.length > 0 || filters.territoryId ? (
            <SearchableSelect
              options={territories}
              value={filters.territoryId ?? ""}
              onChange={(v) => updateFilters({ territoryId: v || undefined })}
              placeholder="Territory"
              searchPlaceholder="Search territory..."
              className="h-8 w-44 bg-background px-2.5 text-xs"
            />
          ) : null}
          <Button
            type="button"
            variant={filters.showInactive ? "secondary" : "outline"}
            size="sm"
            aria-pressed={!!filters.showInactive}
            className="h-8 gap-1 text-xs"
            onClick={() => updateFilters({ showInactive: filters.showInactive ? undefined : true })}
          >
            {filters.showInactive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {filters.showInactive ? "Hide Inactive" : "Show Inactive"}
          </Button>
          {filtersActive && (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </>
      }
      actions={
        <>
          {importButton}
          {addButton}
        </>
      }
    />
  );

  const failureKey = lookupFailures.join("|");
  const partialBanner =
    lookupFailures.length > 0 && bannerDismissed !== failureKey ? (
      <Alert>
        <AlertTriangle className="size-4 text-amber-600" />
        <AlertTitle>Some filters could not be loaded</AlertTitle>
        <AlertDescription>
          Could not load {lookupFailures.join(", ")}. The list below is complete, but those filters may be
          missing or incomplete. Refresh the page to try again.
        </AlertDescription>
        <AlertAction>
          <button
            type="button"
            aria-label="Dismiss"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setBannerDismissed(failureKey)}
          >
            <X className="size-4" />
          </button>
        </AlertAction>
      </Alert>
    ) : null;

  const clearButton = filtersActive ? (
    <Button variant="outline" onClick={clearFilters}>
      Clear filters
    </Button>
  ) : undefined;

  // ── Branches: exactly one of these renders ───────────────────────────────────
  let body: React.ReactNode;
  if (state === "error") {
    body = (
      <EmptyState
        icon={<AlertTriangle className="size-6" />}
        title="Could not load assets."
        description={loadError?.message ?? "Something went wrong. Please try again."}
        action={
          <Button onClick={refresh} disabled={isPending}>
            Retry
          </Button>
        }
        secondaryAction={clearButton}
      />
    );
  } else if (state === "onboarding") {
    body = (
      <EmptyState
        icon={<PackageSearch className="size-6" />}
        title="No assets yet."
        description="Add your first asset, or import a list."
        action={addButton ?? undefined}
        secondaryAction={importButton ?? undefined}
      />
    );
  } else if (state === "no-match") {
    const summary = humanize(assetFilterSummary(filters));
    body = (
      <EmptyState
        icon={<PackageSearch className="size-6" />}
        title="No assets match these filters."
        description={summary ? `Filtered by: ${summary}.` : undefined}
        action={clearButton}
      />
    );
  } else {
    body = (
      <DataTable
        columns={columns}
        data={rows}
        storageKey="wacrm_service_assets_table_columns"
        isLoading={isPending}
        rowKey={(a) => a.id}
        onRowClick={(a) => router.push(`/service/assets/${a.id}`)}
        serverPagination={{
          total,
          page,
          pageSize,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          onPageChange: (p) => go(filters, { page: p }),
          onPageSizeChange: (n) => go(filters, { pageSize: n }),
        }}
      />
    );
  }

  return (
    <PageLayout>
      {state !== "onboarding" && toolbar}
      {partialBanner}
      {body}

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title="Move Asset to Inactive"
        description={
          <>
            Move <span className="font-medium text-foreground">{archiveTarget?.name}</span> to Inactive? It will
            be hidden from the default list but you can re-activate it anytime via “Show Inactive”.
          </>
        }
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={archiving}
        onConfirm={handleArchive}
      />

      {importOpen && (
        <ImportWizard
          open={importOpen}
          onOpenChange={setImportOpen}
          module="customer_assets"
          onImported={refresh}
        />
      )}
    </PageLayout>
  );
}
