import { describe, it, expect } from "vitest";
import {
  describeColumns,
  extractRecipients,
  parseCsv,
  type CsvTable,
} from "./outreach-csv";

describe("parseCsv", () => {
  it("reads a plain file", () => {
    const table = parseCsv("name,phone\nRaj,9876543210\nMeena,9123456789");
    expect(table.header).toEqual(["name", "phone"]);
    expect(table.rows).toEqual([
      ["Raj", "9876543210"],
      ["Meena", "9123456789"],
    ]);
  });

  it("strips the BOM Excel writes, which would otherwise corrupt the first header", () => {
    const table = parseCsv("﻿name,phone\nRaj,9876543210");
    expect(table.header[0]).toBe("name");
  });

  it("keeps a comma that is inside quotes", () => {
    const table = parseCsv('company,phone\n"Shah, Patel & Co",9876543210');
    expect(table.rows[0]).toEqual(["Shah, Patel & Co", "9876543210"]);
  });

  it("turns a doubled quote into one quote", () => {
    const table = parseCsv('name,phone\n"The ""Big"" Store",9876543210');
    expect(table.rows[0][0]).toBe('The "Big" Store');
  });

  it("keeps a newline that is inside quotes", () => {
    const table = parseCsv('address,phone\n"12 Main St\nPune",9876543210');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][0]).toBe("12 Main St\nPune");
  });

  it("handles CRLF, which is what Windows writes", () => {
    const table = parseCsv("name,phone\r\nRaj,9876543210\r\n");
    expect(table.header).toEqual(["name", "phone"]);
    expect(table.rows).toEqual([["Raj", "9876543210"]]);
  });

  it("does not invent a row from a trailing newline", () => {
    expect(parseCsv("name,phone\nRaj,9876543210\n").rows).toHaveLength(1);
  });

  it("skips blank lines in the middle of a file", () => {
    const table = parseCsv("name,phone\nRaj,9876543210\n\nMeena,9123456789");
    expect(table.rows).toHaveLength(2);
  });

  it("pads a short row so the column indexes still line up", () => {
    // A row missing its trailing cells must not shift the phone column, or the
    // wrong value gets messaged.
    const table = parseCsv("name,city,phone\nRaj,Pune,9876543210\nMeena");
    expect(table.rows[1]).toEqual(["Meena", "", ""]);
  });

  it("drops cells beyond the header width rather than widening the table", () => {
    const table = parseCsv("name,phone\nRaj,9876543210,extra");
    expect(table.rows[0]).toEqual(["Raj", "9876543210"]);
  });

  it("keeps a genuine empty cell at the end of a row", () => {
    const table = parseCsv("name,phone,note\nRaj,9876543210,");
    expect(table.rows[0]).toEqual(["Raj", "9876543210", ""]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual({ header: [], rows: [] });
    expect(parseCsv("\n")).toEqual({ header: [], rows: [] });
  });

  it("treats a single line as a header with no rows", () => {
    expect(parseCsv("name,phone")).toEqual({ header: ["name", "phone"], rows: [] });
  });
});

describe("describeColumns", () => {
  const table: CsvTable = parseCsv("name,phone\nRaj,9876543210\nMeena,9123456789");

  it("labels columns by their header and shows a sample", () => {
    expect(describeColumns(table, true)).toEqual([
      { index: 0, label: "name", sample: "Raj" },
      { index: 1, label: "phone", sample: "9876543210" },
    ]);
  });

  it("falls back to a position when the file has no header row", () => {
    // The first row is data in this case, so it must appear as the sample
    // rather than as the label.
    expect(describeColumns(table, false)).toEqual([
      { index: 0, label: "Column 1", sample: "name" },
      { index: 1, label: "Column 2", sample: "phone" },
    ]);
  });

  it("falls back to a position when a header cell is blank", () => {
    const blank = parseCsv("name,\nRaj,9876543210");
    expect(describeColumns(blank, true)[1].label).toBe("Column 2");
  });

  it("shortens a long sample instead of letting the dropdown clip it", () => {
    // The dropdown is only as wide as the field it opens under, so a real
    // address column was being cut off mid-word at whatever point the box
    // ended, which reads as a rendering fault rather than a sample.
    const long = parseCsv(
      "address,phone\n" +
        '"Old Town, Gooty Rd, Aamlapur, Ram Nagar, Anantapur, Andhra Pradesh 515005",9876543210',
    );
    const sample = describeColumns(long, true)[0].sample;
    expect(sample.length).toBeLessThanOrEqual(28);
    expect(sample.endsWith("\u2026")).toBe(true);
    expect(sample.startsWith("Old Town")).toBe(true);
  });

  it("leaves a sample that already fits alone", () => {
    const table = parseCsv("phone\n9876543210");
    expect(describeColumns(table, true)[0].sample).toBe("9876543210");
    expect(describeColumns(table, true)[0].sample).not.toContain("\u2026");
  });

  it("flattens a newline inside a quoted cell so one row cannot break the list", () => {
    const multiline = parseCsv('address,phone\n"12 Main St\nPune",9876543210');
    expect(describeColumns(multiline, true)[0].sample).toBe("12 Main St Pune");
  });

  it("skips empty cells when looking for a sample", () => {
    const sparse = parseCsv("name,phone\nRaj,\nMeena,9123456789");
    expect(describeColumns(sparse, true)[1].sample).toBe("9123456789");
  });
});

describe("extractRecipients", () => {
  const table = parseCsv("name,phone\nRaj,9876543210\nMeena,9123456789");

  it("pulls the chosen columns", () => {
    expect(extractRecipients(table, true, 1, 0)).toEqual([
      { phone: "9876543210", name: "Raj" },
      { phone: "9123456789", name: "Meena" },
    ]);
  });

  it("leaves the name empty when no name column is chosen", () => {
    expect(extractRecipients(table, true, 1, null)).toEqual([
      { phone: "9876543210", name: "" },
      { phone: "9123456789", name: "" },
    ]);
  });

  it("includes the first row when the file has no header", () => {
    // Losing row one is losing a real prospect, silently, which is why the
    // screen asks rather than guessing.
    const noHeader = parseCsv("9876543210\n9123456789");
    expect(extractRecipients(noHeader, false, 0, null)).toEqual([
      { phone: "9876543210", name: "" },
      { phone: "9123456789", name: "" },
    ]);
  });

  it("skips rows with no phone number", () => {
    const gappy = parseCsv("name,phone\nRaj,9876543210\nBlank,\nMeena,9123456789");
    expect(extractRecipients(gappy, true, 1, 0)).toHaveLength(2);
  });

  it("does not normalise or validate - that is the server's job", () => {
    const messy = parseCsv("phone\n+91 98765 43210");
    expect(extractRecipients(messy, true, 0, null)).toEqual([
      { phone: "+91 98765 43210", name: "" },
    ]);
  });
});
