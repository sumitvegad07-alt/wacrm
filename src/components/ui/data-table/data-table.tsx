"use client";

import { useState, useEffect, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Download, ChevronLeft, ChevronRight, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColumnDef } from "./data-table-types";
import { DataTableHeader } from "./data-table-header";
import { ManageColumnsDialog } from "./manage-columns-dialog";
import { TableViewsBar } from "./table-views-bar";
import { useDataExport } from "@/hooks/use-data-export";
import type { TableViewApi } from "@/hooks/use-table-view";
import { reconcileColumns } from "@/lib/table-views";
import { TableSkeleton, EmptyState } from "@/components/shared";

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
  };
}

export function DataTable<T>({
  columns,
  data,
  tableView,
  isLoading,
  emptyMessage = "No data found.",
  rowKey,
  onRowClick,
  selection,
  actions,
  menuActions,
  serverPagination,
}: DataTableProps<T>) {
  const [isManageColumnsOpen, setIsManageColumnsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const { exportToCsv } = useDataExport();

  const safeData = data || [];
  const safeColumns = columns || [];
  const storageKey = tableView.storageKey;
  const filterState = tableView.filterState;

  useEffect(() => {
    setIsMounted(true);
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

  const allOnPageSelected = paginatedData.length > 0 && paginatedData.every(row => selection?.selectedIds.has(rowKey(row)));
  const someOnPageSelected = paginatedData.some(row => selection?.selectedIds.has(rowKey(row)));

  return (
    <div className="space-y-0">
      {/* Top Table Toolbar (in that vertical line just before the starting of the table) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-t-xl border border-b-0 border-border bg-muted/20 text-xs min-h-[44px]">
        <div className="flex items-center gap-3 flex-wrap">
          <TableViewsBar view={tableView} />
          <span className="font-semibold text-foreground text-xs">
            Total: {totalRecords} records
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actions}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More table actions"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
              title="Table actions menu"
            >
              <Menu className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 text-xs">
              {menuActions}
              {menuActions && !serverPagination && <DropdownMenuSeparator />}
              {!serverPagination && (
                <DropdownMenuItem
                  onClick={() => exportToCsv(safeData, visibleColumns, `${storageKey.replace('wacrm_', '').replace('_table_columns', '')}_export_${new Date().toISOString().split('T')[0]}.csv`)}
                  className="cursor-pointer gap-2"
                >
                  <Download className="size-3.5" />
                  Export CSV
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {selection && (
                <TableHead className="w-10">
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
                </TableHead>
              )}
              {actionsColumn && (
                <TableHead className="w-24 whitespace-nowrap text-xs font-semibold text-muted-foreground">
                  {actionsColumn.label || "Action"}
                </TableHead>
              )}
              {visibleColumns.map(col => (
                <DataTableHeader
                  key={col.id}
                  column={col}
                  filterValue={filterState[col.id]}
                  onFilterChange={tableView.setFilter}
                />
              ))}
            </TableRow>
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
                <TableRow
                  key={rowKey(row)}
                  className={`h-9 hover:bg-muted/50 transition-colors ${onRowClick ? "cursor-pointer" : ""}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {selection && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary align-middle"
                        checked={selection.selectedIds.has(rowKey(row))}
                        onChange={(e) => selection.onSelect(rowKey(row), e.target.checked)}
                      />
                    </TableCell>
                  )}
                  {actionsColumn && (
                    <TableCell className="py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {actionsColumn.render ? actionsColumn.render(row) : null}
                    </TableCell>
                  )}
                  {visibleColumns.map(col => (
                    <TableCell key={col.id} className="py-1.5">
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
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5 rounded-b-xl border border-t-0 border-border bg-muted/20 text-xs text-muted-foreground min-h-[48px]">
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
              className="h-7 rounded border border-border bg-background px-2 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
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
            className="text-xs h-7 text-muted-foreground gap-1.5 px-2.5 bg-background hover:bg-muted font-medium"
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
              className="h-7 px-2.5 text-xs bg-background hover:bg-muted font-medium"
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
              className="h-7 px-2.5 text-xs bg-background hover:bg-muted font-medium"
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
