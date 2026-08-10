import { describe, expect, it } from "vitest";
import {
  evaluateConditions,
  evaluateRule,
  resolveFieldValue,
  type ConditionOperator,
  type ConditionRule,
} from "./condition-eval";
import type { FieldType } from "./field-catalog";

// A realistic context: an order event, shaped the way the worker assembles it,
// with the related customer alongside. Values mirror real production shapes —
// note total_amount arrives from Postgres as the string "75000.00".
const ctx = {
  order: {
    order_number: "ORD-0019",
    status: "Pending",
    total_amount: "75000.00",
    discount_total: 0,
    notes: null,
    date: "2026-08-10",
    created_at: "2026-08-10T09:00:00Z",
  },
  customer: {
    name: "Shree Traders",
    company: "Shree Traders Pvt Ltd",
    state: "Gujarat",
    city: "Rajkot",
    email: "",
    pincode: null,
    hierarchy_level: 2,
    "custom:abc-123": "Premium",
  },
} as Record<string, Record<string, unknown> | undefined>;

const rule = (
  id: number,
  field: string,
  operator: ConditionOperator,
  value?: unknown,
): ConditionRule => ({ id, field, operator, value });

describe("resolveFieldValue", () => {
  it("reads a field from the right group", () => {
    expect(resolveFieldValue("customer.state", ctx)).toBe("Gujarat");
    expect(resolveFieldValue("order.order_number", ctx)).toBe("ORD-0019");
  });

  it("reads a custom field key", () => {
    expect(resolveFieldValue("customer.custom:abc-123", ctx)).toBe("Premium");
  });

  it("returns undefined for an absent group or field, without throwing", () => {
    expect(resolveFieldValue("dispatch.lr_no", ctx)).toBeUndefined();
    expect(resolveFieldValue("customer.nonexistent", ctx)).toBeUndefined();
    expect(resolveFieldValue("malformed", ctx)).toBeUndefined();
    expect(resolveFieldValue("", ctx)).toBeUndefined();
  });
});

describe("is_null / is_not_null", () => {
  it("treats null, undefined and whitespace-only as empty", () => {
    expect(evaluateRule(rule(1, "customer.pincode", "is_null"), ctx).passed).toBe(true);
    expect(evaluateRule(rule(1, "customer.email", "is_null"), ctx).passed).toBe(true);
    expect(evaluateRule(rule(1, "order.notes", "is_null"), ctx).passed).toBe(true);
    expect(evaluateRule(rule(1, "customer.nothing_here", "is_null"), ctx).passed).toBe(true);
  });

  it("treats a real value as not empty", () => {
    expect(evaluateRule(rule(1, "customer.state", "is_not_null"), ctx).passed).toBe(true);
    expect(evaluateRule(rule(1, "customer.state", "is_null"), ctx).passed).toBe(false);
  });

  it("does not treat zero as empty", () => {
    expect(evaluateRule(rule(1, "order.discount_total", "is_null"), ctx).passed).toBe(false);
  });
});

describe("equals / not_equals — case-insensitive and trimmed", () => {
  // Field reps type on phones. Exact matching would make this look broken.
  it.each(["Gujarat", "gujarat", "GUJARAT", "  Gujarat  ", "gUjArAt"])(
    "matches %s against Gujarat",
    (input) => {
      expect(evaluateRule(rule(1, "customer.state", "equals", input), ctx).passed).toBe(true);
    },
  );

  it("does not match a different value", () => {
    expect(evaluateRule(rule(1, "customer.state", "equals", "Maharashtra"), ctx).passed).toBe(false);
    expect(evaluateRule(rule(1, "customer.state", "not_equals", "Maharashtra"), ctx).passed).toBe(true);
  });

  it("reports an empty field as not equal to a real value", () => {
    expect(evaluateRule(rule(1, "customer.pincode", "not_equals", "360001"), ctx).passed).toBe(true);
  });

  it("compares numbers written as strings", () => {
    expect(evaluateRule(rule(1, "customer.hierarchy_level", "equals", "2"), ctx).passed).toBe(true);
    expect(evaluateRule(rule(1, "customer.hierarchy_level", "equals", 2), ctx).passed).toBe(true);
  });
});

