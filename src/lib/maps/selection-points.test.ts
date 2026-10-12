import { describe, expect, it } from "vitest";
import { splitMappableSelection, mappedSelectionSummary } from "./selection-points";

type Row = {
  id: string;
  name: string;
  company?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

const rows: Row[] = [
  { id: "a", name: "Anil Shah", company: "Shah Traders", latitude: 22.3, longitude: 70.8 },
  { id: "b", name: "Bela Patel", company: null, latitude: null, longitude: null },
  { id: "c", name: "Chetan Rao", company: "Rao & Co", latitude: "21.17", longitude: "72.83" },
  { id: "d", name: "Divya Mehta", latitude: 23.02, longitude: undefined },
  { id: "e", name: "", company: null, latitude: 19.07, longitude: 72.87 },
];

const accessors = {
  titleOf: (r: Row) => r.company || r.name,
  latOf: (r: Row) => r.latitude,
  lngOf: (r: Row) => r.longitude,
};

describe("splitMappableSelection", () => {
  it("maps the selected rows that have a usable coordinate", () => {
    const { points } = splitMappableSelection(rows, new Set(["a", "c"]), accessors);
    expect(points).toEqual([
      { id: "a", title: "Shah Traders", lat: 22.3, lng: 70.8 },
      { id: "c", title: "Rao & Co", lat: 21.17, lng: 72.83 },
    ]);
  });

  it("coerces coordinates stored as strings, which numeric Postgres columns return", () => {
    const { points } = splitMappableSelection(rows, new Set(["c"]), accessors);
    expect(points[0].lat).toBe(21.17);
    expect(points[0].lng).toBe(72.83);
  });

  it("skips a row missing either half of the coordinate", () => {
    const { points, skipped } = splitMappableSelection(rows, new Set(["b", "d"]), accessors);
    expect(points).toEqual([]);
    expect(skipped).toEqual(["Bela Patel", "Divya Mehta"]);
  });

  it("names a skipped row by its title accessor", () => {
    const { skipped } = splitMappableSelection(rows, new Set(["b"]), accessors);
    expect(skipped).toEqual(["Bela Patel"]);
  });

  it("falls back to a placeholder when a row has no name at all", () => {
    const { points } = splitMappableSelection(rows, new Set(["e"]), accessors);
    expect(points[0].title).toBe("Unnamed record");
  });

  it("ignores selected ids with no row on the current page", () => {
    const { points, skipped } = splitMappableSelection(rows, new Set(["a", "ghost"]), accessors);
    expect(points).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it("rejects a non-finite coordinate rather than plotting it at a wrong place", () => {
    const broken: Row[] = [{ id: "x", name: "Bad Row", latitude: Number.NaN, longitude: 72 }];
    const { points, skipped } = splitMappableSelection(broken, new Set(["x"]), accessors);
    expect(points).toEqual([]);
    expect(skipped).toEqual(["Bad Row"]);
  });

  it("keeps table order so the pin numbers match the list", () => {
    const { points } = splitMappableSelection(rows, new Set(["e", "a"]), accessors);
    expect(points.map((p) => p.id)).toEqual(["a", "e"]);
  });
});

describe("mappedSelectionSummary", () => {
  it("says nothing when every selected record is on the map", () => {
    expect(mappedSelectionSummary(12, [])).toBeNull();
  });

  it("reports how many of the selection are shown and how many lack a location", () => {
    expect(mappedSelectionSummary(12, ["A", "B", "C"])).toBe(
      "12 of 15 shown — 3 have no saved location",
    );
  });

  it("reads naturally when exactly one record was skipped", () => {
    expect(mappedSelectionSummary(4, ["Bela Patel"])).toBe(
      "4 of 5 shown — 1 has no saved location",
    );
  });

  it("covers the case where nothing could be plotted", () => {
    expect(mappedSelectionSummary(0, ["A", "B"])).toBe(
      "0 of 2 shown — 2 have no saved location",
    );
  });
});
