import { describe, expect, test } from "vitest";
import { bucketOf, bucketSummary, daysUntil, inBucket } from "./buckets";
import type { SubscriptionRow } from "./types";

// ---------------------------------------------------------------------------
// This is the module the whole screen rests on: if "today" is off by one, the
// founder opens the screen and is told nobody is due. Every test here passes
// `today` explicitly, which is also how the server calls it — so the result can
// never depend on the machine's own clock or timezone.
// ---------------------------------------------------------------------------

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "s1", customer_id: "001001", company_name: "Shree Narmada Masala",
    plan: "CRM_SFA", billing_term: "yearly", users: 5, amount: 24000,
    start_date: "2025-10-20", end_date: "2026-10-20", salesman_name: "Ravi",
    contact_person: "", phone: "", status: "active", remarks: "",
    follow_up_date: null, created_at: "", updated_at: "",
    ...overrides,
  };
}

const TODAY = "2026-10-20";

describe("daysUntil", () => {
  test("today is zero", () => {
    expect(daysUntil("2026-10-20", TODAY)).toBe(0);
  });

  test("tomorrow is one, yesterday is minus one", () => {
    expect(daysUntil("2026-10-21", TODAY)).toBe(1);
    expect(daysUntil("2026-10-19", TODAY)).toBe(-1);
  });

  test("it counts across a month end", () => {
    expect(daysUntil("2026-11-01", TODAY)).toBe(12);
  });

  test("it counts across a year end", () => {
    expect(daysUntil("2027-01-01", "2026-12-25")).toBe(7);
  });

  test("it counts across a leap day", () => {
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
  });

  test("a blank or malformed date is null, never a number", () => {
    expect(daysUntil("", TODAY)).toBeNull();
    expect(daysUntil("not-a-date", TODAY)).toBeNull();
  });
});

describe("bucketOf", () => {
  test("an end date of today is due today", () => {
    expect(bucketOf(row({ end_date: TODAY }), TODAY)).toBe("today");
  });

  test("a past end date is overdue", () => {
    expect(bucketOf(row({ end_date: "2026-10-19" }), TODAY)).toBe("overdue");
    expect(bucketOf(row({ end_date: "2025-01-01" }), TODAY)).toBe("overdue");
  });

  test("tomorrow through seven days out is next_7", () => {
    expect(bucketOf(row({ end_date: "2026-10-21" }), TODAY)).toBe("next_7");
    expect(bucketOf(row({ end_date: "2026-10-27" }), TODAY)).toBe("next_7");
  });

  test("eight through thirty days out is next_30", () => {
    expect(bucketOf(row({ end_date: "2026-10-28" }), TODAY)).toBe("next_30");
    expect(bucketOf(row({ end_date: "2026-11-19" }), TODAY)).toBe("next_30");
  });

  test("further out than thirty days is in no due bucket", () => {
    expect(bucketOf(row({ end_date: "2026-12-31" }), TODAY)).toBeNull();
  });

  test("a lost customer is in no due bucket, however their date reads", () => {
    // They are not coming back; putting them in today's list is noise in the
    // one place that has to be actionable. They stay visible under All.
    expect(bucketOf(row({ end_date: TODAY, status: "lost" }), TODAY)).toBeNull();
    expect(bucketOf(row({ end_date: "2025-01-01", status: "lost" }), TODAY)).toBeNull();
  });

  test("an on-hold or in-discussion customer is still due", () => {
    expect(bucketOf(row({ end_date: TODAY, status: "on_hold" }), TODAY)).toBe("today");
    expect(bucketOf(row({ end_date: TODAY, status: "in_discussion" }), TODAY)).toBe("today");
  });
});

describe("inBucket", () => {
  test("the next_7 tab includes today and the overdue", () => {
    // The tab answers "what needs chasing this week", so it cannot hide
    // something that was already due on Monday.
    expect(inBucket(row({ end_date: TODAY }), "next_7", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-10-19" }), "next_7", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-10-27" }), "next_7", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-10-28" }), "next_7", TODAY)).toBe(false);
  });

  test("the next_30 tab includes everything up to thirty days out", () => {
    expect(inBucket(row({ end_date: "2026-11-19" }), "next_30", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-11-20" }), "next_30", TODAY)).toBe(false);
  });

  test("the today tab is only today", () => {
    expect(inBucket(row({ end_date: TODAY }), "today", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: "2026-10-19" }), "today", TODAY)).toBe(false);
  });

  test("the overdue tab is only the past", () => {
    expect(inBucket(row({ end_date: "2026-10-19" }), "overdue", TODAY)).toBe(true);
    expect(inBucket(row({ end_date: TODAY }), "overdue", TODAY)).toBe(false);
  });

  test("the all tab holds everything, lost customers included", () => {
    expect(inBucket(row({ end_date: "2030-01-01" }), "all", TODAY)).toBe(true);
    expect(inBucket(row({ status: "lost" }), "all", TODAY)).toBe(true);
  });
});

describe("bucketSummary", () => {
  const rows = [
    row({ id: "a", end_date: TODAY, amount: 24000 }),
    row({ id: "b", end_date: "2026-10-19", amount: 10000 }),
    row({ id: "c", end_date: "2026-10-25", amount: 5000 }),
    row({ id: "d", end_date: "2026-10-31", amount: 7000 }),
    row({ id: "e", end_date: TODAY, amount: 99999, status: "lost" }),
  ];

  test("counts and rupee values per bucket", () => {
    const s = bucketSummary(rows, TODAY);
    expect(s.today).toEqual({ count: 1, amount: 24000 });
    expect(s.overdue).toEqual({ count: 1, amount: 10000 });
  });

  test("the week and month tiles are cumulative, like the tabs", () => {
    const s = bucketSummary(rows, TODAY);
    // overdue + today + within 7 days: b, a, c
    expect(s.next_7).toEqual({ count: 3, amount: 39000 });
    // plus d, inside 30 days
    expect(s.next_30).toEqual({ count: 4, amount: 46000 });
  });

  test("a lost customer is counted nowhere but All", () => {
    const s = bucketSummary(rows, TODAY);
    expect(s.all.count).toBe(5);
    expect(s.today.amount).toBe(24000); // not 123,999
  });

  test("no rows is zeroes, not NaN", () => {
    const s = bucketSummary([], TODAY);
    expect(s.today).toEqual({ count: 0, amount: 0 });
    expect(s.all).toEqual({ count: 0, amount: 0 });
  });
});

describe("the IST day boundary", () => {
  // The bug this guards: Vercel runs in UTC, so at 23:40 IST the UTC date is
  // still yesterday. A screen that asks "who is due today" from the server
  // clock would answer with yesterday's list for the last 5½ hours of every
  // day — and with tomorrow's for the first 5½ hours if read the other way.
  test("late evening IST still reads today's date, not yesterday's", () => {
    // 2026-10-20 23:40 IST == 2026-10-20 18:10 UTC
    const lateEvening = new Date("2026-10-20T18:10:00Z");
    expect(daysUntil("2026-10-20", undefined, lateEvening)).toBe(0);
  });

  test("just after midnight IST reads the new date, not the old one", () => {
    // 2026-10-21 00:10 IST == 2026-10-20 18:40 UTC
    const justAfterMidnight = new Date("2026-10-20T18:40:00Z");
    expect(daysUntil("2026-10-21", undefined, justAfterMidnight)).toBe(0);
    expect(daysUntil("2026-10-20", undefined, justAfterMidnight)).toBe(-1);
  });
});
