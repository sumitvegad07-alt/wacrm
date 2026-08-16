import { describe, it, expect } from 'vitest';
import { toReportDate, getDatesForPeriod } from '@/components/reports/report-filter-drawer';

/**
 * Regression guard for the off-by-one-day bug found 2026-08-16.
 *
 * The report filters used `date.toISOString().split('T')[0]` to serialise the
 * picked calendar day. The date pickers produce LOCAL midnight, and in any
 * timezone east of UTC that serialises to the previous day — so picking
 * 14 Aug queried 13 Aug, and "This Month" started on 31 July. Both the Order
 * and Sales reports silently returned the wrong rows.
 *
 * These tests run under the machine's local timezone. To reproduce the original
 * failure explicitly, run with TZ=Asia/Kolkata.
 */
describe('report date serialisation', () => {
  it('serialises a picked day as that calendar day, not the UTC day', () => {
    // Local midnight — exactly what react-day-picker hands back.
    const picked = new Date(2026, 7, 14);
    expect(toReportDate(picked)).toBe('2026-08-14');
  });

  it('never shifts a local-midnight date backwards', () => {
    // The precise failure mode: toISOString() rolls back a day east of UTC.
    for (const day of [1, 14, 28, 31]) {
      const d = new Date(2026, 6, day); // July 2026
      expect(toReportDate(d)).toBe(`2026-07-${String(day).padStart(2, '0')}`);
    }
  });

  it('keeps end-of-day timestamps on the same calendar day', () => {
    // Presets use endOfDay/endOfMonth — 23:59:59.999 local must not roll forward.
    const endOfDay = new Date(2026, 7, 14, 23, 59, 59, 999);
    expect(toReportDate(endOfDay)).toBe('2026-08-14');
  });

  it('serialises the this_month preset to the first and last of the month', () => {
    const range = getDatesForPeriod('this_month');
    expect(range?.from).toBeDefined();
    expect(range?.to).toBeDefined();

    const start = toReportDate(range!.from!);
    const end = toReportDate(range!.to!);

    // Start must be day 01 — the bug produced the last day of the PREVIOUS month.
    expect(start.slice(-2)).toBe('01');
    expect(start.slice(0, 7)).toBe(end.slice(0, 7)); // same year-month
  });

  it('serialises a single-day custom range to one identical day', () => {
    const day = new Date(2026, 7, 14);
    const range = getDatesForPeriod('custom', { from: day, to: day });
    expect(toReportDate(range!.from!)).toBe('2026-08-14');
    expect(toReportDate(range!.to!)).toBe('2026-08-14');
  });
});
