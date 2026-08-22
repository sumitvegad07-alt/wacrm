// ============================================================================
// Universal Import Framework — shared types
//
// One engine, driven by per-module descriptors. A module becomes importable by
// registering an ImportDescriptor (see ./registry) — never by writing new UI or
// a new parser. Wave 0 ships the Product Units pilot; later waves add descriptors.
// ============================================================================

/** Duplicate-handling modes. Wave 0 supports skip + update. 'new' is deferred. */
export type ImportMode = "skip" | "update";

export type FieldType =
  | "text"
  | "number"
  | "integer"
  | "email"
  | "phone"
  | "boolean"
  | "date"
  | "latlng";

export interface FieldDescriptor {
  /** DB-facing key, also the payload key sent to import_commit. */
  key: string;
  /** Human label shown in the mapping UI + template header. */
  label: string;
  required?: boolean;
  type: FieldType;
  maxLength?: number;
  /** Enum of allowed values (case-insensitive). */
  allowed?: string[];
  /** Participates in the uniqueness / dedupe identity. */
  unique?: boolean;
  /** Header aliases used by auto-mapping, e.g. ['uom','measure']. */
  synonyms: string[];
  /** Example value for the downloadable template (single-row fallback). */
  sample?: string;
  /** Multiple example values — the template emits one row per index, which
   *  makes the "one record per row" format unmistakable. */
  examples?: string[];
  /** For a predefined form field: the real DB column key (system_key). */
  systemKey?: string;
  /** For an admin custom field: the custom_fields.id whose value is written to
   *  the module's EAV table (contact_custom_values, etc.). Mutually exclusive
   *  with systemKey — a field is either a real column or a custom value. */
  customFieldId?: string;
}

/** A named reference resolved to an id (categories, statuses, parents). Not
 *  exercised by the Product Units pilot, but the engine is built for it. */
export interface LookupDescriptor {
  field: string;
  table: string;
  matchColumns: string[];
  /** Guided-resolve eligibility: 'never' = must match/reject; 'admin' = admins may create. */
  createable: "never" | "admin";
  createFields?: Record<string, unknown>;
  /** Self-referential tree (territories, categories): a created node needs a
   *  parent, and existing values are shown as a path. */
  hierarchical?: boolean;
}

export interface ImportDescriptor {
  /** Registry key + import_jobs.module, e.g. 'product_units'. */
  module: string;
  /** DB table the commit RPC writes into (whitelisted server-side). */
  targetTable: string;
  /** Human label ("Product Units"). */
  label: string;
  /** Extra permission beyond `import_data` (module create/manage), if any. */
  requiredPermission?: string;
  /** Whether an insert-only run into this target can be undone. */
  undoable: boolean;
  /** Field keys whose combined value forms the dedupe identity. */
  dedupeKeys: string[];
  fields: FieldDescriptor[];
  lookups?: LookupDescriptor[];
  /** Recommended max rows before the (future) async tier; advisory in Wave 0. */
  maxRows?: number;

  // ---- Config-driven ("form-backed") modules ----
  /** When true, the importer's fields are generated at runtime from the same
   *  `custom_fields` config that drives manual entry (predefined + admin custom
   *  fields, with the real required rules). The `fields` here are only the
   *  synthetic/gated extras (territory, lat/long, financials) not in that config. */
  formBacked?: boolean;
  /** custom_fields.module_name to read the form config from (e.g. 'contact'). */
  fieldsModule?: string;
  /** EAV table + FK column for writing custom-field values. */
  customValuesTable?: string;
  customValuesFk?: string;
  /** Predefined system_keys that map to a real column the commit RPC handles.
   *  A predefined form field whose system_key is not here is skipped (no column). */
  systemColumns?: string[];
  /** System keys hidden when the territory module replaces them (geo fields). */
  territoryReplacesKeys?: string[];
}

/** Normalized output of the shared reader — same shape for CSV and XLSX. */
export interface ParsedFile {
  headers: string[];
  rows: string[][];
  format: "csv" | "xlsx";
}

export type MappingConfidence = "high" | "medium" | "low" | "none";

/** One source column's mapping decision. fieldKey null = ignore this column. */
export interface ColumnMapping {
  sourceHeader: string;
  sourceIndex: number;
  fieldKey: string | null;
  confidence: MappingConfidence;
  /** True if the value came from auto-detection (vs. a user override). */
  auto: boolean;
}

export interface RowError {
  field?: string;
  message: string;
}

export type RowStatus = "valid" | "invalid" | "duplicate";

export interface RowValidation {
  /** 1-based source row number (as it appears in the file, header = row 1). */
  row: number;
  values: Record<string, string>;
  status: RowStatus;
  errors: RowError[];
}

export interface ValidationSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  rows: RowValidation[];
}

/** A row payload sent to import_commit (carries its source row for error mapping).
 *  `__custom` maps custom_field_id → value for the module's EAV table. */
export interface CommitRow {
  __row: number;
  __custom?: Record<string, string>;
  [key: string]: string | number | Record<string, string> | undefined;
}

export interface ImportJob {
  id: string;
  account_id: string;
  user_id: string;
  module: string;
  target_table: string;
  file_name: string;
  file_size: number | null;
  source_format: string | null;
  mode: ImportMode;
  status: "validating" | "previewed" | "importing" | "completed" | "failed" | "undone";
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  imported_rows: number;
  updated_rows: number;
  skipped_rows: number;
  failed_rows: number;
  undoable: boolean;
  undo_deadline: string | null;
  undone_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ---- Guided resolve (unknown lookup values) ----
export interface UnknownValue {
  value: string;
  count: number;
}
export interface ExistingMaster {
  id: string;
  name: string;
  /** Full path for hierarchical masters, e.g. "India / Gujarat / Rajkot". */
  path?: string;
  level?: number;
  parentId?: string | null;
}
export interface LookupResolveGroup {
  field: string;
  label: string;
  table: string;
  createable: "never" | "admin";
  hierarchical: boolean;
  /** Existing master values, for the "map to existing" (and parent) dropdowns. */
  existing: ExistingMaster[];
  unknowns: UnknownValue[];
}
export type ResolveAction =
  | { type: "create"; parentId?: string }
  | { type: "map"; toId: string; toName: string }
  | { type: "blank" };

/** field key -> lowercased unknown value -> chosen action. */
export type ResolveSelections = Record<string, Record<string, ResolveAction>>;

export interface ImportTemplate {
  id: string;
  account_id: string;
  module: string;
  name: string;
  mapping: Record<string, string>;
  default_mode: ImportMode | null;
  created_at: string;
}
