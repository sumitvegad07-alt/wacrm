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

/** How long a print link keeps working. Long enough to reload the tab. */
export const PRINT_TTL_MS = 60 * 60 * 1000;

/** How many lists we keep at once, newest first. */
const MAX_STASHES = 3;

/**
 * Hand a list to the print tab.
 *
 * localStorage, NOT sessionStorage. The print tab is opened with `noopener`,
 * which deliberately severs the link to the tab that opened it — and without
 * that opener relationship the browser gives the new tab a brand-new, empty
 * sessionStorage. The rows were therefore never there to read, and every
 * print said the link had expired. localStorage is shared across every tab of
 * the same origin with no opener needed.
 *
 * Not the URL either: a thousand-row list does not fit in a query string, and
 * re-querying in the print tab could print a different set of rows than the
 * one the user is looking at.
 *
 * Returns null when the rows could not be stored — the list is too big for
 * the browser's quota. The caller must say so rather than opening a tab that
 * can only report failure.
 */
export function stashListPayload(payload: ListPrintPayload): string | null {
  const key = `${PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const body = JSON.stringify(payload);

  try {
    prune();
    localStorage.setItem(key, body);
    return key;
  } catch {
    // Most likely the quota. Drop every stash we own and try once more, so a
    // big list still prints when the only thing in the way is an older one.
    try {
      clearAll();
      localStorage.setItem(key, body);
      return key;
    } catch {
      return null;
    }
  }
}

/**
 * Read it back, in the print tab. Never throws.
 *
 * Deliberately does not delete what it read: reloading the print tab is the
 * obvious thing to do when a sheet looks wrong, and a one-shot read would
 * turn that into "expired". Old entries go on the next write instead.
 */
export function readListPayload(key: string): ListPrintPayload | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ListPrintPayload;
  } catch {
    return null;
  }
}

/** Our keys, newest first. */
function ourKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  return keys.sort((a, b) => stamp(b) - stamp(a));
}

function stamp(key: string): number {
  return Number(key.slice(PREFIX.length).split("_")[0]) || 0;
}

function clearAll() {
  for (const k of ourKeys()) localStorage.removeItem(k);
}

/**
 * Drop anything past its time, and anything beyond the few most recent.
 * Printed lists are large and worthless once printed; leaving them to pile up
 * in a browser the user never clears would eventually block the next print.
 */
function prune() {
  const now = Date.now();
  const keys = ourKeys();
  keys.forEach((k, i) => {
    if (now - stamp(k) > PRINT_TTL_MS || i >= MAX_STASHES - 1) {
      localStorage.removeItem(k);
    }
  });
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
