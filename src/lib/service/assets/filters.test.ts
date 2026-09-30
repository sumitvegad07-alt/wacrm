import { describe, it, expect } from 'vitest';
import {
  parseAssetFilters,
  serializeAssetFilters,
  assetFilterSummary,
  ASSET_STATUSES,
  ilikeContainsValue,
  buildAssetSearchOr,
  warrantyDateBounds,
} from './filters';
import { warrantyState } from '../settings';

describe('parseAssetFilters', () => {
  it('returns an empty filter set for no params', () => {
    expect(parseAssetFilters(new URLSearchParams())).toEqual({});
  });

  it('trims the search term and drops it when blank', () => {
    expect(parseAssetFilters(new URLSearchParams('q=  ')).q).toBeUndefined();
    expect(parseAssetFilters(new URLSearchParams('q=  ro+unit ')).q).toBe('ro unit');
  });

  it('parses a repeated status param into an array', () => {
    expect(parseAssetFilters(new URLSearchParams('status=active&status=scrapped')).status)
      .toEqual(['active', 'scrapped']);
  });

  it('ignores an unknown status value', () => {
    expect(parseAssetFilters(new URLSearchParams('status=active&status=banana')).status)
      .toEqual(['active']);
  });

  it('accepts only the two warranty values', () => {
    expect(parseAssetFilters(new URLSearchParams('warranty=expiring')).warranty).toBe('expiring');
    expect(parseAssetFilters(new URLSearchParams('warranty=soon')).warranty).toBeUndefined();
  });

  it('reads showInactive only from the literal string true', () => {
    expect(parseAssetFilters(new URLSearchParams('showInactive=true')).showInactive).toBe(true);
    expect(parseAssetFilters(new URLSearchParams('showInactive=1')).showInactive).toBeUndefined();
  });
});

describe('serializeAssetFilters', () => {
  it('round-trips every supported filter', () => {
    const f = {
      q: 'kent', contactId: 'c1', assetTypeId: 't1',
      status: ['active' as const], warranty: 'expiring' as const,
      territoryId: 'z1', showInactive: true,
    };
    expect(parseAssetFilters(serializeAssetFilters(f))).toEqual(f);
  });

  it('omits empty values rather than writing blanks', () => {
    expect(serializeAssetFilters({ q: '', status: [] }).toString()).toBe('');
  });
});

describe('assetFilterSummary', () => {
  it('is empty when nothing is filtered', () => {
    expect(assetFilterSummary({})).toBe('');
  });

  it('names the active filters for the no-match empty state', () => {
    expect(assetFilterSummary({ q: 'kent', warranty: 'expired' }))
      .toBe('search "kent", warranty expired');
  });
});

// ── Additions beyond the brief's Step 1 ─────────────────────────

describe('parseAssetFilters — extra edge cases', () => {
  it('drops duplicate status values and keeps first-seen order', () => {
    expect(parseAssetFilters(new URLSearchParams('status=scrapped&status=active&status=scrapped')).status)
      .toEqual(['scrapped', 'active']);
  });

  it('omits the status key entirely when every value is unknown', () => {
    const f = parseAssetFilters(new URLSearchParams('status=banana'));
    expect('status' in f).toBe(false);
  });

  it('trims id filters and drops blank ones', () => {
    const f = parseAssetFilters(new URLSearchParams('contactId=%20c1%20&assetTypeId=&territoryId=%20'));
    expect(f.contactId).toBe('c1');
    expect('assetTypeId' in f).toBe(false);
    expect('territoryId' in f).toBe(false);
  });

  it('accepts every AssetStatus value', () => {
    const qs = new URLSearchParams();
    for (const s of ASSET_STATUSES) qs.append('status', s);
    expect(parseAssetFilters(qs).status).toEqual([...ASSET_STATUSES]);
    expect(ASSET_STATUSES).toEqual(['active', 'under_repair', 'replaced', 'scrapped', 'inactive']);
  });
});

