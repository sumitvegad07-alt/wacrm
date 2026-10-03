import { describe, it, expect } from 'vitest';
import { AssetError } from './errors';
import {
  assetActionGates,
  buildDetailGroups,
  creationSnapshotNote,
  customerDisplay,
  formatDetailDate,
  interpretRestoreError,
  newCodeStart,
  validateNewAssetCode,
  GENERIC_RESTORE_FAILURE,
  MAX_ASSET_CODE_LENGTH,
  type DetailAssetFields,
} from './detail-view';

type Cust = Parameters<typeof customerDisplay>[0];
const cust = (over: Partial<Cust> = {}): Cust => ({
  contact: { name: 'Asha Traders', phone: '9876500001' },
  customer_name_snapshot: 'Asha Traders',
  customer_phone_snapshot: '9876500001',
  ...over,
});

describe('customerDisplay', () => {
  it('names the live contact, not the snapshot, when they differ', () => {
    const r = customerDisplay(cust({ contact: { name: 'Asha Enterprises', phone: '9876500001' } }));
    expect(r).toEqual({ label: 'Asha Enterprises', source: 'live' });
  });

  it('falls back to the phone for a customer with no name (real production rows)', () => {
    expect(customerDisplay(cust({ contact: { name: null, phone: '9000000000' } }))).toEqual({
      label: '9000000000',
      source: 'live',
    });
    expect(customerDisplay(cust({ contact: { name: '   ', phone: '9000000000' } })).label).toBe('9000000000');
  });

  it('uses the snapshot, and says so, when the contact is hidden by data scope', () => {
    expect(customerDisplay(cust({ contact: null }))).toEqual({ label: 'Asha Traders', source: 'snapshot' });
    expect(
      customerDisplay(cust({ contact: null, customer_name_snapshot: null, customer_phone_snapshot: '9111' })),
    ).toEqual({ label: '9111', source: 'snapshot' });
  });

  it('shows a dash when there is nothing at all', () => {
    expect(
      customerDisplay({ contact: null, customer_name_snapshot: null, customer_phone_snapshot: null }),
    ).toEqual({ label: '—', source: 'none' });
  });
});

describe('creationSnapshotNote', () => {
  it('is null when the snapshot still matches the live customer', () => {
    expect(creationSnapshotNote(cust())).toBeNull();
  });

  it('is null when only whitespace differs', () => {
    expect(creationSnapshotNote(cust({ customer_name_snapshot: '  Asha Traders ' }))).toBeNull();
  });

  it('shows the old name and phone after a rename', () => {
    const note = creationSnapshotNote(cust({ contact: { name: 'Asha Enterprises', phone: '9876500001' } }));
    expect(note).toBe('Asha Traders · 9876500001');
  });

  it('shows the snapshot after a phone change alone', () => {
    const note = creationSnapshotNote(cust({ contact: { name: 'Asha Traders', phone: '9999999999' } }));
    expect(note).toBe('Asha Traders · 9876500001');
  });

  it('treats a name added later as a difference and shows what was recorded (phone only)', () => {
    const note = creationSnapshotNote({
      contact: { name: 'Now Named', phone: '9000000000' },
      customer_name_snapshot: null,
      customer_phone_snapshot: '9000000000',
    });
    expect(note).toBe('9000000000');
  });

  it('is null when the live contact is hidden (the header already shows the snapshot)', () => {
    expect(creationSnapshotNote(cust({ contact: null }))).toBeNull();
  });

  it('is null for an asset with no snapshot', () => {
    expect(creationSnapshotNote(cust({ customer_name_snapshot: null, customer_phone_snapshot: null }))).toBeNull();
  });
});

