export interface ListPrintPayload {
  title: string;
  /**
   * `key` is the ColumnDef's `id`, which is how Export CSV resolves a value
   * too — so paper and CSV cannot disagree about what a column contains.
   */
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, unknown>[];
  total: number;
  /** True when the row fetch hit its cap, so the sheet can say so. */
  truncated: boolean;
  printedAt: string;
}

const PREFIX = "wacrm_print_list_";

/**
 * Hand a list to the print tab.
 *
 * sessionStorage rather than the URL: a thousand-row list does not fit in a
 * query string, and re-querying in the print tab would print a different set
 * of rows than the one the user is looking at — the single thing a printed
 * list must never do.
 *
 * Every read and write is guarded. In a private window, or with site data
 * blocked, these throw rather than return empty, and a print that cannot be
 * prepared must not take the screen down with it.
 */
export function stashListPayload(payload: ListPrintPayload): string {
  const key = `${PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Quota, or storage blocked. The print tab shows its expired state.
  }
  return key;
}

/** Read it back, in the print tab. Never throws. */
export function readListPayload(key: string): ListPrintPayload | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ListPrintPayload;
  } catch {
    return null;
  }
}

/**
 * One cell, as it should look on paper.
 *
 * `type` is the column's own type, matching what Export CSV does with a date
 * column — otherwise a date prints as a raw ISO string on paper and as a
 * readable date in the spreadsheet from the same list.
 */
export function formatCell(value: unknown, type?: string): string {
  if (type === "date" && value) {
    const d = new Date(value as string);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  }
  // Checked before the empty test, so a legitimate 0 or false still prints.
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "—";

  // Explicit arrow, not a bare `formatCell` reference: map would pass the
  // index as the second argument and every element after the first would be
  // formatted as though its column type were "1", "2", "3".
  if (Array.isArray(value)) return value.map((v) => formatCell(v, type)).join(", ");

  if (typeof value === "object") {
    // A joined record — a customer, an assignee, a product. Print what a
    // person would call it rather than its shape.
    const o = value as Record<string, unknown>;
    const named = o.name ?? o.full_name ?? o.title ?? o.label;
    return named === undefined ? JSON.stringify(value) : String(named);
  }

  return String(value);
}
