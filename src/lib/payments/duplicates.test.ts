import { describe, it, expect } from 'vitest';
import {
  findDuplicatePayments,
  DEFAULT_DUPLICATE_WINDOW_MINUTES,
  type ExistingPayment,
} from './duplicates';

const NOW = new Date('2026-08-14T12:00:00Z').getTime();
const CUSTOMER = 'contact-1';
const OTHER = 'contact-2';
const TODAY = '2026-08-14';

function payment(over: Partial<ExistingPayment> = {}): ExistingPayment {
  return {
    id: over.id ?? 'p1',
    payment_number: over.payment_number ?? 'PAY-000001',
    contact_id: over.contact_id ?? CUSTOMER,
    amount: over.amount ?? 5000,
    payment_date: over.payment_date ?? TODAY,
    status: over.status ?? 'Pending',
    created_at: over.created_at ?? new Date(NOW - 5 * 60_000).toISOString(),
  };
}

const candidate = { contactId: CUSTOMER, amount: 5000, paymentDate: TODAY };

describe('business duplicate detection', () => {
  it('flags the same customer, amount and date recorded minutes ago', () => {
    // S27b: ten identical collections were accepted with no warning at all.
    const r = findDuplicatePayments(candidate, [payment()], NOW);
    expect(r.isDuplicate).toBe(true);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].payment_number).toBe('PAY-000001');
  });

  it('reports every match, not just the first', () => {
    const r = findDuplicatePayments(
      candidate,
      [payment({ id: 'a' }), payment({ id: 'b' }), payment({ id: 'c' })],
      NOW
    );
    expect(r.matches).toHaveLength(3);
  });

  it('does not flag a different customer', () => {
    const r = findDuplicatePayments(candidate, [payment({ contact_id: OTHER })], NOW);
    expect(r.isDuplicate).toBe(false);
  });

  it('does not flag a different amount', () => {
    const r = findDuplicatePayments(candidate, [payment({ amount: 5001 })], NOW);
    expect(r.isDuplicate).toBe(false);
  });

  it('does not flag a different payment date', () => {
    const r = findDuplicatePayments(candidate, [payment({ payment_date: '2026-08-13' })], NOW);
    expect(r.isDuplicate).toBe(false);
  });

  it('ignores anything outside the window', () => {
    const old = payment({ created_at: new Date(NOW - 120 * 60_000).toISOString() });
    expect(findDuplicatePayments(candidate, [old], NOW).isDuplicate).toBe(false);
    // ...but a wider window catches it
    expect(findDuplicatePayments(candidate, [old], NOW, 180).isDuplicate).toBe(true);
  });

  it('treats a payment exactly on the window edge as inside it', () => {
    const edge = payment({
      created_at: new Date(NOW - DEFAULT_DUPLICATE_WINDOW_MINUTES * 60_000).toISOString(),
    });
    expect(findDuplicatePayments(candidate, [edge], NOW).isDuplicate).toBe(true);
  });

  it('does not treat a cancelled payment as a duplicate', () => {
    // The money was reversed; re-entering it correctly is the expected next step.
    const r = findDuplicatePayments(candidate, [payment({ status: 'Cancelled' })], NOW);
    expect(r.isDuplicate).toBe(false);
  });

  it('still flags an approved payment', () => {
    const r = findDuplicatePayments(candidate, [payment({ status: 'Approved' })], NOW);
    expect(r.isDuplicate).toBe(true);
  });

  it('excludes the row being re-checked', () => {
    const r = findDuplicatePayments(
      { ...candidate, excludeId: 'p1' },
      [payment({ id: 'p1' })],
      NOW
    );
    expect(r.isDuplicate).toBe(false);
  });

  it('reports no duplicate against an empty book', () => {
    expect(findDuplicatePayments(candidate, [], NOW).isDuplicate).toBe(false);
  });

  it('never blocks — it only ever reports', () => {
    // The contract matters: this function returns a flag, it does not throw.
    expect(() => findDuplicatePayments(candidate, [payment()], NOW)).not.toThrow();
    expect(findDuplicatePayments(candidate, [payment()], NOW)).toHaveProperty('isDuplicate');
  });
});