describe("exist_in / not_exist_in", () => {
  it("matches one of a list", () => {
    expect(
      evaluateRule(rule(1, "customer.city", "exist_in", ["Rajkot", "Morbi"]), ctx).passed,
    ).toBe(true);
    expect(
      evaluateRule(rule(1, "customer.city", "exist_in", ["Surat", "Baroda"]), ctx).passed,
    ).toBe(false);
  });

  it("is case-insensitive across the list", () => {
    expect(
      evaluateRule(rule(1, "customer.city", "exist_in", ["rajkot", "MORBI"]), ctx).passed,
    ).toBe(true);
  });

  it("accepts a comma-separated string as a list", () => {
    expect(
      evaluateRule(rule(1, "customer.city", "exist_in", "Rajkot, Morbi"), ctx).passed,
    ).toBe(true);
  });

  it("inverts correctly", () => {
    expect(
      evaluateRule(rule(1, "customer.city", "not_exist_in", ["Surat"]), ctx).passed,
    ).toBe(true);
    expect(
      evaluateRule(rule(1, "customer.city", "not_exist_in", ["Rajkot"]), ctx).passed,
    ).toBe(false);
  });

  it("fails closed with an explanatory note when no values are configured", () => {
    const out = evaluateRule(rule(1, "customer.city", "exist_in", []), ctx);
    expect(out.passed).toBe(false);
    expect(out.note).toMatch(/no values were configured/i);
    // Crucially the INVERSE also fails rather than matching everything.
    expect(evaluateRule(rule(1, "customer.city", "not_exist_in", []), ctx).passed).toBe(false);
  });
});

describe("contains", () => {
  it("matches a substring, case-insensitively", () => {
    expect(evaluateRule(rule(1, "customer.company", "contains", "traders"), ctx).passed).toBe(true);
    expect(evaluateRule(rule(1, "customer.company", "contains", "PVT"), ctx).passed).toBe(true);
  });

  it("does not match an absent substring", () => {
    expect(evaluateRule(rule(1, "customer.company", "contains", "enterprises"), ctx).passed).toBe(false);
  });

  it("fails closed on empty search text", () => {
    const out = evaluateRule(rule(1, "customer.company", "contains", "  "), ctx);
    expect(out.passed).toBe(false);
    expect(out.note).toMatch(/no text was configured/i);
  });
});

describe("greater_than / less_than", () => {
  it("compares a Postgres numeric string against a number", () => {
    expect(evaluateRule(rule(1, "order.total_amount", "greater_than", 50000), ctx).passed).toBe(true);
    expect(evaluateRule(rule(1, "order.total_amount", "greater_than", 80000), ctx).passed).toBe(false);
    expect(evaluateRule(rule(1, "order.total_amount", "less_than", 80000), ctx).passed).toBe(true);
  });

  it("accepts a number typed as a string with separators", () => {
    expect(evaluateRule(rule(1, "order.total_amount", "greater_than", "50,000"), ctx).passed).toBe(true);
  });

  it("is strict, not inclusive, at the boundary", () => {
    expect(evaluateRule(rule(1, "order.total_amount", "greater_than", 75000), ctx).passed).toBe(false);
    expect(evaluateRule(rule(1, "order.total_amount", "less_than", 75000), ctx).passed).toBe(false);
  });

  it("compares dates when the field is typed as a date", () => {
    const types = new Map<string, FieldType>([["order.date", "date"]]);
    expect(
      evaluateRule(rule(1, "order.date", "greater_than", "2026-08-01"), ctx, types).passed,
    ).toBe(true);
    expect(
      evaluateRule(rule(1, "order.date", "less_than", "2026-08-01"), ctx, types).passed,
    ).toBe(false);
  });

  it("falls back to date comparison for untyped timestamp fields", () => {
    expect(
      evaluateRule(rule(1, "order.created_at", "greater_than", "2026-01-01T00:00:00Z"), ctx).passed,
    ).toBe(true);
  });

  it("fails closed with a note when the field is empty", () => {
    const out = evaluateRule(rule(1, "customer.pincode", "greater_than", 100), ctx);
    expect(out.passed).toBe(false);
    expect(out.note).toMatch(/empty/i);
  });

  it("fails closed with a note when values are not comparable", () => {
    const out = evaluateRule(rule(1, "customer.state", "greater_than", 100), ctx);
    expect(out.passed).toBe(false);
    expect(out.note).toMatch(/could not be compared/i);
  });
});

