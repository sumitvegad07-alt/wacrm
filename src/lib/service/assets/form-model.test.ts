import { describe, it, expect } from 'vitest';
import {
  EMPTY_ASSET_FORM,
  buildCreateInput,
  buildUpdateInput,
  customerLabel,
  describeSaveError,
  firstErrorField,
  initialValues,
  localIsoDate,
  validateAssetForm,
  type AssetFormValues,
} from './form-model';
import { AssetError, mapAssetError } from './errors';
import type { CustomerAsset } from '../types';

const TODAY = '2026-10-03';

const filled = (over: Partial<AssetFormValues> = {}): AssetFormValues => ({
  ...EMPTY_ASSET_FORM,
  contact_id: 'c-1',
  name: 'Water purifier',
  ...over,
});

const row = (over: Partial<CustomerAsset> = {}): CustomerAsset => ({
  id: 'a-1',
  account_id: 'acc-1',
  asset_code: 'AST-000001',
  contact_id: 'c-1',
  asset_type_id: 't-1',
  product_id: 'p-1',
  name: 'Water purifier',
  make: 'Kent',
  model_no: 'M1',
  serial_no: 'SN-1',
  installation_date: '2026-01-10',
  warranty_start: '2026-01-10',
  warranty_end: '2027-01-10',
  status: 'active',
  customer_name_snapshot: 'Old Name',
  customer_phone_snapshot: '9999999999',
  site_label: 'Kitchen',
  territory_id: 'terr-1',
  notes: 'n',
  created_by: 'u-1',
  created_at: '2026-01-10T10:00:00.123Z',
  updated_at: '2026-01-10T10:00:00.123Z',
  deleted_at: null,
  ...over,
});

describe('initialValues', () => {
  it('starts empty on create, with Active status and a BLANK territory', () => {
    const v = initialValues(null);
    expect(v).toEqual(EMPTY_ASSET_FORM);
    expect(v.status).toBe('active');
    expect(v.territory_id).toBe('');
  });

  it('fills only the customer when it is locked, never the territory', () => {
    const v = initialValues(null, 'c-9');
    expect(v.contact_id).toBe('c-9');
    expect(v.territory_id).toBe('');
  });

  it('turns every null column of a stored row into a blank string', () => {
    const v = initialValues(
      row({ asset_type_id: null, product_id: null, make: null, serial_no: null, notes: null, warranty_end: null, territory_id: null }),
    );
    expect(v.asset_type_id).toBe('');
    expect(v.product_id).toBe('');
    expect(v.serial_no).toBe('');
    expect(v.warranty_end).toBe('');
    expect(v.territory_id).toBe('');
  });
});

describe('customerLabel', () => {
  it('uses the name, else the phone (name is nullable, phone is not)', () => {
    expect(customerLabel({ name: 'Asha', phone: '111' })).toBe('Asha');
    expect(customerLabel({ name: null, phone: '111' })).toBe('111');
    expect(customerLabel({ name: '   ', phone: '111' })).toBe('111');
  });
});

