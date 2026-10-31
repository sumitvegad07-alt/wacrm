import { describe, expect, test } from "vitest";
import { candidateIds, unseenIds, NEW_FOR_DAYS, type RecordRow } from "./unseen";

// ---------------------------------------------------------------------------
// The highlight is a claim made to the user: "this one arrived and you have not
// read it". The ways it can lie are all here — marking a row the viewer has
// opened, marking a row that was already on screen the first time they looked,
// marking an ancient row nobody will ever open, or marking a row whose age
// cannot actually be established.
//
// The baseline cases are not hypothetical. Without one, a real 201-row Leads
// list highlighted all 201, which looks exactly like highlighting none.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-31T12:00:00.000Z");
/** The viewer first opened this list a week ago. */
const BASELINE = new Date("2026-10-24T12:00:00.000Z").toISOString();

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function row(id: string, createdAt: string | null | undefined): RecordRow {
  return { id, createdAt };
}

const opts = { now: NOW, baselineAt: BASELINE };

describe("candidateIds", () => {
  test("keeps rows created after the viewer started looking", () => {
    const rows = [row("a", daysAgo(0)), row("b", daysAgo(1)), row("c", daysAgo(6))];

    expect(candidateIds(rows, opts)).toEqual(["a", "b", "c"]);
  });

  test("drops everything that was already there when they first looked", () => {
    const rows = [row("after", daysAgo(1)), row("before", daysAgo(8))];

    expect(candidateIds(rows, opts)).toEqual(["after"]);
  });

  test("drops a record created at the very instant of the baseline", () => {
    // It was on the screen they were looking at. Strictly after, or not at all.
    expect(candidateIds([row("same", BASELINE)], opts)).toEqual([]);
  });

  test("highlights nothing at all until the baseline is known", () => {
    const rows = [row("a", daysAgo(0)), row("b", daysAgo(1))];

    expect(candidateIds(rows, { now: NOW, baselineAt: null })).toEqual([]);
    expect(candidateIds(rows, { now: NOW })).toEqual([]);
    expect(candidateIds(rows, { now: NOW, baselineAt: "not a date" })).toEqual([]);
  });

  test("still drops rows older than the window, even after an old baseline", () => {
    const old = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const rows = [row("fresh", daysAgo(2)), row("stale", daysAgo(NEW_FOR_DAYS + 1))];

    expect(candidateIds(rows, { now: NOW, baselineAt: old })).toEqual(["fresh"]);
  });

  test("drops a row whose age cannot be established, rather than calling it new", () => {
    const rows = [
      row("ok", daysAgo(1)),
      row("null", null),
      row("undefined", undefined),
      row("garbage", "not a date"),
      row("empty", ""),
    ];

    expect(candidateIds(rows, opts)).toEqual(["ok"]);
  });

  test("drops a row with no id — nothing could be keyed to it", () => {
    expect(candidateIds([row("", daysAgo(1))], opts)).toEqual([]);
  });

  test("asks about nothing when every row predates the baseline, so no query is needed", () => {
    const rows = [row("a", daysAgo(20)), row("b", daysAgo(400))];

    expect(candidateIds(rows, opts)).toEqual([]);
  });
});

describe("unseenIds", () => {
  const rows = [row("a", daysAgo(1)), row("b", daysAgo(2)), row("c", daysAgo(3))];

  test("highlights the rows this viewer has not opened", () => {
    const unseen = unseenIds(rows, new Set(["b"]), opts);

    expect([...unseen].sort()).toEqual(["a", "c"]);
  });

  test("highlights nothing once every row on screen has been opened", () => {
    expect(unseenIds(rows, new Set(["a", "b", "c"]), opts).size).toBe(0);
  });

  test("never highlights a row older than the window, opened or not", () => {
    const old = [row("ancient", daysAgo(NEW_FOR_DAYS + 5))];

    expect(unseenIds(old, new Set(), opts).size).toBe(0);
  });

  test("ignores opened ids that are not on this page", () => {
    const unseen = unseenIds(rows, new Set(["x", "y", "z"]), opts);

    expect([...unseen].sort()).toEqual(["a", "b", "c"]);
  });

  test("is not fooled by a row created a moment in the future", () => {
    // Clock skew between the database and the browser is real, and a row
    // stamped slightly ahead of now is the newest thing there is, not the
    // oldest.
    const ahead = [row("skewed", new Date(NOW.getTime() + 5_000).toISOString())];

    expect([...unseenIds(ahead, new Set(), opts)]).toEqual(["skewed"]);
  });

  test("the day it is switched on, a full list of old records lights up nothing", () => {
    // The exact regression this was written for: 201 leads, all inside the
    // thirty-day window, none ever opened, and the viewer's baseline set the
    // moment they first loaded the screen.
    const justStarted = { now: NOW, baselineAt: NOW.toISOString() };
    const list = Array.from({ length: 201 }, (_, i) => row(`lead-${i}`, daysAgo(1 + (i % 25))));

    expect(unseenIds(list, new Set(), justStarted).size).toBe(0);
  });

  test("…and the next record created does light up, on its own", () => {
    const justStarted = { now: NOW, baselineAt: daysAgo(1) };
    const list = [
      row("brand-new", new Date(NOW.getTime() - 60_000).toISOString()),
      ...Array.from({ length: 200 }, (_, i) => row(`old-${i}`, daysAgo(2 + (i % 25)))),
    ];

    expect([...unseenIds(list, new Set(), justStarted)]).toEqual(["brand-new"]);
  });
});
