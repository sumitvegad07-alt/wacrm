import { describe, it, expect } from 'vitest';
import {
  computeCustomerFinancials,
  exceedsCreditLimit,
  settledAmount,
} from './financials';

const DAY = 86_400_000;
const NOW = new Date('2026-08-14T00:00:00Z').getTime();

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY).toISOString();
}

describe('settledAmount', () => {
  it('uses the collected amount when nothing has been verified', () => {
    expect(settledAmount({ amount: 5000 })).toBe(5000);
    expect(settledAmount({ amount: 5000, verified_amount: null })).toBe(5000);
  });

  it('prefers the verified amount once an approver sets one', () => {
    expect(settledAmount({ amount: 5000, verified_amount: 4500 })).toBe(4500);
  });

  it('treats a verified amount of zero as zero, not as unverified', () => {
    // A cheque that bounced is verified at 0. Falling back to `amount` here would
    // credit the customer with money that never arrived.
    expect(settledAmount({ amount: 5000, verified_amount: 0 })).toBe(0);
  });

  it('coerces numeric strings from Postgres', () => {
    expect(settledAmount({ amount: '5000.50' as unknown as number })).toBe(5000.5);
  });
});

describe('computeCustomerFinancials', () => {
  it('computes outstanding as opening + orders - payments', () => {
    const r = computeCustomerFinancials({
      openingBalance: 1000,
      creditLimit: 50000,
      orders: [{ total_amount: 10000, created_at: daysAgo(5) }],
      payments: [{ amount: 4000 }],
      now: NOW,
    });

    expect(r.totalOrders).toBe(10000);
    expect(r.approvedPayments).toBe(4000);
    expect(r.outstandingBalance).toBe(7000);
    expect(r.availableCredit).toBe(43000);
  });

  it('handles a customer with no history', () => {
    const r = computeCustomerFinancials({ orders: [], payments: [], now: NOW });
    expect(r.outstandingBalance).toBe(0);
    expect(r.creditLimit).toBeNull();
    expect(r.availableCredit).toBeNull();
  });

  it('returns negative outstanding when a customer has overpaid', () => {
    const r = computeCustomerFinancials({
      orders: [{ total_amount: 1000, created_at: daysAgo(2) }],
      payments: [{ amount: 2500 }],
      now: NOW,
    });
    // Advance payment is a credit the customer is owed, not a floor at zero.
    expect(r.outstandingBalance).toBe(-1500);
  });

  it('treats a credit limit of zero as a real ceiling, not as unlimited', () => {
    const r = computeCustomerFinancials({
      creditLimit: 0,
      orders: [{ total_amount: 500, created_at: daysAgo(1) }],
      payments: [],
      now: NOW,
    });
    expect(r.creditLimit).toBe(0);
    expect(r.availableCredit).toBe(-500);
    expect(exceedsCreditLimit(r, 0)).toBe(true);
  });

  it('distinguishes an unset credit limit from a zero one', () => {
    const unset = computeCustomerFinancials({ orders: [], payments: [], now: NOW });
    expect(unset.availableCredit).toBeNull();
    expect(exceedsCreditLimit(unset, 999_999)).toBe(false);
  });

  it('uses verified amounts when reducing outstanding', () => {
    const r = computeCustomerFinancials({
      orders: [{ total_amount: 10000, created_at: daysAgo(3) }],
      payments: [{ amount: 5000, verified_amount: 3000 }],
      now: NOW,
    });
    expect(r.outstandingBalance).toBe(7000);
  });
});

describe('overdue ageing', () => {
  it('is not overdue while inside the credit period', () => {
    const r = computeCustomerFinancials({
      creditDays: 30,
      orders: [{ total_amount: 5000, created_at: daysAgo(10) }],
      payments: [],
      now: NOW,
    });
    expect(r.isOverdue).toBe(false);
    expect(r.overdueDays).toBe(0);
  });

  it('flags an unpaid order past its credit days', () => {
    const r = computeCustomerFinancials({
      creditDays: 30,
      orders: [{ total_amount: 5000, created_at: daysAgo(45) }],
      payments: [],
      now: NOW,
    });
    expect(r.isOverdue).toBe(true);
    expect(r.overdueDays).toBe(15);
  });

  it('settles oldest debt first, clearing the aged order', () => {
    const r = computeCustomerFinancials({
      creditDays: 30,
      orders: [
        { total_amount: 5000, created_at: daysAgo(60) },
        { total_amount: 3000, created_at: daysAgo(2) },
      ],
      payments: [{ amount: 5000 }],
      now: NOW,
    });
    // The 60-day-old order is fully paid; the recent one is still within terms.
    expect(r.isOverdue).toBe(false);
  });

  it('reports the age of the oldest still-unpaid order', () => {
    const r = computeCustomerFinancials({
      creditDays: 30,
      orders: [
        { total_amount: 5000, created_at: daysAgo(90) },
        { total_amount: 3000, created_at: daysAgo(50) },
      ],
      payments: [],
      now: NOW,
    });
    expect(r.isOverdue).toBe(true);
    expect(r.overdueDays).toBe(60);
  });

  it('applies opening balance before orders when allocating payments', () => {
    const r = computeCustomerFinancials({
      openingBalance: 4000,
      creditDays: 30,
      orders: [{ total_amount: 2000, created_at: daysAgo(45) }],
      payments: [{ amount: 4000 }],
      now: NOW,
    });
    // The payment is consumed entirely by the opening balance, so the aged order stands.
    expect(r.isOverdue).toBe(true);
  });

  it('never ages anything when credit days are not configured', () => {
    const r = computeCustomerFinancials({
      orders: [{ total_amount: 5000, created_at: daysAgo(500) }],
      payments: [],
      now: NOW,
    });
    expect(r.isOverdue).toBe(false);
  });

  it('ages orders by date regardless of the order they arrive in', () => {
    const r = computeCustomerFinancials({
      creditDays: 30,
      orders: [
        { total_amount: 3000, created_at: daysAgo(2) },
        { total_amount: 5000, created_at: daysAgo(60) },
      ],
      payments: [{ amount: 5000 }],
      now: NOW,
    });
    // Payment must settle the 60-day order even though it was listed second.
    expect(r.isOverdue).toBe(false);
  });
});

describe('exceedsCreditLimit', () => {
  it('allows an order that fits inside the remaining limit', () => {
    expect(
      exceedsCreditLimit({ creditLimit: 10000, outstandingBalance: 4000 }, 5000)
    ).toBe(false);
  });

  it('blocks an order that would push past the limit', () => {
    expect(
      exceedsCreditLimit({ creditLimit: 10000, outstandingBalance: 4000 }, 7000)
    ).toBe(true);
  });

  it('allows an order that lands exactly on the limit', () => {
    expect(
      exceedsCreditLimit({ creditLimit: 10000, outstandingBalance: 4000 }, 6000)
    ).toBe(false);
  });

  it('never blocks when no limit is configured', () => {
    expect(
      exceedsCreditLimit({ creditLimit: null, outstandingBalance: 999_999 }, 999_999)
    ).toBe(false);
  });
});
