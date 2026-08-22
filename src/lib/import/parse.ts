import * as XLSX from "xlsx";
import type { ParsedFile } from "./types";

/** Normalize a header/value for matching: lowercase, strip all non-alphanumerics. */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Single shared reader for CSV and XLSX, built on the already-installed `xlsx`
 * (SheetJS) — no new parser dependency. Reads the first sheet, returns a
 * normalized { headers, rows } shape so nothing downstream cares about format.
 *
 * `raw: false` forces cell values to their *formatted text*, which is what stops
 * Excel from handing us phone numbers in scientific notation or dropping leading
 * zeros — every value arrives as a string.
 */
export async function parseFile(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const format: ParsedFile["format"] = /\.xlsx?$/i.test(file.name) ? "xlsx" : "csv";

  const wb = XLSX.read(new Uint8Array(buf), { type: "array", raw: false, cellDates: false });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [], format };
  const ws = wb.Sheets[firstSheetName];

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
