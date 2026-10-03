import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFile, excelSerialToIsoDate, isDateNumberFormat } from './parse';
import { parseDmyDate } from './dates';

/** A cell exactly as a spreadsheet stores it. Dates are a serial + a date number format. */
type Cell = { t: 's' | 'n'; v: string | number; z?: string };

/** Build a real .xlsx byte stream from explicit cells, then wrap it as an uploaded File. */
function xlsxFile(headers: string[], cells: Cell[][], name = 'upload.xlsx'): File {
  const ws: Record<string, unknown> = {};
  headers.forEach((h, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: h };
  });
  cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      ws[XLSX.utils.encode_cell({ r: r + 1, c })] = cell;
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: cells.length, c: Math.max(headers.length, ...cells.map((r) => r.length)) - 1 },
  });
  const buf = XLSX.write({ SheetNames: ['Sheet1'], Sheets: { Sheet1: ws } }, { type: 'buffer', bookType: 'xlsx' });
  return new File([new Uint8Array(buf as Buffer)], name);
}

function csvFile(text: string, name = 'upload.csv'): File {
  return new File([text], name);
}

describe('parseFile — .xlsx date cells', () => {
  it('turns a true Excel date cell into an unambiguous ISO date', async () => {
    // Serial 46054 with a date format is how Excel stores 1 Feb 2026. Rendered as
    // formatted text it would arrive as "2/1/26", which the importers reject.
    const r = await parseFile(xlsxFile(['service_date'], [[{ t: 'n', v: 46054, z: 'm/d/yy' }]]));
    expect(r.rows[0]?.[0]).toBe('2026-02-01');
  });

  it('converts date cells whatever the display format', async () => {
    const r = await parseFile(
      xlsxFile(
        ['a', 'b', 'c', 'd'],
        [[
          { t: 'n', v: 45000, z: 'dd-mmm-yyyy' },
          { t: 'n', v: 45000, z: 'yyyy-mm-dd' },
          { t: 'n', v: 45000, z: 'mm-dd-yy' },
          { t: 'n', v: 45000, z: '[$-409]d-mmm-yyyy' },
        ]],
      ),
    );
    expect(r.rows[0]).toEqual(['2023-03-15', '2023-03-15', '2023-03-15', '2023-03-15']);
  });

  it('keeps the date part of a date+time cell', async () => {
    const r = await parseFile(xlsxFile(['when'], [[{ t: 'n', v: 46054.75, z: 'm/d/yy h:mm' }]]));
    expect(r.rows[0]?.[0]).toBe('2026-02-01');
  });

  it('leaves a text cell that merely looks like a date unchanged', async () => {
    // Typed as text, so it stays ambiguous and must still be rejected downstream.
    const r = await parseFile(xlsxFile(['service_date'], [[{ t: 's', v: '2/1/26' }]]));
    expect(r.rows[0]?.[0]).toBe('2/1/26');
  });

  it('leaves a phone number with a leading zero unchanged', async () => {
    const r = await parseFile(
      xlsxFile(
        ['phone', 'padded'],
        [[
          { t: 's', v: '09876543210' },
          // A numeric cell zero-padded by its format — the case `raw: false` exists to protect.
          { t: 'n', v: 9876543210, z: '00000000000' },
        ]],
      ),
    );
    expect(r.rows[0]).toEqual(['09876543210', '09876543210']);
  });

  it('leaves a long number Excel renders in scientific notation unchanged', async () => {
    const r = await parseFile(xlsxFile(['big'], [[{ t: 'n', v: 123456789012345, z: '0.00E+00' }]]));
    expect(r.rows[0]?.[0]).toBe('1.23E+14');
  });

  it('leaves a time-only cell alone rather than inventing the 1899 epoch date', async () => {
    const r = await parseFile(xlsxFile(['start'], [[{ t: 'n', v: 0.5, z: 'h:mm' }]]));
    expect(r.rows[0]?.[0]).toBe('12:00');
  });

  it('leaves ordinary numbers and currency alone', async () => {
    const r = await parseFile(
      xlsxFile(
        ['qty', 'price', 'plain'],
        [[
          { t: 'n', v: 42, z: 'General' },
          { t: 'n', v: 1234.5, z: '#,##0.00' },
          { t: 'n', v: 46054, z: 'General' },
        ]],
      ),
    );
    expect(r.rows[0]).toEqual(['42', '1,234.50', '46054']);
  });
});

describe('parseFile — the whole point', () => {
  it('hands the importers an .xlsx date they will accept', async () => {
    // The bug this fixes: the cell arrived as "2/1/26", and parseDmyDate rejects a
    // two-digit year rather than guessing a century (see ./dates), so every row failed.
    const r = await parseFile(xlsxFile(['installation_date'], [[{ t: 'n', v: 46054, z: 'm/d/yy' }]]));
    expect(parseDmyDate('2/1/26')).toBeNull(); // the old value, still correctly refused
    expect(parseDmyDate(r.rows[0]![0]!)).toBe('2026-02-01');
  });
});