describe('localIsoDate', () => {
  it('uses the device calendar date, not the UTC date', () => {
    // 1 Oct 2026, 00:30 local. toISOString() would say 30 Sep in any zone ahead of UTC.
    expect(localIsoDate(new Date(2026, 9, 1, 0, 30))).toBe('2026-10-01');
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('validateAssetForm', () => {
  it('passes a minimal valid form', () => {
    expect(validateAssetForm(filled(), TODAY)).toEqual({});
  });

  it('requires a customer and a non-blank name', () => {
    const e = validateAssetForm({ ...EMPTY_ASSET_FORM, name: '   ' }, TODAY);
    expect(e.contact_id).toBeTruthy();
    expect(e.name).toBeTruthy();
  });

  it('blocks warranty end before warranty start, on the end field', () => {
    const e = validateAssetForm(filled({ warranty_start: '2026-06-01', warranty_end: '2026-05-31' }), TODAY);
    expect(e.warranty_end).toBe('Warranty end cannot be before warranty start.');
    expect(Object.keys(e)).toEqual(['warranty_end']);
  });

  it('allows warranty end on the same day as start, and either one alone', () => {
    expect(validateAssetForm(filled({ warranty_start: '2026-06-01', warranty_end: '2026-06-01' }), TODAY)).toEqual({});
    expect(validateAssetForm(filled({ warranty_end: '2026-06-01' }), TODAY)).toEqual({});
    expect(validateAssetForm(filled({ warranty_start: '2026-06-01' }), TODAY)).toEqual({});
  });

  it('blocks an installation date after today, allows today and the past', () => {
    expect(validateAssetForm(filled({ installation_date: '2026-10-04' }), TODAY).installation_date).toBe(
      'Installation date cannot be in the future.',
    );
    expect(validateAssetForm(filled({ installation_date: TODAY }), TODAY)).toEqual({});
    expect(validateAssetForm(filled({ installation_date: '2020-02-29' }), TODAY)).toEqual({});
  });

  it('rejects a date that is not a real calendar day', () => {
    expect(validateAssetForm(filled({ installation_date: '2026-02-30' }), TODAY).installation_date).toBe('Enter a valid date.');
    expect(validateAssetForm(filled({ warranty_end: 'soon' }), TODAY).warranty_end).toBe('Enter a valid date.');
  });

  it('reports every problem at once, and firstErrorField follows the form order', () => {
    const e = validateAssetForm(
      filled({ contact_id: '', name: '', installation_date: '2999-01-01', warranty_start: '2026-06-01', warranty_end: '2026-01-01' }),
      TODAY,
    );
    expect(Object.keys(e).sort()).toEqual(['contact_id', 'installation_date', 'name', 'warranty_end']);
    expect(firstErrorField(e)).toBe('contact_id');
    expect(firstErrorField({ warranty_end: 'x', serial_no: 'y' })).toBe('serial_no');
    expect(firstErrorField({})).toBeNull();
  });
});

describe('buildCreateInput', () => {
  const ctx = { accountId: 'acc-1', createdBy: 'prof-1' };

  it('sends only customer and name when nothing else is filled, so the database inherits the territory', () => {
    const input = buildCreateInput(filled(), ctx);
    const defined = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    expect(defined).toEqual({
      account_id: 'acc-1',
      created_by: 'prof-1',
      contact_id: 'c-1',
      name: 'Water purifier',
      status: 'active',
    });
  });

  it('trims text and drops blank optional fields', () => {
    const input = buildCreateInput(filled({ name: '  Pump  ', make: '  ', serial_no: ' SN-9 ' }), ctx);
    expect(input.name).toBe('Pump');
    expect(input.make).toBeUndefined();
    expect(input.serial_no).toBe('SN-9');
  });

  it('sends an explicit territory only when one was picked', () => {
    expect(buildCreateInput(filled({ territory_id: '' }), ctx).territory_id).toBeUndefined();
    expect(buildCreateInput(filled({ territory_id: 'terr-9' }), ctx).territory_id).toBe('terr-9');
  });

  it('never carries a field the database owns', () => {
    const smuggled = { ...filled(), asset_code: 'AST-9', customer_name_snapshot: 'x', customer_phone_snapshot: 'y', deleted_at: 'z' };
    const keys = Object.keys(buildCreateInput(smuggled, ctx));
    for (const banned of ['asset_code', 'customer_name_snapshot', 'customer_phone_snapshot', 'deleted_at']) {
      expect(keys).not.toContain(banned);
    }
  });
});

describe('buildUpdateInput', () => {
  it('sends nothing when nothing changed, even from an archived row with a millisecond timestamp', () => {
    const archived = row({ deleted_at: '2026-09-01T08:15:30.123456+00:00' });
    expect(buildUpdateInput(initialValues(archived), archived)).toEqual({});
  });

  it('sends only the changed field', () => {
    const r = row();
    expect(buildUpdateInput({ ...initialValues(r), notes: 'new note' }, r)).toEqual({ notes: 'new note' });
  });

  it('keeps the territory out of a notes-only edit, so an explicit territory is left alone', () => {
    const r = row({ territory_id: 'elsewhere' });
    const out = buildUpdateInput({ ...initialValues(r), notes: 'x' }, r);
    expect(out).not.toHaveProperty('territory_id');
  });

  it('sends a territory that was changed to a different one', () => {
    const r = row();
    expect(buildUpdateInput({ ...initialValues(r), territory_id: 'terr-2' }, r)).toEqual({ territory_id: 'terr-2' });
  });

  it('never sends a blank territory (it cannot be cleared)', () => {
    const r = row();
    expect(buildUpdateInput({ ...initialValues(r), territory_id: '' }, r)).toEqual({});
  });

  it('clears an emptied optional field with null', () => {
    const r = row();
    const out = buildUpdateInput({ ...initialValues(r), serial_no: '  ', warranty_end: '', asset_type_id: '' }, r);
    expect(out).toEqual({ serial_no: null, warranty_end: null, asset_type_id: null });
  });

  it('treats whitespace-only differences as no change', () => {
    const r = row({ make: 'Kent' });
    expect(buildUpdateInput({ ...initialValues(r), make: ' Kent ', name: ' Water purifier ' }, r)).toEqual({});
  });

  it('sends status and customer changes', () => {
    const r = row();
    expect(buildUpdateInput({ ...initialValues(r), status: 'scrapped', contact_id: 'c-2' }, r)).toEqual({
      status: 'scrapped',
      contact_id: 'c-2',
    });
  });

  it('never carries a field the database owns', () => {
    const r = row();
    const smuggled = { ...initialValues(r), notes: 'x', asset_code: 'AST-9', deleted_at: null, customer_name_snapshot: 'q' };
    const keys = Object.keys(buildUpdateInput(smuggled, r));
    expect(keys).toEqual(['notes']);
  });
});

describe('describeSaveError', () => {
  it('renders a duplicate serial with the conflicting asset, for a link', () => {
    const err = new AssetError('duplicate_serial', 'x', { serial: '12345' }).withConflict({ id: 'a-91', asset_code: 'AST-000091' });
    expect(describeSaveError(err)).toEqual({
      kind: 'duplicate_serial',
      serial: '12345',
      conflict: { id: 'a-91', asset_code: 'AST-000091' },
      message: 'Serial 12345 already exists on asset AST-000091',
    });
  });

  it('still reports a duplicate serial when the conflicting asset could not be found', () => {
    const f = describeSaveError(new AssetError('duplicate_serial', 'x', { serial: 'S1' }).withConflict(null));
    expect(f).toMatchObject({ kind: 'duplicate_serial', conflict: null, message: 'Serial S1 already exists on another asset' });
  });

  it('maps a raw 23505 on the serial index without leaking the constraint name', () => {
    const raw = { code: '23505', message: 'duplicate key value violates unique constraint "customer_assets_uniq_serial"' };
    const f = describeSaveError(mapAssetError(raw, { serial: 'S1' }));
    expect(f.kind).toBe('duplicate_serial');
    expect(JSON.stringify(f)).not.toContain('customer_assets_uniq_serial');
  });

  it('puts the known validation messages under their own field', () => {
    expect(describeSaveError(mapAssetError({ code: '23514', message: 'violates check constraint "customer_assets_warranty_order_chk"' }))).toMatchObject({ kind: 'field', field: 'warranty_end' });
    expect(describeSaveError(mapAssetError({ code: '23514', message: 'violates check constraint "customer_assets_install_date_chk"' }))).toMatchObject({ kind: 'field', field: 'installation_date' });
    expect(describeSaveError(mapAssetError({ code: '23514', message: 'violates check constraint "customer_assets_name_not_blank"' }))).toMatchObject({ kind: 'field', field: 'name' });
    expect(describeSaveError(new AssetError('validation', 'Choose a customer for this asset.'))).toMatchObject({ kind: 'field', field: 'contact_id' });
  });

  it('never shows an unmapped check-constraint text', () => {
    const raw = 'new row for relation "customer_assets" violates check constraint "customer_assets_something_new_chk"';
    const f = describeSaveError(mapAssetError({ code: '23514', message: raw }));
    expect(f.kind).toBe('banner');
    expect(JSON.stringify(f)).not.toContain('customer_assets');
    expect(f).toMatchObject({ log: true });
  });

  it('never shows an unknown database error', () => {
    const f = describeSaveError(mapAssetError({ code: 'XX000', message: 'relation "customer_assets" exploded' }));
    expect(f).toMatchObject({ kind: 'banner', log: true });
    expect(JSON.stringify(f)).not.toContain('exploded');
  });

  it('says a cross-tenant reference is not in this account', () => {
    const f = describeSaveError(mapAssetError({ code: '23503', message: 'contact_id does not belong to this account' }));
    expect(f).toMatchObject({ kind: 'banner', retryable: false });
    expect((f as { message: string }).message).toContain('customer is not in this account');
  });

  it('explains a permission failure in plain words', () => {
    const f = describeSaveError(mapAssetError({ code: '42501', message: 'new row violates row-level security policy for table "customer_assets"' }));
    expect(f.kind).toBe('banner');
    expect(JSON.stringify(f)).not.toContain('row-level');
  });

  it('marks a network failure as retryable and a missing row as not', () => {
    expect(describeSaveError(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'banner', retryable: true });
    expect(describeSaveError(new AssetError('not_found', 'x'))).toMatchObject({ kind: 'banner', retryable: false });
  });

  it('copes with something that is not an error at all', () => {
    expect(describeSaveError(undefined).kind).toBe('banner');
    expect(describeSaveError('boom').kind).toBe('banner');
  });
});