describe("unknown operator", () => {
  it("fails closed rather than throwing", () => {
    const out = evaluateRule(
      { id: 1, field: "customer.state", operator: "sql_injection" as ConditionOperator, value: "x" },
      ctx,
    );
    expect(out.passed).toBe(false);
    expect(out.note).toMatch(/unknown operator/i);
  });
});

describe("evaluateConditions", () => {
  it("passes with zero rules — 'welcome every new customer' is legitimate", () => {
    expect(evaluateConditions({ rules: [] }, ctx).passed).toBe(true);
    expect(evaluateConditions(null, ctx).passed).toBe(true);
    expect(evaluateConditions(undefined, ctx).passed).toBe(true);
  });

  it("evaluates the founder's Gujarat rule, both ways", () => {
    const set = { rules: [rule(1, "customer.state", "equals", "Gujarat")] };
    expect(evaluateConditions(set, ctx).passed).toBe(true);

    const maharashtra = { ...ctx, customer: { ...ctx.customer, state: "Maharashtra" } };
    expect(evaluateConditions(set, maharashtra).passed).toBe(false);
  });

  it("honours an explicit grouped expression", () => {
    const set = {
      rules: [
        rule(1, "customer.state", "equals", "Gujarat"),
        rule(2, "customer.city", "equals", "Surat"),
        rule(3, "order.total_amount", "greater_than", 50000),
      ],
      expression: "1 AND (2 OR 3)",
    };
    // state matches, city does not, but the big order does → passes.
    expect(evaluateConditions(set, ctx).passed).toBe(true);

    const small = { ...ctx, order: { ...ctx.order, total_amount: "1000.00" } };
    // state matches, city no, order no → fails.
    expect(evaluateConditions(set, small).passed).toBe(false);
  });

  it("derives an expression from relation_with_next when none is given", () => {
    const set = {
      rules: [
        { ...rule(1, "customer.state", "equals", "Gujarat"), relation_with_next: "OR" as const },
        { ...rule(2, "customer.city", "equals", "Surat"), relation_with_next: null },
      ],
    };
    const out = evaluateConditions(set, ctx);
    expect(out.passed).toBe(true);
    expect(out.expression).toBe("1 OR 2");
  });

  it("refuses to send when the saved expression is malformed", () => {
    const set = {
      rules: [rule(1, "customer.state", "equals", "Gujarat")],
      expression: "1 AND (",
    };
    const out = evaluateConditions(set, ctx);
    expect(out.passed).toBe(false);
    expect(out.error).toBeTruthy();
  });

  it("returns per-rule outcomes for the Preview screen", () => {
    const set = {
      rules: [
        rule(1, "customer.state", "equals", "Gujarat"),
        rule(2, "customer.city", "equals", "Surat"),
      ],
      expression: "1 AND 2",
    };
    const out = evaluateConditions(set, ctx);
    expect(out.outcomes).toHaveLength(2);
    expect(out.outcomes[0]).toMatchObject({ id: 1, passed: true, actual: "Gujarat" });
    expect(out.outcomes[1]).toMatchObject({ id: 2, passed: false, actual: "Rajkot" });
  });

  it("never throws on a completely empty context", () => {
    const set = {
      rules: [
        rule(1, "customer.state", "equals", "Gujarat"),
        rule(2, "order.total_amount", "greater_than", 1),
      ],
      expression: "1 OR 2",
    };
    expect(() => evaluateConditions(set, {})).not.toThrow();
    expect(evaluateConditions(set, {}).passed).toBe(false);
  });
});
