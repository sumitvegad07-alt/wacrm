import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomField } from "@/types";
import {
  applyArrayOverlapFilter,
  applyAssignedEmployeeFilter,
  applyExtraColumnFilters,
  applyRangeFilter,
  applyCustomFieldFilters,
  applyDateFilter,
  applyInFilter,
  applyInWithFallbackFilter,
  applyTextFilter,
  isEmptyFilterValue,
} from "./apply-filters";

type FakeQuery = { calls: string[] } & Record<string, (...args: never[]) => unknown>;

/** Records every condition instead of talking to PostgREST. */
function fakeQuery(): FakeQuery {
  const calls: string[] = [];
  const q: Record<string, unknown> = { calls };
  for (const op of ["ilike", "eq", "in", "gte", "lte"]) {
    q[op] = (column: string, value: unknown) => {
      calls.push(`${op}(${column}, ${JSON.stringify(value)})`);
      return q;
    };
  }
  q.filter = (column: string, operator: string, value: unknown) => {
    calls.push(`filter(${column}, ${operator}, ${JSON.stringify(value)})`);
    return q;
  };
  q.or = (expression: string) => {
    calls.push(`or(${expression})`);
    return q;
  };
  q.overlaps = (column: string, value: unknown) => {
    calls.push(`overlaps(${column}, ${JSON.stringify(value)})`);
    return q;
  };
  return q as unknown as FakeQuery;
}

const field = (id: string, type: string): CustomField =>
  ({ id, field_type: type, field_name: id, is_active: true }) as unknown as CustomField;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12));
});
afterEach(() => vi.useRealTimers());

describe("isEmptyFilterValue", () => {
  it("treats the UI's four empty shapes as no filter", () => {
    for (const v of [null, undefined, "", []]) expect(isEmptyFilterValue(v)).toBe(true);
    for (const v of ["a", 0, false, ["x"]]) expect(isEmptyFilterValue(v)).toBe(false);
  });
});

describe("applyTextFilter", () => {
  it("is a contains match, like the old .includes()", () => {
    const q = fakeQuery();
    applyTextFilter(q, "customer_name", "sharma");
    expect(q.calls).toEqual(["ilike(customer_name, \"%sharma%\")"]);
  });

  it("adds nothing when the filter is unset", () => {
    const q = fakeQuery();
    applyTextFilter(q, "customer_name", "");
    expect(q.calls).toEqual([]);
  });
});

describe("applyInFilter", () => {
  it("matches any of the selected options", () => {
    const q = fakeQuery();
    applyInFilter(q, "status", ["Closed", "Dispatched"]);
    expect(q.calls).toEqual(['in(status, ["Closed","Dispatched"])']);
  });

  it("accepts a bare value as a one-item list", () => {
    const q = fakeQuery();
    applyInFilter(q, "status", "Closed");
    expect(q.calls).toEqual(['in(status, ["Closed"])']);
  });
});

describe("applyDateFilter", () => {
  it("turns a preset into a bounded range", () => {
    const q = fakeQuery();
    applyDateFilter(q, "date", "today");
    expect(q.calls).toEqual(['gte(date, "2026-10-12")', 'lte(date, "2026-10-12")']);
  });

  it("leaves an open end unbounded", () => {
    const q = fakeQuery();
    applyDateFilter(q, "date", ["2026-03-02", ""]);
    expect(q.calls).toEqual(['gte(date, "2026-03-02")']);
  });

  it("adds nothing for an unknown preset, matching isDateInFilter's default", () => {
    const q = fakeQuery();
    applyDateFilter(q, "date", "something_new");
    expect(q.calls).toEqual([]);
  });
});

