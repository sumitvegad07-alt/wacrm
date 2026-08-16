import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentModule } from './schema';

/**
 * Custom fields on printed documents.
 *
 * A field defined for a module should be offerable in that module's template and print on
 * the document when enabled. Two things stood between that and reality:
 *
 *  1. The catalogue is mostly *system* fields — Date, Dispatch Date, Valid Until, Tracking
 *     Number — which the template already offers as dedicated Document Info rows. Listing
 *     them again under Custom Fields invites printing the same value twice under two
 *     different labels.
 *  2. Values are stored as raw strings. A date came out as "2026-08-16T00:00:00.000Z", a
 *     relational dropdown as a bare uuid, an attachment as a storage path. Fine in a form
 *     that knows the field type; unreadable on a customer-facing document.
 *
 * Both are handled here, once, for all four print routes and the editor.
 */

/** The per-module table holding values, and the column naming the parent record. */
const VALUE_TABLES: Record<DocumentModule, { table: string; fk: string }> = {
  order: { table: 'order_custom_values', fk: 'order_id' },
  quotation: { table: 'quotation_custom_values', fk: 'quotation_id' },
  dispatch: { table: 'dispatch_custom_values', fk: 'dispatch_id' },
  payment: { table: 'payment_custom_values', fk: 'payment_id' },
};

/**
 * System keys the template already exposes as their own Document Info row.
 *
 * Deliberately a list of the ones that genuinely collide, not "every system field": a
 * system field with no dedicated row (`delivery_date`, say) is still worth offering, and
 * excluding it would lose a field the user can actually fill in.
 */
const SYSTEM_KEYS_WITH_DEDICATED_ROW = new Set([
  'date',
  'dispatch_date',
  'valid_until',
  'tracking_number',
  'status',
  'invoice_no',
  'invoice_date',
  'lr_no',
  'lr_date',
  'transport_name',
  'notes',
]);

export interface CustomFieldDefinition {
  id: string;
  label: string;
  fieldType: string;
  sourceType: string | null;
  sourceModule: string | null;
}

/** Which table a relational dropdown points at, and how to name a row from it. */
const RELATIONAL_SOURCES: Record<string, { table: string; columns: string; label: (r: any) => string }> = {
  user: { table: 'profiles', columns: 'user_id, full_name, email', label: (r) => r.full_name || r.email || '' },
  product: { table: 'products', columns: 'id, name', label: (r) => r.name || '' },
  contact: { table: 'contacts', columns: 'id, company, name', label: (r) => r.company || r.name || '' },
  lead: { table: 'leads', columns: 'id, name', label: (r) => r.name || '' },
};

/**
 * The fields a template may offer for a module — user-defined ones, plus system fields the
 * template has no dedicated row for.
 */
export async function listTemplateCustomFields(
  supabase: SupabaseClient,
  accountId: string,
  module: DocumentModule
): Promise<CustomFieldDefinition[]> {
  // `field_name`, not `label`: custom_fields has no label column, and asking for one makes
  // PostgREST reject the whole query.
  const { data, error } = await supabase
    .from('custom_fields')
    .select('id, field_name, field_type, system_key, source_type, source_module')
    .eq('account_id', accountId)
    .eq('module_name', module)
    .eq('is_active', true)
    .order('position');

  if (error) throw error;

  return (data ?? [])
    .filter((f: any) => !f.system_key || !SYSTEM_KEYS_WITH_DEDICATED_ROW.has(f.system_key))
    .map((f: any) => ({
      id: f.id,
      label: f.field_name || 'Untitled',
      fieldType: f.field_type,
      sourceType: f.source_type ?? null,
      sourceModule: f.source_module ?? null,
    }));
}

function formatScalar(field: CustomFieldDefinition, raw: string): string {
  const value = raw.trim();
  if (value === '') return '';

  switch (field.fieldType) {
    case 'date': {
      const d = new Date(value);
      return Number.isNaN(d.getTime())
        ? value
        : d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    }
    case 'checkbox':
    case 'radio':
      // Stored as a raw boolean by some forms. "true" on an invoice means nothing.
      if (value === 'true') return 'Yes';
      if (value === 'false') return 'No';
      return value;
    case 'attachment': {
      // A storage path or URL is useless in print. The file name at least identifies it.
      const name = value.split('?')[0].split('/').pop();
      return name ? decodeURIComponent(name) : '';
    }
    default:
      return value;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Values for the fields a template selected, formatted for print.
 *
 * Returned in the template's own order, with blanks dropped rather than printed as an
 * empty labelled slot.
 */
export async function fetchCustomFieldValues(
  supabase: SupabaseClient,
  module: DocumentModule,
  recordId: string,
  fieldIds: string[]
): Promise<{ label: string; value: string }[]> {
  if (fieldIds.length === 0) return [];

  const { table, fk } = VALUE_TABLES[module];

  const [{ data: fields }, { data: values }] = await Promise.all([
    supabase
      .from('custom_fields')
      .select('id, field_name, field_type, source_type, source_module')
      .in('id', fieldIds),
    supabase.from(table).select('custom_field_id, value').eq(fk, recordId),
  ]);

  const valueById = new Map<string, string>(
    (values ?? []).map((v: any) => [v.custom_field_id, v.value == null ? '' : String(v.value)])
  );

  const defs = new Map<string, CustomFieldDefinition>(
    (fields ?? []).map((f: any) => [
      f.id,
      {
        id: f.id,
        label: f.field_name || 'Field',
        fieldType: f.field_type,
        sourceType: f.source_type ?? null,
        sourceModule: f.source_module ?? null,
      },
    ])
  );

  // A dropdown backed by another module stores that record's id. Printing a uuid on a
  // customer document is worse than printing nothing, so resolve them — grouped by source
  // table so one lookup covers every field pointing at it.
  const idsBySource = new Map<string, Set<string>>();
  for (const fid of fieldIds) {
    const def = defs.get(fid);
    const raw = valueById.get(fid);
    if (!def || !raw || def.sourceType !== 'module' || !def.sourceModule) continue;
    if (!UUID_RE.test(raw)) continue;
    if (!RELATIONAL_SOURCES[def.sourceModule]) continue;
    if (!idsBySource.has(def.sourceModule)) idsBySource.set(def.sourceModule, new Set());
    idsBySource.get(def.sourceModule)!.add(raw);
  }

  const resolved = new Map<string, string>();
  await Promise.all(
    [...idsBySource.entries()].map(async ([sourceModule, ids]) => {
      const source = RELATIONAL_SOURCES[sourceModule];
      const key = source.table === 'profiles' ? 'user_id' : 'id';
      const { data } = await supabase.from(source.table).select(source.columns).in(key, [...ids]);
      for (const row of data ?? []) {
        const label = source.label(row);
        if (label) resolved.set(String((row as any)[key]), label);
      }
    })
  );

  return fieldIds
    .map((fid) => {
      const def = defs.get(fid);
      const raw = valueById.get(fid);
      if (!def || !raw) return null;

      // A related record that has since been deleted resolves to nothing. Printing its raw
      // uuid would be worse than omitting the line.
      const display =
        def.sourceType === 'module' && UUID_RE.test(raw.trim())
          ? resolved.get(raw.trim()) ?? ''
          : formatScalar(def, raw);

      if (display.trim() === '') return null;
      return { label: def.label, value: display };
    })
    .filter((x): x is { label: string; value: string } => x !== null);
}

export const __testing = { formatScalar, SYSTEM_KEYS_WITH_DEDICATED_ROW };
