// ============================================================
// Client-side column filtering, driven by the column definitions.
//
// Every screen used to hand-write a chain of `if (colId === 'x')` branches,
// and a column whose branch nobody wrote was simply never filtered. That was
// invisible while filters hid behind a click on the heading. Now that the
// filter row is always on screen it is a control that visibly does nothing,
// and there were 49 of them across ten screens.
//
// Driving the match from the ColumnDef makes that impossible: a column with a
// filter type is filtered, full stop.
// ============================================================
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@/components/ui/data-table/data-table-types";
import { matchesColumnFilters } from "./match-filters";

type Row = Record<string, unknown>;

const columns: ColumnDef<Row>[] = [
  { id: "name", label: "Name", type: "text" },
  { id: "status", label: "Status", type: "select" },
  { id: "created_at", label: "Created", type: "date" },
  { id: "note", label: "Note" }, // no type — not filterable
  {
    id: "record_status",
    label: "Record Status",
    type: "select",
    filterValue: (r) => (r.is_active !== false ? "active" : "inactive"),
  },
  {
    id: "tags",
    label: "Tags",
    type: "select",
    filterValue: (r) => r.tag_list as string[],
  },
];

const row = (over: Row = {}): Row => ({
  name: "Mahavir Traders",
  status: "New",
  created_at: "2026-10-10T08:00:00.000Z",
  note: "anything",
  is_active: true,
  tag_list: ["vip", "north"],
  ...over,
});

describe("matchesColumnFilters", () => {
  it("passes everything when no filter is set", () => {
    expect(matchesColumnFilters(row(), {}, columns)).toBe(true);
  });

  it("ignores the four empty filter shapes", () => {
    for (const empty of [null, undefined, "", []]) {
      expect(matchesColumnFilters(row(), { name: empty }, columns)).toBe(true);
    }
  });

  it("matches text as a case-insensitive contains", () => {
    expect(matchesColumnFilters(row(), { name: "mahavir" }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { name: "TRADERS" }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { name: "vishwa" }, columns)).toBe(false);
  });

  it("matches a select against any chosen value", () => {
    expect(matchesColumnFilters(row(), { status: ["New"] }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { status: ["Won", "New"] }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { status: ["Won"] }, columns)).toBe(false);
  });

  it("accepts a bare value for a select as well as a list", () => {
    expect(matchesColumnFilters(row(), { status: "New" }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { status: "Won" }, columns)).toBe(false);
  });

  it("matches a date against a preset", () => {
    const recent = row({ created_at: new Date().toISOString() });
    expect(matchesColumnFilters(recent, { created_at: "today" }, columns)).toBe(true);
    expect(matchesColumnFilters(row({ created_at: "2001-01-01" }), { created_at: "today" }, columns)).toBe(
      false,
    );
  });

  it("uses filterValue when the filter target is not the rendered column", () => {
    // Record Status reads is_active, not a `record_status` field.
    expect(matchesColumnFilters(row(), { record_status: ["active"] }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { record_status: ["inactive"] }, columns)).toBe(false);
    expect(
      matchesColumnFilters(row({ is_active: false }), { record_status: ["inactive"] }, columns),
    ).toBe(true);
  });

  it("matches when a row holds several values and any one is chosen", () => {
    expect(matchesColumnFilters(row(), { tags: ["north"] }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { tags: ["south"] }, columns)).toBe(false);
  });

  it("requires every active filter to match, not just one", () => {
    expect(matchesColumnFilters(row(), { name: "mahavir", status: ["New"] }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { name: "mahavir", status: ["Won"] }, columns)).toBe(false);
  });

  it("ignores a filter for a column that is not filterable or does not exist", () => {
    // A stale saved view can carry a filter for a column this release dropped,
    // or for one whose field was since made unfilterable. Neither may hide rows.
    expect(matchesColumnFilters(row(), { note: "nothing like this" }, columns)).toBe(true);
    expect(matchesColumnFilters(row(), { vanished: "x" }, columns)).toBe(true);
  });

  it("treats a missing or empty value as not matching a text search", () => {
    expect(matchesColumnFilters(row({ name: null }), { name: "a" }, columns)).toBe(false);
    expect(matchesColumnFilters(row({ name: undefined }), { name: "a" }, columns)).toBe(false);
  });

  it("compares numbers as text, so a number column can still be searched", () => {
    const cols: ColumnDef<Row>[] = [{ id: "qty", label: "Qty", type: "text" }];
    expect(matchesColumnFilters({ qty: 1250 }, { qty: "25" }, cols)).toBe(true);
    expect(matchesColumnFilters({ qty: 1250 }, { qty: "99" }, cols)).toBe(false);
  });
});
