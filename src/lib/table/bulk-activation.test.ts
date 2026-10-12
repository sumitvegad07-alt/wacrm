import { describe, expect, it } from "vitest";
import { inactiveSelection, reactivateDisabledReason } from "./bulk-activation";

type Row = { id: string; is_active?: boolean | null };

describe("inactiveSelection", () => {
  const rows: Row[] = [
    { id: "a", is_active: true },
    { id: "b", is_active: false },
    { id: "c" }, // legacy row, flag never written
    { id: "d", is_active: null },
    { id: "e", is_active: false },
  ];

  it("returns only the selected rows that are inactive", () => {
    expect(inactiveSelection(rows, new Set(["a", "b", "e"]))).toEqual(["b", "e"]);
  });

  it("treats a missing or null flag as active, matching every list's Status column", () => {
    // Every module renders `is_active !== false` as Active, so a row with no
    // flag must not be offered for re-activation — there is nothing to restore.
    expect(inactiveSelection(rows, new Set(["c", "d"]))).toEqual([]);
  });

  it("ignores selected ids that are not on the current page", () => {
    // Selection survives a filter change, so an id can outlive its row.
    expect(inactiveSelection(rows, new Set(["b", "zzz"]))).toEqual(["b"]);
  });

  it("returns an empty list for an empty selection", () => {
    expect(inactiveSelection(rows, new Set<string>())).toEqual([]);
  });

  it("preserves the row order of the table, not the selection order", () => {
    expect(inactiveSelection(rows, new Set(["e", "b"]))).toEqual(["b", "e"]);
  });

  it("accepts a custom active-flag accessor, for the tables that call it `active`", () => {
    // Price Lists and Schemes store the flag as `active`, not `is_active`.
    const priceLists = [
      { id: "p1", active: false },
      { id: "p2", active: true },
      { id: "p3", active: false },
    ];
    expect(
      inactiveSelection(priceLists, new Set(["p1", "p2", "p3"]), (r) => r.id, (r) => r.active),
    ).toEqual(["p1", "p3"]);
  });

  it("accepts a custom id accessor for tables that do not key on `id`", () => {
    const keyed = [
      { code: "u1", is_active: false },
      { code: "u2", is_active: true },
    ];
    expect(inactiveSelection(keyed, new Set(["u1", "u2"]), (r) => r.code)).toEqual(["u1"]);
  });
});

describe("reactivateDisabledReason", () => {
  it("explains an empty selection", () => {
    expect(reactivateDisabledReason(0, 0)).toBe("Select records to re-activate");
  });

  it("explains a selection that holds nothing inactive", () => {
    expect(reactivateDisabledReason(3, 0)).toBe(
      "None of the 3 selected records are Inactive",
    );
  });

  it("reads naturally for a single active record", () => {
    expect(reactivateDisabledReason(1, 0)).toBe("The selected record is not Inactive");
  });

  it("is undefined when there is something to restore, so the button stays enabled", () => {
    expect(reactivateDisabledReason(3, 2)).toBeUndefined();
  });
});
