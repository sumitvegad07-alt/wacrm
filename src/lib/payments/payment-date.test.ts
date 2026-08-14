import { describe, it, expect } from 'vitest';
import { validatePaymentDate, DEFAULT_ALLOW_BACKDATE_DAYS } from './payment-date';

const TODAY = '2026-08-14';

function daysBefore(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('payment date policy', () => {
  it('accepts today', () => {
    const r = validatePaymentDate(TODAY, TODAY);
    expect(r.ok).toBe(true);
    expect(r.ageDays).toBe(0);
  });

  it('accepts a date inside the default window', () => {
    const r = validatePaymentDate(daysBefore(10), TODAY);
    expect(r.ok).toBe(true);
    expect(r.ageDays).toBe(10);
  });

  it('accepts a date exactly on the window boundary', () => {
    const r = validatePaymentDate(daysBefore(DEFAULT_ALLOW_BACKDATE_DAYS), TODAY);
    expect(r.ok).toBe(true);
  });

  it('rejects one day beyond the window', () => {
    const r = validatePaymentDate(daysBefore(DEFAULT_ALLOW_BACKDATE_DAYS + 1), TODAY);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/31 days old/);
  });

  it('rejects the 400-day backdate from the pilot simulation', () => {
    // S19c: a field rep recorded a collection dated 400 days back with no complaint.
    const r = validatePaymentDate(daysBefore(400), TODAY);
    expect(r.ok).toBe(false);
    expect(r.ageDays).toBe(400);
  });

  it('allows that same 400-day backdate for a holder of backdate_payments', () => {
    const r = validatePaymentDate(daysBefore(400), TODAY, { canBackdate: true });
    expect(r.ok).toBe(true);
  });

  it('rejects a future date even with the backdate permission', () => {
    // Backdating is a separate concern; nothing justifies a forward-dated collection.
    const r = validatePaymentDate('2026-08-15', TODAY, { canBackdate: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Payment date cannot be in the future');
  });

  it('rejects a date far in the future', () => {
    const r = validatePaymentDate('2027-01-01', TODAY);
    expect(r.ok).toBe(false);
    expect(r.ageDays).toBeLessThan(0);
  });

  it('honours a per-account window', () => {
    expect(validatePaymentDate(daysBefore(60), TODAY, { allowBackdateDays: 90 }).ok).toBe(true);
    expect(validatePaymentDate(daysBefore(60), TODAY, { allowBackdateDays: 7 }).ok).toBe(false);
  });

  it('treats a zero-day window as same-day-only', () => {
    expect(validatePaymentDate(TODAY, TODAY, { allowBackdateDays: 0 }).ok).toBe(true);
    expect(validatePaymentDate(daysBefore(1), TODAY, { allowBackdateDays: 0 }).ok).toBe(false);
  });

  it('rejects an unparseable date', () => {
    const r = validatePaymentDate('not-a-date', TODAY);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a valid date/);
  });
});
