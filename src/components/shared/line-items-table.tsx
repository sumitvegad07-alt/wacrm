import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The read-only table inside a detail page — order and quotation line items,
 * linked deals, stock movements, payment history.
 *
 * `DataTable` is the wrong tool for these: they have no filters, no column
 * management, no pagination and no saved views, and they are nested inside a
 * section rather than owning the page. So forty files hand-rolled a raw
 * `<table>` with their own `<th>`/`<td>` classes instead, and they drifted —
 * header rows variously `bg-muted/40` or `bg-muted/30` or nothing, cells
 * `px-4 py-3` or `px-3 py-2`, text `text-sm` or `text-xs`, and a `min-w-`
 * chosen per file.
 *
 * This wraps `ui/table`, so a line-items table and a data grid now share one
 * cell padding, one border treatment and one header style.
 */

export interface LineItemsTableProps {
  /** The `<tr>` of `LineItemsHead` cells. */
  head?: ReactNode;
  /**
   * Minimum width before the table scrolls sideways inside its own container.
   * A real minimum matters: without one, six columns of data collapse into
   * unreadable slivers on a narrow screen. Defaults to `40rem`.
   */
  minWidth?: string;
  className?: string;
  children: ReactNode;
}

export function LineItemsTable({
  head,
  minWidth = "40rem",
  className,
  children,
}: LineItemsTableProps) {
  return (
    <Table
      data-slot="line-items-table"
      containerClassName="rounded-lg border border-border"
      className={cn("text-table", className)}
      style={{ minWidth }}
    >
      {head && <TableHeader className="bg-muted/40">{head}</TableHeader>}
      <TableBody>{children}</TableBody>
    </Table>
  );
}

/** A column heading. Right-align a numeric column with `className="text-right"`. */
export function LineItemsHead({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <TableHead
      className={cn("text-caption font-semibold text-muted-foreground", className)}
    >
      {children}
    </TableHead>
  );
}

/** A body row. Pass `onClick` to make it navigate, and it becomes clickable. */
export function LineItemsRow({
  onClick,
  className,
  children,
}: {
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <TableRow
      onClick={onClick}
      // A clickable row is also reachable from the keyboard. The raw <tr
      // onClick> blocks these pages replaced were mouse-only.
      role={onClick ? "link" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(onClick && "cursor-pointer hover:bg-muted/40", className)}
    >
      {children}
    </TableRow>
  );
}

/** A body cell. */
export function LineItemsCell({
  className,
  colSpan,
  children,
}: {
  className?: string;
  colSpan?: number;
  children?: ReactNode;
}) {
  return (
    <TableCell colSpan={colSpan} className={cn("text-foreground", className)}>
      {children}
    </TableCell>
  );
}
