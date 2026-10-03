import { describe, expect, it } from "vitest";
import {
  MCP_DAILY_CALL_BUDGET,
  MCP_ROW_CEILING,
  clampLimit,
  startOfAccountDayUtc,
  wasTruncated,
} from "./limits";

describe("clampLimit", () => {
  it("defaults to the ceiling when the AI asks for nothing", () => {
    expect(clampLimit(undefined)).toBe(MCP_ROW_CEILING);
  });

  it("honours a smaller request", () => {
    expect(clampLimit(10)).toBe(10);
  });

  it("clamps a larger request rather than honouring it", () => {
    expect(clampLimit(50_000)).toBe(MCP_ROW_CEILING);
  });

  it("rejects nonsense without throwing", () => {
    expect(clampLimit(0)).toBe(MCP_ROW_CEILING);
    expect(clampLimit(-5)).toBe(MCP_ROW_CEILING);
    expect(clampLimit(Number.NaN)).toBe(MCP_ROW_CEILING);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(MCP_ROW_CEILING);
    expect(clampLimit("100" as unknown as number)).toBe(MCP_ROW_CEILING);
  });

  it("floors a fractional request rather than passing it to Postgres", () => {
    expect(clampLimit(10.7)).toBe(10);
  });
});

describe("wasTruncated", () => {
  it("flags a full page, because more rows may exist", () => {
    expect(wasTruncated(1000, 1000)).toBe(true);
  });

  it("does not flag a partial page", () => {
    expect(wasTruncated(37, 1000)).toBe(false);
  });

  it("does not flag an empty result", () => {
    expect(wasTruncated(0, 1000)).toBe(false);
  });

  it("flags an over-full page defensively", () => {
    expect(wasTruncated(1001, 1000)).toBe(true);
  });
});

describe("startOfAccountDayUtc", () => {
  it("starts an Indian day at 18:30 UTC the previous evening", () => {
    // 2026-10-03 12:00 IST -> the IST day began 2026-10-02T18:30:00Z.
    const iso = startOfAccountDayUtc("Asia/Kolkata", new Date("2026-10-03T06:30:00Z"));
    expect(iso).toBe("2026-10-02T18:30:00.000Z");
  });

  it("rolls to the next day once IST passes midnight", () => {
    // 2026-10-03T19:30Z is 2026-10-04 01:00 IST, so the day began 18:30Z.
    const iso = startOfAccountDayUtc("Asia/Kolkata", new Date("2026-10-03T19:30:00Z"));
    expect(iso).toBe("2026-10-03T18:30:00.000Z");
  });

  it("handles a UTC account with no offset", () => {
    const iso = startOfAccountDayUtc("UTC", new Date("2026-10-03T06:30:00Z"));
    expect(iso).toBe("2026-10-03T00:00:00.000Z");
  });

  it("handles a zone behind UTC", () => {
    // 2026-10-03T02:00Z is 2026-10-02 22:00 in New York (EDT, -4).
    const iso = startOfAccountDayUtc("America/New_York", new Date("2026-10-03T02:00:00Z"));
    expect(iso).toBe("2026-10-02T04:00:00.000Z");
  });

  it("uses the offset in force on that date, not a fixed one", () => {
    // New York is -5 in January and -4 in July. A fixed offset would put one
    // of these an hour out and mis-bucket a whole day of calls.
    const winter = startOfAccountDayUtc("America/New_York", new Date("2026-01-15T12:00:00Z"));
    const summer = startOfAccountDayUtc("America/New_York", new Date("2026-07-15T12:00:00Z"));
    expect(winter).toBe("2026-01-15T05:00:00.000Z");
    expect(summer).toBe("2026-07-15T04:00:00.000Z");
  });

  it("always lands before the given instant", () => {
    for (const zone of ["Asia/Kolkata", "UTC", "America/New_York", "Australia/Sydney"]) {
      for (const iso of [
        "2026-10-03T00:30:00Z",
        "2026-10-03T12:00:00Z",
        "2026-10-03T23:45:00Z",
      ]) {
        const now = new Date(iso);
        const start = new Date(startOfAccountDayUtc(zone, now));
        expect(start.getTime(), `${zone} @ ${iso}`).toBeLessThanOrEqual(now.getTime());
        // …and never more than 24h before it.
        expect(now.getTime() - start.getTime()).toBeLessThan(25 * 3600_000);
      }
    }
  });
});

describe("budget constant", () => {
  it("is a generous but finite daily ceiling", () => {
    expect(MCP_DAILY_CALL_BUDGET).toBeGreaterThan(100);
    expect(Number.isFinite(MCP_DAILY_CALL_BUDGET)).toBe(true);
  });
});
