import { ReactNode } from "react";

export type ColumnFilterType = "text" | "select" | "date";

export interface ColumnOption {
  label: string;
  value: string;
}

export interface ColumnDef<T> {
  id: string;
  label: string;
  /**
   * The `custom_fields.system_key` whose admin configuration governs this
   * column's heading and visibility. Defaults to `id`.
   *
   * Needed because a column's id is its identity (saved column preferences,
   * sorting, filter state) and is not always the same as the field it shows.
   * The customers table is the case that exposed this: its company column has
   * id "name" but renders `contact.company`, so it picked up the label for
   * system_key 'name' — "Contact Person" — and BOTH visible headings read
   * "Contact Person". Worse, hiding "Contact Person" in settings would have
   * hidden the company column.
   */
  systemKey?: string;
  type?: ColumnFilterType;
  options?: ColumnOption[]; // For 'select' type filters
  visibleByDefault?: boolean;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
}

export interface FilterState {
  [columnId: string]: any;
}
