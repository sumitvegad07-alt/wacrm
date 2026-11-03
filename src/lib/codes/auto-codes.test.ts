import { describe, expect, test } from 'vitest';
import {
  CODE_KINDS,
  DEFAULT_CODE_SETTINGS,
  cleanPrefix,
  codePlaceholder,
  formatCode,
  isAutoCodeOn,
  normalizeRule,
  previewCode,
  readCodeSettings,
} from './auto-codes';

// ---------------------------------------------------------------------------
// The founder's one hard requirement: "By default it must be disabled."
// Everything else in here guards the ways a stored setting can arrive wrong —
// a tenant who saved under an older build, a hand-edited settings JSON, or a
// number typed into the Digits box that nobody validated.
//
// The formatCode cases are deliberately the same cases the SQL test asserts
// (scratch test for 20261103130000), because the live preview in Settings and
// the code the database actually mints must not disagree.
// ---------------------------------------------------------------------------

describe('off by default', () => {
  test('every record type ships disabled', () => {
    for (const kind of CODE_KINDS) {
      expect(DEFAULT_CODE_SETTINGS[kind].enabled).toBe(false);
    }
  });

  test('an account that never saved anything has all three off', () => {
    const settings = readCodeSettings(null);
    for (const kind of CODE_KINDS) {
      expect(settings[kind].enabled).toBe(false);
    }
  });

  test('an account with other settings but no code_settings has all three off', () => {
    const settings = readCodeSettings({ extra_settings: { multi_unit_enabled: true } });
    expect(isAutoCodeOn({ extra_settings: {} }, 'customer')).toBe(false);
    expect(settings.employee.enabled).toBe(false);
  });

  test('enabled is only ever true for a real boolean true', () => {
    // A JSON "true" string, or 1, must not switch numbering on for a live tenant.
    expect(normalizeRule({ enabled: 'true' }, 'customer').enabled).toBe(false);
    expect(normalizeRule({ enabled: 1 }, 'customer').enabled).toBe(false);
    expect(normalizeRule({ enabled: true }, 'customer').enabled).toBe(true);
  });
});

describe('formatCode — must match the SQL character for character', () => {
  test('pads to the configured width', () => {
    expect(formatCode({ prefix: 'CUST-', digits: 4 }, 1)).toBe('CUST-0001');
    expect(formatCode({ prefix: 'CUST-', digits: 4 }, 42)).toBe('CUST-0042');
    expect(formatCode({ prefix: 'EMP-', digits: 3 }, 7)).toBe('EMP-007');
    expect(formatCode({ prefix: 'SKU-', digits: 6 }, 1234)).toBe('SKU-001234');
  });

  test('an empty prefix is allowed', () => {
    expect(formatCode({ prefix: '', digits: 4 }, 9)).toBe('0009');
  });

  test('a number wider than the width GROWS, it is never truncated', () => {
    // Truncating would mint a duplicate of CUST-0001 on the 10,001st customer.
    expect(formatCode({ prefix: 'CUST-', digits: 4 }, 10000)).toBe('CUST-10000');
    expect(formatCode({ prefix: 'CUST-', digits: 1 }, 123)).toBe('CUST-123');
  });

  test('digits of 1 still works', () => {
    expect(formatCode({ prefix: 'C', digits: 1 }, 5)).toBe('C5');
  });
});

describe('prefix cleaning', () => {
  test('keeps letters, digits, dash, slash and underscore', () => {
    expect(cleanPrefix('CUST-')).toBe('CUST-');
    expect(cleanPrefix('OZ/24_')).toBe('OZ/24_');
  });

  test('strips spaces and quotes, which break a CSV or a hand-written report', () => {
    expect(cleanPrefix('CU ST')).toBe('CUST');
    expect(cleanPrefix("O'Z")).toBe('OZ');
    expect(cleanPrefix('A,B;C')).toBe('ABC');
  });

  test('caps the length', () => {
    expect(cleanPrefix('ABCDEFGHIJKLMNOPQRSTUV').length).toBe(12);
  });

  test('an empty prefix survives as empty rather than reverting to a default', () => {
    expect(normalizeRule({ prefix: '' }, 'customer').prefix).toBe('');
  });

  test('a missing prefix falls back to the record type default', () => {
    expect(normalizeRule({}, 'customer').prefix).toBe('CUST-');
    expect(normalizeRule({}, 'employee').prefix).toBe('EMP-');
    expect(normalizeRule({}, 'product').prefix).toBe('SKU-');
  });
});

describe('digits and next are clamped', () => {
  test('digits is held between 1 and 10', () => {
    expect(normalizeRule({ digits: 0 }, 'customer').digits).toBe(1);
    expect(normalizeRule({ digits: -5 }, 'customer').digits).toBe(1);
    expect(normalizeRule({ digits: 99 }, 'customer').digits).toBe(10);
    expect(normalizeRule({ digits: 4.7 }, 'customer').digits).toBe(4);
  });

  test('nonsense digits fall back to the default rather than NaN', () => {
    expect(normalizeRule({ digits: 'abc' }, 'customer').digits).toBe(4);
    expect(normalizeRule({ digits: null }, 'customer').digits).toBe(4);
  });

  test('next never drops below 1, so nobody gets CUST-0000', () => {
    expect(normalizeRule({ next: 0 }, 'customer').next).toBe(1);
    expect(normalizeRule({ next: -12 }, 'customer').next).toBe(1);
  });

  test('a digit string from a form input is accepted', () => {
    expect(normalizeRule({ digits: '6', next: '250' }, 'customer')).toMatchObject({
      digits: 6,
      next: 250,
    });
  });
});

describe('what the admin and the form see', () => {
  test('the preview shows the code the next save will produce', () => {
    expect(previewCode({ enabled: true, prefix: 'CUST-', digits: 4, next: 1 })).toBe('CUST-0001');
    expect(previewCode({ enabled: true, prefix: 'CUST-', digits: 4, next: 318 })).toBe('CUST-0318');
  });

  test('the form placeholder is empty while numbering is off', () => {
    expect(codePlaceholder({ code_settings: {} }, 'customer')).toBe('');
  });

  test('the form placeholder names the code that will be filled in', () => {
    const settings = {
      code_settings: { customer: { enabled: true, prefix: 'CUST-', digits: 4, next: 318 } },
    };
    expect(codePlaceholder(settings, 'customer')).toBe('Auto (CUST-0318)');
    // The other two are still off, so their boxes say nothing.
    expect(codePlaceholder(settings, 'employee')).toBe('');
  });
});

describe('one record type at a time', () => {
  test('switching customers on leaves employees and products off', () => {
    const settings = { code_settings: { customer: { enabled: true } } };
    expect(isAutoCodeOn(settings, 'customer')).toBe(true);
    expect(isAutoCodeOn(settings, 'employee')).toBe(false);
    expect(isAutoCodeOn(settings, 'product')).toBe(false);
  });

  test('an unknown record type in stored settings is ignored, not crashed on', () => {
    const settings = readCodeSettings({ code_settings: { lead: { enabled: true } } });
    expect(Object.keys(settings).sort()).toEqual(['customer', 'employee', 'product']);
  });
});