describe('parseFile — CSV is untouched', () => {
  it('hands the importers a CSV yyyy-mm-dd date they will accept', async () => {
    // The bug: a CSV carries no cell formats, so SheetJS guessed "2024-03-15" was a
    // date, stored it as a serial formatted m/d/yy, and `raw: false` rendered that
    // back as "3/15/24" — a two-digit year, which ./dates refuses. Every row failed,
    // on the very format the importers list first.
    const r = await parseFile(csvFile('installation_date\n2024-03-15\n'));
    expect(r.rows[0]?.[0]).toBe('2024-03-15');
    expect(parseDmyDate(r.rows[0]![0]!)).toBe('2024-03-15');
  });

  it('leaves CSV dates exactly as they arrive today', async () => {
    const r = await parseFile(
      csvFile('service_date,slashed,phone,big\n15-03-2024,15/03/2024,09876543210,123456789012345\n'),
    );
    expect(r.rows[0]).toEqual(['15-03-2024', '15/03/2024', '09876543210', '123456789012345']);
    expect(r.format).toBe('csv');
  });

  it('keeps the day-first CSV forms readable by the importers', async () => {
    const r = await parseFile(csvFile('a,b\n15-03-2024,15/03/2024\n'));
    expect(r.rows[0]!.map((v) => parseDmyDate(v))).toEqual(['2024-03-15', '2024-03-15']);
  });

  it('never resolves an ambiguous CSV date month-first', async () => {
    // SheetJS's own guess here is 1 February. The import rules are day-first and
    // refuse a two-digit year outright, so this text must survive verbatim and be
    // rejected downstream — not be silently settled as February on the way in.
    const r = await parseFile(csvFile('service_date\n2/1/26\n'));
    expect(r.rows[0]?.[0]).toBe('2/1/26');
    expect(parseDmyDate(r.rows[0]![0]!)).toBeNull();
  });

  it('leaves CSV leading zeros, long numbers and plain numbers unchanged', async () => {
    // 0044123 is stored by SheetJS as the number 44123; it only survives intact
    // because the display text is what reaches us. That must keep working.
    const r = await parseFile(
      csvFile('phone,padded,big,qty,price\n09876543210,0044123,123456789012345,42,1234.5\n'),
    );
    expect(r.rows[0]).toEqual(['09876543210', '0044123', '123456789012345', '42', '1234.5']);
  });
});

describe('excelSerialToIsoDate', () => {
  it('converts serials without drifting by a day across timezones', () => {
    expect(excelSerialToIsoDate(46054)).toBe('2026-02-01');
    expect(excelSerialToIsoDate(45000)).toBe('2023-03-15');
    expect(excelSerialToIsoDate(25569)).toBe('1970-01-01');
    expect(excelSerialToIsoDate(73050)).toBe('2099-12-31');
  });

  it('ignores the time fraction', () => {
    expect(excelSerialToIsoDate(46054.999)).toBe('2026-02-01');
  });

  it('refuses serials in the range distorted by the Excel 1900 leap-year bug', () => {
    expect(excelSerialToIsoDate(60)).toBeNull();
    expect(excelSerialToIsoDate(0.5)).toBeNull();
    expect(excelSerialToIsoDate(-5)).toBeNull();
  });
});

describe('isDateNumberFormat', () => {
  it('recognises formats carrying a day or year token', () => {
    for (const f of ['m/d/yy', 'dd-mmm-yyyy', 'yyyy-mm-dd', 'mmm-yy', 'd/m/yy;@', '[$-409]d-mmm-yyyy']) {
      expect(isDateNumberFormat(f), f).toBe(true);
    }
  });

  it('rejects time-only, general and numeric formats', () => {
    for (const f of ['h:mm', 'h:mm:ss', '[h]:mm:ss', 'General', '0.00E+00', '#,##0.00', '@', '00000000000', '']) {
      expect(isDateNumberFormat(f), f).toBe(false);
    }
  });

  it('ignores d and y inside quoted literals and backslash escapes', () => {
    expect(isDateNumberFormat('0.0" days"')).toBe(false);
    expect(isDateNumberFormat('#,##0" yd"')).toBe(false);
    // String.raw so the backslash survives as a backslash: the format is 0\d,
    // an escaped literal "d" after a digit placeholder.
    expect(isDateNumberFormat(String.raw`0\d`)).toBe(false);
    expect(isDateNumberFormat(String.raw`#,##0\y`)).toBe(false);
  });
});
