import { describe, expect, test } from 'vitest';
import {
  buildLevelIndex,
  describeLevelResolve,
  resolveImportedLevels,
  type ParentImportRow,
} from './resolve-parents';
import { contactsDescriptor } from './descriptors/masters';

// ---------------------------------------------------------------------------
// Importing Customer Level.
//
// Two things carry the weight:
//
//  1. A person types the level NAME ("Dealer"), because the name is the only
//     form of it they ever see in the product. The column stores a number.
//  2. It has to be a SECOND PASS, and it has to run BEFORE suppliers are
//     resolved — trg_enforce_customer_parent compares the two levels, so a
//     file that sets both would have its suppliers refused if the levels were
//     not already in place.
// ---------------------------------------------------------------------------

const LEVELS = [
  { position: 1, name: 'Stockiest' },
  { position: 2, name: 'Distributor' },
  { position: 3, name: 'Dealer' },
];

type Contact = { id: string; customer_code: string | null; phone_normalized: string | null };

function fakeClient(contacts: Contact[], opts: { failBatch?: boolean } = {}) {
  const updates: { level: number; ids: string[] }[] = [];
  const client = {
    from(table: string) {
      if (table !== 'contacts') throw new Error(`unexpected table ${table}`);
      const state: { level?: number; singleId?: string } = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: string) => {
          if (col === 'id') state.singleId = val;
          return builder;
        },
        or: () => Promise.resolve({ data: contacts, error: null }),
        update: (patch: { hierarchy_level: number }) => {
          state.level = patch.hierarchy_level;
          return builder;
        },
        in: (_col: string, ids: string[]) => {
          if (opts.failBatch) {
            return Promise.resolve({ error: { message: 'batch refused' }, count: null });
          }
          updates.push({ level: state.level!, ids });
          return Promise.resolve({ error: null, count: ids.length });
        },
      };
      (builder as { then: unknown }).then = (
        resolve: (v: { error: null }) => unknown,
      ) => {
        if (state.singleId) updates.push({ level: state.level!, ids: [state.singleId] });
        return Promise.resolve(resolve({ error: null }));
      };
      return builder;
    },
  };
  return { client, updates };
}

const CONTACTS: Contact[] = [
  { id: 'id-a', customer_code: 'CUST-0001', phone_normalized: '919000000001' },
  { id: 'id-b', customer_code: 'CUST-0002', phone_normalized: '919000000002' },
  { id: 'id-c', customer_code: null, phone_normalized: '919000000003' },
];

describe('what a person is allowed to type', () => {
  test('the level name, in any case', () => {
    const index = buildLevelIndex(LEVELS);
    expect(index.get('dealer')).toBe(3);
    expect(index.get('distributor')).toBe(2);
    expect(index.get('stockiest')).toBe(1);
  });

  test('or the level number', () => {
    const index = buildLevelIndex(LEVELS);
    expect(index.get('1')).toBe(1);
    expect(index.get('3')).toBe(3);
  });

  test('a level that was never configured is not invented', () => {
    const index = buildLevelIndex(LEVELS);
    expect(index.get('super stockist')).toBeUndefined();
    expect(index.get('4')).toBeUndefined();
  });

  test('a blank level name contributes only its number', () => {
    const index = buildLevelIndex([{ position: 1, name: '  ' }, { position: 2, name: null }]);
    expect(index.get('1')).toBe(1);
    expect(index.get('2')).toBe(2);
    expect(index.size).toBe(2);
  });
});

