import { describe, expect, test } from 'vitest';
import {
  describeParentResolve,
  resolveImportedParents,
  type ParentImportRow,
} from './resolve-parents';

// ---------------------------------------------------------------------------
// A fake Supabase client, just enough to record what the resolver asks for and
// what it writes. The point of these tests is the MAPPING decisions — which
// row becomes whose child, what happens when a code is missing, and that one
// bad pair does not take the good ones down with it.
// ---------------------------------------------------------------------------

type Contact = { id: string; customer_code: string | null; phone_normalized: string | null };

function fakeClient(contacts: Contact[], opts: { failBatch?: boolean; failFor?: string[] } = {}) {
  const updates: { parentId: string; childIds: string[] }[] = [];

  const client = {
    from(table: string) {
      if (table !== 'contacts') throw new Error(`unexpected table ${table}`);
      const state: { parentId?: string; ids?: string[]; singleId?: string } = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: string) => {
          if (col === 'id') state.singleId = val;
          return builder;
        },
        or: () => Promise.resolve({ data: contacts, error: null }),
        update: (patch: { parent_id: string }) => {
          state.parentId = patch.parent_id;
          return builder;
        },
        in: (_col: string, ids: string[]) => {
          state.ids = ids;
          if (opts.failBatch) {
            return Promise.resolve({ error: { message: 'batch refused' }, count: null });
          }
          updates.push({ parentId: state.parentId!, childIds: ids });
          return Promise.resolve({ error: null, count: ids.length });
        },
      };
      // A single-row update resolves when awaited directly.
      (builder as { then: unknown }).then = (
        resolve: (v: { error: { message: string } | null }) => unknown,
      ) => {
        const id = state.singleId!;
        if (opts.failFor?.includes(id)) {
          return resolve({ error: { message: 'a supplier must sit above this customer' } });
        }
        updates.push({ parentId: state.parentId!, childIds: [id] });
        return resolve({ error: null });
      };
      return builder;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, updates };
}

const CONTACTS: Contact[] = [
  { id: 'dist-1', customer_code: 'CUST-0001', phone_normalized: '9000000001' },
  { id: 'dist-2', customer_code: 'CUST-0002', phone_normalized: '9000000002' },
  { id: 'deal-1', customer_code: 'CUST-0010', phone_normalized: '9000000010' },
  { id: 'deal-2', customer_code: null, phone_normalized: '9000000011' },
];

describe('nothing to do', () => {
  test('no parent_code anywhere means no reads and no writes', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const rows: ParentImportRow[] = [{ customer_code: 'CUST-0010', phone: '9000000010' }];
    const out = await resolveImportedParents(client, 'acct', rows);
    expect(out.mapped).toBe(0);
    expect(updates).toEqual([]);
  });

  test('a blank or whitespace parent_code is not a mapping', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { customer_code: 'CUST-0010', parent_code: '   ' },
      { customer_code: 'CUST-0010', parent_code: '' },
    ]);
    expect(out.mapped).toBe(0);
    expect(updates).toEqual([]);
  });
});

describe('matching a row to its own customer', () => {
  test('by customer_code when it has one', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { customer_code: 'CUST-0010', parent_code: 'CUST-0001' },
    ]);
    expect(out.mapped).toBe(1);
    expect(updates).toEqual([{ parentId: 'dist-1', childIds: ['deal-1'] }]);
  });

  test('by phone when it has no code — the key the importer dedupes on', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { phone: '90000 00011', parent_code: 'CUST-0002' },
    ]);
    expect(out.mapped).toBe(1);
    expect(updates).toEqual([{ parentId: 'dist-2', childIds: ['deal-2'] }]);
  });

  test('phone matching is digits-only, exactly as import_commit does it', async () => {
    // import_commit normalises with regexp_replace(phone,'\D','','g') and
    // compares against phone_normalized. This resolver does the same, so a
    // row matches here if and only if it would have matched the import itself.
    const { client } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { phone: '(9000) 000-011', parent_code: 'CUST-0002' },
    ]);
    expect(out.mapped).toBe(1);
  });

  test('a country code is NOT stripped, matching the importer behaviour too', async () => {
    // Recorded rather than worked around: stripping a leading 91 would be a
    // guess, and would mis-match a genuine 12-digit stored number. A sheet
    // written with +91 must use the same shape the customers were imported
    // with, which is what the import screen already requires for dedupe.
    const { client } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { phone: '+91 90000 00011', parent_code: 'CUST-0002' },
    ]);
    expect(out.mapped).toBe(0);
    expect(out.unmatchedChild).toEqual(['+91 90000 00011']);
  });

  test('codes match regardless of case and padding', async () => {
    const { client } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { customer_code: ' cust-0010 ', parent_code: ' cust-0001 ' },
    ]);
    expect(out.mapped).toBe(1);
  });
});