describe("applyCustomFieldFilters", () => {
  const fields = [field("aaa", "text"), field("bbb", "dropdown"), field("ccc", "date")];

  it("ignores everything that is not a cf_ filter", () => {
    const q = fakeQuery();
    applyCustomFieldFilters(q, { status: ["Closed"], customerName: "x" }, fields);
    expect(q.calls).toEqual([]);
  });

  it("contains-matches a text custom field", () => {
    const q = fakeQuery();
    applyCustomFieldFilters(q, { cf_aaa: "steel" }, fields);
    expect(q.calls).toEqual(['ilike(custom_values->>cf_aaa, "%steel%")']);
  });

  it("exact-matches a dropdown against the chosen options", () => {
    const q = fakeQuery();
    applyCustomFieldFilters(q, { cf_bbb: ["Red", "Blue"] }, fields);
    expect(q.calls).toEqual(['in(custom_values->>cf_bbb, ["Red","Blue"])']);
  });

  it("ranges a date custom field", () => {
    const q = fakeQuery();
    applyCustomFieldFilters(q, { cf_ccc: "today" }, fields);
    expect(q.calls).toEqual([
      "filter(custom_values->>cf_ccc, gte, \"2026-10-12\")",
      "filter(custom_values->>cf_ccc, lte, \"2026-10-12\")",
    ]);
  });

  it("ANDs two custom-field filters at once - the case an embedded join cannot express", () => {
    const q = fakeQuery();
    applyCustomFieldFilters(q, { cf_aaa: "steel", cf_bbb: ["Red"] }, fields);
    expect(q.calls).toEqual([
      'ilike(custom_values->>cf_aaa, "%steel%")',
      'in(custom_values->>cf_bbb, ["Red"])',
    ]);
  });

  it("falls back to a contains match for a field it has no definition for", () => {
    const q = fakeQuery();
    applyCustomFieldFilters(q, { cf_zzz: "x" }, []);
    expect(q.calls).toEqual(['ilike(custom_values->>cf_zzz, "%x%")']);
  });

  it("skips a cf filter that is set to empty", () => {
    const q = fakeQuery();
    applyCustomFieldFilters(q, { cf_aaa: "", cf_bbb: [] }, fields);
    expect(q.calls).toEqual([]);
  });
});


const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

// ============================================================
// Owner and Collaborator filters.
//
// `leads.owner_id` holds an AUTH user id, not a profiles.id, and falls back to
// `user_id` (the creator) when it is null — which is exactly what the Lead
// Owner column displays. A filter that only looked at owner_id would silently
// miss every lead whose owner was never set, which is most of them on an
// account that does not assign owners.
// ============================================================
describe("applyInWithFallbackFilter", () => {
  it("matches the column, or the fallback where the column is null", () => {
    const q = fakeQuery();
    applyInWithFallbackFilter(q, "owner_id", "user_id", [U1, U2]);
    expect(q.calls).toEqual([
      `or(owner_id.in.(${U1},${U2}),and(owner_id.is.null,user_id.in.(${U1},${U2})))`,
    ]);
  });

  it("accepts a single value as well as a list", () => {
    const q = fakeQuery();
    applyInWithFallbackFilter(q, "owner_id", "user_id", U1);
    expect(q.calls).toEqual([
      `or(owner_id.in.(${U1}),and(owner_id.is.null,user_id.in.(${U1})))`,
    ]);
  });

  it("adds nothing when no filter is set", () => {
    for (const empty of [null, undefined, "", []]) {
      const q = fakeQuery();
      applyInWithFallbackFilter(q, "owner_id", "user_id", empty);
      expect(q.calls).toEqual([]);
    }
  });

  it("drops values that could break out of the PostgREST expression", () => {
    // The ids are uuids. Anything carrying a comma, a bracket or a quote is
    // not one, and must never be pasted into an `or(...)` string.
    const q = fakeQuery();
    applyInWithFallbackFilter(q, "owner_id", "user_id", [U1, "a,b", "c)d", 'e"f', "g(h"]);
    expect(q.calls).toEqual([
      `or(owner_id.in.(${U1}),and(owner_id.is.null,user_id.in.(${U1})))`,
    ]);
  });

  it("adds nothing when every value was rejected", () => {
    const q = fakeQuery();
    applyInWithFallbackFilter(q, "owner_id", "user_id", ["a,b", "not-a-uuid"]);
    expect(q.calls).toEqual([]);
  });
});