describe('assetActionGates', () => {
  it('offers Edit and Archive on a live asset to someone with both rights', () => {
    expect(assetActionGates({ edit: true, delete: true }, false)).toEqual({ edit: true, archive: true, restore: false });
  });

  it('offers Restore, never Archive, on an archived asset', () => {
    expect(assetActionGates({ edit: true, delete: true }, true)).toEqual({ edit: true, archive: false, restore: true });
  });

  it('ties Archive and Restore to delete_service_assets, and Edit to edit_service_assets, independently', () => {
    expect(assetActionGates({ edit: true, delete: false }, false)).toEqual({ edit: true, archive: false, restore: false });
    expect(assetActionGates({ edit: true, delete: false }, true)).toEqual({ edit: true, archive: false, restore: false });
    expect(assetActionGates({ edit: false, delete: true }, false)).toEqual({ edit: false, archive: true, restore: false });
    expect(assetActionGates({ edit: false, delete: false }, true)).toEqual({ edit: false, archive: false, restore: false });
  });
});

describe('formatDetailDate', () => {
  it('formats the calendar day the column names', () => {
    expect(formatDetailDate('2026-10-05')).toBe('5 Oct 2026');
    expect(formatDetailDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('returns null for blank and the raw text for garbage', () => {
    expect(formatDetailDate(null)).toBeNull();
    expect(formatDetailDate('  ')).toBeNull();
    expect(formatDetailDate('not a date')).toBe('not a date');
  });
});

const asset = (over: Partial<DetailAssetFields> = {}): DetailAssetFields => ({
  ...cust(),
  asset_code: 'AST-000001',
  name: 'Test purifier',
  asset_type_id: 'type-1',
  asset_type: { name: 'Water purifier' },
  product_id: 'prod-1',
  product: { name: 'AquaPure 5' },
  make: 'AquaCo',
  model_no: 'AP-5',
  serial_no: 'SN-100',
  installation_date: '2026-06-01',
  warranty_start: '2026-06-01',
  warranty_end: '2027-05-31',
  status: 'under_repair',
  site_label: 'Kitchen',
  territory_id: 'terr-1',
  territory: { name: 'Andheri' },
  notes: 'Checked on site',
  ...over,
});

describe('buildDetailGroups', () => {
  it('returns the four groups in the form order', () => {
    expect(buildDetailGroups(asset()).map((g) => g.title)).toEqual(['Identity', 'Lifecycle', 'Placement', 'Notes']);
  });

  it('lists the form fields in each group, in form order', () => {
    const g = buildDetailGroups(asset());
    expect(g[0].fields.map((f) => f.key)).toEqual([
      'asset_code',
      'customer',
      'name',
      'asset_type',
      'product',
      'make',
      'model_no',
      'serial_no',
    ]);
    expect(g[1].fields.map((f) => f.key)).toEqual(['installation_date', 'warranty_start', 'warranty_end', 'status']);
    expect(g[2].fields.map((f) => f.key)).toEqual(['site_label', 'territory']);
    expect(g[3].fields.map((f) => f.key)).toEqual(['notes']);
  });

  it('formats dates and the status label, and uses joined names', () => {
    const byKey = Object.fromEntries(buildDetailGroups(asset()).flatMap((g) => g.fields).map((f) => [f.key, f.value]));
    expect(byKey).toMatchObject({
      asset_code: 'AST-000001',
      customer: 'Asha Traders',
      asset_type: 'Water purifier',
      product: 'AquaPure 5',
      installation_date: '1 Jun 2026',
      warranty_end: '31 May 2027',
      status: 'Under repair',
      territory: 'Andheri',
      notes: 'Checked on site',
    });
  });

  it('puts the LIVE customer name in the customer field, not the snapshot', () => {
    const f = buildDetailGroups(asset({ contact: { name: 'Renamed Ltd', phone: '9876500001' } }))[0].fields[1];
    expect(f.value).toBe('Renamed Ltd');
  });

  it('gives null (a dash on screen) for blank optional fields', () => {
    const g = buildDetailGroups(
      asset({
        asset_type_id: null,
        asset_type: null,
        product_id: null,
        product: null,
        make: '  ',
        model_no: null,
        serial_no: null,
        installation_date: null,
        warranty_start: null,
        warranty_end: null,
        site_label: null,
        territory_id: null,
        territory: null,
        notes: null,
      }),
    );
    const values = g.flatMap((x) => x.fields).filter((f) => !['asset_code', 'customer', 'name', 'status'].includes(f.key));
    expect(values.every((f) => f.value === null)).toBe(true);
  });

  it('says "Not available" when an id is set but the joined row is missing, not a dash', () => {
    const g = buildDetailGroups(asset({ asset_type: null, product: null, territory: null }));
    const byKey = Object.fromEntries(g.flatMap((x) => x.fields).map((f) => [f.key, f.value]));
    expect(byKey.asset_type).toBe('Not available');
    expect(byKey.product).toBe('Not available');
    expect(byKey.territory).toBe('Not available');
  });
});

describe('interpretRestoreError', () => {
  it('turns a code collision into "needs a new code", carrying the code and the asset holding it', () => {
    const err = new AssetError('duplicate_code', 'taken', { assetCode: 'AST-000001' }).withConflict({
      id: 'b',
      asset_code: 'AST-000001',
    });
    expect(interpretRestoreError(err)).toEqual({
      kind: 'needs-new-code',
      clashingCode: 'AST-000001',
      holder: { id: 'b', asset_code: 'AST-000001' },
    });
  });

  it('copes with a collision whose holder or code is unknown', () => {
    expect(interpretRestoreError(new AssetError('duplicate_code', 'taken'))).toEqual({
      kind: 'needs-new-code',
      clashingCode: null,
      holder: null,
    });
  });

  it('passes the readable message of any other AssetError through', () => {
    expect(interpretRestoreError(new AssetError('permission', "You don't have permission to do that."))).toEqual({
      kind: 'failed',
      message: "You don't have permission to do that.",
    });
    expect(interpretRestoreError(new AssetError('network', 'Network error'))).toMatchObject({ kind: 'failed' });
  });

  it('never shows raw text from a non-AssetError', () => {
    expect(interpretRestoreError(new Error('duplicate key value violates unique constraint "x"'))).toEqual({
      kind: 'failed',
      message: GENERIC_RESTORE_FAILURE,
    });
    expect(interpretRestoreError('boom')).toEqual({ kind: 'failed', message: GENERIC_RESTORE_FAILURE });
  });
});

describe('validateNewAssetCode', () => {
  it('trims and accepts a normal code', () => {
    expect(validateNewAssetCode('  AST-900001 ', 'AST-000001', 'AST-')).toEqual({ ok: true, code: 'AST-900001' });
  });

  it('refuses blank', () => {
    expect(validateNewAssetCode('   ', null)).toEqual({ ok: false, message: 'Enter a new asset code.' });
  });

  it('refuses the pre-filled start with no number added', () => {
    const r = validateNewAssetCode('AST-', 'AST-000001', 'AST-');
    expect(r.ok).toBe(false);
  });

  it('refuses the code that just clashed', () => {
    const r = validateNewAssetCode('AST-000001', 'AST-000001', 'AST-');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('AST-000001');
  });

  it('refuses an over-long code', () => {
    expect(validateNewAssetCode('X'.repeat(MAX_ASSET_CODE_LENGTH + 1), null).ok).toBe(false);
    expect(validateNewAssetCode('X'.repeat(MAX_ASSET_CODE_LENGTH), null).ok).toBe(true);
  });

  it('does not invent a format rule: any non-blank text within the length is allowed', () => {
    expect(validateNewAssetCode('PUMP 7', null)).toEqual({ ok: true, code: 'PUMP 7' });
  });
});

describe('newCodeStart', () => {
  it('keeps everything up to and including the last hyphen', () => {
    expect(newCodeStart('AST-000001')).toBe('AST-');
    expect(newCodeStart('SRV-A-0042')).toBe('SRV-A-');
  });

  it('is empty when there is no hyphen', () => {
    expect(newCodeStart('PUMP7')).toBe('');
  });
});
