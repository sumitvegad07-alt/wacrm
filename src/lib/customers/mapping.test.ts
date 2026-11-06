import { describe, expect, test } from 'vitest';
import {
  MAPPING_MODES,
  MAPPING_MODE_META,
  canEditParentByHand,
  eligibleParents,
  isMappingOn,
  isParentOwnedBySystem,
  levelsProblem,
  OFFERED_MAPPING_MODES,
  readMappingMode,
  readSetupStatus,
  remapRpcFor,
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

// ---------------------------------------------------------------------------
// Area mapping (2026-11-04). Mapping the channel by AREA replaced mapping it by
// beat, because a beat is a visit route INSIDE an area, not the area itself.
// Beat mode has to keep working for anyone already on it while disappearing
// from the choices an admin is offered.
// ---------------------------------------------------------------------------

describe('area mapping', () => {
  test('area is a real mode', () => {
    expect(readMappingMode({ extra_settings: { customer_mapping_mode: 'area' } })).toBe('area');
    expect(isMappingOn({ extra_settings: { customer_mapping_mode: 'area' } })).toBe(true);
  });

  test('beat is still honoured but no longer offered', () => {
    expect(readMappingMode({ extra_settings: { customer_mapping_mode: 'beat' } })).toBe('beat');
    expect(OFFERED_MAPPING_MODES).not.toContain('beat');
    expect(OFFERED_MAPPING_MODES).toEqual(['off', 'manual', 'area']);
  });

  test('every offered mode is a real mode with help text', () => {
    for (const mode of OFFERED_MAPPING_MODES) {
      expect(MAPPING_MODES).toContain(mode);
      expect(MAPPING_MODE_META[mode].help).toBeTruthy();
    }
  });

  test('the system owns the supplier in area mode until a human locks it', () => {
    const area = { extra_settings: { customer_mapping_mode: 'area' } };
    expect(isParentOwnedBySystem(area, { parent_locked: false })).toBe(true);
    expect(isParentOwnedBySystem(area, null)).toBe(true);
    // The override: one area that really holds two Distributors.
    expect(isParentOwnedBySystem(area, { parent_locked: true })).toBe(false);
  });

  test('a beat owns the supplier outright — locking is not offered there', () => {
    const beat = { extra_settings: { customer_mapping_mode: 'beat' } };
    expect(isParentOwnedBySystem(beat, { parent_locked: true })).toBe(true);
  });

  test('manual mode is always the human', () => {
    const manual = { extra_settings: { customer_mapping_mode: 'manual' } };
    expect(isParentOwnedBySystem(manual, { parent_locked: false })).toBe(false);
    expect(canEditParentByHand(manual)).toBe(true);
  });

  test('a human may override in area mode, never in beat mode', () => {
    expect(canEditParentByHand({ extra_settings: { customer_mapping_mode: 'area' } })).toBe(true);
    expect(canEditParentByHand({ extra_settings: { customer_mapping_mode: 'beat' } })).toBe(false);
  });

  test('each mode re-maps through its own RPC', () => {
    expect(remapRpcFor('area')).toBe('resync_account_area_parents');
    expect(remapRpcFor('beat')).toBe('resync_account_beat_parents');
    expect(remapRpcFor('manual')).toBeNull();
    expect(remapRpcFor('off')).toBeNull();
  });
});

describe('secondary sales needs at least two levels', () => {
  const two = [{ name: 'Distributor' }, { name: 'Dealer' }];

  test('one level is refused, because every order would be primary', () => {
    expect(levelsProblem(true, [{ name: 'Dealer' }])).toMatch(/at least 2/i);
  });

  test('a blank name does not count as a level', () => {
    expect(levelsProblem(true, [{ name: 'Dealer' }, { name: '   ' }])).toMatch(/at least 2/i);
    expect(levelsProblem(true, [{ name: 'Dealer' }, { name: null }])).toMatch(/at least 2/i);
  });

  test('two or more is fine', () => {
    expect(levelsProblem(true, two)).toBeNull();
    expect(levelsProblem(true, [...two, { name: 'Stockist' }])).toBeNull();
  });

  test('more than five is refused', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `L${i}` }));
    expect(levelsProblem(true, six)).toMatch(/at most 5/i);
  });

  test('switched off, the rule does not apply at all', () => {
    expect(levelsProblem(false, [])).toBeNull();
    expect(levelsProblem(false, [{ name: 'Dealer' }])).toBeNull();
  });
});

describe('setup status', () => {
  test('missing or junk counts read as zero rather than NaN', () => {
    // needs_choice reads 0 against a database where 20261105120000 has not
    // been applied yet, which is the correct answer there — an area cannot
    // hold two distributors until the key is widened.
    expect(readSetupStatus(null)).toEqual({
      total: 0, no_level: 0, no_parent: 0, no_area: 0, locked: 0, needs_choice: 0,
    });
    expect(readSetupStatus({ total: 'x' }).total).toBe(0);
  });

  test('string counts from PostgREST jsonb are coerced', () => {
    expect(readSetupStatus({ total: '39', no_level: '9' })).toMatchObject({ total: 39, no_level: 9 });
  });
});
