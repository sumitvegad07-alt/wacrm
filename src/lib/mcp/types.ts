// ============================================================
// Catalog vocabulary: what a data set IS.
//
// Only the descriptor types live here. The other types in this module sit
// beside the code that owns them — McpContext in session.ts, FetchArgs /
// FetchResult in fetch.ts, TenantContext in gating.ts — so a reader looking
// at one of those files finds its own shapes without a detour.
// ============================================================
import type { ProductLine } from "@/lib/plans/catalog";

export type { ProductLine };

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "date" | "datetime" | "boolean";
}

export interface FilterDef {
  key: string;
  label: string;
  type: "id" | "text" | "select" | "date_range" | "time_of_day";
  options?: string[];
  /**
   * The report engine wants this filter's value wrapped in an object under
   * this property, e.g. `{ contact_id: "<id>" }` rather than a bare id.
   *
   * Carried on the descriptor rather than special-cased in fetch.ts, because
   * the whole point of the catalog is that the engine's expectations live in
   * one place. Getting this wrong is silent: execute_report matches nothing
   * and returns 0 instead of erroring, which is how "how many visits for
   * this customer" answered 0 against 5 real visits.
   */
  wrapIn?: string;
}

export interface DataSetDescriptor {
  /** The name the AI uses, e.g. "visits". */
  name: string;
  /** Human label, as the dashboard spells it. */
  title: string;
  route: "report" | "reader";
  /** Plan line required to see this at all. */
  line: ProductLine;
  /** accounts.settings module-toggle key, where the module is optional. */
  requiredModule?: string;
  /** Behind the mcp_allow_workforce_data privacy switch. */
  sensitive?: boolean;
  /** route "report": the execute_report module name. */
  reportModule?: string;
  /** route "reader": base table. */
  table?: string;
  /**
   * route "reader": the columns the `search` filter looks in.
   *
   * Explicit rather than inferred, because guessing "any text column" would
   * quietly search a GSTIN or an address when the admin asked for a company
   * name, and the AI would report a confident match on the wrong record.
   */
  searchFields?: string[];
  /**
   * route "reader": the timestamptz column a period filters on.
   *
   * Without this a reader data set ignores the time window entirely and
   * answers "the last 15 days" with the whole history, which looks like a
   * real answer.
   */
  dateColumn?: string;
  /** ALLOW-LIST of readable columns. No select *, ever. */
  fields: FieldDef[];
  filters: FilterDef[];
  /** group_by options. */
  dimensions: FieldDef[];
  measures: FieldDef[];
  /** Business rules, in prose, for the AI. Without these it invents its own
   *  definitions and reports a confidently wrong number. */
  notes: string;
  /** Worked example calls. Without these the AI fumbles its first two tries. */
  examples: string[];
}