describe('serializeAssetFilters — extra edge cases', () => {
  it('writes a repeated status param and never writes showInactive=false', () => {
    const s = serializeAssetFilters({ status: ['active', 'scrapped'], showInactive: false });
    expect(s.getAll('status')).toEqual(['active', 'scrapped']);
    expect(s.has('showInactive')).toBe(false);
  });

  it('trims the search term and omits it when only whitespace', () => {
    expect(serializeAssetFilters({ q: '  kent ' }).get('q')).toBe('kent');
    expect(serializeAssetFilters({ q: '   ' }).toString()).toBe('');
  });

  it('round-trips a search term with URL-significant characters', () => {
    const f = { q: 'a&b=c, d+e' };
    expect(parseAssetFilters(serializeAssetFilters(f))).toEqual(f);
  });
});

describe('assetFilterSummary — clause order', () => {
  it('always emits clauses in the fixed order and omits absent ones', () => {
    expect(
      assetFilterSummary({
        territoryId: 't', warranty: 'expiring', status: ['active', 'scrapped'],
        assetTypeId: 'a', contactId: 'c', q: 'kent',
      }),
    ).toBe('search "kent", customer, type, status active, scrapped, warranty expiring, territory');
  });

  it('emits bare words for the id-only filters', () => {
    expect(assetFilterSummary({ contactId: 'c1' })).toBe('customer');
    expect(assetFilterSummary({ assetTypeId: 'a1' })).toBe('type');
    expect(assetFilterSummary({ territoryId: 'z1' })).toBe('territory');
  });

  it('ignores showInactive and an empty status list', () => {
    expect(assetFilterSummary({ showInactive: true, status: [] })).toBe('');
  });

  it('ignores a whitespace-only search term', () => {
    expect(assetFilterSummary({ q: '   ' })).toBe('');
  });
});

// ── PostgREST .or() escaping ────────────────────────────────────
// Test helpers: a tiny model of how PostgREST reads an .or() string and how
// Postgres then reads the resulting LIKE pattern. They exist so the tests can
// assert on MEANING (what the database will actually be asked) rather than on
// an incidental string shape.

/** Split on commas that sit OUTSIDE double quotes; honours backslash escapes inside quotes. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote && ch === '\\') { cur += ch + (s[i + 1] ?? ''); i++; continue; }
    if (ch === '"') inQuote = !inQuote;
    if (ch === ',' && !inQuote) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** The value PostgREST hands to Postgres after stripping the quotes and un-escaping \" and \\. */
function unquote(token: string): string {
  expect(token.startsWith('"') && token.endsWith('"')).toBe(true);
  const inner = token.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') { out += inner[i + 1] ?? ''; i++; } else out += inner[i];
  }
  return out;
}

/** Postgres ILIKE with the default ESCAPE '\' as a case-insensitive RegExp. */
function likeToRegExp(pattern: string): RegExp {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') { re += (pattern[i + 1] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; }
    else if (ch === '%') re += '[\\s\\S]*';
    else if (ch === '_') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', 'i');
}

const matches = (term: string, candidate: string) =>
  likeToRegExp(unquote(ilikeContainsValue(term))).test(candidate);

