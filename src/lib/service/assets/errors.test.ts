import { describe, it, expect } from 'vitest';
import { mapAssetError, AssetError, isRangeNotSatisfiable, rangeRowCount } from './errors';

const pg = (code: string, message: string, extra: Record<string, string> = {}) => ({ code, message, ...extra });

describe('mapAssetError', () => {
  it('maps a serial collision and carries the serial the caller sent', () => {
    const e = mapAssetError(
      pg('23505', 'duplicate key value violates unique constraint "customer_assets_uniq_serial"', {
        details: 'Key (account_id, lower(serial_no))=(9c1e, sn-12345) already exists.',
      }),
      { serial: 'SN-12345' },
    );
    expect(e.kind).toBe('duplicate_serial');
    expect(e.serial).toBe('SN-12345');
    expect(e.message).toBe('Serial SN-12345 already exists on another asset');
  });

  it('withConflict rewrites the message to name the existing asset', () => {
    const e = mapAssetError(
      pg('23505', 'duplicate key value violates unique constraint "customer_assets_uniq_serial"'),
      { serial: '12345' },
    ).withConflict({ id: 'a1', asset_code: 'AST-000091' });
    expect(e.message).toBe('Serial 12345 already exists on asset AST-000091');
    expect(e.conflict).toEqual({ id: 'a1', asset_code: 'AST-000091' });
    expect(e.kind).toBe('duplicate_serial');
  });

  it('withConflict is a no-op on any other kind', () => {
    const e = mapAssetError(pg('42501', 'x'));
    expect(e.withConflict({ id: 'a', asset_code: 'B' })).toBe(e);
  });

  it('maps an asset-code collision', () => {
    const e = mapAssetError(pg('23505', 'duplicate key value violates unique constraint "customer_assets_uniq_code"'));
    expect(e.kind).toBe('duplicate_code');
  });

  it('does not call an unrelated unique violation a serial or code collision', () => {
    expect(mapAssetError(pg('23505', 'duplicate key value violates unique constraint "other_idx"')).kind).toBe('unknown');
  });

  it.each([
    ['customer_assets: contact 1 does not exist in account 2', 'That customer is not in this account.'],
    ['customer_assets: asset_type_id 1 does not exist in account 2', 'That asset type is not in this account.'],
    ['customer_assets: product_id 1 does not exist in account 2', 'That product is not in this account.'],
    ['customer_assets: territory_id 1 does not exist in account 2', 'That territory is not in this account.'],
    ['insert violates foreign key constraint "customer_assets_contact_id_fkey"', 'That customer is not in this account.'],
  ])('maps 23503 (%s) to a readable reference error', (message, expected) => {
    const e = mapAssetError(pg('23503', message));
    expect(e.kind).toBe('reference_invalid');
    expect(e.message).toBe(expected);
  });

  it('falls back to a generic reference message when the reference is unknown', () => {
    expect(mapAssetError(pg('23503', 'something else')).message).toMatch(/not in this account/);
  });

  it('maps 42501 to a permission error, with a specific message for the archive guard', () => {
    expect(mapAssetError(pg('42501', 'new row violates row-level security policy')).kind).toBe('permission');
    expect(
      mapAssetError(pg('42501', 'customer_assets: archiving or restoring an asset requires delete_service_assets')).message,
    ).toBe("You don't have permission to archive or restore assets.");
  });

  it('maps the CHECK constraints to friendly validation messages', () => {
    expect(mapAssetError(pg('23514', 'violates check constraint "customer_assets_warranty_order_chk"')).message)
      .toBe('Warranty end cannot be before warranty start.');
    expect(mapAssetError(pg('23514', 'violates check constraint "customer_assets_install_date_chk"')).message)
      .toBe('Installation date cannot be in the future.');
    expect(mapAssetError(pg('23514', 'violates check constraint "customer_assets_name_not_blank"')).message)
      .toBe('Asset name is required.');
  });

  it('maps a malformed uuid / enum (22P02) to a validation error', () => {
    expect(mapAssetError(pg('22P02', 'invalid input syntax for type uuid: "garbage"')).kind).toBe('validation');
  });

  it('maps a thrown TypeError and a SQLSTATE-less fetch failure to a retryable network error', () => {
    const t = mapAssetError(new TypeError('Failed to fetch'));
    expect(t.kind).toBe('network');
    expect(t.retryable).toBe(true);
    expect(mapAssetError({ code: '', message: 'TypeError: fetch failed' }).kind).toBe('network');
  });

  it('passes an existing AssetError through untouched and defaults everything else to unknown', () => {
    const own = new AssetError('not_found', 'x');
    expect(mapAssetError(own)).toBe(own);
    expect(mapAssetError(pg('XX000', 'boom')).kind).toBe('unknown');
    expect(mapAssetError(null).kind).toBe('unknown');
  });
});

describe('duplicate_code messages', () => {
  const dup = pg('23505', 'duplicate key value violates unique constraint "customer_assets_uniq_code"');

  it('tells the user to give the asset a new code when a restore collides', () => {
    const e = mapAssetError(dup, { restoring: true, assetCode: 'AST-000012' });
    expect(e.kind).toBe('duplicate_code');
    expect(e.assetCode).toBe('AST-000012');
    expect(e.message).toBe(
      'Asset code AST-000012 has since been given to another asset. Give this asset a new code, then restore it.',
    );
  });

  it('names the code on a collision that is not a restore', () => {
    expect(mapAssetError(dup, { assetCode: 'AST-000099' }).message).toBe('Asset code AST-000099 is already used by another asset.');
  });

  it('withConflict keeps the message and attaches the holder of the code', () => {
    const e = mapAssetError(dup, { restoring: true, assetCode: 'AST-000012' }).withConflict({ id: 'x', asset_code: 'AST-000012' });
    expect(e.kind).toBe('duplicate_code');
    expect(e.conflict).toEqual({ id: 'x', asset_code: 'AST-000012' });
    expect(e.assetCode).toBe('AST-000012');
    expect(e.message).toMatch(/Give this asset a new code, then restore it/);
  });
});

describe('range helpers (offset past the last row)', () => {
  const err = {
    code: 'PGRST103',
    message: 'Requested range not satisfiable',
    details: 'An offset of 100 was requested, but there are only 3 rows.',
  };

  it('recognises a 416 by status, by code and by message', () => {
    expect(isRangeNotSatisfiable({}, 416)).toBe(true);
    expect(isRangeNotSatisfiable(err)).toBe(true);
    expect(isRangeNotSatisfiable({ message: 'Requested range not satisfiable' })).toBe(true);
  });

  it('does not treat other errors as an empty page', () => {
    expect(isRangeNotSatisfiable({ code: '42501', message: 'denied' }, 403)).toBe(false);
    expect(isRangeNotSatisfiable(null)).toBe(false);
  });

  it('reads the real row count from the details, or null', () => {
    expect(rangeRowCount(err)).toBe(3);
    expect(rangeRowCount({ details: 'An offset of 5 was requested, but there are only 1 row.' })).toBe(1);
    expect(rangeRowCount({ details: 'nothing useful' })).toBeNull();
    expect(rangeRowCount(undefined)).toBeNull();
  });
});
