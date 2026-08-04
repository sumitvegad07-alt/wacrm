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
import { ColumnDef, FilterState } from "./data-table-types";
import { DataTableHeader } from "./data-table-header";
import { ManageColumnsDialog } from "./manage-columns-dialog";
import { useDataExport } from "@/hooks/use-data-export";
import { TableSkeleton, EmptyState } from "@/components/shared";

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  filterState?: FilterState;
  onFilterChange?: (columnId: string, value: any) => void;
  storageKey: string;
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
}

export function DataTable<T>({
  columns,
  data,
  filterState = {},
  onFilterChange = () => {},
  storageKey,
  isLoading,
  emptyMessage = "No data found.",
  rowKey,
  onRowClick,
  selection,
  actions,
  menuActions,
}: DataTableProps<T>) {
  const [isManageColumnsOpen, setIsManageColumnsOpen] = useState(false);
  const [activeColumnIds, setActiveColumnIds] = useState<string[]>([]);
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const { exportToCsv } = useDataExport();

  const safeData = data || [];
  const safeColumns = columns || [];

  useEffect(() => {
    setCurrentPage(1);
  }, [safeData.length]);

  // Load preferences from local storage on mount
  useEffect(() => {
    setIsMounted(true);
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.active && parsed.visible) {
          // Reconcile stored columns with current columns (in case new columns were added)
          const newColIds = safeColumns.map(c => c.id).filter(id => !parsed.active.includes(id));
          const allActive = [...parsed.active, ...newColIds];
          
          setActiveColumnIds(allActive);
          
          // New columns should be visible if visibleByDefault !== false
          const newVisibleCols = newColIds.filter(id => {
             const c = safeColumns.find(col => col.id === id);
             return c && c.visibleByDefault !== false;
          });
          setVisibleColumnIds([...parsed.visible, ...newVisibleCols]);
          return;
        }
      } catch (e) {
        console.error("Failed to parse column preferences", e);
      }
    }
    
    // Default fallback
    const defaultIds = safeColumns.map(c => c.id);
    const defaultVisible = safeColumns.filter(c => c.visibleByDefault !== false).map(c => c.id);
    setActiveColumnIds(defaultIds);
    setVisibleColumnIds(defaultVisible);
  }, [safeColumns, storageKey]);

  const handleSaveColumns = (active: string[], visible: string[]) => {
    setActiveColumnIds(active);
    setVisibleColumnIds(visible);
    localStorage.setItem(storageKey, JSON.stringify({ active, visible }));
  };

  const totalRecords = safeData.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRecords);
  const paginatedData = useMemo(() => {
    return safeData.slice(startIndex, endIndex);
  }, [safeData, startIndex, endIndex]);

  if (!isMounted) return null; // Avoid hydration mismatch

  // Determine the ordered visible columns
  const visibleColumns = activeColumnIds
    .filter(id => visibleColumnIds.includes(id))
    .map(id => safeColumns.find(c => c.id === id))
    .filter(Boolean) as ColumnDef<T>[];

  const allOnPageSelected = paginatedData.length > 0 && paginatedData.every(row => selection?.selectedIds.has(rowKey(row)));
  const someOnPageSelected = paginatedData.some(row => selection?.selectedIds.has(rowKey(row)));

  return (
    <div className="space-y-0">
      {/* Top Table Toolbar (in that vertical line just before the starting of the table) */}
      {(actions || safeData.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-t-xl border border-b-0 border-border bg-muted/20 text-xs min-h-[44px]">
          <div className="flex items-center gap-2">
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
                {menuActions && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onClick={() => exportToCsv(safeData, visibleColumns, `${storageKey.replace('wacrm_', '').replace('_table_columns', '')}_export_${new Date().toISOString().split('T')[0]}.csv`)}
                  className="cursor-pointer gap-2"
                >
                  <Download className="size-3.5" />
                  Export CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

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
              {visibleColumns.map(col => (
                <DataTableHeader
                  key={col.id}
                  column={col}
                  filterValue={filterState[col.id]}
                  onFilterChange={onFilterChange}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + (selection ? 1 : 0)} className="p-0">
                  <TableSkeleton columns={visibleColumns.length + (selection ? 1 : 0)} rows={5} />
                </TableCell>
              </TableRow>
            ) : paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + (selection ? 1 : 0)} className="p-0">
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
                  className={`h-12 hover:bg-muted/50 transition-colors ${onRowClick ? "cursor-pointer" : ""}`}
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
                  {visibleColumns.map(col => (
                    <TableCell key={col.id} className="py-3">
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
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-7 rounded border border-border bg-background px-2 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
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
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
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
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
