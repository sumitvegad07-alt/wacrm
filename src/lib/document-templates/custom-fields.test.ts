import { describe, it, expect } from 'vitest';
import { __testing, type CustomFieldDefinition } from './custom-fields';

const { formatScalar, SYSTEM_KEYS_WITH_DEDICATED_ROW } = __testing;

const field = (fieldType: string, extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition => ({
  id: 'f1',
  label: 'Field',
  fieldType,
  sourceType: null,
  sourceModule: null,
  ...extra,
});

describe('formatScalar', () => {
  it('renders a date the way the rest of the document does', () => {
    // Stored as an ISO string; "2026-08-16T00:00:00.000Z" on an invoice is unreadable.
    expect(formatScalar(field('date'), '2026-08-16T00:00:00.000Z')).toBe('16-08-2026');
    expect(formatScalar(field('date'), '2026-08-16')).toBe('16-08-2026');
  });

  it('leaves an unparseable date alone rather than printing "Invalid Date"', () => {
    expect(formatScalar(field('date'), 'sometime next week')).toBe('sometime next week');
  });

  it('turns stored booleans into Yes / No', () => {
    expect(formatScalar(field('checkbox'), 'true')).toBe('Yes');
    expect(formatScalar(field('checkbox'), 'false')).toBe('No');
    expect(formatScalar(field('radio'), 'true')).toBe('Yes');
  });

  it('keeps a radio choice that is not a boolean', () => {
    expect(formatScalar(field('radio'), 'Express')).toBe('Express');
  });

  it('reduces an attachment to its file name, not a storage URL', () => {
    expect(
      formatScalar(field('attachment'), 'https://x.supabase.co/storage/v1/object/public/a/b/receipt%20scan.png?token=abc')
    ).toBe('receipt scan.png');
    expect(formatScalar(field('attachment'), 'account/user/eway.pdf')).toBe('eway.pdf');
  });

  it('passes text, number and dropdown choices through untouched', () => {
    expect(formatScalar(field('text'), 'EWB-4471829301')).toBe('EWB-4471829301');
    expect(formatScalar(field('number'), '42')).toBe('42');
    expect(formatScalar(field('dropdown'), 'Rice')).toBe('Rice');
  });

  it('treats whitespace as empty', () => {
    expect(formatScalar(field('text'), '   ')).toBe('');
  });
});

describe('system field exclusion', () => {
  it('excludes the system keys that already have a dedicated template row', () => {
    // Offering these under Custom Fields too would print the same value twice, under two
    // different labels.
    for (const key of ['date', 'dispatch_date', 'valid_until', 'tracking_number', 'notes']) {
      expect(SYSTEM_KEYS_WITH_DEDICATED_ROW.has(key)).toBe(true);
    }
  });

  it('does not exclude a system field the template has no row for', () => {
    // delivery_date has no dedicated row, so it stays available — excluding every system
    // field would lose fields the user can genuinely fill in.
    expect(SYSTEM_KEYS_WITH_DEDICATED_ROW.has('delivery_date')).toBe(false);
  });
});
