import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchMonthlyCollection, fetchTodaysCollection, fetchTotalOutstanding } from './payment-queries';
import { loadSalesMetrics } from './sales-queries';
import { DEFAULT_OUTSTANDING_CONFIG } from '@/lib/payments/outstanding-config';
import { startOfAccountDay, startOfAccountMonth } from './date-utils';

// ---------------------------------------------------------------------------
// Two defects, both of which a small tenant can never see.
//
// 1. PostgREST caps an unbounded .select() at 1,000 rows and reports nothing.
//    Every money tile fetched rows and summed them in JS, so a tenant past
//    1,000 matching rows was shown an understated figure with no error. On the
//    live Satyam account the Outstanding tile read NEGATIVE, because the
//    orders side of the subtraction lost 1,126 rows and the payments side 68.
//
// 2. "Today" and "this month" came from the viewer's browser clock, not the
//    account's timezone.
//
// These tests pin the two things that stop both from coming back: the figure
// is read from a DATABASE AGGREGATE rather than counted from rows, and when
// the pre-migration fallback does count rows, the window it asks for starts at
// the account's midnight.
// ---------------------------------------------------------------------------

/**
 * A PostgREST-shaped stub that behaves like the real thing in the one way that
 * matters here: a `.select()` with no range yields at most 1,000 rows.
 */
function truncatingDb(options: {
  rows?: Record<string, unknown[]>;
  rpc?: Record<string, unknown>;
  /** Simulates the window before the migration is applied. */
  rpcMissing?: boolean;
}) {
  type RpcArgs = Record<string, unknown>;
  const captured = { rpcCalls: [] as { fn: string; args: RpcArgs }[], gte: [] as string[] };

  // Cast to SupabaseClient at the end: this stands in for a PostgREST query
  // builder, whose chainable shape TypeScript cannot usefully describe here.
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        in: () => builder,
        lt: () => builder,
        order: () => builder,
        gte(_col: string, value: string) {
          captured.gte.push(value);
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) => {
          const all = options.rows?.[table] ?? [];
          // THE BUG, reproduced: PostgREST hands back 1,000 rows and a 200.
          return Promise.resolve({ data: all.slice(0, 1000), error: null, count: null }).then(resolve);
        },
      };
      return builder;
    },
    rpc(fn: string, args: RpcArgs) {
      captured.rpcCalls.push({ fn, args });
      if (options.rpcMissing) {
        return Promise.resolve({
          data: null,
          error: { code: 'PGRST202', message: `Could not find the function public.${fn}` },
        });
      }
      return Promise.resolve({ data: options.rpc?.[fn] ?? null, error: null });
    },
  };

  return { db: db as unknown as SupabaseClient, captured };
}

/** 2,126 orders of 50,000 — the prod shape. 1,000 of them sum to far less. */
const manyOrders = Array.from({ length: 2126 }, () => ({ total_amount: 50000, status: 'Closed' }));
/** 1,068 payments of 83,600 — the prod shape. */
const manyPayments = Array.from({ length: 1068 }, () => ({ amount: 83600, verified_amount: null }));

