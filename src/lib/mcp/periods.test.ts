import { describe, expect, it } from "vitest";
import {
  MCP_PERIODS,
  isMcpPeriod,
  resolveCustomRange,
  resolveDaysBack,
  resolvePeriod,
  todayInZone,
} from "./periods";

const IST = "Asia/Kolkata";

describe("todayInZone", () => {
  it("returns the Indian date, not the UTC date, late in the UTC evening", () => {
    // 2026-10-03T19:30:00Z is 2026-10-04T01:00 IST.
    expect(todayInZone(IST, new Date("2026-10-03T19:30:00Z"))).toBe("2026-10-04");
  });

  it("returns the Indian date just after midnight IST", () => {
    // 2026-10-03T18:35:00Z is 2026-10-04T00:05 IST.
    expect(todayInZone(IST, new Date("2026-10-03T18:35:00Z"))).toBe("2026-10-04");
  });

  it("honours a non-Indian account timezone", () => {
    expect(todayInZone("America/New_York", new Date("2026-10-03T02:00:00Z"))).toBe("2026-10-02");
  });
});

describe("resolvePeriod", () => {
  it("resolves today in account time, not UTC", () => {
    const r = resolvePeriod("today", IST, new Date("2026-10-03T19:30:00Z"));
    expect(r.start_date).toBe("2026-10-04");
    expect(r.end_date).toBe("2026-10-04");
  });

  it("resolves yesterday relative to the account's today", () => {
    const r = resolvePeriod("yesterday", IST, new Date("2026-10-03T19:30:00Z"));
    expect(r.start_date).toBe("2026-10-03");
    expect(r.end_date).toBe("2026-10-03");
  });

  it("resolves this_month across a month boundary in account time", () => {
    // 2026-09-30T19:00:00Z is 2026-10-01 00:30 IST — October, not September.
    const r = resolvePeriod("this_month", IST, new Date("2026-09-30T19:00:00Z"));
    expect(r.start_date).toBe("2026-10-01");
    expect(r.end_date).toBe("2026-10-31");
  });

  it("resolves last_month", () => {
    const r = resolvePeriod("last_month", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-09-01");
    expect(r.end_date).toBe("2026-09-30");
  });

  it("resolves last_180_days inclusive of today, matching the dashboard", () => {
    const r = resolvePeriod("last_180_days", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.end_date).toBe("2026-10-03");
    expect(r.start_date).toBe("2026-04-06"); // 180 days before 2026-10-03
  });

  it("resolves this_quarter", () => {
    const r = resolvePeriod("this_quarter", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-10-01");
    expect(r.end_date).toBe("2026-12-31");
  });

  it("resolves current_year", () => {
    const r = resolvePeriod("current_year", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-01-01");
    expect(r.end_date).toBe("2026-12-31");
  });

  it("carries the timezone and a human label for the AI to quote", () => {
    const r = resolvePeriod("last_180_days", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.timezone).toBe(IST);
    expect(r.label).toBe("Last 180 Days");
  });

  it("rejects an unknown period rather than silently returning everything", () => {
    expect(() => resolvePeriod("last_fortnight", IST)).toThrow(/unknown period/i);
  });

  it("rejects custom ranges — the AI must not send raw dates", () => {
    expect(() => resolvePeriod("custom", IST)).toThrow(/unknown period/i);
  });
});

// The dashboard resolves periods with date-fns in the BROWSER's timezone.
// These cases pin the connector to the same calendar semantics (quirks
// included) so the Task 15 trust test can assert the two agree.
describe("dashboard parity", () => {
  it("starts the week on Sunday, as date-fns startOfWeek does by default", () => {
    // 2026-10-03 is a Saturday, so the week runs Sun 27 Sep – Sat 3 Oct.
    const r = resolvePeriod("this_week", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-09-27");
    expect(r.end_date).toBe("2026-10-03");
  });

  it("resolves last_week as the whole previous Sunday-to-Saturday week", () => {
    const r = resolvePeriod("last_week", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-09-20");
    expect(r.end_date).toBe("2026-09-26");
  });

  it("keeps the dashboard's 91-day last_90_days quirk rather than fixing it", () => {
    // subDays(now, 90) through end-of-today is 91 calendar days inclusive.
    const r = resolvePeriod("last_90_days", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-07-05");
    expect(r.end_date).toBe("2026-10-03");
  });

  it("resolves previous_quarter", () => {
    const r = resolvePeriod("previous_quarter", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2026-07-01");
    expect(r.end_date).toBe("2026-09-30");
  });

  it("rolls previous_quarter back into last year from Q1", () => {
    const r = resolvePeriod("previous_quarter", IST, new Date("2026-02-14T06:00:00Z"));
    expect(r.start_date).toBe("2025-10-01");
    expect(r.end_date).toBe("2025-12-31");
  });

  it("resolves previous_year", () => {
    const r = resolvePeriod("previous_year", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2025-01-01");
    expect(r.end_date).toBe("2025-12-31");
  });

  it("rolls last_month back into last year from January", () => {
    const r = resolvePeriod("last_month", IST, new Date("2026-01-10T06:00:00Z"));
    expect(r.start_date).toBe("2025-12-01");
    expect(r.end_date).toBe("2025-12-31");
  });

  it("gets February right in a leap year", () => {
    const r = resolvePeriod("this_month", IST, new Date("2028-02-10T06:00:00Z"));
    expect(r.end_date).toBe("2028-02-29");
  });

  it("resolves last_365_days", () => {
    const r = resolvePeriod("last_365_days", IST, new Date("2026-10-03T06:00:00Z"));
    expect(r.start_date).toBe("2025-10-03");
    expect(r.end_date).toBe("2026-10-03");
  });
});

describe("short windows", () => {
  // Added after "last 15 days total visits by Dhaval" could not be answered:
  // no preset matched, so a perfectly ordinary question got a range instead
  // of a number.
  it.each([
    ["last_7_days", "2026-09-28"],
    ["last_15_days", "2026-09-20"],
    ["last_30_days", "2026-09-05"],
    ["last_60_days", "2026-08-06"],
  ])("%s counts exactly that many days, ending today", (period, start) => {
    const r = resolvePeriod(period, IST, new Date("2026-10-04T06:00:00Z"));
    expect(r.start_date).toBe(start);
    expect(r.end_date).toBe("2026-10-04");
  });

  it.each([
    ["last_7_days", 7],
    ["last_15_days", 15],
    ["last_30_days", 30],
    ["last_60_days", 60],
  ])("%s spans exactly %i calendar days inclusive", (period, days) => {
    const r = resolvePeriod(period, IST, new Date("2026-10-04T06:00:00Z"));
    const span =
      (Date.parse(r.end_date) - Date.parse(r.start_date)) / 86_400_000 + 1;
    expect(span).toBe(days);
  });

  it("keeps the legacy windows off-by-one, for dashboard parity", () => {
    // Deliberate: last_90_days must keep agreeing with the dashboard.
    const r = resolvePeriod("last_90_days", IST, new Date("2026-10-04T06:00:00Z"));
    const span = (Date.parse(r.end_date) - Date.parse(r.start_date)) / 86_400_000 + 1;
    expect(span).toBe(91);
  });

  it("resolves them in account time, not UTC", () => {
    const r = resolvePeriod("last_15_days", IST, new Date("2026-10-03T19:30:00Z"));
    expect(r.end_date).toBe("2026-10-04");
  });
});

describe("MCP_PERIODS", () => {
  it("offers the dashboard presets plus the short windows, and excludes custom", () => {
    expect(MCP_PERIODS).toHaveLength(17);
    expect(MCP_PERIODS).not.toContain("custom");
    expect(MCP_PERIODS).toContain("last_180_days");
  });

  it("type-narrows known names only", () => {
    expect(isMcpPeriod("today")).toBe(true);
    expect(isMcpPeriod("custom")).toBe(false);
    expect(isMcpPeriod(42)).toBe(false);
  });

  it("resolves every advertised period without throwing", () => {
    for (const p of MCP_PERIODS) {
      const r = resolvePeriod(p, IST, new Date("2026-10-03T06:00:00Z"));
      expect(r.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.start_date <= r.end_date).toBe(true);
    }
  });
});

describe("resolveDaysBack", () => {
  const AT = new Date("2026-10-04T06:00:00Z");

  it.each([
    [1, "2026-10-04"],
    [9, "2026-09-26"],
    [15, "2026-09-20"],
    [45, "2026-08-21"],
  ])("last %i days starts on %s", (days, start) => {
    const r = resolveDaysBack(days, IST, AT);
    expect(r.start_date).toBe(start);
    expect(r.end_date).toBe("2026-10-04");
  });

  it("spans exactly the number of days asked for", () => {
    for (const days of [1, 2, 9, 15, 31, 100]) {
      const r = resolveDaysBack(days, IST, AT);
      const span =
        (Date.parse(r.end_date) - Date.parse(r.start_date)) / 86_400_000 + 1;
      expect(span, `days_back=${days}`).toBe(days);
    }
  });

  it("counts from the account's today, not UTC's", () => {
    // 19:30Z is already tomorrow in India.
    const r = resolveDaysBack(1, IST, new Date("2026-10-03T19:30:00Z"));
    expect(r.start_date).toBe("2026-10-04");
  });

  it("labels itself so the AI can quote the window", () => {
    expect(resolveDaysBack(9, IST, AT).label).toBe("Last 9 Days");
    expect(resolveDaysBack(1, IST, AT).label).toBe("Last 1 Day");
  });

  it("rejects nonsense rather than guessing", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveDaysBack(bad, IST, AT)).toThrow(/whole number|1 or more/i);
    }
  });

  it("refuses an unreasonable span", () => {
    expect(() => resolveDaysBack(5000, IST, AT)).toThrow(/limited to/i);
  });
});

describe("resolveCustomRange", () => {
  it("accepts an explicit range as calendar dates", () => {
    const r = resolveCustomRange("2026-09-20", "2026-10-04", IST);
    expect(r.start_date).toBe("2026-09-20");
    expect(r.end_date).toBe("2026-10-04");
    expect(r.timezone).toBe(IST);
    expect(r.label).toBe("2026-09-20 to 2026-10-04");
  });

  it("allows a single day", () => {
    const r = resolveCustomRange("2026-09-20", "2026-09-20", IST);
    expect(r.start_date).toBe(r.end_date);
  });

  it("rejects a backwards range instead of silently swapping it", () => {
    expect(() => resolveCustomRange("2026-10-04", "2026-09-20", IST)).toThrow(/after/i);
  });

  it.each(["20-09-2026", "2026/09/20", "Sep 20 2026", "2026-9-2", "", "today"])(
    "rejects %j as a date",
    (bad) => {
      expect(() => resolveCustomRange(bad, "2026-10-04", IST)).toThrow(/YYYY-MM-DD/);
    },
  );

  it("rejects a date that looks right but cannot exist", () => {
    expect(() => resolveCustomRange("2026-02-30", "2026-03-01", IST)).toThrow(/YYYY-MM-DD/);
    expect(() => resolveCustomRange("2026-13-01", "2026-13-02", IST)).toThrow(/YYYY-MM-DD/);
  });

  it("accepts 29 February in a leap year", () => {
    expect(resolveCustomRange("2028-02-29", "2028-03-01", IST).start_date).toBe("2028-02-29");
  });

  it("refuses an unreasonable span", () => {
    expect(() => resolveCustomRange("2000-01-01", "2026-10-04", IST)).toThrow(/limit/i);
  });
});
