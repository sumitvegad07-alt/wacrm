import { describe, it, expect } from 'vitest';
import { customerAssetsDescriptor as d } from './customer-assets';
import { getImportDescriptor, isImportModule } from '../registry';
import { detectMapping } from '../mapping';
import { validateRows, buildCommitRows } from '../validate';
import { buildTemplateCsv } from '../error-report';
import type { ValidationSummary } from '../types';

const field = (key: string) => d.fields.find((f) => f.key === key);

describe('customer assets import descriptor', () => {
  it('is registered under its module key', () => {
    expect(getImportDescriptor('customer_assets')).toBe(d);
    expect(isImportModule('customer_assets')).toBe(true);
  });

  it('targets the right table and requires the import right', () => {
    expect(d.targetTable).toBe('customer_assets');
    expect(d.requiredPermission).toBe('import_service_assets');
    expect(d.undoable).toBe(true);
  });

  it('dedupes on serial number', () => {
    expect(d.dedupeKeys).toEqual(['serial_no']);
  });

  it('requires a customer and a name, and nothing else', () => {
    expect(d.fields.filter((f) => f.required).map((f) => f.key).sort())
      .toEqual(['customer', 'name']);
  });

  it('never accepts a territory column from the file', () => {
    expect(field('territory')).toBeUndefined();
    expect(field('territory_id')).toBeUndefined();
    // Not even by label or synonym: a Territory header must stay unmapped.
    for (const f of d.fields) {
      const words = [f.key, f.label, ...f.synonyms].map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''));
      expect(words.some((w) => w.includes('territory'))).toBe(false);
    }
  });

  it('leaves a Territory column in the file unmapped', () => {
    const m = detectMapping(['Customer', 'Asset Name', 'Territory'], d);
    expect(m[0].fieldKey).toBe('customer');
    expect(m[1].fieldKey).toBe('name');
    expect(m[2].fieldKey).toBeNull();
  });

  it('never accepts an asset code, or either customer snapshot, from the file', () => {
    expect(field('asset_code')).toBeUndefined();
    expect(field('customer_name_snapshot')).toBeUndefined();
    expect(field('customer_phone_snapshot')).toBeUndefined();
  });

  it('gives the customer field phone and code synonyms so real files map cleanly', () => {
    const syn = field('customer')!.synonyms;
    expect(syn).toContain('customername');
    expect(syn).toContain('mobile');
    expect(syn).toContain('customercode');
  });

  it('offers every asset status as an allowed value', () => {
    expect([...field('status')!.allowed!].sort())
      .toEqual(['active', 'inactive', 'replaced', 'scrapped', 'under_repair']);
  });

  it('caps rows to protect the commit RPC', () => {
    expect(d.maxRows).toBeLessThanOrEqual(5000);
  });

  it('is insert-only: it does not offer an update mode', () => {
    expect(d.insertOnly).toBe(true);
  });

  it('has no lookups, so the guided-resolve step can never create a master', () => {
    expect(d.lookups).toBeUndefined();
  });

  it('offers "create missing asset types" as the only option', () => {
    expect(d.options).toHaveLength(1);
    expect(d.options![0].key).toBe('create_asset_types');
  });

  it('tells the user the date rule in the wizard help', () => {
    expect(d.help).toContain('yyyy-mm-dd, dd-mm-yyyy or dd/mm/yyyy');
    expect(d.help).toContain('A two-digit year is rejected rather than guessed');
  });

  it('no longer tells the user to reformat Excel dates or switch to CSV', () => {
    // The shared reader now hands .xlsx date cells over as ISO (see lib/import/parse),
    // so the workaround this importer used to print is obsolete.
    expect(d.help).not.toMatch(/save as CSV|format date columns|from Excel/i);
  });

  it('uses the strict day-first date type for all three dates', () => {
    for (const k of ['installation_date', 'warranty_start', 'warranty_end']) {
      expect(field(k)!.type).toBe('date_dmy');
    }
  });

  it('its template header is the field labels', () => {
    const header = buildTemplateCsv(d).split('\r\n')[0].split(',');
    expect(header).toEqual(d.fields.map((f) => f.label));
  });

  it('auto-maps a typical customer export', () => {
    const m = detectMapping(
      ['Customer Name', 'Asset Type', 'Product Code', 'Asset Name', 'Make', 'Model No', 'Serial Number',
        'Installation Date', 'Warranty Start', 'Warranty End', 'Status', 'Site', 'Notes'],
      d,
    );
    expect(m.map((x) => x.fieldKey)).toEqual([
      'customer', 'asset_type', 'product', 'name', 'make', 'model_no', 'serial_no',
      'installation_date', 'warranty_start', 'warranty_end', 'status', 'site_label', 'notes',
    ]);
  });
});

