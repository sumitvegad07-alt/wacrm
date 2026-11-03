import { describe, expect, test } from 'vitest';
import {
  BUYING_STATUSES,
  BUYING_STATUS_BADGE,
  BUYING_STATUS_OPTIONS,
  buyingStatusLabel,
  hasValidReason,
  isBuyingStatusEnabled,
  normalizeBuyingStatus,
  requiresReason,
} from './buying-status';

// ---------------------------------------------------------------------------
// Two rules worth a test of their own:
//
//  1. It is OFF until an admin switches it on. OZZO has live paying tenants
//     and a new column appearing in their customer list unasked is how trust
//     goes.
//  2. Anything unrecognised reads as "yet to buy". Claiming somebody has
//     bought when the data does not say so is the expensive mistake — a rep
//     would stop calling on a shop that never ordered.
// ---------------------------------------------------------------------------

describe('off until switched on', () => {
  test('an account with no settings at all has it off', () => {
    expect(isBuyingStatusEnabled(null)).toBe(false);
    expect(isBuyingStatusEnabled(undefined)).toBe(false);
    expect(isBuyingStatusEnabled({})).toBe(false);
  });

  test('an account with other extra settings still has it off', () => {
    expect(isBuyingStatusEnabled({ extra_settings: { multi_unit_enabled: true } })).toBe(false);
  });

  test('only a real boolean true switches it on', () => {
    expect(isBuyingStatusEnabled({ extra_settings: { buying_status_enabled: 'true' } })).toBe(false);
    expect(isBuyingStatusEnabled({ extra_settings: { buying_status_enabled: 1 } })).toBe(false);
    expect(isBuyingStatusEnabled({ extra_settings: { buying_status_enabled: true } })).toBe(true);
  });
});

describe('reading a stored value', () => {
  test('the two real values survive', () => {
    expect(normalizeBuyingStatus('buyer')).toBe('buyer');
    expect(normalizeBuyingStatus('yet_to_buy')).toBe('yet_to_buy');
  });

  test('blacklist survives, because it is a human judgement', () => {
    expect(normalizeBuyingStatus('blacklist')).toBe('blacklist');
  });

  test('anything else reads as yet_to_buy, never as a buyer or a blacklist', () => {
    // Guessing "blacklist" would cut off a trading customer; guessing "buyer"
    // would stop a rep calling on a shop that never ordered. Neither is safe.
    for (const junk of [null, undefined, '', 'Buyer', 'BUYER', 'Blacklist', 'blocked', 'active', 0, {}, []]) {
      expect(normalizeBuyingStatus(junk)).toBe('yet_to_buy');
    }
  });

  test('the labels are the words the founder chose', () => {
    expect(buyingStatusLabel('buyer')).toBe('Buyer');
    expect(buyingStatusLabel('yet_to_buy')).toBe('Yet to Buy');
    // Not "Inactive", not "Not a buyer" — it is an instruction to go and sell.
    expect(buyingStatusLabel(null)).toBe('Yet to Buy');
    expect(buyingStatusLabel('blacklist')).toBe('Blacklisted');
  });
});

describe('blacklist must say why', () => {
  test('only blacklist demands a reason', () => {
    expect(requiresReason('blacklist')).toBe(true);
    expect(requiresReason('buyer')).toBe(false);
    expect(requiresReason('yet_to_buy')).toBe(false);
  });

  test('whitespace is not a reason — matches the CHECK constraint', () => {
    expect(hasValidReason(null)).toBe(false);
    expect(hasValidReason(undefined)).toBe(false);
    expect(hasValidReason('')).toBe(false);
    expect(hasValidReason('   ')).toBe(false);
    expect(hasValidReason(' \t \n ')).toBe(false);
  });

  test('a real reason passes', () => {
    expect(hasValidReason('Cheque bounced twice')).toBe(true);
    expect(hasValidReason('  padded but real  ')).toBe(true);
  });
});

describe('the filter options', () => {
  test('offers exactly the three statuses, labelled', () => {
    expect(BUYING_STATUS_OPTIONS).toEqual([
      { value: 'buyer', label: 'Buyer' },
      { value: 'yet_to_buy', label: 'Yet to Buy' },
      { value: 'blacklist', label: 'Blacklisted' },
    ]);
  });

  test('every status has a badge style, so none can render unstyled', () => {
    for (const status of BUYING_STATUSES) {
      expect(BUYING_STATUS_BADGE[status]).toBeTruthy();
    }
  });

  test('every status has an option, so none can be unfilterable', () => {
    expect(BUYING_STATUS_OPTIONS.map((o) => o.value).sort()).toEqual([...BUYING_STATUSES].sort());
  });
});