describe('resolving a file', () => {
  const rows: ParentImportRow[] = [
    { customer_code: 'CUST-0001', customer_level: 'Stockiest' },
    { customer_code: 'CUST-0002', customer_level: 'dealer' },
    { phone: '+91 90000 00003', customer_level: '2' },
  ];

  test('names and numbers both land on the right customer', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const r = await resolveImportedLevels(client as never, 'acct', rows, LEVELS);
    expect(r.mapped).toBe(3);
    expect(updates).toEqual(
      expect.arrayContaining([
        { level: 1, ids: ['id-a'] },
        { level: 3, ids: ['id-b'] },
        { level: 2, ids: ['id-c'] },
      ]),
    );
  });

  test('customers are grouped so each level costs one update', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    await resolveImportedLevels(
      client as never,
      'acct',
      [
        { customer_code: 'CUST-0001', customer_level: 'Dealer' },
        { customer_code: 'CUST-0002', customer_level: 'Dealer' },
      ],
      LEVELS,
    );
    expect(updates).toEqual([{ level: 3, ids: ['id-a', 'id-b'] }]);
  });

  test('an unrecognised level is reported, not guessed at', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const r = await resolveImportedLevels(
      client as never,
      'acct',
      [{ customer_code: 'CUST-0001', customer_level: 'Super Stockist' }],
      LEVELS,
    );
    expect(r.mapped).toBe(0);
    expect(r.unknownLevels).toEqual(['Super Stockist']);
    expect(updates).toEqual([]);
  });

  test('a row naming nobody is reported rather than silently dropped', async () => {
    const { client } = fakeClient(CONTACTS);
    const r = await resolveImportedLevels(
      client as never,
      'acct',
      [{ customer_code: 'CUST-9999', customer_level: 'Dealer' }],
      LEVELS,
    );
    expect(r.unmatchedChild).toEqual(['CUST-9999']);
  });

  test('rows with no level are left completely alone', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const r = await resolveImportedLevels(
      client as never,
      'acct',
      [{ customer_code: 'CUST-0001' }, { customer_code: 'CUST-0002', customer_level: '   ' }],
      LEVELS,
    );
    expect(r.mapped).toBe(0);
    expect(updates).toEqual([]);
  });

  test('an account with no levels configured does nothing at all', async () => {
    const { client, updates } = fakeClient(CONTACTS);
    const r = await resolveImportedLevels(
      client as never,
      'acct',
      [{ customer_code: 'CUST-0001', customer_level: 'Dealer' }],
      [],
    );
    expect(r.mapped).toBe(0);
    expect(updates).toEqual([]);
  });

  test('one refused row does not take the rest of the batch with it', async () => {
    const { client, updates } = fakeClient(CONTACTS, { failBatch: true });
    const r = await resolveImportedLevels(
      client as never,
      'acct',
      [
        { customer_code: 'CUST-0001', customer_level: 'Dealer' },
        { customer_code: 'CUST-0002', customer_level: 'Dealer' },
      ],
      LEVELS,
    );
    // Retried one at a time, so both still get through.
    expect(r.mapped).toBe(2);
    expect(updates).toEqual([
      { level: 3, ids: ['id-a'] },
      { level: 3, ids: ['id-b'] },
    ]);
  });
});

describe('what the import summary says', () => {
  test('nothing to report reads as null, not an empty sentence', () => {
    expect(
      describeLevelResolve({ mapped: 0, unknownLevels: [], unmatchedChild: [], refused: [] }),
    ).toBeNull();
  });

  test('the counts are spelled out', () => {
    const line = describeLevelResolve({
      mapped: 12,
      unknownLevels: ['Super Stockist', 'Super Stockist'],
      unmatchedChild: ['CUST-9999'],
      refused: [],
    });
    expect(line).toContain('12 customers given a level');
    // Repeats collapse — one bad spelling in 400 rows is one problem.
    expect(line).toContain('1 level name not recognised');
  });
});

describe('the importer offers the column', () => {
  test('Customer Level is a synthetic extra, so no custom_fields row can hide it', () => {
    const field = contactsDescriptor.fields.find((f) => f.key === 'customer_level');
    expect(field).toBeDefined();
    expect(field?.label).toBe('Customer Level');
    // It must NOT be a system column: import_commit has no such column, which
    // is exactly why it is resolved after the commit instead.
    expect(contactsDescriptor.systemColumns).not.toContain('customer_level');
    expect(contactsDescriptor.systemColumns).not.toContain('hierarchy_level');
  });

  test('the headers a person would actually write are recognised', () => {
    const field = contactsDescriptor.fields.find((f) => f.key === 'customer_level');
    expect(field?.synonyms).toEqual(expect.arrayContaining(['level', 'customerlevel', 'tier']));
  });

  test('Supplier Code is still offered beside it', () => {
    expect(contactsDescriptor.fields.find((f) => f.key === 'parent_code')).toBeDefined();
  });
});
