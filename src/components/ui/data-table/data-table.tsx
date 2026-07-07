"use client";

import { useState, useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Download } from "lucide-react";
import { ColumnDef, FilterState } from "./data-table-types";
import { DataTableHeader } from "./data-table-header";
import { ManageColumnsDialog } from "./manage-columns-dialog";
import { useDataExport } from "@/hooks/use-data-export";

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  filterState: FilterState;
  onFilterChange: (columnId: string, value: any) => void;
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
}

export function DataTable<T>({
  columns,
  data,
  filterState,
  onFilterChange,
  storageKey,
  isLoading,
  emptyMessage = "No data found.",
  rowKey,
  onRowClick,
  selection,
}: DataTableProps<T>) {
  const [isManageColumnsOpen, setIsManageColumnsOpen] = useState(false);
  const [activeColumnIds, setActiveColumnIds] = useState<string[]>([]);
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const { exportToCsv } = useDataExport();

  // Load preferences from local storage on mount
  useEffect(() => {
    setIsMounted(true);
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.active && parsed.visible) {
          // Reconcile stored columns with current columns (in case new columns were added)
          const newColIds = columns.map(c => c.id).filter(id => !parsed.active.includes(id));
          const allActive = [...parsed.active, ...newColIds];
          
          setActiveColumnIds(allActive);
          
          // New columns should be visible if visibleByDefault !== false
          const newVisibleCols = newColIds.filter(id => {
             const c = columns.find(col => col.id === id);
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
    const defaultIds = columns.map(c => c.id);
    const defaultVisible = columns.filter(c => c.visibleByDefault !== false).map(c => c.id);
    setActiveColumnIds(defaultIds);
    setVisibleColumnIds(defaultVisible);
  }, [columns, storageKey]);

  const handleSaveColumns = (active: string[], visible: string[]) => {
    setActiveColumnIds(active);
    setVisibleColumnIds(visible);
    localStorage.setItem(storageKey, JSON.stringify({ active, visible }));
  };

  if (!isMounted) return null; // Avoid hydration mismatch

  // Determine the ordered visible columns
  const visibleColumns = activeColumnIds
    .filter(id => visibleColumnIds.includes(id))
    .map(id => columns.find(c => c.id === id))
    .filter(Boolean) as ColumnDef<T>[];

  const allOnPageSelected = data.length > 0 && data.every(row => selection?.selectedIds.has(rowKey(row)));
  const someOnPageSelected = data.some(row => selection?.selectedIds.has(rowKey(row)));

  return (
    <div className="space-y-4">
      {/* Top Bar for Table Controls */}
      <div className="flex justify-end gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          className="text-xs h-8 text-muted-foreground gap-1.5"
          onClick={() => exportToCsv(data, visibleColumns, `${storageKey.replace('wacrm_', '').replace('_table_columns', '')}_export_${new Date().toISOString().split('T')[0]}.csv`)}
        >
          <Download className="size-3.5" />
          Export CSV
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="text-xs h-8 text-muted-foreground gap-1.5"
          onClick={() => setIsManageColumnsOpen(true)}
        >
          <LayoutGrid className="size-3.5" />
          Manage columns
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
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
                <TableCell colSpan={visibleColumns.length + (selection ? 1 : 0)} className="text-center py-12 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + (selection ? 1 : 0)} className="text-center py-12 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow 
                  key={rowKey(row)}
                  className={`hover:bg-muted/50 transition-colors ${onRowClick ? "cursor-pointer" : ""}`}
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
