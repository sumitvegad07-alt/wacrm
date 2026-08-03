import { describe, it, expect } from "vitest";
import { tallyStops } from "./execution-ops";

describe("tallyStops", () => {
  it("tallies completed / skipped / pending per execution", () => {
    const m = tallyStops([
      { execution_id: "e1", status: "completed" },
      { execution_id: "e1", status: "completed" },
      { execution_id: "e1", status: "skipped" },
      { execution_id: "e1", status: "pending" },
      { execution_id: "e2", status: "completed" },
    ]);
    expect(m.get("e1")).toEqual({ total: 4, completed: 2, skipped: 1, pending: 1 });
    expect(m.get("e2")).toEqual({ total: 1, completed: 1, skipped: 0, pending: 0 });
  });

  it("treats unknown statuses as pending (defensive)", () => {
    const m = tallyStops([{ execution_id: "e", status: "weird" }]);
    expect(m.get("e")).toEqual({ total: 1, completed: 0, skipped: 0, pending: 1 });
  });

  it("returns an empty map for no stops", () => {
    expect(tallyStops([]).size).toBe(0);
  });
});
