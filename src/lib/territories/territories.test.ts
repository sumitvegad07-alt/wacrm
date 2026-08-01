import { describe, it, expect } from 'vitest';
import { buildTree, parseCsv, treeToCsv } from './api';
import {
  normalizeTerritorySettings,
  enabledLevels,
  leafLevel,
  levelName,
  DEFAULT_TERRITORY_SETTINGS,
} from './settings';
import type { Territory, TerritoryNode } from './types';

function t(partial: Partial<Territory> & { id: string }): Territory {
  return {
    account_id: 'acct',
    parent_id: null,
    level: 1,
    name: partial.id,
    code: null,
    status: 'active',
    notes: null,
    is_seed_data: false,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    ...partial,
  };
}

describe('buildTree', () => {
  it('nests an adjacency list by parent_id', () => {
    const rows: Territory[] = [
      t({ id: 'india', level: 1 }),
      t({ id: 'guj', level: 2, parent_id: 'india' }),
      t({ id: 'surat', level: 3, parent_id: 'guj' }),
      t({ id: 'usa', level: 1 }),
    ];
    const tree = buildTree(rows);
    expect(tree.map((n) => n.id).sort()).toEqual(['india', 'usa']);
    const india = tree.find((n) => n.id === 'india')!;
    expect(india.children.map((c) => c.id)).toEqual(['guj']);
    expect(india.children[0].children.map((c) => c.id)).toEqual(['surat']);
  });

  it('surfaces orphans (missing parent) at the root so nothing is hidden', () => {
    const rows: Territory[] = [t({ id: 'child', level: 3, parent_id: 'missing' })];
    const tree = buildTree(rows);
    expect(tree.map((n) => n.id)).toEqual(['child']);
  });
});

describe('normalizeTerritorySettings', () => {
  it('falls back to defaults for junk input', () => {
    expect(normalizeTerritorySettings(null)).toEqual(DEFAULT_TERRITORY_SETTINGS);
    // default assignment mode is area-wise (founder decision)
    expect(normalizeTerritorySettings('nope').assignment_mode).toBe('area_wise');
  });

  it('renumbers positions to 1..n and clamps to 5 levels', () => {
    const s = normalizeTerritorySettings({
      levels: [
        { position: 9, name: 'A', enabled: true },
        { position: 4, name: 'B', enabled: false },
        { name: 'C' },
        { name: 'D' },
        { name: 'E' },
        { name: 'F' },
      ],
      assignment_mode: 'area_wise',
    });
    expect(s.levels.map((l) => l.position)).toEqual([1, 2, 3, 4, 5]);
    expect(s.assignment_mode).toBe('area_wise');
    expect(s.levels[1].enabled).toBe(false);
  });
});

describe('enabledLevels / leafLevel / levelName', () => {
  const s = normalizeTerritorySettings({
    levels: [
      { position: 1, name: 'Country', enabled: true },
      { position: 2, name: 'State', enabled: true },
      { position: 3, name: 'City', enabled: false },
    ],
    assignment_mode: 'direct',
  });
  it('enabledLevels returns only enabled', () => {
    expect(enabledLevels(s).map((l) => l.name)).toEqual(['Country', 'State']);
  });
  it('leafLevel is the deepest enabled', () => {
    expect(leafLevel(s)?.name).toBe('State');
  });
  it('levelName resolves by position', () => {
    expect(levelName(s, 1)).toBe('Country');
    expect(levelName(s, 9)).toBe('Level 9');
  });
});

describe('CSV round-trip', () => {
  const tree: TerritoryNode[] = [
    {
      ...t({ id: 'India', level: 1, code: 'IN' }),
      children: [
        {
          ...t({ id: 'Gujarat', level: 2, parent_id: 'India', code: 'GJ' }),
          children: [{ ...t({ id: 'Surat, South', level: 3, parent_id: 'Gujarat' }), children: [] }],
        },
      ],
    },
  ];

  it('exports parent_path,name,code,notes with escaping', () => {
    const csv = treeToCsv(tree);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('parent_path,name,code,notes');
    expect(lines[1]).toBe(',India,IN,'); // root row → empty parent_path (name mirrors id here)
    expect(lines).toContain('India/Gujarat,"Surat, South",,'); // comma value gets quoted
  });

  it('parseCsv handles quotes, embedded commas, and CRLF', () => {
    const rows = parseCsv('parent_path,name,code,notes\r\nIndia/Gujarat,"Surat, South",GJ,"a ""b"" c"\r\n');
    expect(rows[0]).toEqual(['parent_path', 'name', 'code', 'notes']);
    expect(rows[1]).toEqual(['India/Gujarat', 'Surat, South', 'GJ', 'a "b" c']);
  });

  it('parseCsv drops fully-empty rows', () => {
    expect(parseCsv('a,b\n\n,\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});
