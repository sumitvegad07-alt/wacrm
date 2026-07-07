import { ReactNode } from "react";

export type ColumnFilterType = "text" | "select" | "date";

export interface ColumnOption {
  label: string;
  value: string;
}

export interface ColumnDef<T> {
  id: string;
  label: string;
  type?: ColumnFilterType;
  options?: ColumnOption[]; // For 'select' type filters
  visibleByDefault?: boolean;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
}

export interface FilterState {
  [columnId: string]: any;
}
