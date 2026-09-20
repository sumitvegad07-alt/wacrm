import { describe, it, expect } from 'vitest';
import { runResolver, RESOLVERS } from './resolvers';
import type { SupabaseClient } from '@supabase/supabase-js';

// Minimal chainable mock: from(table).select(..,{count}).eq(...) resolves to {count}.
function mockSupabase(counts: Record<string, number>): SupabaseClient {
  const make = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain; builder.eq = chain; builder.gt = chain;
    builder.limit = chain; builder.not = chain;
    // resolve as a thenable returning the configured count / rows
    (builder as { then: unknown }).then = (res: (v: unknown) => void) =>
      res({ count: counts[table] ?? 0, data: (counts[table] ?? 0) > 0 ? [{ id: 'x' }] : [], error: null });
    return builder;
  };
  return { from: (t: string) => make(t) } as unknown as SupabaseClient;
}

const ctx = (supabase: SupabaseClient, params: Record<string, unknown> | null = null, answers = {}) =>
  ({ accountId: 'acc', supabase, params, answers });

describe('count resolvers', () => {
  it('territory_count returns the territories count', async () => {
    expect(await runResolver('territory_count', ctx(mockSupabase({ territories: 3 })))).toBe(3);
  });
  it('role_count counts employee_roles', async () => {
    expect(await runResolver('role_count', ctx(mockSupabase({ employee_roles: 2 })))).toBe(2);
  });
  it('employee_count counts profiles', async () => {
    expect(await runResolver('employee_count', ctx(mockSupabase({ profiles: 4 })))).toBe(4);
  });
});

describe('exists resolvers', () => {
  it('attendance_or_visit is true when tracking_sessions exist', async () => {
    expect(await runResolver('attendance_or_visit', ctx(mockSupabase({ tracking_sessions: 1 })))).toBe(true);
  });
  it('attendance_or_visit is false when neither exists', async () => {
    expect(await runResolver('attendance_or_visit', ctx(mockSupabase({})))).toBe(false);
  });
  it('meaningful_data is true when location_pings exist', async () => {
    expect(await runResolver('meaningful_data', ctx(mockSupabase({ location_pings: 10 })))).toBe(true);
  });
});

describe('answer resolver', () => {
  it('returns true when the answer is present', async () => {
    const c = ctx(mockSupabase({}), { question_key: 'customer_assignment_method' }, { customer_assignment_method: 'area_wise' });
    expect(await runResolver('answer', c)).toBe(true);
  });
  it('returns false when the answer is missing', async () => {
    const c = ctx(mockSupabase({}), { question_key: 'customer_assignment_method' }, {});
    expect(await runResolver('answer', c)).toBe(false);
  });
});

describe('registry', () => {
  it('exposes exactly the WFA v1 keys', () => {
    expect(Object.keys(RESOLVERS).sort()).toEqual(
      ['answer', 'attendance_or_visit', 'customer_count', 'employee_count', 'employee_logged_in', 'meaningful_data', 'role_count', 'territory_count'].sort()
    );
  });
  it('throws on unknown key', async () => {
    await expect(runResolver('nope', ctx(mockSupabase({})))).rejects.toThrow();
  });
});
