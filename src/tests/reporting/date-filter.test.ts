import { describe, it, expect } from 'vitest';
import { PERIOD_PRESETS, getDatesForPeriod } from '@/components/reports/report-filter-drawer';

describe('Date Preset Certification Suite', () => {
  const expectedPresets = [
    'today',
    'yesterday',
    'this_week',
    'last_week',
    'this_month',
    'last_month',
    'this_quarter',
    'previous_quarter',
    'current_year',
    'previous_year',
    'last_90_days',
    'last_180_days',
    'last_365_days',
    'custom',
  ];

  it('contains all 14 required period presets', () => {
    const values = PERIOD_PRESETS.map(p => p.value);
    expectedPresets.forEach(preset => {
      expect(values).toContain(preset);
    });
  });

  expectedPresets.filter(p => p !== 'custom').forEach(preset => {
    it(`calculates non-null date range for period '${preset}'`, () => {
      const range = getDatesForPeriod(preset);
      expect(range).toBeDefined();
      expect(range?.from).toBeInstanceOf(Date);
      expect(range?.to).toBeInstanceOf(Date);
      if (range?.from && range?.to) {
        expect(range.from.getTime()).toBeLessThanOrEqual(range.to.getTime());
      }
    });
  });

  it('handles custom date range correctly', () => {
    const customFrom = new Date('2026-01-01');
    const customTo = new Date('2026-01-31');
    const range = getDatesForPeriod('custom', { from: customFrom, to: customTo });
    expect(range?.from).toEqual(customFrom);
    expect(range?.to).toEqual(customTo);
  });
});
