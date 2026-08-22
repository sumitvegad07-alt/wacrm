import type {
  ColumnMapping,
  CommitRow,
  ImportDescriptor,
  ParsedFile,
  RowError,
  RowValidation,
  ValidationSummary,
} from "./types";
import { normalizeKey } from "./parse";

/** Turn parsed rows + a column mapping into field-keyed rows, keeping the
 *  1-based source row number (header is row 1, so first data row is row 2). */
export function buildMappedRows(
  parsed: ParsedFile,
  mappings: ColumnMapping[],
): { row: number; values: Record<string, string> }[] {
  const active = mappings.filter((m) => m.fieldKey);
  return parsed.rows.map((cells, idx) => {
    const values: Record<string, string> = {};
    for (const m of active) values[m.fieldKey as string] = (cells[m.sourceIndex] ?? "").trim();
    return { row: idx + 2, values };
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOL_TRUE = new Set(["true", "yes", "y", "1"]);
const BOOL_FALSE = new Set(["false", "no", "n", "0"]);

function typeError(field: ImportDescriptor["fields"][number], value: string): string | null {
  switch (field.type) {
    case "number":
      return Number.isFinite(Number(value)) ? null : "must be a number";
    case "integer":
      return Number.isInteger(Number(value)) ? null : "must be a whole number";
    case "email":
      return EMAIL_RE.test(value) ? null : "invalid email";
    case "phone":
      return value.replace(/\D/g, "").length >= 6 ? null : "invalid phone number";
    case "boolean":
      return BOOL_TRUE.has(value.toLowerCase()) || BOOL_FALSE.has(value.toLowerCase())
        ? null
        : "must be yes/no";
    case "date":
      return Number.isNaN(Date.parse(value)) ? "invalid date" : null;
    case "latlng":
      return Number.isFinite(Number(value)) ? null : "must be a coordinate";
    default:
      return null;
  }
}

/**
 * Validate every mapped row against the descriptor + the existing dedupe keys.
 * Runs entirely client-side before any write — this is the dry run that powers
 * the preview verdict and the "Validate only" exit.
 */
export function validateRows(
  mappedRows: { row: number; values: Record<string, string> }[],
  descriptor: ImportDescriptor,
  existingKeys: Set<string>,
): ValidationSummary {
  const rows: RowValidation[] = [];
  const seen = new Set<string>();
  let valid = 0;
  let invalid = 0;
  let duplicate = 0;

  for (const { row, values } of mappedRows) {
    const errors: RowError[] = [];

    for (const field of descriptor.fields) {
      const value = (values[field.key] ?? "").trim();
      if (!value) {
        if (field.required) errors.push({ field: field.key, message: `${field.label} is required` });
        continue;
      }
      const te = typeError(field, value);
      if (te) errors.push({ field: field.key, message: `${field.label} ${te}` });
      if (field.maxLength && value.length > field.maxLength) {
        errors.push({ field: field.key, message: `${field.label} exceeds ${field.maxLength} characters` });
      }
      if (field.allowed && !field.allowed.some((a) => a.toLowerCase() === value.toLowerCase())) {
        errors.push({ field: field.key, message: `${field.label} must be one of: ${field.allowed.join(", ")}` });
      }
    }

    // Identity check. Normal imports flag duplicates; "match-required" imports
    // (Outstanding, Opening Stock) invert it — a row must match an existing
    // record, and no match is an error.
    let dupe = false;
    const keyParts = descriptor.dedupeKeys.map((k) => normalizeKey(values[k] ?? ""));
    const keyComplete = keyParts.every((p) => p !== "");
    if (keyComplete) {
      const key = keyParts.join("|");
      if (descriptor.requiresExistingMatch) {
        if (!existingKeys.has(key)) {
          const noun = descriptor.keyTable === "contacts" ? "customer" : descriptor.keyTable === "products" ? "product" : "record";
          errors.push({ message: `No matching ${noun} found — nothing to update` });
        }
      } else {
        if (existingKeys.has(key) || seen.has(key)) dupe = true;
        seen.add(key);
      }
    }

    let status: RowValidation["status"];
    if (errors.length > 0) {
      status = "invalid";
      invalid++;
    } else if (dupe) {
      status = "duplicate";
      duplicate++;
    } else {
      status = "valid";
      valid++;
    }

    rows.push({ row, values, status, errors });
  }

  return { total: mappedRows.length, valid, invalid, duplicate, rows };
}

/**
 * Build the commit payload. In Skip mode we send only genuinely-new (valid)
 * rows. In Update mode we also send duplicates so existing rows get refreshed.
 * Invalid rows are never sent.
 *
 * Custom (admin-defined) fields are split into a `__custom` object keyed by
 * custom_field_id, which the commit RPC writes to the module's EAV table.
 * Real-column fields stay at the top level keyed by their column name.
 */
export function buildCommitRows(
  summary: ValidationSummary,
  mode: "skip" | "update",
  descriptor: ImportDescriptor,
): CommitRow[] {
  const customFieldIdByKey = new Map(
    descriptor.fields.filter((f) => f.customFieldId).map((f) => [f.key, f.customFieldId as string]),
  );

  return summary.rows
    .filter((r) => r.status === "valid" || (mode === "update" && r.status === "duplicate"))
    .map((r) => {
      const out: CommitRow = { __row: r.row };
      const custom: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.values)) {
        const cfId = customFieldIdByKey.get(k);
        if (cfId) {
          if (v) custom[cfId] = v;
        } else {
          out[k] = v;
        }
      }
      if (Object.keys(custom).length) out.__custom = custom;
      return out;
    });
}
