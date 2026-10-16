import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomField } from "@/types";
import {
  applyArrayOverlapFilter,
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
