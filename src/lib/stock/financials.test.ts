import { describe, it, expect } from 'vitest';
import { readStockSettings, exceedsAvailable, toNumber, STOCK_REASON_CODES, STOCK_IN_REASONS, STOCK_OUT_REASONS, stockReasonsFor } from './financials';

describe('stock financials — pure helpers', () => {
  it('coerces NUMERIC strings from Postgres', () => {
    expect(toNumber('12.50')).toBe(12.5);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('nonsense')).toBe(0);
  });

  it('reads stock settings with safe defaults', () => {
    expect(readStockSettings(null)).toEqual({
      stockOutEvent: 'order_closed',
      restrictOnInsufficient: false,
    });
    expect(
      readStockSettings({ stock_settings: { stock_out_event: 'dispatch', restrict_on_insufficient: true } })
    ).toEqual({ stockOutEvent: 'dispatch', restrictOnInsufficient: true });
    // an unknown event value falls back to the default
    expect(readStockSettings({ stock_settings: { stock_out_event: 'weird' } }).stockOutEvent).toBe(
      'order_closed'
    );
  });

  it('blocks only when ordered quantity strictly exceeds available', () => {
    expect(exceedsAvailable(8, 10)).toBe(true);
    expect(exceedsAvailable(10, 10)).toBe(false); // exactly available is allowed
    expect(exceedsAvailable(10, 9)).toBe(false);
    expect(exceedsAvailable(0, 1)).toBe(true);
    expect(exceedsAvailable(-2, 1)).toBe(true); // already negative stock
  });

  it('reason codes are direction-aware and match the DB CHECK list', () => {
    // Purchase is stock-in only; Damage is stock-out only.
    expect(STOCK_IN_REASONS).toContain('Purchase');
    expect(STOCK_IN_REASONS).not.toContain('Damage');
    expect(STOCK_OUT_REASONS).toContain('Damage');
    expect(STOCK_OUT_REASONS).not.toContain('Purchase');
    // The two bidirectional reasons appear on both.
    for (const shared of ['Stock Correction', 'Physical Count Adjustment']) {
      expect(STOCK_IN_REASONS).toContain(shared);
      expect(STOCK_OUT_REASONS).toContain(shared);
    }
    // The union (DB CHECK list) is 12 distinct reasons.
    expect(STOCK_REASON_CODES).toHaveLength(12);
    expect(stockReasonsFor('in')).toBe(STOCK_IN_REASONS);
    expect(stockReasonsFor('out')).toBe(STOCK_OUT_REASONS);
  });
});
