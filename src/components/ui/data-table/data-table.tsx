"use client";

import { useState, useEffect, useMemo, useRef, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTableToolbarSlot } from "@/components/layout/table-toolbar-slot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Download, ChevronLeft, ChevronRight, Menu, Printer } from "lucide-react";
import { stashListPayload } from "@/lib/print/list-payload";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ColumnDef } from "./data-table-types";
import { DataTableHeader } from "./data-table-header";
import { DataTableFilterRow } from "./data-table-filter-row";
import { ManageColumnsDialog } from "./manage-columns-dialog";
import { TableViewsBar } from "./table-views-bar";
import { useDataExport } from "@/hooks/use-data-export";
import { useUnseenRecords, type RecordModule } from "@/hooks/use-record-views";
import type { TableViewApi } from "@/hooks/use-table-view";
import { reconcileColumns } from "@/lib/table-views";
import { TableSkeleton, EmptyState } from "@/components/shared";
import { toast } from "sonner";
import { EXPORT_MAX_ROWS } from "@/lib/table/export-all-pages";
import { errorMessage } from '@/lib/errors/message';

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  /**
   * The screen's table state, from `useTableView(storageKey, defaultFilters)`.
   *
   * It owns the filters, the column layout, the rows per page and the saved
   * views, so all of that survives leaving the screen and coming back. The page
   * holds the hook rather than the table because the page needs `filterState`
   * to filter its own rows.
   */
  tableView: TableViewApi;
  isLoading?: boolean;
  emptyMessage?: React.ReactNode;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /**
   * Where a row goes when it is clicked. Prefer this over doing the
   * `router.push` yourself in `onRowClick`.
   *
   * Knowing the destination up front is what lets the table warm Next's router
   * cache while the pointer rests on a row, and show the row as busy for the
   * gap between the click and the new page. A row used to be a bare
   * `<tr onClick>` that pushed on click: nothing was ever prefetched, so every
   * row click paid a cold round trip (measured at ~900ms on a warm localhost
   * production build, against 39ms once cached) with no spinner, no highlight
   * and no cursor change for the whole of it. It read as a dead click, people
   * clicked again, and the second click — now warm — opened the page, which is
   * why it looked like "it only works the second time".
   */
  rowHref?: (row: T) => string | null | undefined;
  /**
   * Draw a row bolder and tinted until this viewer has opened it.
   *
   * Pass the list's module (`"order"`, `"contact"`, …) and how to read a row's
   * creation time; the table looks up what this viewer has already opened and
   * styles the rest. Leave either out and no row is ever highlighted.
   *
   * The table does the lookup rather than the page, for two reasons. The
   * styling of "not read yet" has to be identical on all twenty-six lists, and
   * the only way to guarantee that is for the caller to own the question and
   * nothing else. And the table is the only thing that knows which rows are
   * actually *on screen* — asking about `paginatedData` is twenty ids, where a
   * page asking about its own filtered array could be a thousand.
   */
  unseenModule?: RecordModule;
  createdAtOf?: (row: T) => string | null | undefined;
  selection?: {
    selectedIds: Set<string>;
    onSelectAll: (checked: boolean) => void;
    onSelect: (id: string, checked: boolean) => void;
  };
  /**
   * Action buttons to render in the table header toolbar right before the table starts
   * (e.g. "+ Add Customer", "Import", etc.)
   */
  actions?: React.ReactNode;
  /**
   * Menu action items to render under the three-lines More Menu button
   * (e.g. Import Products, Hide Inactive toggle, etc.)
   */
  menuActions?: React.ReactNode;
  /**
   * Server-driven paging. Omit it and the table pages `data` itself (every existing screen).
   * When set, `data` is ONE page that the server has already sliced, so the table must not slice
   * or count it again: `total` is the row count across ALL pages, `page` is 1-based, and the
   * footer's Prev / Next / rows-per-page controls call back instead of paging locally.
   * Export CSV is left out in this mode because it could only export the loaded page.
   */
  serverPagination?: {
    total: number;
    page: number;
    pageSize: number;
    /** Choices for the rows-per-page select. Defaults to 10 / 20 / 50 / 100. */
    pageSizeOptions?: number[];
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    /**
     * Fetches EVERY row of the current search/filter, for Export CSV.
     *
     * Without it the button could only ever export the twenty rows on screen,
     * which is never what the user means — so a screen that omits this gets no
     * Export button at all rather than a misleading one. `useServerTable`
     * callers pass `exportAll: () => fetchAllPages(...)`.
     */
    exportAll?: () => Promise<{ rows: unknown[]; truncated: boolean }>;
  };
  /**
   * Accepted and ignored since the toolbar line was removed — every column
   * carries its own filter now, which is what made the global box redundant.
   *
   * Kept on the interface so the twenty-odd screens that pass it keep
   * compiling; the prop and its call sites come out in a separate pass.
   */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /**
   * Desktop only: take the height the page has left over and scroll the rows
   * inside the grid, with the headings and the filter row pinned at the top
   * and the pagination bar pinned at the bottom.
   *
   * Needs an ancestor that is itself height-constrained — on a module page
   * that is `<PageLayout fill>`. Without one it is inert and the table grows
   * with its rows exactly as before, so it is safe to pass anywhere.
   */
  fill?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  tableView,
  isLoading,
  emptyMessage = "No data found.",
  rowKey,
  onRowClick,
  rowHref,
  unseenModule,
  createdAtOf,
  selection,
  actions,
  menuActions,
  serverPagination,
  search,
  fill = false,
}: DataTableProps<T>) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const [pendingRowKey, setPendingRowKey] = useState<string | null>(null);
  const prefetched = useRef<Set<string>>(new Set());
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isManageColumnsOpen, setIsManageColumnsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isExporting, setIsExporting] = useState(false);
  const { exportToCsv } = useDataExport();

  const safeData = data || [];
  const safeColumns = columns || [];
  const storageKey = tableView.storageKey;
  const filterState = tableView.filterState;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const toolbarSlot = useTableToolbarSlot();

  // Claim on mount so PageHeader renders even on a page whose header has no
  // content of its own; release on unmount so it goes back to returning null.
  const { claim: claimToolbarSlot, release: releaseToolbarSlot } = toolbarSlot;
  useEffect(() => {
    claimToolbarSlot();
    return () => releaseToolbarSlot();
  }, [claimToolbarSlot, releaseToolbarSlot]);

  // The busy row clears when React finishes the navigation — or when this page
  // is left, so a row never stays highlighted behind a cancelled one.
  useEffect(() => {
    if (!isNavigating) setPendingRowKey(null);
  }, [isNavigating]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [safeData.length]);

  /**
   * The effective column layout, derived rather than stored.
   *
   * `tableView` holds what the user chose (or what a saved view carried);
   * `reconcileColumns` merges that with the columns this release actually
   * defines. Being a pure derivation means switching view updates the table in
   * the same render — no effect, no flicker, and no writing a merged layout back
   * to storage behind the user's back.
   */
  const { active: activeColumnIds, visible: visibleColumnIds } = useMemo(
    () => reconcileColumns(safeColumns, tableView.columnState),
    [safeColumns, tableView.columnState],
  );

  // Tell the hook what is really on screen, so "Save as new view" records this
  // layout even when the user has never opened Manage Columns.
  const reportEffectiveColumns = tableView.reportEffectiveColumns;
  useEffect(() => {
    reportEffectiveColumns({ active: activeColumnIds, visible: visibleColumnIds });
  }, [reportEffectiveColumns, activeColumnIds, visibleColumnIds]);

  /**
   * Export CSV.
   *
   * In local mode the whole table is already in `safeData`, so it exports that.
   * In server mode only one page is in memory, so it asks the screen for every
   * row of the current search and filter — see fetchAllPages. A server-paged
   * screen that supplies no `exportAll` gets no button, because exporting the
   * twenty rows on screen is never what the user means.
   */
  const canExport = !serverPagination || Boolean(serverPagination.exportAll);

  // Same rule as Export: without `exportAll` a server-paged screen could only
  // print the page on screen, which is never what "print the list" means, so
  // the entry is not offered rather than offered and misleading.
  const canPrintList = canExport;

  const handleExport = async () => {
    const filename = `${storageKey.replace("wacrm_", "").replace("_table_columns", "")}_export_${new Date().toISOString().split("T")[0]}.csv`;

    if (!serverPagination) {
      exportToCsv(safeData, visibleColumns, filename);
      return;
    }
    if (!serverPagination.exportAll) return;

    setIsExporting(true);
    const toastId = toast.loading("Preparing export…");
    try {
      const { rows, truncated } = await serverPagination.exportAll();
      exportToCsv(rows as T[], visibleColumns, filename);
      if (truncated) {
        toast.warning(
          `Exported the first ${EXPORT_MAX_ROWS.toLocaleString()} rows. Narrow the filter to export the rest.`,
          { id: toastId },
        );
      } else {
        toast.success(`Exported ${rows.length.toLocaleString()} rows.`, { id: toastId });
      }
    } catch (err) {
      toast.error(errorMessage(err, "Export failed."), { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  /**
   * Print the list, at A4 or A5.
   *
   * Reuses exactly what Export CSV uses — `exportAll()` for the server-paged
   * screens, `safeData` otherwise — so the sheet carries every row matching
   * the current search and filters, not the twenty on screen. Same rule about
   * a screen without `exportAll`: see canPrintList.
   */
  const handlePrintList = async (size: "a4" | "a5") => {
    let rows: Record<string, unknown>[] = safeData as Record<string, unknown>[];
    let truncated = false;

    if (serverPagination) {
      if (!serverPagination.exportAll) return;
      setIsExporting(true);
      try {
        const result = await serverPagination.exportAll();
        rows = result.rows as Record<string, unknown>[];
        truncated = result.truncated;
      } catch (err) {
        toast.error(errorMessage(err, "Could not prepare the print."));
        return;
      } finally {
        setIsExporting(false);
      }
    }

    const key = stashListPayload({
      // document.title carries the screen's name, which is what the sheet
      // should be headed — no screen has to pass one in.
      title: (document.title || "List").replace(/\s*[|·-]\s*OZZO.*$/i, "").trim() || "List",
      // `id`, not a guess: that is the key Export CSV resolves a value with.
      columns: visibleColumns.map((c) => ({ key: c.id, label: c.label, type: c.type })),
      rows,
      total: serverPagination ? rows.length : totalRecords,
      truncated,
      printedAt: new Date().toISOString(),
    });

    // Nowhere to put the rows — almost always a list too big for the
    // browser's quota. Say so, rather than opening a tab that can only
    // report that the link is dead.
    if (!key) {
      toast.error("That list is too large to print. Narrow the filter and try again.");
      return;
    }

    window.open(`/print/list?key=${key}&size=${size}`, "_blank", "noopener");
  };

  const handleSaveColumns = (active: string[], visible: string[]) => {
    tableView.setColumnState({ active, visible });
  };

  // Local mode pages `safeData` here; server mode trusts the page it was handed.
  const effectivePageSize = serverPagination ? serverPagination.pageSize : tableView.pageSize;
  const totalRecords = serverPagination ? serverPagination.total : safeData.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / effectivePageSize));
  const safePage = Math.min(serverPagination ? serverPagination.page : currentPage, totalPages);
  const startIndex = (safePage - 1) * effectivePageSize;
  const endIndex = serverPagination
    ? Math.min(startIndex + safeData.length, totalRecords)
    : Math.min(startIndex + effectivePageSize, totalRecords);
  const paginatedData = useMemo(() => {
    return serverPagination ? safeData : safeData.slice(startIndex, endIndex);
  }, [safeData, startIndex, endIndex, serverPagination]);

  /**
   * The rows on this page this viewer has not opened yet. Asked about the rows
   * on screen only, and above the `isMounted` early return, because a hook
   * cannot be called conditionally.
   */
  const unseenRowKeys = useUnseenRecords({
    module: unseenModule,
    rows: paginatedData,
    idOf: rowKey,
    createdAtOf,
  });

  if (!isMounted) return null; // Avoid hydration mismatch

  // The row-actions column is pinned to the 2nd position (right after the
  // selection checkbox) on every table — checkbox → Action → data — rather
  // than floating at the end. It's excluded from the manageable/visible set
  // so it can't be hidden or reordered away.
  const actionsColumn = safeColumns.find(c => c.id === "actions") || null;

  // Determine the ordered visible columns
  const visibleColumns = activeColumnIds
    .filter(id => visibleColumnIds.includes(id))
    .map(id => safeColumns.find(c => c.id === id))
    .filter(Boolean) as ColumnDef<T>[];

  // Total leading (non-data) columns: selection + pinned actions.
  const leadingColSpan = (selection ? 1 : 0) + (actionsColumn ? 1 : 0);

  /**
   * Pinned heading + filter rows, for `fill` mode only.
   *
   * They stick to the TABLE's own scrollport, so they need an opaque
   * background of their own — a transparent cell would let the rows scroll
   * through it. The filter band is `bg-muted` rather than the row's
   * `bg-muted/20` for the same reason, which also makes headings, filters and
   * data read as three distinct bands. `top-8` is the 32px heading row above.
   */
  /**
   * Warm the router cache while the pointer rests on a row.
   *
   * After a short dwell, not on the first pixel of contact: running down a
   * hundred rows with the mouse on the way to the scrollbar should not fire a
   * hundred requests. Each href is only ever prefetched once.
   */
  const prefetchRow = (row: T) => {
    if (!rowHref) return;
    const href = rowHref(row);
    if (!href || prefetched.current.has(href)) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (prefetched.current.has(href)) return;
      prefetched.current.add(href);
      try {
        router.prefetch(href);
      } catch {
        // A prefetch is an optimisation; the click still works without it.
      }
    }, 120);
  };

  const cancelPrefetch = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  /**
   * Open a row. Inside `startNavigation` so React keeps the old page
   * interactive and tells us it is busy, which is what paints the row as
   * pending instead of leaving the screen looking inert.
   */
  const activateRow = (row: T) => {
    const href = rowHref?.(row);
    if (href) {
      setPendingRowKey(rowKey(row));
      startNavigation(() => router.push(href));
      return;
    }
    onRowClick?.(row);
  };

  const rowIsInteractive = Boolean(onRowClick || rowHref);

  const headCellClass = fill ? "lg:sticky lg:top-0 lg:z-20 lg:bg-card" : undefined;
  const filterCellClass = fill ? "lg:sticky lg:top-8 lg:z-10 lg:bg-muted" : undefined;

  const allOnPageSelected = paginatedData.length > 0 && paginatedData.every(row => selection?.selectedIds.has(rowKey(row)));
  const someOnPageSelected = paginatedData.some(row => selection?.selectedIds.has(rowKey(row)));

  /**
   * Everything that used to live on the toolbar line. Built once so the same
   * markup can go either to the page heading row or, with no slot, inline.
   */
  const toolbarControls = (
    <>
      <TableViewsBar view={tableView} />
      <span className="font-semibold text-foreground text-xs whitespace-nowrap">
        Total: {totalRecords} records
      </span>
      {actions}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More table actions"
          className="flex h-11 w-11 md:h-7 md:w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
          title="Table actions menu"
        >
          <Menu className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 text-xs">
          {menuActions}
          {menuActions && canExport && <DropdownMenuSeparator />}
          {canExport && (
            <DropdownMenuItem
              onClick={handleExport}
              disabled={isExporting}
              className="cursor-pointer gap-2"
            >
              <Download className="size-3.5" />
              {isExporting ? "Exporting…" : "Export CSV"}
            </DropdownMenuItem>
          )}
          {canPrintList && <DropdownMenuSeparator />}
          {canPrintList && (
            <DropdownMenuItem
              onClick={() => handlePrintList("a4")}
              disabled={isExporting}
              className="cursor-pointer gap-2"
            >
              <Printer className="size-3.5" />
              Print list (A4)
            </DropdownMenuItem>
          )}
          {canPrintList && (
            <DropdownMenuItem
              onClick={() => handlePrintList("a5")}
              disabled={isExporting}
              className="cursor-pointer gap-2"
            >
              <Printer className="size-3.5" />
              Print list (A5)
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div
      data-slot="data-table"
      className={cn(
        "flex flex-col",
        // `flex-1` claims the leftover height inside a `<PageLayout fill>`.
        // The explicit `min-h` does two jobs: like `min-h-0` it switches off a
        // flex item's automatic content-based minimum, which is what lets the
        // rows scroll rather than pushing the pagination bar off the bottom —
        // and it stops a page whose cards and charts eat the viewport from
        // squeezing the grid down to a sliver. Past that floor the page
        // scrolls instead.
        fill && "lg:flex-1 lg:min-h-[280px]",
      )}
    >
      {/* The toolbar line is gone. Its controls now sit in the page heading
          row, reached through a portal, so the grid starts right at the top of
          the page. The inline fallback is not decorative: a table rendered
          outside the dashboard shell has no slot, and controls with nowhere to
          go would vanish silently. */}
      {toolbarSlot.node
        ? createPortal(toolbarControls, toolbarSlot.node)
        : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-2.5 py-1.5 text-xs">
            {toolbarControls}
          </div>
        )}

      <div
        className={cn(
          // `rounded-t-xl` moved here from the toolbar line that used to sit
          // above: the grid is the top edge of the card now.
          "flex flex-col rounded-t-xl border border-border bg-card",
          fill ? "lg:min-h-0 lg:flex-1" : "overflow-hidden",
        )}
      >
        <Table
          containerClassName={cn(fill && "lg:min-h-0 lg:flex-1 lg:overflow-auto")}
          // With no rows the table is only as tall as its headings, leaving the
          // "no data" line stranded at the top of a tall empty grid. Stretching
          // it centres that message in the space instead. Only ever when the
          // body is empty — on a table with rows it would stretch them.
          className={cn(fill && !isLoading && paginatedData.length === 0 && "lg:h-full")}
        >
          <TableHeader>
            <TableRow>
              {selection && (
                <TableHead className={cn("w-11 md:w-10", headCellClass)}>
                  {/* The visible box stays 16px; the label around it is the
                      44px tap target on phones. Measured by the responsive
                      suite through `data-touch-target`. */}
                  <label
                    data-touch-target
                    className="inline-flex h-11 w-11 md:h-auto md:w-auto cursor-pointer items-center justify-center"
                  >
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer accent-primary align-middle"
                    checked={allOnPageSelected}
                    ref={input => {
                      if (input) {
                        input.indeterminate = !allOnPageSelected && someOnPageSelected;
                      }
                    }}
                    onChange={(e) => selection.onSelectAll(e.target.checked)}
                    aria-label="Select all rows on this page"
                  />
                  </label>
                </TableHead>
              )}
              {actionsColumn && (
                <TableHead className={cn("w-24 whitespace-nowrap text-xs font-semibold text-muted-foreground", headCellClass)}>
                  {actionsColumn.label || "Action"}
                </TableHead>
              )}
              {visibleColumns.map(col => (
                <DataTableHeader
                  key={col.id}
                  column={col}
                  filterValue={filterState[col.id]}
                  className={headCellClass}
                />
              ))}
            </TableRow>
            {/* Filters sit in their own permanent row under the headings, so
                what a table is filtered by is visible rather than hidden
                behind a click on the heading. */}
            <DataTableFilterRow
              columns={visibleColumns}
              filterState={filterState}
              onFilterChange={tableView.setFilter}
              leadingColSpan={leadingColSpan}
              cellClassName={filterCellClass}
            />
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + leadingColSpan} className="p-0">
                  <TableSkeleton columns={visibleColumns.length + leadingColSpan} rows={5} />
                </TableCell>
              </TableRow>
            ) : paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + leadingColSpan} className="p-0">
                  {typeof emptyMessage === "string" ? (
                    <EmptyState title={emptyMessage} className="border-0 rounded-none bg-transparent my-4" />
                  ) : (
                    <div className="py-8 text-center text-muted-foreground">{emptyMessage}</div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row) => (
                // Cells are py-0.5, not py-1: a `size="sm"` Button rendered
                // inside one is 28px tall and would otherwise set the row
                // height to 37px on its own. 2px around it keeps the row at the
                // 33px `h-8` asks for, and text-only cells stay centred by
                // `align-middle` either way.
                <TableRow
                  key={rowKey(row)}
                  aria-busy={pendingRowKey === rowKey(row) || undefined}
                  className={cn(
                    "h-8 transition-colors hover:bg-muted/50",
                    rowIsInteractive && "cursor-pointer",
                    // Not opened by this viewer yet: a bar down the left edge, a
                    // tint, and more weight.
                    //
                    // All three, because any one of them alone failed. The first
                    // attempt was a 6% tint plus semibold, which is a reasonable
                    // signal on white and is simply not there on this app's dark
                    // theme — the founder's verdict on it was "no difference at
                    // all". And weight alone is invisible in a column rendered
                    // as a coloured link or a badge, which on these lists is
                    // most of them. The bar is the part that survives both, and
                    // it is a shape rather than a colour, so it also survives a
                    // monochrome print-out and colour-blindness.
                    //
                    // Listed before the pending class so a click still overrides
                    // it.
                    unseenRowKeys?.has(rowKey(row)) &&
                      "border-l-2 border-l-primary bg-primary/10 font-semibold text-foreground",
                    // The click landed: say so immediately, and keep saying it
                    // until the next page is on screen.
                    pendingRowKey === rowKey(row) && "bg-primary/10 cursor-progress hover:bg-primary/10",
                  )}
                  onPointerEnter={() => prefetchRow(row)}
                  onPointerLeave={cancelPrefetch}
                  onClick={() => activateRow(row)}
                >
                  {selection && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <label
                        data-touch-target
                        className="inline-flex h-11 w-11 md:h-auto md:w-auto cursor-pointer items-center justify-center"
                      >
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer accent-primary align-middle"
                          checked={selection.selectedIds.has(rowKey(row))}
                          onChange={(e) => selection.onSelect(rowKey(row), e.target.checked)}
                        />
                      </label>
                    </TableCell>
                  )}
                  {actionsColumn && (
                    <TableCell className="py-0.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {actionsColumn.render ? actionsColumn.render(row) : null}
                    </TableCell>
                  )}
                  {visibleColumns.map(col => (
                    <TableCell key={col.id} className={cn("py-0.5", col.cellClassName)}>
                      {col.render ? col.render(row) : (row as any)[col.id] || "-"}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Koops Demo Style Bottom Footer Bar (Total Count, Rows per page, MANAGE COLUMN, Pagination) */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-3 py-1.5 rounded-b-xl border border-t-0 border-border bg-muted/20 text-xs text-muted-foreground min-h-[48px] lg:min-h-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 font-medium">
            <span>Show</span>
            <select
              value={effectivePageSize}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (serverPagination) {
                  serverPagination.onPageSizeChange(next);
                  return;
                }
                tableView.setPageSize(next);
                setCurrentPage(1);
              }}
              className="h-11 md:h-7 rounded border border-border bg-background px-2 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {(serverPagination?.pageSizeOptions ?? [10, 20, 50, 100]).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span>rows per page</span>
          </div>
          <span className="h-4 w-px bg-border hidden sm:inline-block" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs h-11 md:h-7 text-muted-foreground gap-1.5 px-2.5 bg-background hover:bg-muted font-medium"
            onClick={() => setIsManageColumnsOpen(true)}
          >
            <LayoutGrid className="size-3" />
            MANAGE COLUMN
          </Button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-medium">
            {totalRecords === 0 ? 0 : startIndex + 1} - {endIndex} of {totalRecords}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() =>
                serverPagination
                  ? serverPagination.onPageChange(Math.max(1, safePage - 1))
                  : setCurrentPage((p) => Math.max(1, p - 1))
              }
              className="h-11 md:h-7 px-2.5 text-xs bg-background hover:bg-muted font-medium"
            >
              <ChevronLeft className="size-3.5 mr-1" />
              Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() =>
                serverPagination
                  ? serverPagination.onPageChange(Math.min(totalPages, safePage + 1))
                  : setCurrentPage((p) => Math.min(totalPages, p + 1))
              }
              className="h-11 md:h-7 px-2.5 text-xs bg-background hover:bg-muted font-medium"
            >
              Next
              <ChevronRight className="size-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      <ManageColumnsDialog
        open={isManageColumnsOpen}
        onOpenChange={setIsManageColumnsOpen}
        columns={columns}
        activeColumnIds={activeColumnIds}
        visibleColumnIds={visibleColumnIds}
        onSave={handleSaveColumns}
      />
    </div>
  );
}
