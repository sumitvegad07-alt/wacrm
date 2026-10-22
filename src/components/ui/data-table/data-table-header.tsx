"use client";

import { Search } from "lucide-react";
import { ColumnDef } from "./data-table-types";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableHeaderProps<T> {
  column: ColumnDef<T>;
  /** Extra classes for the cell — the table passes the pinned-heading rules. */
  className?: string;
  /**
   * Only to show whether this column is filtered. Setting the filter belongs
   * to `DataTableFilterRow`, the permanent row under the headings; this is a
   * heading again, as the name always claimed.
   */
  filterValue: unknown;
}

function isSet(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0 && value.some((v) => v !== "");
  return true;
}

export function DataTableHeader<T>({ column, filterValue, className }: DataTableHeaderProps<T>) {
  // A column with no `type` cannot be filtered, so it never shows the marker.
  const isActive = Boolean(column.type) && isSet(filterValue);

  return (
    <TableHead className={cn("whitespace-nowrap px-2 font-semibold text-foreground", column.cellClassName, className)}>
      <span className="flex items-center gap-1.5">
        {isActive && (
          <Search className="size-3.5 shrink-0 text-primary" aria-label="Filtered" />
        )}
        <span className={isActive ? "text-primary" : undefined}>{column.label}</span>
      </span>
    </TableHead>
  );
}
