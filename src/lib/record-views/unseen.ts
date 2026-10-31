// ============================================================
// Which rows on screen this viewer has not opened yet.
//
// Kept as pure functions, apart from the hook that calls them, because the two
// rules worth getting right are both arithmetic: what counts as new enough to
// mark, and what counts as not yet opened. Both are easy to get subtly wrong
// and neither needs a database to test.
// ============================================================

/**
 * How long after it was created a record can still be highlighted as new.
 *
 * There has to be a limit. Without one, "a row you have never opened" means
 * every row in the account on an employee's first login — six thousand bold
 * orders, and a highlight that highlights nothing. Thirty days is long enough
 * that a week away does not lose anything and short enough that the bold rows
 * on a list are always a short list.
 *
 * It is also what lets `record_views` be pruned: past this window a record is
 * never highlighted again whether or not a view row exists for it.
 */
export const NEW_FOR_DAYS = 30;

/**
 * The lists that can highlight unopened rows.
 *
 * Same singular names as `custom_fields.module_name` and
 * `module_activities.module_name`, so the schema has one module vocabulary
 * rather than three.
 */
export type RecordModule =
  | "contact"
  | "lead"
  | "deal"
  | "quotation"
  | "order"
  | "payment"
  | "expense"
  | "task"
  | "product";

/** The two things this needs from a row, whatever else the row is. */
export interface RecordRow {
  id: string;
  /** The row's `created_at`, as the database returned it. */
  createdAt: string | null | undefined;
}

const DAY_MS = 86_400_000;

/**
 * The ids young enough to be worth asking about.
 *
 * This is what bounds the lookup: the list asks "which of *these* have I
 * opened?" about at most a page of rows, and about none at all on a page of
 * older records. A row with no parseable `created_at` is left out rather than
 * treated as new — a highlight is a claim about recency, and an unreadable
 * timestamp is no grounds for making it.
 */
export function candidateIds(
  rows: readonly RecordRow[],
  now: Date = new Date(),
  days: number = NEW_FOR_DAYS,
): string[] {
  const cutoff = now.getTime() - days * DAY_MS;
  const out: string[] = [];

  for (const row of rows) {
    if (!row.id || !row.createdAt) continue;
    const created = Date.parse(row.createdAt);
    if (Number.isNaN(created)) continue;
    if (created >= cutoff) out.push(row.id);
  }

  return out;
}

/**
 * Of the rows on screen, the ones to highlight: new enough, and not opened.
 *
 * `seen` is whatever came back from `record_views` for this viewer. An id in
 * `seen` that is not on screen is ignored, and an id on screen that is missing
 * from `seen` is unopened — so a failed lookup must pass an empty set only if
 * highlighting everything young is the intended behaviour. The hook passes no
 * set at all on failure instead, and highlights nothing.
 */
export function unseenIds(
  rows: readonly RecordRow[],
  seen: ReadonlySet<string>,
  now: Date = new Date(),
  days: number = NEW_FOR_DAYS,
): Set<string> {
  const out = new Set<string>();

  for (const id of candidateIds(rows, now, days)) {
    if (!seen.has(id)) out.add(id);
  }

  return out;
}

/** Shared empty set, so a list with nothing to highlight re-renders nothing. */
export const NO_UNSEEN: ReadonlySet<string> = new Set<string>();