describe('ilikeContainsValue', () => {
  it('wraps a plain term as a quoted contains-pattern', () => {
    expect(ilikeContainsValue('kent')).toBe('"%kent%"');
  });

  it('keeps a comma inside the quoted value instead of splitting the filter', () => {
    const token = ilikeContainsValue('Kent, Mumbai');
    expect(token).toBe('"%Kent, Mumbai%"');
    expect(splitTopLevel(token)).toHaveLength(1);
  });

  it('matches a literal comma, and not the two halves separately', () => {
    expect(matches('Kent, Mumbai', 'Kent, Mumbai Pvt Ltd')).toBe(true);
    expect(matches('Kent, Mumbai', 'Kent Mumbai')).toBe(false);
    expect(matches('Kent, Mumbai', 'Kent')).toBe(false);
    expect(matches('Kent, Mumbai', 'Mumbai')).toBe(false);
  });

  it('treats % as a literal percent, not a wildcard', () => {
    expect(matches('50%', 'Rated 50% duty')).toBe(true);
    expect(matches('50%', '500 units')).toBe(false);
  });

  it('treats _ as a literal underscore, not a single-character wildcard', () => {
    expect(matches('a_b', 'model a_b')).toBe(true);
    expect(matches('a_b', 'model axb')).toBe(false);
  });

  it('treats a backslash as a literal backslash', () => {
    expect(matches('a\\b', 'path a\\b here')).toBe(true);
    expect(matches('a\\b', 'path ab here')).toBe(false);
  });

  it('keeps a double quote literal and inside the quoted value', () => {
    const token = ilikeContainsValue('12" pipe');
    expect(splitTopLevel(token)).toHaveLength(1);
    expect(matches('12" pipe', 'PVC 12" pipe')).toBe(true);
  });

  it('keeps parentheses and dots literal', () => {
    expect(splitTopLevel(ilikeContainsValue('RO (v2.1)'))).toHaveLength(1);
    expect(matches('RO (v2.1)', 'Aqua RO (v2.1) unit')).toBe(true);
    expect(matches('RO (v2.1)', 'Aqua RO (v2x1) unit')).toBe(false);
  });

  it('never leaves a * in the value, because PostgREST turns it into a % wildcard', () => {
    expect(unquote(ilikeContainsValue('a*b'))).not.toContain('*');
    // A star is deliberately widened to a single-character wildcard so the row still matches.
    expect(matches('a*b', 'a*b')).toBe(true);
  });
});

describe('buildAssetSearchOr', () => {
  it('produces exactly four OR branches for a term that contains commas', () => {
    const or = buildAssetSearchOr('Kent, Mumbai');
    const branches = splitTopLevel(or);
    expect(branches).toHaveLength(4);
    expect(branches.map((b) => b.split('.ilike.')[0])).toEqual([
      'name', 'serial_no', 'asset_code', 'customer_phone_snapshot',
    ]);
    for (const b of branches) expect(unquote(b.split('.ilike.')[1]!)).toBe('%Kent, Mumbai%');
  });

  it('stays four branches for a term full of PostgREST metacharacters', () => {
    expect(splitTopLevel(buildAssetSearchOr('a,b.c(d)e*f"g\\h%i_j'))).toHaveLength(4);
  });

  it('matches a plain term the same way in every column', () => {
    expect(buildAssetSearchOr('kent')).toBe(
      'name.ilike."%kent%",serial_no.ilike."%kent%",asset_code.ilike."%kent%",customer_phone_snapshot.ilike."%kent%"',
    );
  });
});

describe('warrantyDateBounds', () => {
  const TODAY = new Date('2026-09-30T10:00:00Z');

  it('expired is strictly before today', () => {
    expect(warrantyDateBounds('expired', TODAY)).toEqual({ lt: '2026-09-30' });
  });

  it('expiring runs from today through today + 30 days, inclusive', () => {
    expect(warrantyDateBounds('expiring', TODAY)).toEqual({ gte: '2026-09-30', lte: '2026-10-30' });
  });

  // The DB filter and the list's pill must never disagree, so the bounds are checked
  // against warrantyState() itself over a run of days that spans both edges.
  for (const [label, today] of [
    ['mid-day', new Date('2026-09-30T10:00:00Z')],
    ['one second before UTC midnight', new Date('2026-09-30T23:59:59Z')],
    ['UTC midnight', new Date('2026-10-01T00:00:00Z')],
    ['across a month end', new Date('2026-12-15T08:00:00Z')],
  ] as const) {
    it(`agrees with warrantyState for every day from -3 to +35 (${label})`, () => {
      const dayMs = 86_400_000;
      const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      const expiring = warrantyDateBounds('expiring', today);
      const expired = warrantyDateBounds('expired', today);
      for (let off = -3; off <= 35; off++) {
        const warranty_end = new Date(base + off * dayMs).toISOString().slice(0, 10);
        const state = warrantyState({ warranty_end }, today);
        const inExpiring = warranty_end >= expiring.gte! && warranty_end <= expiring.lte!;
        const inExpired = warranty_end < expired.lt!;
        expect(inExpiring, `${warranty_end} (offset ${off}) expiring`).toBe(state === 'expiring');
        expect(inExpired, `${warranty_end} (offset ${off}) expired`).toBe(state === 'expired');
      }
    });
  }
});
