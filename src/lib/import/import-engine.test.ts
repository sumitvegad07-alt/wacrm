import { describe, it, expect } from "vitest";
import { normalizeKey } from "./parse";
import { detectMapping, unmappedRequiredFields, mappedFieldKeys } from "./mapping";
import { validateRows, buildCommitRows } from "./validate";
import { buildErrorCsv, buildTemplateCsv } from "./error-report";
import { productUnitsDescriptor as D } from "./descriptors/product-units";
import type { ValidationSummary } from "./types";

describe("normalizeKey", () => {
  it("strips case and non-alphanumerics", () => {
    expect(normalizeKey("Unit Name")).toBe("unitname");
    expect(normalizeKey("U.O.M.")).toBe("uom");
    expect(normalizeKey("  Short-Name ")).toBe("shortname");
  });
});

describe("detectMapping", () => {
  it("maps exact + synonym headers with high confidence", () => {
    const m = detectMapping(["Unit Name", "Short Name", "Extra"], D);
    expect(m[0].fieldKey).toBe("name");
    expect(m[0].confidence).toBe("high");
    expect(m[1].fieldKey).toBe("short_name");
    expect(m[2].fieldKey).toBeNull();
  });

  it("resolves synonyms (uom -> name, symbol -> short_name)", () => {
    const m = detectMapping(["UOM", "Symbol"], D);
    expect(m[0].fieldKey).toBe("name");
    expect(m[1].fieldKey).toBe("short_name");
  });

  it("falls back to fuzzy matching for near-misses", () => {
    const m = detectMapping(["Units"], D); // 'units' contains 'unit'
    expect(m[0].fieldKey).toBe("name");
    expect(["medium", "high"]).toContain(m[0].confidence);
  });

  it("never assigns the same field to two columns", () => {
    const m = detectMapping(["Unit Name", "Unit"], D);
    const nameCols = m.filter((x) => x.fieldKey === "name");
    expect(nameCols).toHaveLength(1);
  });

  it("flags unmapped required fields", () => {
    const m = detectMapping(["Short Name"], D);
    expect(unmappedRequiredFields(m, D)).toEqual(["Unit Name"]);
    expect(mappedFieldKeys(m).has("short_name")).toBe(true);
  });
});

describe("validateRows", () => {
  const rows = (names: (string | undefined)[]) =>
    names.map((n, i) => ({ row: i + 2, values: { name: n ?? "" } as Record<string, string> }));

  it("flags required, duplicate-in-file, and valid rows", () => {
    const s = validateRows(rows(["Kg", "", "Kg"]), D, new Set());
    expect(s.valid).toBe(1);
    expect(s.invalid).toBe(1);
    expect(s.duplicate).toBe(1);
    expect(s.rows[1].errors[0].message).toContain("required");
  });

  it("flags rows duplicating existing records (case-insensitive)", () => {
    const s = validateRows(rows(["KG"]), D, new Set(["kg"]));
    expect(s.duplicate).toBe(1);
    expect(s.rows[0].status).toBe("duplicate");
  });

  it("enforces maxLength", () => {
    const s = validateRows(rows(["x".repeat(101)]), D, new Set());
    expect(s.invalid).toBe(1);
    expect(s.rows[0].errors[0].message).toContain("100 characters");
  });
});

describe("buildCommitRows", () => {
  const summary: ValidationSummary = {
    total: 3,
    valid: 1,
    invalid: 1,
    duplicate: 1,
    rows: [
      { row: 2, values: { name: "New" }, status: "valid", errors: [] },
      { row: 3, values: { name: "" }, status: "invalid", errors: [{ message: "x" }] },
      { row: 4, values: { name: "Dup" }, status: "duplicate", errors: [] },
    ],
  };

  it("skip mode sends only valid rows", () => {
    const out = buildCommitRows(summary, "skip", D);
    expect(out.map((r) => r.name)).toEqual(["New"]);
    expect(out[0].__row).toBe(2);
  });

  it("update mode sends valid + duplicate, never invalid", () => {
    const out = buildCommitRows(summary, "update", D);
    expect(out.map((r) => r.name).sort()).toEqual(["Dup", "New"]);
  });
});

describe("buildCommitRows — custom fields", () => {
  it("splits custom-field values into __custom keyed by custom_field_id", () => {
    const desc = {
      module: "contacts", targetTable: "contacts", label: "Customers", undoable: true,
      dedupeKeys: ["phone"],
      fields: [
        { key: "phone", label: "Phone", type: "phone" as const, synonyms: [] },
        { key: "cf:abc-123", label: "Gst", type: "text" as const, synonyms: [], customFieldId: "abc-123" },
      ],
    };
    const summary: ValidationSummary = {
      total: 1, valid: 1, invalid: 0, duplicate: 0,
      rows: [{ row: 2, values: { phone: "+9199", "cf:abc-123": "GST99" }, status: "valid", errors: [] }],
    };
    const out = buildCommitRows(summary, "skip", desc);
    expect(out[0].phone).toBe("+9199");
    expect(out[0]["cf:abc-123"]).toBeUndefined();
    expect(out[0].__custom).toEqual({ "abc-123": "GST99" });
  });
});

describe("error + template CSV", () => {
  it("neutralizes CSV injection and appends Row/Error", () => {
    const summary: ValidationSummary = {
      total: 1,
      valid: 0,
      invalid: 1,
      duplicate: 0,
      rows: [{ row: 2, values: { name: "=cmd()", short_name: "" }, status: "invalid", errors: [{ message: "bad" }] }],
    };
    const csv = buildErrorCsv(D, summary.rows);
    expect(csv).toContain("Row,Error");
    expect(csv).toContain("'=cmd()"); // leading apostrophe neutralizes the formula
    expect(csv).toContain("bad");
  });

  it("template carries field labels + sample", () => {
    const csv = buildTemplateCsv(D);
    expect(csv.split("\r\n")[0]).toBe("Unit Name,Short Name");
    expect(csv).toContain("Kilograms");
  });
});
