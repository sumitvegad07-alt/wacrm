import { describe, expect, test } from "vitest";
import { MIN_DECIDED_FOR_WIN_RATE, summarise, type ForecastRow } from "./forecast";

// Every figure on the dashboard is money the founder will plan around, so the
// arithmetic is pinned here rather than trusted to the chart.

const NOW = new Date("2026-09-26T10:00:00+05:30");

function row(over: Partial<ForecastRow> = {}): ForecastRow {
  return {
    id: Math.random().toString(36).slice(2),
    status: "sent",
    grand_total: 21600,
    users_total: 6,
    proposal_date: "2026-09-01",
    decided_at: null,
    ...over,
  };
}

describe("summarise", () => {
  test("counts a proposal won this month as this month's business", () => {
    const s = summarise([row({ status: "won", decided_at: "2026-09-20T10:00:00Z", grand_total: 21600 })], NOW);

    expect(s.wonThisMonth.count).toBe(1);
    expect(s.wonThisMonth.value).toBe(21600);
  });

  test("uses the month it was decided, not the month it was written", () => {
    // Written in June, marked won in September: September's business.
    const s = summarise(
      [row({ status: "won", proposal_date: "2026-06-02", decided_at: "2026-09-20T10:00:00Z" })],
      NOW,
    );

    expect(s.wonThisMonth.count).toBe(1);
  });

  test("reads the decided month in Indian time, not UTC", () => {
    // 2026-08-31 19:00 UTC is 2026-09-01 00:30 IST — September's business.
    const s = summarise([row({ status: "won", decided_at: "2026-08-31T19:00:00Z" })], NOW);

    expect(s.wonThisMonth.count).toBe(1);
  });

  test("does not count a deal won in an earlier month", () => {
    const s = summarise([row({ status: "won", decided_at: "2026-08-10T10:00:00Z" })], NOW);

    expect(s.wonThisMonth.count).toBe(0);
    expect(s.wonThisMonth.value).toBe(0);
  });

  describe("pipeline", () => {
    test("counts only sent proposals", () => {
      const s = summarise(
        [
          row({ status: "sent", grand_total: 10000 }),
          row({ status: "draft", grand_total: 50000 }),
          row({ status: "won", decided_at: "2026-09-02T10:00:00Z", grand_total: 70000 }),
          row({ status: "lost", decided_at: "2026-09-03T10:00:00Z", grand_total: 90000 }),
        ],
        NOW,
      );

      expect(s.pipeline.count).toBe(1);
      expect(s.pipeline.value).toBe(10000);
    });

    test("a draft is not business, however large", () => {
      const s = summarise([row({ status: "draft", grand_total: 999999 })], NOW);

      expect(s.pipeline.value).toBe(0);
    });
  });

  describe("win rate", () => {
    test("is won over decided, ignoring anything still open", () => {
      const decided = [
        ...Array.from({ length: 3 }, () => row({ status: "won", decided_at: "2026-09-02T10:00:00Z" })),
        ...Array.from({ length: 1 }, () => row({ status: "lost", decided_at: "2026-09-02T10:00:00Z" })),
        ...Array.from({ length: 2 }, () => row({ status: "won", decided_at: "2026-07-02T10:00:00Z" })),
      ];

      const s = summarise([...decided, row({ status: "sent" })], NOW);

      expect(s.decidedCount).toBe(6);
      expect(s.winRate).toBeCloseTo(5 / 6, 5);
    });

    test("is withheld until enough proposals have been decided", () => {
      // Three decided proposals cannot produce a meaningful rate; showing one
      // would be false precision on a page used to plan money.
      const s = summarise(
        [
          row({ status: "won", decided_at: "2026-09-02T10:00:00Z" }),
          row({ status: "won", decided_at: "2026-09-03T10:00:00Z" }),
          row({ status: "lost", decided_at: "2026-09-04T10:00:00Z" }),
          row({ status: "sent" }),
        ],
        NOW,
      );

      expect(s.decidedCount).toBe(3);
      expect(s.hasEnoughHistory).toBe(false);
      expect(s.winRate).toBeNull();
      expect(s.weightedPipeline).toBeNull();
    });

    test("weights the pipeline once there is enough history", () => {
      const decided = [
        ...Array.from({ length: 3 }, () => row({ status: "won", decided_at: "2026-09-02T10:00:00Z" })),
        ...Array.from({ length: 2 }, () => row({ status: "lost", decided_at: "2026-09-02T10:00:00Z" })),
      ];

      const s = summarise([...decided, row({ status: "sent", grand_total: 100000 })], NOW);

      expect(s.decidedCount).toBe(MIN_DECIDED_FOR_WIN_RATE);
      expect(s.hasEnoughHistory).toBe(true);
      expect(s.winRate).toBeCloseTo(0.6, 5);
      expect(s.weightedPipeline).toBe(60000);
    });
  });

  describe("renewals", () => {
    test("projects a won deal to the same month next year", () => {
      const s = summarise([row({ status: "won", decided_at: "2026-09-20T10:00:00Z", grand_total: 21600 })], NOW);
      const sept = s.renewals.find((r) => r.month === "2027-09");

      expect(sept?.value).toBe(21600);
      expect(sept?.count).toBe(1);
    });

    test("covers the next twelve months", () => {
      const s = summarise([], NOW);

      expect(s.renewals).toHaveLength(12);
      expect(s.renewals[0].month).toBe("2026-10");
      expect(s.renewals[11].month).toBe("2027-09");
    });

    test("adds up several deals renewing in the same month", () => {
      const s = summarise(
        [
          row({ status: "won", decided_at: "2026-11-05T10:00:00Z", grand_total: 10000 }),
          row({ status: "won", decided_at: "2026-11-25T10:00:00Z", grand_total: 5000 }),
        ],
        NOW,
      );
      const nov = s.renewals.find((r) => r.month === "2027-11");

      expect(nov).toBeUndefined(); // beyond the 12-month window
      expect(s.renewals.find((r) => r.month === "2027-09")?.value).toBe(0);
    });

    test("ignores lost deals", () => {
      const s = summarise([row({ status: "lost", decided_at: "2026-09-20T10:00:00Z" })], NOW);

      expect(s.renewals.every((r) => r.value === 0)).toBe(true);
    });

    test("totals the renewal value in the window", () => {
      const s = summarise(
        [
          row({ status: "won", decided_at: "2025-12-10T10:00:00Z", grand_total: 30000 }),
          row({ status: "won", decided_at: "2026-09-20T10:00:00Z", grand_total: 21600 }),
        ],
        NOW,
      );

      // The 2025 deal renews 2026-12 (inside the window); the 2026 one renews 2027-09.
      expect(s.renewalTotal).toBe(51600);
    });
  });

  describe("monthly history", () => {
    test("returns the last twelve months ending with this one", () => {
      const s = summarise([], NOW);

      expect(s.monthly).toHaveLength(12);
      expect(s.monthly[11].month).toBe("2026-09");
      expect(s.monthly[0].month).toBe("2025-10");
    });

    test("buckets won value by decided month", () => {
      const s = summarise(
        [
          row({ status: "won", decided_at: "2026-09-02T10:00:00Z", grand_total: 21600 }),
          row({ status: "won", decided_at: "2026-08-02T10:00:00Z", grand_total: 10000 }),
          row({ status: "lost", decided_at: "2026-08-03T10:00:00Z", grand_total: 99999 }),
        ],
        NOW,
      );

      expect(s.monthly.find((m) => m.month === "2026-09")?.won).toBe(21600);
      expect(s.monthly.find((m) => m.month === "2026-08")?.won).toBe(10000);
      expect(s.monthly.find((m) => m.month === "2026-08")?.lost).toBe(99999);
    });
  });

  describe("averages", () => {
    test("averages deal size over won deals only", () => {
      const s = summarise(
        [
          row({ status: "won", decided_at: "2026-09-02T10:00:00Z", grand_total: 20000, users_total: 4 }),
          row({ status: "won", decided_at: "2026-08-02T10:00:00Z", grand_total: 10000, users_total: 6 }),
          row({ status: "sent", grand_total: 999999, users_total: 99 }),
        ],
        NOW,
      );

      expect(s.avgWonValue).toBe(15000);
      expect(s.avgWonUsers).toBe(5);
    });

    test("reports zero rather than NaN with nothing won", () => {
      const s = summarise([row({ status: "sent" })], NOW);

      expect(s.avgWonValue).toBe(0);
      expect(s.avgWonUsers).toBe(0);
      expect(s.wonTotal).toBe(0);
    });
  });

  test("handles an empty store", () => {
    const s = summarise([], NOW);

    expect(s.wonThisMonth).toEqual({ count: 0, value: 0 });
    expect(s.pipeline).toEqual({ count: 0, value: 0 });
    expect(s.winRate).toBeNull();
  });
});
