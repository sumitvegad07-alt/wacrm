/**
 * A tripwire for the list screens that deliberately do NOT page on the server.
 *
 * Product categories, units, employee roles, announcements, broadcasts and the
 * employee list are setup data with a natural ceiling — dozens of rows, in the
 * low thousands at the very worst. Paging those on the server would add a
 * round-trip per page and buy nothing, so they still load in one go and page in
 * the browser, as every screen used to.
 *
 * The cap exists so that a table nobody expected to grow cannot silently turn
 * into a multi-megabyte download the way the transactional lists did. If a
 * screen ever hits it, that screen needs the `useServerTable` treatment — and
 * the user is told rather than quietly shown a truncated list.
 *
 * See docs/engineering/WEB_PERFORMANCE_RESEARCH_2026-10-12.md.
 */
export const REFERENCE_ROW_CAP = 500;

/** Shown under a capped list when it is full, so truncation is never silent. */
export const REFERENCE_CAP_NOTICE = `Showing the first ${REFERENCE_ROW_CAP}. This list was not expected to grow this large — tell support so it can be paged properly.`;

/**
 * Cap for the deals kanban board.
 *
 * A board is not a list: it has to show every deal in every stage at once, so
 * `useServerTable` is the wrong tool for it and this stays a single query.
 * Deals DO grow with the business, though, unlike the setup data above — so
 * this is a stop-gap, not a design. The real fix is paging each stage column
 * separately, which is its own piece of work.
 */
export const DEAL_BOARD_CAP = 1000;