describe('one update per supplier, not per dealer', () => {
  test('dealers naming the same supplier are written together', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { customer_code: 'CUST-0010', parent_code: 'CUST-0001' },
      { phone: '9000000011', parent_code: 'CUST-0001' },
    ]);
    expect(out.mapped).toBe(2);
    expect(updates).toHaveLength(1);
    expect(updates[0].childIds.sort()).toEqual(['deal-1', 'deal-2']);
  });
});

describe('what cannot be resolved is reported, not guessed', () => {
  test('an unknown supplier code is listed', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { customer_code: 'CUST-0010', parent_code: 'CUST-9999' },
    ]);
    expect(out.mapped).toBe(0);
    expect(out.unmatchedParent).toEqual(['CUST-9999']);
    expect(updates).toEqual([]);
  });

  test('a row that cannot be matched back to a customer is listed', async () => {
    const { client } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { customer_code: 'CUST-7777', parent_code: 'CUST-0001' },
    ]);
    expect(out.mapped).toBe(0);
    expect(out.unmatchedChild).toEqual(['CUST-7777']);
  });

  test('a customer supplying themselves is refused with a reason', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const out = await resolveImportedParents(client, 'acct', [
      { customer_code: 'CUST-0001', parent_code: 'CUST-0001' },
    ]);
    expect(out.mapped).toBe(0);
    expect(out.refused[0].reason).toContain('cannot supply themselves');
    expect(updates).toEqual([]);
  });
});

describe('one bad pair does not lose the good ones', () => {
  test('a refused batch is retried one at a time', async () => {
    // deal-1 is illegal (say, wrong level); deal-2 is fine. Before the retry
    // both would have been lost together.
    const { client, updates } = fakeClient(CONTACTS, { failBatch: true, failFor: ['deal-1'] });
    const out = await resolveImportedParents(client, 'acct', [
      { customer_code: 'CUST-0010', parent_code: 'CUST-0001' },
      { phone: '9000000011', parent_code: 'CUST-0001' },
    ]);
    expect(out.mapped).toBe(1);
    expect(updates).toEqual([{ parentId: 'dist-1', childIds: ['deal-2'] }]);
    expect(out.refused).toHaveLength(1);
    expect(out.refused[0].reason).toContain('must sit above');
  });
});

describe('the summary line', () => {
  test('says nothing when there was nothing to say', () => {
    expect(
      describeParentResolve({ mapped: 0, unmatchedParent: [], unmatchedChild: [], refused: [] }),
    ).toBeNull();
  });

  test('counts what was mapped', () => {
    expect(
      describeParentResolve({ mapped: 3, unmatchedParent: [], unmatchedChild: [], refused: [] }),
    ).toBe('3 customers given a supplier.');
  });

  test('names the missing supplier codes, de-duplicated', () => {
    const line = describeParentResolve({
      mapped: 1,
      unmatchedParent: ['CUST-9999', 'CUST-9999', 'CUST-8888'],
      unmatchedChild: [],
      refused: [],
    });
    expect(line).toContain('1 customer given a supplier');
    expect(line).toContain('2 supplier codes not found');
    expect(line).toContain('CUST-9999');
  });

  test('mentions refusals with the database reason', () => {
    const line = describeParentResolve({
      mapped: 0,
      unmatchedParent: [],
      unmatchedChild: [],
      refused: [{ code: 'x', reason: 'supply loop' }],
    });
    expect(line).toContain('1 refused (supply loop)');
  });
});
