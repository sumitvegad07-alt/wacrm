import { describe, expect, test } from 'vitest';
import { coverageWalk, indexTerritories, type TerritoryLink } from './coverage';

// ---------------------------------------------------------------------------
// The founder's 2026-11-03 scenario, which is the reason this module exists:
// a salesman holds an AREA, the customer is recorded with only the CITY above
// it, and the customer read "unassigned" because the walk only ever went up.
//
// The tree used throughout is the live Rajkot shape:
//
//   India (1)
//   └── Gujarat (2)
//       └── Rajkot (3)
//           ├── 150 Feet Ring Road (4)
//           │   └── Shop Lane (5)
//           └── Amin Marg (4)
// ---------------------------------------------------------------------------

const TREE: TerritoryLink[] = [
  { id: 'india', parent_id: null },
  { id: 'gujarat', parent_id: 'india' },
  { id: 'rajkot', parent_id: 'gujarat' },
  { id: 'ring-road', parent_id: 'rajkot' },
  { id: 'shop-lane', parent_id: 'ring-road' },
  { id: 'amin-marg', parent_id: 'rajkot' },
];

const index = indexTerritories(TREE);

/** Dhaval holds one area of Rajkot. Nobody holds Rajkot itself. */
const AREA_ONLY = { 'ring-road': ['Dhaval'] };

describe('the bug: assignment below the customer', () => {
  const covers = coverageWalk(index, AREA_ONLY);

  test('a customer recorded with only the City resolves to the area rep inside it', () => {
    expect(covers('rajkot')).toEqual(['Dhaval']);
  });

  test('a customer recorded with only the State resolves to him too', () => {
    expect(covers('gujarat')).toEqual(['Dhaval']);
  });

  test('the customer actually in his area still resolves to him', () => {
    expect(covers('ring-road')).toEqual(['Dhaval']);
  });

  test('a customer below his area still resolves to him, by walking up', () => {
    expect(covers('shop-lane')).toEqual(['Dhaval']);
  });

  test('a SIBLING area is still nobody of his — this must not widen', () => {
    expect(covers('amin-marg')).toEqual([]);
  });

  test('a customer with no territory resolves to nobody', () => {
    expect(covers(null)).toEqual([]);
    expect(covers(undefined)).toEqual([]);
  });
});

describe('what already worked keeps working', () => {
  test('an assignment ABOVE the customer still wins by walking up', () => {
    const covers = coverageWalk(index, { rajkot: ['Ramesh'] });
    expect(covers('amin-marg')).toEqual(['Ramesh']);
    expect(covers('shop-lane')).toEqual(['Ramesh']);
  });

  test('the NEAREST assigned ancestor wins, not the highest', () => {
    const covers = coverageWalk(index, { india: ['Head Office'], rajkot: ['Ramesh'] });
    expect(covers('amin-marg')).toEqual(['Ramesh']);
  });

  test('a customer who already resolves is never changed by the downward pass', () => {
    // Ramesh holds the city, Dhaval an area inside it. The city-level customer
    // belongs to Ramesh exactly as before — the fallback must not fire.
    const covers = coverageWalk(index, { rajkot: ['Ramesh'], 'ring-road': ['Dhaval'] });
    expect(covers('rajkot')).toEqual(['Ramesh']);
  });
});

describe('several reps inside one territory', () => {
  test('a city-level customer resolves to every area rep in that city', () => {
    const covers = coverageWalk(index, { 'ring-road': ['Dhaval'], 'amin-marg': ['Suresh'] });
    expect(covers('rajkot').sort()).toEqual(['Dhaval', 'Suresh']);
  });

  test('the nearest level inside wins, so deeper sub-areas are not dragged in', () => {
    const covers = coverageWalk(index, { 'ring-road': ['Dhaval'], 'shop-lane': ['Junior'] });
    expect(covers('rajkot')).toEqual(['Dhaval']);
  });

  test('it reaches past an empty level to find the reps below it', () => {
    // Nobody holds either area; one holds a sub-area two levels down.
    const covers = coverageWalk(index, { 'shop-lane': ['Junior'] });
    expect(covers('rajkot')).toEqual(['Junior']);
  });

  test('duplicates across two sibling areas are not reported twice', () => {
    const covers = coverageWalk(index, { 'ring-road': ['Dhaval'], 'amin-marg': ['Dhaval'] });
    expect(covers('rajkot')).toEqual(['Dhaval']);
  });
});

describe('it cannot hang or wander', () => {
  test('an unknown territory id resolves to nobody', () => {
    expect(coverageWalk(index, AREA_ONLY)('nowhere')).toEqual([]);
  });

  test('a parent cycle is survivable', () => {
    const cyclic = indexTerritories([
      { id: 'a', parent_id: 'b' },
      { id: 'b', parent_id: 'a' },
    ]);
    expect(coverageWalk(cyclic, {})('a')).toEqual([]);
  });

  test('an empty tree resolves to nobody', () => {
    expect(coverageWalk(indexTerritories([]), {})('rajkot')).toEqual([]);
  });
});
