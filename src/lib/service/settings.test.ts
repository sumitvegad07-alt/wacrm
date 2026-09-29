import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SERVICE_SETTINGS,
  normalizeServiceSettings,
  warrantyState,
} from './settings';

describe('normalizeServiceSettings', () => {
  it('returns defaults for null, undefined and non-objects', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(normalizeServiceSettings(bad)).toEqual(DEFAULT_SERVICE_SETTINGS);
    }
  });

  it('keeps supplied values and fills the gaps', () => {
    const out = normalizeServiceSettings({ asset_code_prefix: 'EQP' });
    expect(out.asset_code_prefix).toBe('EQP');
    expect(out.job_no_prefix).toBe(DEFAULT_SERVICE_SETTINGS.job_no_prefix);
  });

  it('uppercases and trims a prefix and strips anything but A-Z0-9', () => {
    expect(normalizeServiceSettings({ asset_code_prefix: '  eq-p 1 ' }).asset_code_prefix).toBe('EQP1');
  });

  it('falls back to the default when a prefix normalises to empty', () => {
    expect(normalizeServiceSettings({ asset_code_prefix: '---' }).asset_code_prefix)
      .toBe(DEFAULT_SERVICE_SETTINGS.asset_code_prefix);
  });

  it('caps a prefix at 6 characters', () => {
    expect(normalizeServiceSettings({ asset_code_prefix: 'ABCDEFGHI' }).asset_code_prefix).toBe('ABCDEF');
  });

  it('rejects non-positive and non-numeric sla hours per priority', () => {
    const out = normalizeServiceSettings({ sla_hours: { critical: 0, high: -1, medium: 'x', low: 96 } });
    expect(out.sla_hours.critical).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.critical);
    expect(out.sla_hours.high).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.high);
    expect(out.sla_hours.medium).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.medium);
    expect(out.sla_hours.low).toBe(96);
  });

  it('rejects an unknown assignment mode', () => {
    expect(normalizeServiceSettings({ default_assignment_mode: 'magic' }).default_assignment_mode)
      .toBe(DEFAULT_SERVICE_SETTINGS.default_assignment_mode);
  });

  it('coerces require_asset_on_assign to a real boolean', () => {
    expect(normalizeServiceSettings({ require_asset_on_assign: false }).require_asset_on_assign).toBe(false);
    expect(normalizeServiceSettings({ require_asset_on_assign: 'no' }).require_asset_on_assign).toBe(true);
  });

  it('never mutates its input', () => {
    const input = { asset_code_prefix: 'x' };
    const copy = structuredClone(input);
    normalizeServiceSettings(input);
    expect(input).toEqual(copy);
  });
});

describe('warrantyState', () => {
  const today = new Date('2026-09-29T00:00:00Z');

  it('is none when no warranty end is recorded', () => {
    expect(warrantyState({ warranty_end: null }, today)).toBe('none');
  });

  it('is expired the day after warranty end', () => {
    expect(warrantyState({ warranty_end: '2026-09-28' }, today)).toBe('expired');
  });

  it('is expiring on the last day of warranty', () => {
    expect(warrantyState({ warranty_end: '2026-09-29' }, today)).toBe('expiring');
  });

  it('is expiring within 30 days inclusive', () => {
    expect(warrantyState({ warranty_end: '2026-10-29' }, today)).toBe('expiring');
  });

  it('is active beyond 30 days', () => {
    expect(warrantyState({ warranty_end: '2026-10-30' }, today)).toBe('active');
  });
});

describe('defaults isolation', () => {
  it('returns a fresh sla_hours object rather than the default reference', () => {
    const a = normalizeServiceSettings(null);
    expect(a.sla_hours).not.toBe(DEFAULT_SERVICE_SETTINGS.sla_hours);
    a.sla_hours.low = 1;
    expect(DEFAULT_SERVICE_SETTINGS.sla_hours.low).toBe(72);
    expect(normalizeServiceSettings(null).sla_hours.low).toBe(72);
  });

  it('returns a fresh sla_hours object for an object input too', () => {
    const b = normalizeServiceSettings({ asset_code_prefix: 'X' });
    expect(b.sla_hours).not.toBe(DEFAULT_SERVICE_SETTINGS.sla_hours);
    b.sla_hours.critical = 99;
    expect(DEFAULT_SERVICE_SETTINGS.sla_hours.critical).toBe(4);
  });
});

describe('sla_hours bounds', () => {
  it('rejects non-integer, over-cap and exponent-form values but keeps a legitimate one', () => {
    const out = normalizeServiceSettings({ sla_hours: { low: 4.5, medium: 10000, high: 1e21, critical: 96 } });
    expect(out.sla_hours.low).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.low);
    expect(out.sla_hours.medium).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.medium);
    expect(out.sla_hours.high).toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.high);
    expect(out.sla_hours.critical).toBe(96);
  });

  it('accepts the 8760-hour cap exactly and rejects 8761', () => {
    expect(normalizeServiceSettings({ sla_hours: { low: 8760 } }).sla_hours.low).toBe(8760);
    expect(normalizeServiceSettings({ sla_hours: { low: 8761 } }).sla_hours.low)
      .toBe(DEFAULT_SERVICE_SETTINGS.sla_hours.low);
  });
});

describe('warrantyState UTC-day semantics', () => {
  const lateToday = new Date('2026-09-29T23:59:59Z');

  it('treats the last second of the UTC day as still that day', () => {
    expect(warrantyState({ warranty_end: '2026-09-29' }, lateToday)).toBe('expiring');
    expect(warrantyState({ warranty_end: '2026-09-28' }, lateToday)).toBe('expired');
  });

  it('is none for an unparseable warranty end', () => {
    expect(warrantyState({ warranty_end: 'garbage' }, new Date('2026-09-29T00:00:00Z'))).toBe('none');
  });

  it('is none for an invalid today rather than a confident active', () => {
    expect(warrantyState({ warranty_end: '2027-01-01' }, new Date('nope'))).toBe('none');
  });
});
