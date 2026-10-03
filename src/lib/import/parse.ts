import * as XLSX from "xlsx";
import type { ParsedFile } from "./types";

/** Normalize a header/value for matching: lowercase, strip all non-alphanumerics. */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Excel's day zero. Serials count whole days from here, so doing the arithmetic in
 *  UTC and reading it back with getUTC* is exact — it never shifts by a day with the
 *  machine's timezone, which is what `cellDates: true` and `toISOString()` both do. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/**
 * An Excel date serial as `yyyy-mm-dd`, or null when the number is not a date we
 * will vouch for.
 *
 * Serials below 61 are refused: Excel keeps a fictional 29 Feb 1900 at serial 60, so
 * everything at or below it is off by one, and a value under 1 is a time of day with
 * no date at all. Nothing under 61 is a plausible imported date (it would be January
 * or February 1900), so those cells are left on the existing formatted-text path
 * rather than converted to something subtly wrong.
 */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 61) return null;
  const d = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Does this number format mean the cell holds a calendar date?
 *
 * A day or year token (`d`/`y`) is the test. Excel number formats only carry a bare
 * `d` or `y` as a date token — a literal one has to be quoted or backslash-escaped —
 * so those are stripped first, along with `[...]` sections (`[Red]`, `[$-409]`, and
 * the `[h]` elapsed-time marker).
 *
 * Requiring `d` or `y` rather than any date token is deliberate: it excludes
 * time-only formats like `h:mm`, where `m` means minutes, not month. Those cells
 * carry no date — converting one would invent 30 Dec 1899.
 */
export function isDateNumberFormat(fmt: string): boolean {
  const bare = fmt
    .replace(/\\./g, "") // backslash-escaped literal characters
    .replace(/"[^"]*"/g, "") // quoted literal runs
    .replace(/\[[^\]]*\]/g, ""); // locale, colour and elapsed-time sections
  return /[dy]/i.test(bare);
}

/**
 * Rewrite every genuine date cell in the sheet to an ISO date string, in place.
 *
 * A date in a spreadsheet is a plain number plus a date number format. Under
 * `raw: false` it reaches us as its *display* text, so a cell holding 1 Feb 2026
 * arrives as whatever the author's format said — often `2/1/26`, which the
 * importers reject because a two-digit year is ambiguous (see ./dates). Replacing
 * the cell with an ISO text cell hands the rest of the pipeline an unambiguous
 * date while every other cell stays on the formatted-text path untouched.
 */
function rewriteDateCellsToIso(ws: XLSX.WorkSheet): void {
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith("!")) continue; // !ref, !margins, !merges, …
    const cell: XLSX.CellObject | undefined = ws[addr];
    // Only numeric cells carrying a date format. Text cells — including text that
    // merely looks like a date — are left exactly as they are.
    if (!cell || cell.t !== "n" || typeof cell.v !== "number") continue;
    if (typeof cell.z !== "string" || !isDateNumberFormat(cell.z)) continue;
    const iso = excelSerialToIsoDate(cell.v);
    if (iso === null) continue;
    cell.t = "s";
    cell.v = iso;
    cell.w = iso; // `raw: false` reads `w`, so set both
  }
}

/**
 * Single shared reader for CSV and XLSX, built on the already-installed `xlsx`
 * (SheetJS) — no new parser dependency. Reads the first sheet, returns a
 * normalized { headers, rows } shape so nothing downstream cares about format.
 *
 * `raw: false` forces cell values to their *formatted text*, which is what stops
 * Excel from handing us phone numbers in scientific notation or dropping leading
 * zeros — every value arrives as a string.
 *
 * `cellNF: true` adds each cell's number format so date cells can be told apart
 * from ordinary numbers and rewritten to ISO (see rewriteDateCellsToIso). It only
 * populates `z`; no cell value changes because of it.
 *
 * Both of those are for spreadsheets only. A date in a CSV is not a date cell at
 * all, just text, so SheetJS *guesses*: it recognises `2024-03-15`, converts it to a
 * serial, stamps it with the format `m/d/yy`, and `raw: false` renders that back as
 * `3/15/24`. ISO text went in and an ambiguous two-digit year came out, which
 * ./dates rightly refused. The serial is no better, because the guess is also
 * month-first — SheetJS reads `2/1/26` as 1 February, where the import rules are
 * day-first and refuse to pick at all.
 *
 * So CSV is read with `raw: true`, which turns that guessing off at the source:
 * every cell arrives as the literal characters from the file, dates included, and
 * ./dates decides. Leading zeros and long numbers are safe for the same reason —
 * `0044123` stays `0044123` instead of becoming the number 44123 — so `raw: false`
 * is kept for .xlsx, where its formatted text is the thing protecting them.
 */
export async function parseFile(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const format: ParsedFile["format"] = /\.xlsx?$/i.test(file.name) ? "xlsx" : "csv";

  const wb = XLSX.read(new Uint8Array(buf), {
    type: "array",
    // CSV: literal text, no date guessing. XLSX: formatted text (see above).
    raw: format === "csv",
    cellDates: false,
    cellNF: true,
  });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [], format };
  const ws = wb.Sheets[firstSheetName];

  if (format === "xlsx") rewriteDateCellsToIso(ws);

  const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });

  if (matrix.length === 0) return { headers: [], rows: [], format };

  const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());
  const width = headers.length;

  const rows: string[][] = [];
  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    // Normalize width to the header count; coerce every cell to a trimmed string.
    const row: string[] = [];
    for (let c = 0; c < width; c++) row.push(String(raw[c] ?? "").trim());
    // Drop rows that are entirely empty (trailing blank lines, spacer rows).
    if (row.some((v) => v !== "")) rows.push(row);
  }

  return { headers, rows, format };
}
