import type { ImportDescriptor, RowValidation } from "./types";

// CSV output helpers. A cell that begins with =,+,-,@ is neutralised with a
// leading apostrophe so a spreadsheet can't interpret imported/exported data as
// a formula (CSV injection). Values with commas/quotes/newlines are quoted.
function csvCell(value: string): string {
  let v = value ?? "";
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Trigger a client-side download of text content. */
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob(["﻿" + text], { type: mime }); // BOM keeps Excel happy with UTF-8
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * A sample file with the exact headers the importer expects. Emits multiple
 * example rows when the descriptor provides them, so the "one record per row"
 * format is unmistakable (a single-row template got mistaken for the whole
 * dataset — see the Product Units pilot feedback). Falls back to one row.
 */
export function buildTemplateCsv(descriptor: ImportDescriptor): string {
  const header = descriptor.fields.map((f) => f.label);
  const rowCount = Math.max(1, ...descriptor.fields.map((f) => f.examples?.length ?? 0));
  const rows: string[][] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(descriptor.fields.map((f) => f.examples?.[i] ?? (i === 0 ? f.sample ?? "" : "")));
  }
  return toCsv([header, ...rows]);
}

/**
 * Error report: the descriptor's columns plus the source Row number and a
 * human error message, so the user fixes the file in Excel and re-uploads only
 * the rejects. Includes rows that failed validation (invalid).
 */
export function buildErrorCsv(descriptor: ImportDescriptor, rows: RowValidation[]): string {
  const failed = rows.filter((r) => r.status === "invalid");
  const header = [...descriptor.fields.map((f) => f.label), "Row", "Error"];
  const body = failed.map((r) => [
    ...descriptor.fields.map((f) => r.values[f.key] ?? ""),
    String(r.row),
    r.errors.map((e) => e.message).join("; "),
  ]);
  return toCsv([header, ...body]);
}
