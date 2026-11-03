import { describe, expect, test } from 'vitest';
import {
  MAPPING_MODES,
  MAPPING_MODE_META,
  canEditParentByHand,
  eligibleParents,
  isMappingOn,
  readMappingMode,
} from './mapping';

// ---------------------------------------------------------------------------
// Two things carry real weight here:
//
//  1. OFF unless the account chose a mode. OZZO has live paying tenants, and a
//     "Supplied By" box appearing on the customer form unasked is how trust
//     goes.
//  2. Who may supply whom. A dealer must never be offered as a distributor's
//     supplier. The database enforces the same rule; this only narrows the
//     picker so nobody is handed a rejected save.
// ---------------------------------------------------------------------------

describe('off unless the account chose a mode', () => {
  test('nothing configured reads as off', () => {
    expect(readMappingMode(null)).toBe('off');
    expect(readMappingMode(undefined)).toBe('off');
    expect(readMappingMode({})).toBe('off');
    expect(readMappingMode({ extra_settings: {} })).toBe('off');
  });

  test('other extra settings do not switch it on', () => {
    expect(isMappingOn({ extra_settings: { multi_unit_enabled: true } })).toBe(false);
  });

  test('an unrecognised mode reads as off rather than guessing', () => {
    expect(readMappingMode({ extra_settings: { customer_mapping_mode: 'route' } })).toBe('off');
    expect(readMappingMode({ extra_settings: { customer_mapping_mode: true } })).toBe('off');
    expect(readMappingMode({ extra_settings: { customer_mapping_mode: '' } })).toBe('off');
  });

  test('the two real modes survive', () => {
    expect(readMappingMode({ extra_settings: { customer_mapping_mode: 'manual' } })).toBe('manual');
    expect(readMappingMode({ extra_settings: { customer_mapping_mode: 'beat' } })).toBe('beat');
  });

  test('every mode has a label and help text', () => {
    for (const mode of MAPPING_MODES) {
      expect(MAPPING_MODE_META[mode].label).toBeTruthy();
      expect(MAPPING_MODE_META[mode].help).toBeTruthy();
    }
  });
});

describe('who owns the Supplied By box', () => {
  test('a human types it in manual mode only', () => {
    expect(canEditParentByHand({ extra_settings: { customer_mapping_mode: 'manual' } })).toBe(true);
    // Beat mode: the trigger owns the column, so the box is read-only.
    expect(canEditParentByHand({ extra_settings: { customer_mapping_mode: 'beat' } })).toBe(false);
    expect(canEditParentByHand(null)).toBe(false);
  });
});

describe('who may supply whom', () => {
  const distributor = { id: 'd1', hierarchy_level: 1 };
  const subStockist = { id: 's1', hierarchy_level: 2 };
  const dealer = { id: 'x1', hierarchy_level: 3 };
  const noLevel = { id: 'n1', hierarchy_level: null };

  test('a dealer is offered everybody above him', () => {
    const out = eligibleParents([distributor, subStockist, dealer], dealer);
    expect(out.map((c) => c.id)).toEqual(['d1', 's1']);
  });

  test('a distributor at the top is offered nobody at or below him', () => {
    const out = eligibleParents([distributor, subStockist, dealer], distributor);
    expect(out).toEqual([]);
  });

  test('nobody supplies themselves', () => {
    const out = eligibleParents([distributor, subStockist], subStockist);
    expect(out.map((c) => c.id)).toEqual(['d1']);
  });

  test('the same level is not above — a dealer cannot supply a dealer', () => {
    const other = { id: 'x2', hierarchy_level: 3 };
    expect(eligibleParents([other], dealer)).toEqual([]);
  });

  test('three levels work, not just two', () => {
    // super-stockist → distributor → dealer. The middle one is offered only
    // what is genuinely above it.
    expect(eligibleParents([distributor, subStockist, dealer], subStockist).map((c) => c.id))
      .toEqual(['d1']);
  });

  test('with no levels anywhere, everyone is a candidate', () => {
    // This is every account with order hierarchy switched off: the rule cannot
    // mean anything, so it must not block mapping altogether.
    const out = eligibleParents([noLevel, { id: 'n2', hierarchy_level: null }], { id: 'n3' });
    expect(out.map((c) => c.id)).toEqual(['n1', 'n2']);
  });

  test('a candidate with no level is allowed for a levelled child', () => {
    expect(eligibleParents([noLevel], dealer).map((c) => c.id)).toEqual(['n1']);
  });

  test('a levelled candidate is allowed for a child with no level', () => {
    expect(eligibleParents([distributor], noLevel).map((c) => c.id)).toEqual(['d1']);
  });

  test('a new customer with no id yet still gets a filtered list', () => {
    expect(eligibleParents([distributor, dealer], { hierarchy_level: 3 }).map((c) => c.id))
      .toEqual(['d1']);
  });

  test('an empty candidate list is handled', () => {
    expect(eligibleParents([], dealer)).toEqual([]);
  });
});
