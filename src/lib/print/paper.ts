export type PaperSize = "A4" | "A5";

/**
 * Read a paper size off a query string.
 *
 * Anything unrecognised is A4, because a sheet that silently comes out the
 * wrong size is worse than one that ignores a typo.
 */
export function parsePaperSize(raw: string | null | undefined): PaperSize {
  return String(raw ?? "").toLowerCase() === "a5" ? "A5" : "A4";
}

/**
 * The type scale for a sheet.
 *
 * A5 is half an A4, so the same table has to come down a size to keep its
 * columns on the page. These numbers are the ones `/print/report` has been
 * using in production since the summary reports shipped; they are lifted here
 * rather than re-derived, so paper output stays identical to what has already
 * been signed off.
 */
export function paperMetrics(size: PaperSize) {
  const compact = size === "A5";
  return {
    size,
    compact,
    margin: compact ? "10mm" : "16mm",
    title: compact ? "16px" : "22px",
    heading: compact ? "12px" : "15px",
    body: compact ? "9px" : "11px",
    table: compact ? "8.5px" : "11px",
  };
}
