import { describe, it, expect } from "vitest";
import { plannerCellKey, applyOptimisticMove, type PlannerSlot } from "./planner-ops";
import { routeKeys } from "@/hooks/route/query-keys";

interface Row extends PlannerSlot {
  id: string;
  route_id: string;
}
const seed = (): Row[] => [
  { id: "1", assignee_id: "a", day_of_week: 1, route_id: "r1" },
  { id: "2", assignee_id: "a", day_of_week: 2, route_id: "r2" },
  { id: "3", assignee_id: "b", day_of_week: 1, route_id: "r3" },
];

describe("plannerCellKey", () => {
  it("formats assignee:dow", () => {
    expect(plannerCellKey("a", 1)).toBe("a:1");
  });
});

describe("applyOptimisticMove", () => {
  it("moves into an empty cell and empties the source", () => {
    const out = applyOptimisticMove(seed(), { assigneeId: "a", dayOfWeek: 1 }, { assigneeId: "a", dayOfWeek: 3 });
    expect(out.find((r) => r.assignee_id === "a" && r.day_of_week === 1)).toBeUndefined();
    const moved = out.find((r) => r.assignee_id === "a" && r.day_of_week === 3);
    expect(moved?.route_id).toBe("r1");
    expect(out).toHaveLength(3);
  });

  it("overwrites the target cell (mirrors the atomic move RPC)", () => {
    const out = applyOptimisticMove(seed(), { assigneeId: "a", dayOfWeek: 1 }, { assigneeId: "b", dayOfWeek: 1 });
    // b:1 now holds r1 (moved); the previous r3 at b:1 is gone; a:1 emptied.
    const target = out.find((r) => r.assignee_id === "b" && r.day_of_week === 1);
    expect(target?.route_id).toBe("r1");
    expect(out.some((r) => r.route_id === "r3")).toBe(false);
    expect(out).toHaveLength(2);
  });

  it("leaves unrelated cells untouched", () => {
    const out = applyOptimisticMove(seed(), { assigneeId: "a", dayOfWeek: 1 }, { assigneeId: "a", dayOfWeek: 3 });
    expect(out.find((r) => r.id === "2")).toEqual({ id: "2", assignee_id: "a", day_of_week: 2, route_id: "r2" });
    expect(out.find((r) => r.id === "3")).toEqual({ id: "3", assignee_id: "b", day_of_week: 1, route_id: "r3" });
  });
});

describe("planner query keys", () => {
  it("plannerAll is the invalidation prefix of planner(accountId, sig)", () => {
    expect(routeKeys.plannerAll()).toEqual(["routes", "planner"]);
    expect(routeKeys.planner("acc", "x,y")).toEqual(["routes", "planner", "acc", "x,y"]);
    expect(routeKeys.planner("acc")).toEqual(["routes", "planner", "acc", "all"]);
  });
});