describe("applyArrayOverlapFilter", () => {
  it("matches a row whose array column holds any of the chosen values", () => {
    const q = fakeQuery();
    applyArrayOverlapFilter(q, "collaborator_ids", [U1, U2]);
    expect(q.calls).toEqual([`overlaps(collaborator_ids, ${JSON.stringify([U1, U2])})`]);
  });

  it("adds nothing when no filter is set", () => {
    for (const empty of [null, undefined, "", []]) {
      const q = fakeQuery();
      applyArrayOverlapFilter(q, "collaborator_ids", empty);
      expect(q.calls).toEqual([]);
    }
  });
});

// ============================================================
// Range filters.
//
// Money columns had no filter at all, because a contains match on an amount
// misleads: searching 100 matches 1,100. A from/to pair is what they actually
// need, and it has to treat each end as optional — "over 10,000" is a filter
// with no upper bound.
// ============================================================
describe("applyRangeFilter", () => {
  it("applies both ends when both are given", () => {
    const q = fakeQuery();
    applyRangeFilter(q, "total_amount", ["100", "500"]);
    expect(q.calls).toEqual(['gte(total_amount, 100)', 'lte(total_amount, 500)']);
  });

  it("applies only the end that was filled in", () => {
    const lower = fakeQuery();
    applyRangeFilter(lower, "total_amount", ["100", ""]);
    expect(lower.calls).toEqual(['gte(total_amount, 100)']);

    const upper = fakeQuery();
    applyRangeFilter(upper, "total_amount", ["", "500"]);
    expect(upper.calls).toEqual(['lte(total_amount, 500)']);
  });

  it("adds nothing when neither end is filled in", () => {
    for (const empty of [null, undefined, "", [], ["", ""]]) {
      const q = fakeQuery();
      applyRangeFilter(q, "total_amount", empty);
      expect(q.calls).toEqual([]);
    }
  });

  it("ignores an end that is not a number, rather than sending NaN", () => {
    const q = fakeQuery();
    applyRangeFilter(q, "total_amount", ["abc", "500"]);
    expect(q.calls).toEqual(['lte(total_amount, 500)']);
  });

  it("accepts zero as a real bound", () => {
    const q = fakeQuery();
    applyRangeFilter(q, "total_amount", ["0", "0"]);
    expect(q.calls).toEqual(['gte(total_amount, 0)', 'lte(total_amount, 0)']);
  });
});

// ============================================================
// The generated columns have to reach the query too.
//
// extraColumns builds a column per stored field so Manage Column can offer it.
// Each one carries a filter, and a filter that never reaches the query is a
// control that visibly does nothing — the exact problem the filter row was
// built to expose.
// ============================================================
describe("applyExtraColumnFilters", () => {
  const specs = [
    ["notes", "Notes", "text"],
    ["total", "Total", "currency"],
    ["qty", "Qty", "number"],
    ["due", "Due", "date"],
    ["flag", "Flag", "boolean"],
  ] as const;

  it("applies each kind the way that kind is filtered", () => {
    const q = fakeQuery();
    applyExtraColumnFilters(q, { notes: "urgent", total: ["10", "20"], flag: ["true"] }, specs);
    expect(q.calls).toEqual([
      'ilike(notes, "%urgent%")',
      "gte(total, 10)",
      "lte(total, 20)",
      "eq(flag, true)",
    ]);
  });

  it("filters a number column by range, like money", () => {
    const q = fakeQuery();
    applyExtraColumnFilters(q, { qty: ["5", ""] }, specs);
    expect(q.calls).toEqual(["gte(qty, 5)"]);
  });

  it("ignores filters for columns it does not own", () => {
    const q = fakeQuery();
    applyExtraColumnFilters(q, { somethingElse: "x" }, specs);
    expect(q.calls).toEqual([]);
  });

  it("adds nothing when no filter is set", () => {
    const q = fakeQuery();
    applyExtraColumnFilters(q, { notes: "", total: [], due: null }, specs);
    expect(q.calls).toEqual([]);
  });

  it("skips a spec that reads its value from somewhere else", () => {
    // A reader means the value is not stored under that column name, so there
    // is nothing for the database to match on.
    const q = fakeQuery();
    applyExtraColumnFilters(q, { derived: "x" }, [
      ["derived", "Derived", "text", () => "x"],
    ] as const);
    expect(q.calls).toEqual([]);
  });
});