describe('the 1,000-row truncation cannot come back', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('outstanding is read from the aggregate, not counted from rows', async () => {
    const { db, captured } = truncatingDb({
      rows: { orders: manyOrders, payments: manyPayments, contacts: [] },
      rpc: { dashboard_total_outstanding: { outstanding: 17015200 } },
    });

    const total = await fetchTotalOutstanding(db, 'account-1', DEFAULT_OUTSTANDING_CONFIG);

    expect(total).toBe(17015200);
    expect(captured.rpcCalls.map((c) => c.fn)).toContain('dashboard_total_outstanding');
  });

  it('the row-counting fallback would have been wrong — and wrong in the WRONG DIRECTION', async () => {
    // This is the defect, demonstrated. With the RPC absent the old code path
    // runs, sees 1,000 of 2,126 orders and 1,000 of 1,068 payments, and
    // produces a NEGATIVE amount owed. The assertion exists so that if anyone
    // ever makes the fallback the primary path again, this test says what that
    // costs.
    const { db } = truncatingDb({
      rows: { orders: manyOrders, payments: manyPayments, contacts: [] },
      rpcMissing: true,
    });

    const total = await fetchTotalOutstanding(db, 'account-1', DEFAULT_OUTSTANDING_CONFIG);

    expect(total).toBe(1000 * 50000 - 1000 * 83600);
    expect(total).toBeLessThan(0);
    // The true figure, which only the aggregate can produce.
    expect(total).not.toBe(2126 * 50000 - 1068 * 83600);
  });

  it('sales metrics are read from the aggregate, not counted from rows', async () => {
    const { db, captured } = truncatingDb({
      rows: { orders: manyOrders },
      rpc: {
        dashboard_sales_metrics: {
          orders_today_count: 12,
          orders_today_value: 600000,
          orders_month_value: 106300000,
          pending_dispatch_count: 7,
        },
      },
    });

    const metrics = await loadSalesMetrics(db, 'account-1');

    expect(metrics.ordersMonthValue).toBe(106300000);
    expect(metrics.ordersTodayCount).toBe(12);
    expect(captured.rpcCalls[0].fn).toBe('dashboard_sales_metrics');
  });

  it("today's collection is read from the aggregate", async () => {
    const { db } = truncatingDb({
      rows: { payments: manyPayments },
      rpc: { dashboard_collection_totals: { today: 89284800, month_current: 89284800, month_previous: 10 } },
    });

    expect(await fetchTodaysCollection(db, 'account-1')).toBe(89284800);
  });

  it('numeric columns arriving as strings are still numbers', async () => {
    // Postgres `numeric` crosses the wire as a string. A tile that renders
    // "₹89284800" by string concatenation, or adds a delta to it, needs this.
    const { db } = truncatingDb({
      rpc: { dashboard_collection_totals: { today: '89284800.50', month_current: '1', month_previous: '2' } },
    });

    const value = await fetchTodaysCollection(db, 'account-1');
    expect(typeof value).toBe('number');
    expect(value).toBe(89284800.5);
  });

  it('the data scope reaches the RPC as auth user ids, and unrestricted means NULL', async () => {
    const { db, captured } = truncatingDb({ rpc: { dashboard_sales_metrics: {} } });

    await loadSalesMetrics(db, 'account-1', {
      unrestricted: false,
      ready: true,
      userIds: ['user-a', 'user-b'],
      profileIds: ['profile-a'],
      key: 'k',
      apply: (q) => q,
    });
    expect(captured.rpcCalls[0].args.p_user_ids).toEqual(['user-a', 'user-b']);

    await loadSalesMetrics(db, 'account-1', {
      unrestricted: true,
      ready: true,
      userIds: [],
      profileIds: [],
      key: 'all',
      apply: (q) => q,
    });
    expect(captured.rpcCalls[1].args.p_user_ids).toBeNull();
  });

  it('a restricted viewer with an empty visible set stays empty, never widened to the account', async () => {
    const { db, captured } = truncatingDb({ rpc: { dashboard_sales_metrics: {} } });

    await loadSalesMetrics(db, 'account-1', {
      unrestricted: false,
      ready: true,
      userIds: [],
      profileIds: [],
      key: 'none',
      apply: (q) => q,
    });

    // [] means "match nothing". NULL would mean "match everything".
    expect(captured.rpcCalls[0].args.p_user_ids).toEqual([]);
    expect(captured.rpcCalls[0].args.p_user_ids).not.toBeNull();
  });

  it('the account rule still decides which statuses count', async () => {
    const { db, captured } = truncatingDb({ rpc: { dashboard_total_outstanding: { outstanding: 0 } } });

    await fetchTotalOutstanding(db, 'account-1', {
      orderStatuses: ['Part Dispatch', 'Dispatched', 'Closed'],
      paymentStatuses: ['Pending', 'Approved'],
    });

    expect(captured.rpcCalls[0].args.p_order_statuses).toEqual(['Part Dispatch', 'Dispatched', 'Closed']);
    expect(captured.rpcCalls[0].args.p_payment_statuses).toEqual(['Pending', 'Approved']);
  });
});

describe('day boundaries come from the account, not the browser', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    // 02:00 IST on 31 October. In UTC it is still 30 October — which is what
    // made a UTC-midnight boundary drop the whole first morning of orders.
    vi.setSystemTime(new Date('2026-10-30T20:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Asia/Kolkata midnight is 18:30Z the day before, not 00:00Z", () => {
    expect(startOfAccountDay('Asia/Kolkata').toISOString()).toBe('2026-10-30T18:30:00.000Z');
  });

  it('the same instant is a different day in a western timezone', () => {
    // 30 Oct 16:30 in New York, so that account's day began at 04:00Z.
    expect(startOfAccountDay('America/New_York').toISOString()).toBe('2026-10-30T04:00:00.000Z');
  });

  it('the account month starts at local midnight on the 1st', () => {
    expect(startOfAccountMonth('Asia/Kolkata').toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it("an instant that is already next month locally rolls the month over", () => {
    vi.setSystemTime(new Date('2026-10-31T19:00:00Z')); // 1 Nov 00:30 IST
    expect(startOfAccountMonth('Asia/Kolkata').toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it("the fallback asks for the ACCOUNT's day, not the runtime's", async () => {
    const { db, captured } = truncatingDb({ rows: { payments: [] }, rpcMissing: true });

    await fetchTodaysCollection(db, 'account-1', 'Asia/Kolkata');

    expect(captured.gte).toEqual(['2026-10-30T18:30:00.000Z']);
  });

  it("the fallback's month window is the account's month", async () => {
    const { db, captured } = truncatingDb({ rows: { payments: [] }, rpcMissing: true });

    await fetchMonthlyCollection(db, 'account-1', 'Asia/Kolkata');

    // Current month, then previous month.
    expect(captured.gte).toEqual(['2026-09-30T18:30:00.000Z', '2026-08-31T18:30:00.000Z']);
  });

  it('an account that has never set a timezone is treated as Asia/Kolkata', async () => {
    const { db, captured } = truncatingDb({ rows: { payments: [] }, rpcMissing: true });

    await fetchTodaysCollection(db, 'account-1');

    expect(captured.gte).toEqual(['2026-10-30T18:30:00.000Z']);
  });
});
