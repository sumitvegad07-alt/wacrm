import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  assetCustomerLabel,
  assetStatusLabel,
  buildTerritoryOptions,
  decideListState,
  hasActiveFilters,
  humanize,
  parsePaging,
} from './list-view';
import { ASSET_STATUSES } from './filters';

const p = (qs: string) => new URLSearchParams(qs);

describe('parsePaging', () => {
  it('defaults to page 1 and the default size', () => {
    expect(parsePaging(p(''))).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, offset: 0 });
  });
  it('derives the offset from page and size', () => {
    expect(parsePaging(p('page=3&pageSize=50'))).toEqual({ page: 3, pageSize: 50, offset: 100 });
  });
  it('ignores garbage', () => {
    expect(parsePaging(p('page=abc&pageSize=7'))).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(parsePaging(p('page=-4')).page).toBe(1);
    expect(parsePaging(p('page=0')).page).toBe(1);
    expect(parsePaging(p('page=2.9')).page).toBe(2);
  });
  it('caps an absurd page so the offset stays a safe integer', () => {
    expect(Number.isSafeInteger(parsePaging(p('page=99999999999999999999&pageSize=100')).offset)).toBe(true);
  });
});

describe('decideListState', () => {
  const none = {};
  it('shows an error before anything else, even with rows', () => {
    expect(decideListState({ failed: true, rowCount: 0, offset: 0, filters: none })).toBe('error');
    expect(decideListState({ failed: true, rowCount: 5, offset: 0, filters: none })).toBe('error');
  });
  it('is populated whenever there are rows', () => {
    expect(decideListState({ failed: false, rowCount: 1, offset: 0, filters: none })).toBe('populated');
    expect(decideListState({ failed: false, rowCount: 1, offset: 50, filters: { q: 'x' } })).toBe('populated');
  });
  it('shows onboarding only on page 1 with no rows and no filter', () => {
    expect(decideListState({ failed: false, rowCount: 0, offset: 0, filters: none })).toBe('onboarding');
  });
  it('shows no-match, never onboarding, when a filter is applied', () => {
    for (const filters of [
      { q: 'pump' },
      { contactId: 'c' },
      { assetTypeId: 't' },
      { territoryId: 'z' },
      { status: ['scrapped' as const] },
      { warranty: 'expired' as const },
    ]) {
      expect(decideListState({ failed: false, rowCount: 0, offset: 0, filters })).toBe('no-match');
    }
  });
  it('resets to page 1 when rows are empty past page 1, whatever the filters', () => {
    expect(decideListState({ failed: false, rowCount: 0, offset: 25, filters: none })).toBe('reset-page');
    expect(decideListState({ failed: false, rowCount: 0, offset: 25, filters: { q: 'x' } })).toBe('reset-page');
  });
  it('does not count Show Inactive as a filter', () => {
    expect(hasActiveFilters({ showInactive: true })).toBe(false);
    expect(decideListState({ failed: false, rowCount: 0, offset: 0, filters: { showInactive: true } })).toBe(
      'onboarding',
    );
  });
});

describe('assetCustomerLabel', () => {
  const snap = { customer_name_snapshot: 'Old Name', customer_phone_snapshot: '+911111111111' };
  it('prefers the live contact name', () => {
    expect(assetCustomerLabel({ contact: { name: 'Kent RO', phone: '+912222222222' }, ...snap })).toBe('Kent RO');
  });
  it('falls back to the live phone when the contact name is null or blank', () => {
    expect(assetCustomerLabel({ contact: { name: null, phone: '+912222222222' }, ...snap })).toBe('+912222222222');
    expect(assetCustomerLabel({ contact: { name: '  ', phone: '+912222222222' }, ...snap })).toBe('+912222222222');
  });
  it('uses the snapshot only when the contact is hidden', () => {
    expect(assetCustomerLabel({ contact: null, ...snap })).toBe('Old Name');
    expect(
      assetCustomerLabel({ contact: null, customer_name_snapshot: null, customer_phone_snapshot: '+911111111111' }),
    ).toBe('+911111111111');
  });
  it('shows a dash rather than a blank cell', () => {
    expect(assetCustomerLabel({ contact: null, customer_name_snapshot: null, customer_phone_snapshot: null })).toBe('—');
  });
});

describe('labels', () => {
  it('humanizes enum text', () => {
    expect(humanize('status under_repair, scrapped')).toBe('status under repair, scrapped');
  });
  it('labels every asset status', () => {
    for (const s of ASSET_STATUSES) expect(assetStatusLabel(s).length).toBeGreaterThan(0);
  });
});

describe('buildTerritoryOptions', () => {
  const rows = [
    { id: 'in', parent_id: null, name: 'India' },
    { id: 'gj', parent_id: 'in', name: 'Gujarat' },
    { id: 'su', parent_id: 'gj', name: 'Surat' },
    { id: 'ah', parent_id: 'gj', name: 'Ahmedabad' },
    { id: 'mh', parent_id: 'in', name: 'Maharashtra' },
  ];
  it('offers leaves only, labelled with their full path, sorted', () => {
    expect(buildTerritoryOptions(rows)).toEqual([
      { value: 'ah', label: 'India › Gujarat › Ahmedabad' },
      { value: 'su', label: 'India › Gujarat › Surat' },
      { value: 'mh', label: 'India › Maharashtra' },
    ]);
  });
  it('keeps a non-leaf that is already selected in the URL', () => {
    const values = buildTerritoryOptions(rows, 'gj').map((o) => o.value);
    expect(values).toContain('gj');
  });
  it('survives a parent cycle', () => {
    const cyc = [
      { id: 'a', parent_id: 'b', name: 'A' },
      { id: 'b', parent_id: 'a', name: 'B' },
    ];
    expect(() => buildTerritoryOptions(cyc, 'a')).not.toThrow();
  });
});
