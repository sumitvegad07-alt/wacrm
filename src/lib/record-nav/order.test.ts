import { describe, expect, test } from "vitest";

import { neighbours } from "./order";

/**
 * The rule ‹ › follows. Pure, so it is tested without a browser — which is
 * also why the arithmetic lives in `neighbours` and not inside the component.
 */
describe("neighbours", () => {
  const list = ["a", "b", "c", "d"];

  test("a record in the middle has one on either side", () => {
    expect(neighbours(list, "b")).toEqual({
      prevId: "a",
      nextId: "c",
      position: 2,
      total: 4,
    });
  });

  test("the first record has nothing before it", () => {
    expect(neighbours(list, "a")).toEqual({
      prevId: null,
      nextId: "b",
      position: 1,
      total: 4,
    });
  });

  test("the last record has nothing after it — Next does not wrap round", () => {
    // Wrapping would send someone who has worked to the bottom of the list
    // straight back to the top, with no sign that they had finished.
    expect(neighbours(list, "d")).toEqual({
      prevId: "c",
      nextId: null,
      position: 4,
      total: 4,
    });
  });

  test("the only record in a list has no neighbours", () => {
    expect(neighbours(["a"], "a")).toEqual({
      prevId: null,
      nextId: null,
      position: 1,
      total: 1,
    });
  });

  test("a record opened from somewhere other than its list gets no arrows", () => {
    // From a link in an email, a dashboard tile, a search result. Offering
    // "next" would walk them into a list they never chose.
    expect(neighbours(list, "zz")).toEqual({
      prevId: null,
      nextId: null,
      position: 0,
      total: 4,
    });
  });

  test("no remembered order means no arrows", () => {
    expect(neighbours([], "a")).toEqual({
      prevId: null,
      nextId: null,
      position: 0,
      total: 0,
    });
  });

  test("no id means no arrows", () => {
    expect(neighbours(list, null)).toEqual({
      prevId: null,
      nextId: null,
      position: 0,
      total: 4,
    });
  });
});