// ============================================================
// Assigned Employee on Customers.
//
// The column is a three-way fallback: the customer's own employee_id, else
// whoever covers its territory (walking up to the first assigned ancestor),
// else whoever created it. That is why it had no filter — one column
// comparison cannot express it. It can be expressed as a set of branches,
// once the territory tree has been resolved in the browser, which that screen
// already does to render the column at all.
// ============================================================
const P1 = "33333333-3333-4333-8333-333333333333";
const A1 = "44444444-4444-4444-8444-444444444444";
const T1 = "55555555-5555-4555-8555-555555555555";
const T2 = "66666666-6666-4666-8666-666666666666";

describe("applyAssignedEmployeeFilter", () => {
  const scope = { employeeIds: [P1], areaTerritoryIds: [T1], creatorIds: [A1] };

  it("matches the direct assignment, the area, and the creator fallback", () => {
    const q = fakeQuery();
    applyAssignedEmployeeFilter(q, [scope], [T1, T2]);
    expect(q.calls).toHaveLength(1);
    const clause = q.calls[0];
    expect(clause).toContain(`employee_id.in.(${P1})`);
    // Area only counts where no one was named directly.
    expect(clause).toContain(`and(employee_id.is.null,territory_id.in.(${T1}))`);
    // The creator only counts where nobody covers the territory at all.
    expect(clause).toContain(`territory_id.not.in.(${T1},${T2})`);
    expect(clause).toContain(`user_id.in.(${A1})`);
    // A customer with no territory is covered by nobody, so the creator wins.
    expect(clause).toContain("territory_id.is.null");
  });

  it("leaves out a branch it has no ids for", () => {
    const q = fakeQuery();
    applyAssignedEmployeeFilter(q, [{ employeeIds: [P1], areaTerritoryIds: [], creatorIds: [] }], []);
    const clause = q.calls[0];
    expect(clause).toBe(`or(employee_id.in.(${P1}))`);
  });

  it("drops the covered guard when nothing is covered", () => {
    const q = fakeQuery();
    applyAssignedEmployeeFilter(q, [{ employeeIds: [], areaTerritoryIds: [], creatorIds: [A1] }], []);
    expect(q.calls[0]).toBe(`or(and(employee_id.is.null,user_id.in.(${A1})))`);
  });

  it("adds nothing when no one is selected", () => {
    const q = fakeQuery();
    applyAssignedEmployeeFilter(q, [], [T1]);
    expect(q.calls).toEqual([]);
  });

  it("adds nothing when the selection resolves to no branches at all", () => {
    const q = fakeQuery();
    applyAssignedEmployeeFilter(q, [{ employeeIds: [], areaTerritoryIds: [], creatorIds: [] }], []);
    expect(q.calls).toEqual([]);
  });

  it("refuses ids that are not uuids, rather than pasting them into the expression", () => {
    const q = fakeQuery();
    applyAssignedEmployeeFilter(
      q,
      [{ employeeIds: ["a,b", P1], areaTerritoryIds: ["x)y"], creatorIds: [] }],
      ["z(z"],
    );
    expect(q.calls[0]).toBe(`or(employee_id.in.(${P1}))`);
  });

  it("ORs the branches of several people together", () => {
    const q = fakeQuery();
    applyAssignedEmployeeFilter(
      q,
      [
        { employeeIds: [P1], areaTerritoryIds: [], creatorIds: [] },
        { employeeIds: [A1], areaTerritoryIds: [], creatorIds: [] },
      ],
      [],
    );
    expect(q.calls[0]).toBe(`or(employee_id.in.(${P1}),employee_id.in.(${A1}))`);
  });
});
