import { describe, it, expect } from 'vitest';
import {
  PAYMENT_STATUSES,
  canTransitionTo,
  getSourceLabel,
  getStatusColor,
  validateCancellation,
  requiresCancellationReason,
  type PaymentStatus,
} from './statuses';

const TERMINAL: PaymentStatus[] = ['Rejected', 'Cancelled'];

describe('payment status state machine', () => {
  it('lets a pending payment be approved, rejected or cancelled', () => {
    expect(canTransitionTo('Pending', 'Approved')).toBe(true);
    expect(canTransitionTo('Pending', 'Rejected')).toBe(true);
    expect(canTransitionTo('Pending', 'Cancelled')).toBe(true);
  });

  it('lets an approved payment be cancelled', () => {
    // S12: without this there is no way to reverse a payment approved in error or a
    // cheque that bounces later, and the customer's outstanding stays wrong forever.
    expect(canTransitionTo('Approved', 'Cancelled')).toBe(true);
  });

  it('does not let an approved payment go back to Pending or be Rejected', () => {
    expect(canTransitionTo('Approved', 'Pending')).toBe(false);
    expect(canTransitionTo('Approved', 'Rejected')).toBe(false);
    expect(canTransitionTo('Approved', 'Approved')).toBe(false);
  });

  it('treats rejected and cancelled as fully terminal', () => {
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

describe('cancellation reason', () => {
  it('is required only when cancelling', () => {
    expect(requiresCancellationReason('Cancelled')).toBe(true);
    expect(requiresCancellationReason('Approved')).toBe(false);
    expect(requiresCancellationReason('Rejected')).toBe(false);
  });

  it('rejects a missing, empty or whitespace-only reason', () => {
    // S13: cancelling with no reason used to succeed, leaving no record of why the
    // money was reversed.
    expect(validateCancellation(undefined)).toBe('Cancellation reason is required');
    expect(validateCancellation(null)).toBe('Cancellation reason is required');
    expect(validateCancellation('')).toBe('Cancellation reason is required');
    expect(validateCancellation('   ')).toBe('Cancellation reason is required');
  });

  it('accepts a real reason', () => {
    expect(validateCancellation('Cheque Bounced')).toBeNull();
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
