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
  /**
   * Where a `select` filter gets its values when the column has no `options`.
   *
   * Columns backed by a master list — Lead Status, Source, Industry — keep
   * using `options` and need none of this. The rest fall into two kinds:
   * people (Owner, Collaborator, Assignee), which come from the account's
   * staff list, and free text (City, Area, Company), which comes from a capped
   * scan of the account's own rows.
   *
   * `module` and `column` are matched against a hard-coded allowlist on the
   * server; they are never interpolated into SQL.
   */
  valueSource?:
    | {
        kind: "people";
        /**
         * Which id the chosen value carries, because the two are not
         * interchangeable and the wrong one silently matches nothing.
         *
         * `auth` is `profiles.user_id` — what `leads.owner_id` and
         * `collaborator_ids` hold. `profile` is `profiles.id` — what
         * `expenses.employee_id` and the route plans hold.
         */
        idSpace: "profile" | "auth";
      }
    | { kind: "distinct"; module: string; column: string };
  visibleByDefault?: boolean;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
}

export interface FilterState {
  [columnId: string]: any;
}
