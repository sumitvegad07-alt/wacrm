import { describe, expect, test } from "vitest";
import {
  assigneeLabel,
  myStatus,
  progressLabel,
  rollupStatus,
  type TaskAssignee,
} from "./assignees";

let seq = 0;
const a = (profile_id: string, status: "Pending" | "Completed" = "Pending"): TaskAssignee => ({
  id: `a${seq++}`,
  task_id: "t1",
  profile_id,
  status,
  completed_at: status === "Completed" ? "2026-10-26T00:00:00.000Z" : null,
  created_at: `2026-10-2${seq}T00:00:00.000Z`,
});

describe("rollupStatus", () => {
  test("everyone done completes the task", () => {
    expect(rollupStatus([a("p1", "Completed"), a("p2", "Completed")], "Pending")).toBe("Completed");
  });

  // The founder's explicit choice: one person finishing does not finish it.
  test("one of three done leaves it open", () => {
    expect(rollupStatus([a("p1", "Completed"), a("p2"), a("p3")], "Pending")).toBe("Pending");
  });

  test("adding a person to a finished task reopens it", () => {
    expect(rollupStatus([a("p1", "Completed"), a("p2")], "Completed")).toBe("Pending");
  });

  test("an in-between status the user set by hand is left alone", () => {
    expect(rollupStatus([a("p1"), a("p2")], "In Progress")).toBe("In Progress");
  });

  // A cancelled task is not a finished one, and must never be resurrected by
  // someone being added to it.
  test("a cancelled task stays cancelled", () => {
    expect(rollupStatus([a("p1"), a("p2")], "Cancelled")).toBe("Cancelled");
  });

  // Nobody to roll up from, so nothing is asserted about the task.
  test("no assignees leaves the status exactly as it was", () => {
    expect(rollupStatus([], "In Progress")).toBe("In Progress");
    expect(rollupStatus([], "Completed")).toBe("Completed");
  });
});

describe("myStatus", () => {
  test("gives your own row's status", () => {
    const rows = [a("p1", "Completed"), a("p2")];
    expect(myStatus(rows, "p1")).toBe("Completed");
    expect(myStatus(rows, "p2")).toBe("Pending");
  });

  test("null when you are not on the task", () => {
    expect(myStatus([a("p1")], "p9")).toBeNull();
    expect(myStatus([a("p1")], null)).toBeNull();
  });
});

describe("progressLabel", () => {
  test("counts the done ones when there are several people", () => {
    expect(progressLabel([a("p1", "Completed"), a("p2"), a("p3")])).toBe("1 of 3 done");
  });

  // A single-assignee task is the normal case and gains nothing from "0 of 1".
  test("stays quiet for one person or none", () => {
    expect(progressLabel([a("p1")])).toBeNull();
    expect(progressLabel([])).toBeNull();
  });
});

describe("assigneeLabel", () => {
  test("one name on its own", () => {
    expect(assigneeLabel(["Priya"])).toBe("Priya");
  });

  test("the first name carries the rest as a count", () => {
    expect(assigneeLabel(["Priya", "Rahul", "Sana"])).toBe("Priya +2");
  });

  test("nobody assigned says so", () => {
    expect(assigneeLabel([])).toBe("Unassigned");
  });
});
