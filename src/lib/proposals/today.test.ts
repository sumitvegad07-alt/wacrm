import { describe, expect, test } from "vitest";
import { todayInIndia } from "./today";

describe("todayInIndia", () => {
  test("returns an ISO date string", () => {
    expect(todayInIndia(new Date("2026-09-26T09:00:00Z"))).toBe("2026-09-26");
  });

  test("uses the Indian day, not the server's UTC day", () => {
    // 19:00 UTC is already 00:30 the next day in IST. A Vercel server running
    // in UTC would otherwise date a late-evening proposal to yesterday.
    expect(todayInIndia(new Date("2026-09-25T19:00:00Z"))).toBe("2026-09-26");
  });

  test("does not roll forward early in the Indian day", () => {
    // 20:00 UTC on the 25th is 01:30 IST on the 26th; 18:00 is 23:30 on the 25th.
    expect(todayInIndia(new Date("2026-09-25T18:00:00Z"))).toBe("2026-09-25");
  });

  test("zero-pads month and day", () => {
    expect(todayInIndia(new Date("2026-01-04T06:00:00Z"))).toBe("2026-01-04");
  });
});
