import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOM_REPEAT,
  describeRepeat,
  generateRepeatDates,
  isoDayOfWeek,
  type CustomRepeat,
} from './repeat-schedule';

// November 2026: the 1st is a Sunday, so the 2nd is a Monday and the month has 30 days.
const YEAR = 2026;
const NOV = 10; // 0-based

const custom = (over: Partial<CustomRepeat>): CustomRepeat => ({ ...DEFAULT_CUSTOM_REPEAT, ...over });

describe('isoDayOfWeek', () => {
  it('numbers Monday 1 through Sunday 7, matching route_plan_assignments.day_of_week', () => {
    expect(isoDayOfWeek(YEAR, NOV, 2)).toBe(1); // Monday
    expect(isoDayOfWeek(YEAR, NOV, 1)).toBe(7); // Sunday, not 0
  });
});

describe('generateRepeatDates — fixed intervals', () => {
  it('steps 14 days, not 15 — a fortnightly beat lands on the same weekday', () => {
    const dates = generateRepeatDates('2026-11-02', '14_days', YEAR, NOV);
    expect(dates).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
    // Every one of them is the same weekday, which is the whole reason for 14 over 15.
    const weekdays = new Set(dates.map((d) => isoDayOfWeek(YEAR, NOV, Number(d.slice(-2)))));
    expect(weekdays.size).toBe(1);
  });

  it('weekly steps 7 and stops inside the month', () => {
    expect(generateRepeatDates('2026-11-20', 'weekly', YEAR, NOV)).toEqual(['2026-11-20', '2026-11-27']);
  });

  it('monthly is the start date alone', () => {
    expect(generateRepeatDates('2026-11-09', 'monthly', YEAR, NOV)).toEqual(['2026-11-09']);
  });

  it('daily fills to the end of the month', () => {
    expect(generateRepeatDates('2026-11-28', 'daily', YEAR, NOV)).toEqual([
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
    ]);
  });
});

describe('generateRepeatDates — custom: pick weekdays', () => {
  it('schedules every chosen weekday from the start date on', () => {
    const dates = generateRepeatDates('2026-11-01', 'custom', YEAR, NOV, custom({ weekdays: [1, 4] }));
    expect(dates).toEqual([
      '2026-11-02', // Mon
      '2026-11-05', // Thu
      '2026-11-09',
      '2026-11-12',
      '2026-11-16',
      '2026-11-19',
      '2026-11-23',
      '2026-11-26',
      '2026-11-30',
    ]);
  });

  it('ticking nothing schedules nothing, rather than every day', () => {
    expect(generateRepeatDates('2026-11-01', 'custom', YEAR, NOV, custom({ weekdays: [] }))).toEqual([]);
  });
});

describe('generateRepeatDates — custom: every N days', () => {
  it('uses the admin’s own interval', () => {
    expect(
      generateRepeatDates('2026-11-01', 'custom', YEAR, NOV, custom({ mode: 'interval', intervalDays: 21 })),
    ).toEqual(['2026-11-01', '2026-11-22']);
  });

  it('clamps nonsense rather than looping forever or scheduling nothing', () => {
    const zero = generateRepeatDates('2026-11-28', 'custom', YEAR, NOV, custom({ mode: 'interval', intervalDays: 0 }));
    expect(zero).toEqual(['2026-11-28', '2026-11-29', '2026-11-30']);
    const huge = generateRepeatDates('2026-11-01', 'custom', YEAR, NOV, custom({ mode: 'interval', intervalDays: 9999 }));
    expect(huge).toEqual(['2026-11-01']);
  });
});

describe('generateRepeatDates — custom: pick dates in the month', () => {
  it('keeps the picked dates, in order, de-duplicated', () => {
    expect(
      generateRepeatDates('2026-11-01', 'custom', YEAR, NOV, custom({ mode: 'month_dates', monthDates: [20, 1, 10, 10] })),
    ).toEqual(['2026-11-01', '2026-11-10', '2026-11-20']);
  });

  it('drops a date that has already passed and one the month does not have', () => {
    expect(
      generateRepeatDates('2026-11-15', 'custom', YEAR, NOV, custom({ mode: 'month_dates', monthDates: [1, 20, 31] })),
    ).toEqual(['2026-11-20']);
  });
});

describe('generateRepeatDates — month boundaries', () => {
  it('runs a later month from its 1st rather than from a day number borrowed elsewhere', () => {
    // Start 20 Oct, looking at November: the 20th of October says nothing about November.
    expect(generateRepeatDates('2026-10-20', 'weekly', YEAR, NOV)).toEqual([
      '2026-11-01',
      '2026-11-08',
      '2026-11-15',
      '2026-11-22',
      '2026-11-29',
    ]);
  });

  it('schedules nothing in a month that ends before the start date', () => {
    expect(generateRepeatDates('2026-12-05', 'weekly', YEAR, NOV)).toEqual([]);
  });

  it('ignores an unparseable start date instead of producing Invalid Date rows', () => {
    expect(generateRepeatDates('not-a-date', 'weekly', YEAR, NOV)).toEqual([]);
  });
});

describe('describeRepeat', () => {
  it('says how many dates, so an empty custom selection is visible before the click', () => {
    expect(describeRepeat([], YEAR, NOV)).toBe('Nothing to schedule in November 2026');
    expect(describeRepeat(['2026-11-02'], YEAR, NOV)).toBe('1 date in November 2026');
    expect(describeRepeat(['2026-11-02', '2026-11-16'], YEAR, NOV)).toBe('2 dates in November 2026');
  });
});
