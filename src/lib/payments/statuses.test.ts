import { describe, it, expect } from 'vitest';
import {
  PAYMENT_STATUSES,
  canTransitionTo,
  getSourceLabel,
  getStatusColor,
  type PaymentStatus,
} from './statuses';

const TERMINAL: PaymentStatus[] = ['Approved', 'Rejected', 'Cancelled'];

describe('payment status state machine', () => {
  it('lets a pending payment be approved, rejected or cancelled', () => {
    expect(canTransitionTo('Pending', 'Approved')).toBe(true);
    expect(canTransitionTo('Pending', 'Rejected')).toBe(true);
    expect(canTransitionTo('Pending', 'Cancelled')).toBe(true);
  });

  it('treats approved, rejected and cancelled as terminal', () => {
    // Money that has been ruled on must not silently change state again — the DB
    // trigger enforces the same rule, this guards the UI half.
    for (const from of TERMINAL) {
      for (const to of PAYMENT_STATUSES) {
        expect(canTransitionTo(from, to)).toBe(false);
      }
    }
  });

  it('does not allow a payment to transition to its own status', () => {
    expect(canTransitionTo('Pending', 'Pending')).toBe(false);
  });

  it('rejects unknown source statuses', () => {
    expect(canTransitionTo('Draft', 'Approved')).toBe(false);
    expect(canTransitionTo('', 'Approved')).toBe(false);
  });
});

describe('status presentation', () => {
  it('has a colour for every declared status', () => {
    for (const s of PAYMENT_STATUSES) {
      expect(getStatusColor(s)).not.toBe('bg-gray-100 text-gray-800');
    }
  });

  it('falls back to a neutral colour for an unknown status', () => {
    expect(getStatusColor('Whatever')).toBe('bg-gray-100 text-gray-800');
  });

  it('labels known sources and passes through unknown ones', () => {
    expect(getSourceLabel('visit')).toBe('Site Visit');
    expect(getSourceLabel('admin')).toBe('Admin Console');
    expect(getSourceLabel('smoke-signal')).toBe('smoke-signal');
  });
});
