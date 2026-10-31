import { describe, expect, test } from "vitest";
import { candidateIds, unseenIds, NEW_FOR_DAYS, type RecordRow } from "./unseen";

// ---------------------------------------------------------------------------
// The highlight is a claim made to the user: "you have not read this one". The
// ways it can lie are all here — marking a row the viewer has opened, marking
// an ancient row nobody will ever open, or marking a row whose age we cannot
// actually establish.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-31T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function row(id: string, createdAt: string | null | undefined): RecordRow {
  return { id, createdAt };
}

describe("candidateIds", () => {
  test("keeps rows created inside the window", () => {
    const rows = [row("a", daysAgo(0)), row("b", daysAgo(1)), row("c", daysAgo(29))];

    expect(candidateIds(rows, NOW)).toEqual(["a", "b", "c"]);
  });

  test("drops rows older than the window", () => {
    const rows = [row("fresh", daysAgo(2)), row("stale", daysAgo(NEW_FOR_DAYS + 1))];

    expect(candidateIds(rows, NOW)).toEqual(["fresh"]);
  });

  test("drops a row whose age cannot be established, rather than calling it new", () => {
    const rows = [
      row("ok", daysAgo(1)),
      row("null", null),
      row("undefined", undefined),
      row("garbage", "not a date"),
      row("empty", ""),
    ];

    expect(candidateIds(rows, NOW)).toEqual(["ok"]);
  });

  test("drops a row with no id — nothing could be keyed to it", () => {
    expect(candidateIds([row("", daysAgo(1))], NOW)).toEqual([]);
  });

  test("asks about nothing when every row is old, so no query is needed", () => {
    const rows = [row("a", daysAgo(60)), row("b", daysAgo(400))];

    expect(candidateIds(rows, NOW)).toEqual([]);
  });
});

describe("unseenIds", () => {
  const rows = [row("a", daysAgo(1)), row("b", daysAgo(2)), row("c", daysAgo(3))];

  test("highlights the rows this viewer has not opened", () => {
    const unseen = unseenIds(rows, new Set(["b"]), NOW);

    expect([...unseen].sort()).toEqual(["a", "c"]);
  });

  test("highlights nothing once every row on screen has been opened", () => {
    expect(unseenIds(rows, new Set(["a", "b", "c"]), NOW).size).toBe(0);
  });

  test("never highlights a row older than the window, opened or not", () => {
    const old = [row("ancient", daysAgo(NEW_FOR_DAYS + 5))];

    expect(unseenIds(old, new Set(), NOW).size).toBe(0);
  });

  test("ignores opened ids that are not on this page", () => {
    const unseen = unseenIds(rows, new Set(["x", "y", "z"]), NOW);

    expect([...unseen].sort()).toEqual(["a", "b", "c"]);
  });

  test("is not fooled by a row created a moment in the future", () => {
    // Clock skew between the database and the browser is real, and a row
    // stamped slightly ahead of now is the newest thing there is, not the
    // oldest. `created >= cutoff` has to hold for it.
    const ahead = [row("skewed", new Date(NOW.getTime() + 5_000).toISOString())];

    expect([...unseenIds(ahead, new Set(), NOW)]).toEqual(["skewed"]);
  });
});
