import { describe, expect, test } from 'vitest';
import { rollUpCustomerCounts } from './customer-counts';
import type { TerritoryNode } from './types';

// ---------------------------------------------------------------------------
// The badge beside a territory answers "how many customers are in here?", and
// for a Country that has to mean everything beneath it.
//
// Checked against live data on 2026-10-05: customers sit at levels 2, 3 and 4,
// and NONE at level 1. A count of only the customers pinned directly to a node
// would therefore show 0 next to India while 293 customers sat under it — the
// opposite of useful. The badge rolls the subtree up.
//
// Levels 3 and 4 both hold customers, so a City can have both its own customers
// and more inside its Areas. Both must be included.
// ---------------------------------------------------------------------------

/** Minimal node — the roll-up only reads `id` and `children`. */
function node(id: string, children: TerritoryNode[] = []): TerritoryNode {
  return { id, children } as TerritoryNode;
}

describe('rollUpCustomerCounts', () => {
  test('a leaf shows the customers pinned to it', () => {
    const totals = rollUpCustomerCounts([node('area')], new Map([['area', 7]]));

    expect(totals.get('area')).toBe(7);
  });

  test('a country totals every customer beneath it', () => {
    const tree = [node('india', [node('gujarat', [node('surat'), node('rajkot')])])];
    const direct = new Map([
      ['surat', 10],
      ['rajkot', 4],
    ]);

    const totals = rollUpCustomerCounts(tree, direct);

    expect(totals.get('india')).toBe(14);
    expect(totals.get('gujarat')).toBe(14);
  });

  test('a city counts its own customers as well as those in its areas', () => {
    // Levels 3 and 4 both carry customers in the live data, so this is the
    // common case, not an edge case.
    const tree = [node('surat', [node('adajan'), node('vesu')])];
    const direct = new Map([
      ['surat', 3],
      ['adajan', 5],
      ['vesu', 2],
    ]);

    const totals = rollUpCustomerCounts(tree, direct);

    expect(totals.get('surat')).toBe(10);
  });

  test('a territory nobody is in reads zero, not blank', () => {
    const totals = rollUpCustomerCounts([node('empty')], new Map());

    expect(totals.get('empty')).toBe(0);
  });

  test('siblings do not leak into each other', () => {
    const tree = [node('gujarat', [node('surat', [node('adajan')])]), node('kerala', [node('kochi')])];
    const direct = new Map([
      ['adajan', 9],
      ['kochi', 1],
    ]);

    const totals = rollUpCustomerCounts(tree, direct);

    expect(totals.get('gujarat')).toBe(9);
    expect(totals.get('kerala')).toBe(1);
  });

  test('counts for territories that are not in the tree are ignored', () => {
    // An archived territory is filtered out of the tree but its customers still
    // carry its id. Counting it would make a parent's badge exceed what the
    // screen can account for.
    const totals = rollUpCustomerCounts([node('india', [node('gujarat')])], new Map([['atlantis', 99]]));

    expect(totals.get('india')).toBe(0);
    expect(totals.has('atlantis')).toBe(false);
  });

  test('handles a deep chain without losing anyone', () => {
    const tree = [node('l1', [node('l2', [node('l3', [node('l4', [node('l5')])])])])];
    const direct = new Map([['l5', 6]]);

    const totals = rollUpCustomerCounts(tree, direct);

    expect(totals.get('l1')).toBe(6);
    expect(totals.get('l4')).toBe(6);
  });
});
