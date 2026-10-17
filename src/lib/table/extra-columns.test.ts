// ============================================================
// Every stored field has to be reachable from Manage Column.
//
// A screen only ever showed the handful of columns somebody wrote by hand, so
// a field the account had configured to show in the table — Contact Number on
// Employees was the one that got noticed — had no column to appear through and
// could not be added at all. These build the rest, hidden by default, so the
// table looks unchanged until the user ticks one.
// ============================================================
import { describe, expect, it } from "vitest";
import { extraColumns } from "./extra-columns";

type Row = Record<string, unknown>;

describe("extraColumns", () => {
  it("builds a hidden column per field, keeping the order given", () => {
    const cols = extraColumns<Row>([
      ["notes", "Notes", "text"],
      ["total", "Total", "currency"],
    ]);
    expect(cols.map((c) => c.id)).toEqual(["notes", "total"]);
    expect(cols.map((c) => c.label)).toEqual(["Notes", "Total"]);
    // Hidden, so adding a column never changes what a screen shows today.
    expect(cols.every((c) => c.visibleByDefault === false)).toBe(true);
  });

  it("gives text a text filter, dates a date filter, and amounts a range", () => {
    const [text, num, date, money] = extraColumns<Row>([
      ["notes", "Notes", "text"],
      ["qty", "Qty", "number"],
      ["due", "Due", "date"],
      ["total", "Total", "currency"],
    ]);
    expect(text.type).toBe("text");
    expect(date.type).toBe("date");
    // A contains match on an amount misleads — searching 100 matches 1,100 —
    // so amounts and counts get a from/to pair instead.
    expect(num.type).toBe("range");
    expect(money.type).toBe("range");
  });

  it("gives a yes/no field a pick list rather than a text box", () => {
    const [flag] = extraColumns<Row>([["track_stock", "Track Stock", "boolean"]]);
    expect(flag.type).toBe("select");
    expect(flag.options?.map((o) => o.value)).toEqual(["true", "false"]);
    expect(flag.filterValue!({ track_stock: true })).toBe("true");
    expect(flag.filterValue!({ track_stock: false })).toBe("false");
  });

  it("filters a date on the raw stored value, not on the rendered date", () => {
    const [date] = extraColumns<Row>([["due", "Due", "date"]]);
    expect(date.filterValue!({ due: "2026-10-17T05:00:00Z" })).toBe("2026-10-17T05:00:00Z");
  });

  it("renders nothing missing as a dash rather than blank or 'undefined'", () => {
    const [text] = extraColumns<Row>([["notes", "Notes", "text"]]);
    for (const empty of [null, undefined, ""]) {
      expect(JSON.stringify(text.render!({ notes: empty }))).toContain("-");
    }
  });

  it("accepts a reader when the value is not stored under the column id", () => {
    const [col] = extraColumns<Row>([
      ["employee", "Employee", "text", (r) => (r.profile as Row)?.full_name],
    ]);
    expect(col.filterValue!({ profile: { full_name: "Vikram" } })).toBe("Vikram");
  });
});
