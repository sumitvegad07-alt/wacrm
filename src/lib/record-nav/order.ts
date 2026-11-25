/**
 * "Next record" — the order the list was in when you clicked into one.
 *
 * ── Why the order comes from the list and not from the database ──
 *
 * A detail page could ask the server for "the lead after this one" — but after
 * it *by what*? The list the user is working through is their own: their
 * search, their column filters, their sort, their saved view. A server query
 * ordered by `created_at` would answer a different question from the one the
 * screen in front of them is asking, and ‹ › would skip records they can see
 * and land on records they have filtered out. That is worse than no button.
 *
 * So the list is the source of truth. `DataTable` writes the ids it is
 * actually showing, in the order it is showing them, and a record's page reads
 * that back to find its neighbours. The two agree by construction.
 *
 * ── sessionStorage, not localStorage ──
 *
 * This is per-tab working state with a lifetime of one sitting. localStorage
 * would let a tab opened this morning hand a stale order to a tab opened this
 * afternoon, and would survive a logout. sessionStorage is already per-tab and
 * already cleared when the tab closes, which is exactly the lifetime wanted.
 *
 * Everything here fails closed and silently: private browsing, a full quota, a
 * disabled store, or anything else throwing means no order, which means no
 * arrows. A reading aid must never be able to break the page it sits on.
 */

const PREFIX = "ozzo:record-nav:";

/**
 * Past this, the order is assumed to be from an older sitting and ignored.
 * Long enough to cover a lunch break with the tab left open, short enough that
 * a list from this morning cannot send someone to a record that has since been
 * filtered away.
 */
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

/**
 * A ceiling on what is written, so a thousand-row list cannot fill the tab's
 * storage quota on its own. 2,000 ids of 36 characters is roughly 74KB, well
 * inside the usual 5MB, and no human pages through more than that.
 */
const MAX_IDS = 2000;

export type RecordOrder = { ids: string[]; savedAt: number };

export type Neighbours = {
  /** The record before this one in the list, or null at the top. */
  prevId: string | null;
  /** The record after this one in the list, or null at the bottom. */
  nextId: string | null;
  /** 1-based position, or 0 when this record is not in the saved order. */
  position: number;
  /** How many records the list was showing. */
  total: number;
};

export const NO_NEIGHBOURS: Neighbours = {
  prevId: null,
  nextId: null,
  position: 0,
  total: 0,
};

function storageKey(module: string): string {
  return `${PREFIX}${module}`;
}

/**
 * Remember the order a list is showing.
 *
 * Called by `DataTable` with the ids of every row that survived the search and
 * the filters, in display order — not just the current page, because "next"
 * has to be able to walk off the end of page one onto page two.
 */
export function saveRecordOrder(module: string, ids: string[]): void {
  if (typeof window === "undefined" || !module) return;
  try {
    const payload: RecordOrder = {
      ids: ids.slice(0, MAX_IDS),
      savedAt: Date.now(),
    };
    window.sessionStorage.setItem(storageKey(module), JSON.stringify(payload));
  } catch {
    // No store, no quota, no arrows. Nothing else is affected.
  }
}

/** Read back what a list last showed. An empty array means "no arrows". */
export function readRecordOrder(module: string): string[] {
  if (typeof window === "undefined" || !module) return [];
  try {
    const raw = window.sessionStorage.getItem(storageKey(module));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<RecordOrder> | null;
    if (!parsed || !Array.isArray(parsed.ids)) return [];
    if (typeof parsed.savedAt !== "number") return [];
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return [];
    return parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Where `id` sits in `ids`, and what is either side of it.
 *
 * Pure, so the rule is testable without a browser. A record that is not in the
 * list at all — opened from a search result, a link in an email, a dashboard
 * tile — gets no neighbours rather than the first and second rows of some
 * list it was never part of.
 */
export function neighbours(ids: string[], id: string | null | undefined): Neighbours {
  if (!id || ids.length === 0) return { ...NO_NEIGHBOURS, total: ids.length };
  const index = ids.indexOf(id);
  if (index < 0) return { ...NO_NEIGHBOURS, total: ids.length };
  return {
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
    position: index + 1,
    total: ids.length,
  };
}