describe('customer assets import: row validation', () => {
  const row = (values: Record<string, string>, n = 2) => ({ row: n, values });
  const base = { customer: 'Acme', name: 'Chiller 1' };

  it('accepts dd-mm-yyyy, dd/mm/yyyy and ISO dates', () => {
    const s = validateRows(
      [
        row({ ...base, installation_date: '15-03-2024' }),
        row({ ...base, installation_date: '15/03/2024' }, 3),
        row({ ...base, installation_date: '2024-03-15' }, 4),
      ],
      d,
      new Set(),
    );
    expect(s.valid).toBe(3);
  });

  it('fails a two-digit year instead of guessing a century', () => {
    const s = validateRows([row({ ...base, installation_date: '01-02-26' })], d, new Set());
    expect(s.invalid).toBe(1);
    expect(s.rows[0].errors[0].message).toMatch(/Installation Date/);
    expect(s.rows[0].errors[0].message).toMatch(/two-digit/i);
  });

  it('fails an impossible calendar date', () => {
    const s = validateRows([row({ ...base, warranty_end: '31-02-2026' })], d, new Set());
    expect(s.invalid).toBe(1);
  });

  it('rejects a status that is not one of the five', () => {
    const s = validateRows([row({ ...base, status: 'broken' })], d, new Set());
    expect(s.invalid).toBe(1);
  });

  it('requires customer and name', () => {
    const s = validateRows([row({ customer: '', name: '' })], d, new Set());
    expect(s.rows[0].errors.map((e) => e.field).sort()).toEqual(['customer', 'name']);
  });

  it('flags a serial already on file as a duplicate (case-insensitive)', () => {
    const s = validateRows([row({ ...base, serial_no: 'sn-100' })], d, new Set(['sn100']));
    expect(s.rows[0].status).toBe('duplicate');
  });
});

describe('customer assets import: commit payload', () => {
  const summary: ValidationSummary = {
    total: 3, valid: 1, invalid: 1, duplicate: 1,
    rows: [
      { row: 2, values: { customer: 'A', name: 'ok' }, status: 'valid', errors: [] },
      { row: 3, values: { customer: '', name: '' }, status: 'invalid', errors: [{ message: 'x' }] },
      { row: 4, values: { customer: 'A', name: 'dup', serial_no: 'S1' }, status: 'duplicate', errors: [] },
    ],
  };

  it('still sends a duplicate in skip mode, so the server can name the existing asset', () => {
    const out = buildCommitRows(summary, 'skip', d);
    expect(out.map((r) => r.name)).toEqual(['ok', 'dup']);
  });

  it('never sends an invalid row', () => {
    expect(buildCommitRows(summary, 'update', d).some((r) => r.__row === 3)).toBe(false);
  });

  it('sends the create-asset-types flag only when ticked', () => {
    expect(buildCommitRows(summary, 'skip', d)[0].opt_create_asset_types).toBeUndefined();
    expect(buildCommitRows(summary, 'skip', d, { create_asset_types: false })[0].opt_create_asset_types).toBeUndefined();
    expect(buildCommitRows(summary, 'skip', d, { create_asset_types: true })[0].opt_create_asset_types).toBe('true');
  });
});
