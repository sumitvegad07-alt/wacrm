import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomField } from "@/types";
import type { FieldDescriptor, FieldType, ImportDescriptor } from "./types";
import { normalizeKey } from "./parse";

// Maps a custom_fields.field_type to the importer's validation type.
function mapFieldType(t: string): FieldType {
  switch ((t || "").toLowerCase()) {
    case "phone": return "phone";
    case "email": return "email";
    case "number": case "currency": case "decimal": return "number";
    case "date": case "datetime": return "date";
    case "checkbox": case "boolean": case "toggle": return "boolean";
    default: return "text"; // text, textarea, select, dropdown, radio, etc.
  }
}

// Best-effort extraction of allowed values from a select/dropdown's field_options.
function extractAllowed(opts: unknown): string[] | undefined {
  const arr = Array.isArray(opts)
    ? opts
    : opts && typeof opts === "object" && Array.isArray((opts as Record<string, unknown>).options)
      ? ((opts as Record<string, unknown>).options as unknown[])
      : null;
  if (!arr) return undefined;
  const vals = arr
    .map((o) => (typeof o === "string" ? o : o && typeof o === "object" ? String((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value ?? "") : ""))
    .filter((s): s is string => !!s);
  return vals.length ? vals : undefined;
}

// Synonyms so an admin's export column (from another CRM) auto-maps onto our
// field: the field label, its system_key, and each split word all count.
function synonymsFor(field: { field_name: string; system_key?: string | null }): string[] {
  const out = new Set<string>();
  if (field.system_key) out.add(field.system_key);
  out.add(field.field_name);
  for (const w of field.field_name.split(/[^A-Za-z0-9]+/)) if (w.length >= 3) out.add(w);
  return [...out].map((s) => s.trim()).filter(Boolean);
}

/**
 * Build the runtime import descriptor for a form-backed module (Customers /
 * Products / Leads) from the SAME `custom_fields` config that drives manual
 * entry — so the import columns, required rules, and custom fields all mirror
 * the form exactly. Non-form-backed masters return their static descriptor.
 */
export async function buildImportDescriptor(
  supabase: SupabaseClient,
  base: ImportDescriptor,
  accountId: string,
  opts: { territoryEnabled?: boolean } = {},
): Promise<ImportDescriptor> {
  if (!base.formBacked || !base.fieldsModule) return base;

  const { data } = await supabase
    .from("custom_fields")
    .select("*")
    .eq("account_id", accountId)
    .eq("module_name", base.fieldsModule)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const rows = (data as CustomField[]) ?? [];
  const systemColumns = new Set(base.systemColumns ?? []);
  const territoryReplaces = new Set(base.territoryReplacesKeys ?? []);
  const fields: FieldDescriptor[] = [];

  for (const cf of rows) {
    // Predefined field → real column, only if the commit RPC handles that column.
    if (cf.system_key) {
      if (!systemColumns.has(cf.system_key)) continue; // no backing column — skip
      if (opts.territoryEnabled && territoryReplaces.has(cf.system_key)) continue; // replaced by territory
      fields.push({
        key: cf.system_key,
        label: cf.field_name,
        required: !!cf.is_required,
        type: mapFieldType(cf.field_type),
        allowed: extractAllowed(cf.field_options),
        synonyms: synonymsFor(cf),
        systemKey: cf.system_key,
      });
    } else {
      // Admin custom field → EAV value.
      fields.push({
        key: `cf:${cf.id}`,
        label: cf.field_name,
        required: !!cf.is_required,
        type: mapFieldType(cf.field_type),
        allowed: extractAllowed(cf.field_options),
        synonyms: synonymsFor(cf),
        customFieldId: cf.id,
      });
    }
  }

  // Append the synthetic/gated extras defined on the base (territory, lat/long,
  // financials). Territory is only offered when the module is enabled.
  for (const extra of base.fields) {
    if (extra.key === "territory" && !opts.territoryEnabled) continue;
    if (fields.some((f) => f.key === extra.key)) continue;
    fields.push(extra);
  }

  // A phone/name/etc. that the config didn't include but the RPC requires as the
  // dedupe key must still exist, or the importer can't function. Guarantee it.
  for (const dk of base.dedupeKeys) {
    if (!fields.some((f) => f.key === dk)) {
      const fallback = base.fields.find((f) => f.key === dk);
      if (fallback) fields.push(fallback);
    }
  }

  return { ...base, fields };
}

/** Ensure a mapping never sends two source columns to the same field id. */
export function normalizeFieldKey(s: string): string {
  return normalizeKey(s);
}
