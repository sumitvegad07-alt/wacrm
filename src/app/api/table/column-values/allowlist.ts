/**
 * The only module/column pairs whose distinct values may be listed.
 *
 * This map IS the security boundary for /api/table/column-values: nothing a
 * caller sends ever reaches SQL, only the table and column names found here.
 * Adding a pair is a deliberate decision — never widen it to "any column of
 * this table", and never list a column that identifies a person or a tenant.
 *
 * Columns that already have a configured list behind them — Lead Status,
 * Source, Industry, Category — do not belong here either. Those come from
 * their own master tables and need no scan.
 */
export const ALLOWED_MODULES: Readonly<
  Record<string, { table: string; columns: readonly string[] }>
> = Object.freeze({
  lead: {
    table: "leads",
    columns: ["city", "state", "country", "area", "company", "pincode"],
  },
  contact: {
    table: "contacts",
    columns: ["city", "state", "country", "area", "company", "pincode"],
  },
});

/**
 * Resolve a caller's module and column to the real table and column, or null
 * when the pair is not listed.
 *
 * Uses `Object.hasOwn` rather than a plain lookup so `constructor`,
 * `__proto__` and friends cannot resolve to something off Object.prototype.
 */
export function resolveAllowed(
  module: string,
  column: string,
): { table: string; column: string } | null {
  if (!Object.hasOwn(ALLOWED_MODULES, module)) return null;
  const entry = ALLOWED_MODULES[module];
  if (!entry.columns.includes(column)) return null;
  return { table: entry.table, column };
}
