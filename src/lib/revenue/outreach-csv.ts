/**
 * A small CSV reader for the outreach upload screen.
 *
 * WHY NOT parse-contact-csv.ts
 *
 * That one is for the contacts importer and insists the file has a column
 * literally headed `phone`. Here the founder picks which column holds the
 * numbers, so this has to hand back whatever columns the file actually has and
 * let him choose. It also splits the header row on bare commas, which breaks
 * on a quoted header, and strips every quote character from every cell.
 *
 * WHY NOT A LIBRARY
 *
 * This runs in the browser on a file the founder picked himself. The whole job
 * is three rules (quotes, doubled quotes, newlines inside quotes) and a BOM,
 * and it is worth more as twenty tested lines than as a dependency.
 *
 * Imports nothing on purpose, so it is testable without a DOM.
 */

export interface CsvTable {
  /** First row of the file, verbatim. May or may not be a header - the caller decides. */
  header: string[];
  /** Every row after the first, padded so each has `header.length` cells. */
  rows: string[][];
}

/**
 * Splits CSV text into rows of cells.
 *
 * Handles the three things a hand-made parser usually gets wrong:
 * a comma inside quotes, a doubled quote standing for one quote, and a
 * newline inside quotes. Also strips a UTF-8 BOM, which Excel writes on every
 * "Save as CSV" and which would otherwise glue itself to the first header and
 * make that column impossible to recognise.
 */
export function parseCsv(text: string): CsvTable {
  // Written as an escape on purpose: a literal U+FEFF here is invisible in an
  // editor and one stray reformat would delete it, taking BOM stripping with it
  // and leaving no visible diff behind.
  const input = text.replace(/^\uFEFF/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  // Tracked so a trailing newline does not add a phantom empty row, while a
  // genuine empty cell at the end of a real row is kept.
  let cellStarted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    // A row of one empty cell is a blank line, not a record.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && !cellStarted) {
      quoted = true;
      cellStarted = true;
      continue;
    }
    if (char === ",") {
      endCell();
      continue;
    }
    if (char === "\r") {
      // Swallow CRLF as one break; a lone CR is treated as a break too.
      if (input[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (char === "\n") {
      endRow();
      continue;
    }

    cell += char;
    cellStarted = true;
  }

  // Whatever is left when the text runs out is a final row, unless the file
  // ended on a newline and left nothing behind.
  if (cell !== "" || row.length > 0) endRow();

  if (!rows.length) return { header: [], rows: [] };

  const header = rows[0];
  const width = header.length;
  const body = rows.slice(1).map((r) => {
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push("");
    return padded;
  });

  return { header, rows: body };
}

/**
 * The longest sample value shown in the column dropdown.
 *
 * The dropdown is the width of the field it opens under, and an address column
 * carries things like "Old Town, Gooty Rd, Aamlapur, Ram Nagar, Anantapur,
 * Andhra Pradesh 515005". Left whole it is clipped mid-word at whatever point
 * the box ends, which reads as a rendering fault. Cut deliberately, with an
 * ellipsis, it reads as a sample.
 */
const SAMPLE_MAX = 28;

/**
 * A label for each column, for the dropdown the founder picks from.
 *
 * Shows the header text when there is one and a sample value from the first
 * row that has anything in that column, because "Column 3" on its own tells
 * him nothing and the header in these files is often something like `f4`.
 */
export function describeColumns(
  table: CsvTable,
  firstRowIsHeader: boolean,
): { index: number; label: string; sample: string }[] {
  const dataRows = firstRowIsHeader ? table.rows : [table.header, ...table.rows];

  return table.header.map((headerCell, index) => {
    const found =
      dataRows.find((r) => (r[index] ?? "").trim() !== "")?.[index]?.trim() ?? "";
    // Newlines are legal inside a quoted CSV field and would break the row.
    const flat = found.replace(/\s+/g, " ");
    const sample =
      flat.length > SAMPLE_MAX ? `${flat.slice(0, SAMPLE_MAX - 1).trimEnd()}…` : flat;
    const named = firstRowIsHeader ? headerCell.trim() : "";
    return {
      index,
      label: named || `Column ${index + 1}`,
      sample,
    };
  });
}

/**
 * Pulls the phone column, and optionally a name column, out of the table.
 *
 * Returns raw strings. Normalising and validating them is the server's job -
 * `parsePhones` in the outreach route is the one place that decides what
 * counts as a sendable number, and a second opinion in the browser would be a
 * second thing to keep in step.
 */
export function extractRecipients(
  table: CsvTable,
  firstRowIsHeader: boolean,
  phoneColumn: number,
  nameColumn: number | null,
): { phone: string; name: string }[] {
  const dataRows = firstRowIsHeader ? table.rows : [table.header, ...table.rows];

  const out: { phone: string; name: string }[] = [];
  for (const row of dataRows) {
    const phone = (row[phoneColumn] ?? "").trim();
    if (!phone) continue;
    const name = nameColumn === null ? "" : (row[nameColumn] ?? "").trim();
    out.push({ phone, name });
  }
  return out;
}
