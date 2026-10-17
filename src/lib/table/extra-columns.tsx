import React from "react";
import type { ColumnDef, ColumnFilterType } from "@/components/ui/data-table/data-table-types";
import { formatCurrency } from "@/lib/currency";

/**
 * The rest of a module's stored fields, as columns Manage Column can offer.
 *
 * A screen only ever showed the handful of columns somebody wrote by hand. A
 * field nobody wrote a column for could not be added to the table at all, no
 * matter what the account's field settings said — Employees had `mobile`
 * configured as "Contact Number" with show-in-table ON and still could not
 * show it, because there was no column to show it through.
 *
 * Everything built here is hidden by default, so a screen looks exactly as it
 * did until somebody ticks one.
 */

export type ExtraColumnKind = "text" | "number" | "currency" | "date" | "datetime" | "boolean";

/** `[field, heading, kind]`, with an optional reader for a value held elsewhere. */
export type ExtraColumnSpec<T> = readonly [
  id: string,
  label: string,
  kind: ExtraColumnKind,
  read?: (row: T) => unknown,
];

const dash = () => React.createElement("span", { className: "text-muted-foreground" }, "-");

/**
 * Money and counts get a from/to range. A contains match on an amount
 * misleads — searching 100 matches 1,100 — so these were left unfilterable
 * until the filter row learned ranges.
 */
function filterTypeFor(kind: ExtraColumnKind): ColumnFilterType | undefined {
  if (kind === "currency" || kind === "number") return "range";
  if (kind === "date" || kind === "datetime") return "date";
  if (kind === "boolean") return "select";
  return "text";
}

export function extraColumns<T>(
  specs: readonly ExtraColumnSpec<T>[],
  currencyCode?: string,
): ColumnDef<T>[] {
  return specs.map(([id, label, kind, read]) => {
    const valueOf = (row: T): unknown =>
      read ? read(row) : (row as Record<string, unknown>)[id];

    const column: ColumnDef<T> = {
      id,
      label,
      type: filterTypeFor(kind),
      visibleByDefault: false,
      // Filter on the stored value, never on the rendered one: a date must be
      // compared as a date, not as the string the cell happens to print.
      filterValue: (row) => {
        const value = valueOf(row);
        if (kind === "boolean") return value === true ? "true" : "false";
        return value;
      },
      render: (row) => {
        const value = valueOf(row);
        if (value === null || value === undefined || value === "") return dash();

        if (kind === "currency") {
          return React.createElement(
            "span",
            { className: "tabular-nums" },
            formatCurrency(Number(value), currencyCode),
          );
        }
        if (kind === "number") {
          return React.createElement("span", { className: "tabular-nums" }, String(value));
        }
        if (kind === "boolean") {
          return React.createElement("span", null, value === true ? "Yes" : "No");
        }
        if (kind === "date" || kind === "datetime") {
          const parsed = new Date(String(value));
          if (Number.isNaN(parsed.getTime())) return dash();
          return React.createElement(
            "span",
            { className: "text-sm text-muted-foreground" },
            kind === "date" ? parsed.toLocaleDateString() : parsed.toLocaleString(),
          );
        }
        return React.createElement("span", { className: "text-sm" }, String(value));
      },
    };

    if (kind === "boolean") {
      column.options = [
        { label: "Yes", value: "true" },
        { label: "No", value: "false" },
      ];
    }
    return column;
  });
}
