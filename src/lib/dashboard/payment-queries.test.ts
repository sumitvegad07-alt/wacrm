import { describe, expect, it } from 'vitest';
import {
  fetchCreditExceededCustomers,
  fetchOverdueCustomers,
  fetchTotalOutstanding,
} from './payment-queries';
import {
  DEFAULT_OUTSTANDING_CONFIG,
  type OutstandingConfig,
} from '@/lib/payments/outstanding-config';

// ---------------------------------------------------------------------------
// Three dashboard widgets derive what customers owe, each with its own query.
// Before 2026-10-05 all three named `status = 'Closed'` in their own source, so
// a change to the rule had to be remembered in three places — and the customer
// card, the payment form and the Ageing report besides.
//
// These tests pin only one thing, but it is the thing that matters for money:
// the statuses that reach the database are the account's chosen statuses, never
// a status the widget decided for itself.
// ---------------------------------------------------------------------------

interface Captured {
  orders?: string[];
  payments?: string[];
}

/** Minimal PostgREST-shaped stub: every builder method returns the builder. */
function fakeDb(captured: Captured) {
  return {
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        lt: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: () => builder,
        in(col: string, vals: string[]) {
          if (col === 'status' && table === 'orders') captured.orders = vals;
          if (col === 'status' && table === 'payments') captured.payments = vals;
          return builder;
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(res),
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: null }),
  } as any;
}

const ON_DISPATCH: OutstandingConfig = {
  orderStatuses: ['Part Dispatch', 'Dispatched', 'Closed'],
  paymentStatuses: ['Pending', 'Approved'],
};

describe('dashboard money widgets honour the account rule', () => {
  it('fetchTotalOutstanding counts the chosen order statuses', async () => {
    const captured: Captured = {};
    await fetchTotalOutstanding(fakeDb(captured), 'account-1', { ...ON_DISPATCH });
    expect(captured.orders).toEqual(['Part Dispatch', 'Dispatched', 'Closed']);
  });

  it('fetchTotalOutstanding counts the chosen payment statuses', async () => {
    const captured: Captured = {};
    await fetchTotalOutstanding(fakeDb(captured), 'account-1', { ...ON_DISPATCH });
    expect(captured.payments).toEqual(['Pending', 'Approved']);
  });

  it('fetchOverdueCustomers counts the chosen statuses', async () => {
    const captured: Captured = {};
    await fetchOverdueCustomers(fakeDb(captured), 'account-1', { ...ON_DISPATCH });
    expect(captured.orders).toEqual(['Part Dispatch', 'Dispatched', 'Closed']);
  });

  it('fetchCreditExceededCustomers counts the chosen statuses', async () => {
    const captured: Captured = {};
    await fetchCreditExceededCustomers(fakeDb(captured), 'account-1', { ...ON_DISPATCH });
    expect(captured.orders).toEqual(['Part Dispatch', 'Dispatched', 'Closed']);
  });

  it('the default rule still asks for Closed orders and Approved payments', async () => {
    const captured: Captured = {};
    await fetchTotalOutstanding(fakeDb(captured), 'account-1', DEFAULT_OUTSTANDING_CONFIG);
    expect(captured.orders).toEqual(['Closed']);
    expect(captured.payments).toEqual(['Approved']);
  });
});
