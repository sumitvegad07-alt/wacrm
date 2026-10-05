import { describe, expect, test } from 'vitest';
import {
  CUSTOMER_UNIQUE_KEYS,
  LEAD_UNIQUE_KEYS,
  readCustomerUniqueKeys,
  readLeadUniqueKeys,
} from './unique-keys';

// ---------------------------------------------------------------------------
// Which fields block a duplicate save is the admin's choice, ticked per module.
// Two rules decide everything here, and they differ on purpose:
//
//   Customers already have duplicate prevention — `customer_unique_key` has
//   defaulted to "name" for every account since it shipped. So an account that
//   has never opened the new screen must keep blocking on name.
//
//   Leads have NONE. The live database has only a primary key on `leads`
//   (checked 2026-10-05). Switching a default on would start rejecting saves
//   across all 33 accounts for records they have always been allowed to create,
//   so leads start with nothing ticked and the admin opts in.
//
// Contact Number is in neither list: it is enforced unconditionally by a unique
// index on both tables, and Settings shows it as a locked row.
// ---------------------------------------------------------------------------

describe('readCustomerUniqueKeys', () => {
  test('an account that never opened the screen keeps blocking on name', () => {
    expect(readCustomerUniqueKeys(undefined)).toEqual(['name']);
  });

  test('honours the old single-choice setting when it says code', () => {
    expect(readCustomerUniqueKeys({ extra_settings: { customer_unique_key: 'code' } })).toEqual([
      'code',
    ]);
  });

  test('the new list wins over the old single choice', () => {
    const keys = readCustomerUniqueKeys({
      extra_settings: { customer_unique_key: 'code', customer_unique_keys: ['name', 'code'] },
    });

    expect(keys).toEqual(['name', 'code']);
  });

  test('an admin who unticks everything gets no name or code blocking', () => {
    // Unlike the outstanding rule, an empty list here is a legitimate choice —
    // it means "stop blocking on name and code". Contact Number still blocks,
    // so this cannot leave a tenant with no protection at all.
    expect(readCustomerUniqueKeys({ extra_settings: { customer_unique_keys: [] } })).toEqual([]);
  });

  test('drops a field that is not a real customer key', () => {
    const keys = readCustomerUniqueKeys({
      extra_settings: { customer_unique_keys: ['name', 'shoe_size'] },
    });

    expect(keys).toEqual(['name']);
  });

  test('drops duplicates so a field cannot be checked twice', () => {
    const keys = readCustomerUniqueKeys({
      extra_settings: { customer_unique_keys: ['code', 'code', 'name'] },
    });

    expect(keys).toEqual(['name', 'code']);
  });

  test('falls back to the old behaviour when the list is the wrong shape', () => {
    expect(readCustomerUniqueKeys({ extra_settings: { customer_unique_keys: 'name' } })).toEqual([
      'name',
    ]);
  });
});

describe('readLeadUniqueKeys', () => {
  test('leads start with nothing ticked, because they had no protection before', () => {
    expect(readLeadUniqueKeys(undefined)).toEqual([]);
  });

  test('reads what the admin ticked', () => {
    const keys = readLeadUniqueKeys({ extra_settings: { lead_unique_keys: ['name', 'email'] } });

    expect(keys).toEqual(['name', 'email']);
  });

  test('drops a field leads do not have', () => {
    // There is deliberately no Lead Code field (founder, 2026-10-05).
    const keys = readLeadUniqueKeys({ extra_settings: { lead_unique_keys: ['name', 'code'] } });

    expect(keys).toEqual(['name']);
  });

  test('stays empty when the setting is the wrong shape', () => {
    expect(readLeadUniqueKeys({ extra_settings: { lead_unique_keys: 'name' } })).toEqual([]);
  });
});

describe('the tickable fields', () => {
  test('contact number is not tickable on either module', () => {
    // It is enforced by a unique index regardless of the setting, so offering it
    // as a tick would be a lie — unticking it would change nothing.
    expect(CUSTOMER_UNIQUE_KEYS.map((f) => f.key)).not.toContain('phone');
    expect(LEAD_UNIQUE_KEYS.map((f) => f.key)).not.toContain('phone');
  });

  test('each tickable field names the column it guards', () => {
    expect(CUSTOMER_UNIQUE_KEYS.find((f) => f.key === 'code')?.column).toBe('customer_code');
    expect(LEAD_UNIQUE_KEYS.find((f) => f.key === 'email')?.column).toBe('email');
  });
});
