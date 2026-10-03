import { describe, it, expect } from 'vitest';
import { parseDmyDate } from './dates';

describe('parseDmyDate', () => {
  it('reads dd-mm-yyyy, dd/mm/yyyy and ISO into an ISO date', () => {
    expect(parseDmyDate('15-03-2024')).toBe('2024-03-15');
    expect(parseDmyDate('15/03/2024')).toBe('2024-03-15');
    expect(parseDmyDate('2024-03-15')).toBe('2024-03-15');
  });

  it('accepts single-digit day and month in the day-first forms', () => {
    expect(parseDmyDate('1-2-2026')).toBe('2026-02-01');
    expect(parseDmyDate('5/7/2025')).toBe('2025-07-05');
  });

  it('is day-first: 03/04/2024 is the 3rd of April', () => {
    expect(parseDmyDate('03/04/2024')).toBe('2024-04-03');
  });

  it('rejects a two-digit year rather than guessing a century', () => {
    expect(parseDmyDate('01-02-26')).toBeNull();
    expect(parseDmyDate('1/2/26')).toBeNull();
  });

  it('rejects impossible calendar dates', () => {
    expect(parseDmyDate('31-02-2026')).toBeNull();
    expect(parseDmyDate('29-02-2025')).toBeNull();
    expect(parseDmyDate('2026-13-01')).toBeNull();
    expect(parseDmyDate('00-01-2026')).toBeNull();
  });

  it('accepts 29 Feb in a leap year', () => {
    expect(parseDmyDate('29-02-2024')).toBe('2024-02-29');
  });

  it('rejects other shapes: free text, slashed ISO, dotted, unpadded ISO, empty', () => {
    expect(parseDmyDate('March 15, 2024')).toBeNull();
    expect(parseDmyDate('2024/03/15')).toBeNull();
    expect(parseDmyDate('15.03.2024')).toBeNull();
    expect(parseDmyDate('2024-3-5')).toBeNull();
    expect(parseDmyDate('')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parseDmyDate('  15-03-2024 ')).toBe('2024-03-15');
  });
});
