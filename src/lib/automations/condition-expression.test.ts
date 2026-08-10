import { describe, expect, it } from "vitest";
import {
  buildExpressionFromRelations,
  evaluateExpression,
  parseConditionExpression,
  type ExpressionNode,
} from "./condition-expression";

function parseOk(input: string, available: number[] = []): ExpressionNode {
  const r = parseConditionExpression(input, available);
  if (!r.ok) throw new Error(`expected parse to succeed, got: ${r.error}`);
  return r.node;
}

function evalWith(input: string, results: Record<number, boolean>): boolean {
  return evaluateExpression(parseOk(input), new Map(Object.entries(results).map(([k, v]) => [Number(k), v])));
}

describe("parseConditionExpression — grammar", () => {
  it("parses a single rule", () => {
    expect(parseOk("1")).toEqual({ kind: "rule", id: 1 });
  });

  it("parses the founder's grouping example", () => {
    const r = parseConditionExpression("1 AND (2 OR 3)");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.referenced).toEqual([1, 2, 3]);
  });

  it("accepts lowercase and mixed-case keywords", () => {
    expect(parseConditionExpression("1 and (2 or 3)").ok).toBe(true);
    expect(parseConditionExpression("1 And (2 Or 3)").ok).toBe(true);
  });

  it("tolerates missing and excess whitespace", () => {
    expect(parseConditionExpression("1AND2").ok).toBe(true);
    expect(parseConditionExpression("   1   AND    2   ").ok).toBe(true);
  });

  it("handles multi-digit rule numbers", () => {
    const r = parseConditionExpression("10 OR 2");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.referenced).toEqual([2, 10]);
  });

  it("handles deep nesting", () => {
    expect(parseConditionExpression("((1 AND 2) OR (3 AND (4 OR 5)))").ok).toBe(true);
  });
});

describe("parseConditionExpression — AND binds tighter than OR", () => {
  // The single most consequential precedence decision in the feature: an admin
  // writing "1 OR 2 AND 3" means "1, or else both 2 and 3" — the SQL reading.
  it("evaluates 1 OR 2 AND 3 as 1 OR (2 AND 3)", () => {
    expect(evalWith("1 OR 2 AND 3", { 1: true, 2: false, 3: false })).toBe(true);
    expect(evalWith("1 OR 2 AND 3", { 1: false, 2: true, 3: false })).toBe(false);
    expect(evalWith("1 OR 2 AND 3", { 1: false, 2: true, 3: true })).toBe(true);
  });

  it("brackets override precedence", () => {
    expect(evalWith("(1 OR 2) AND 3", { 1: true, 2: false, 3: false })).toBe(false);
    expect(evalWith("(1 OR 2) AND 3", { 1: true, 2: false, 3: true })).toBe(true);
  });
});

describe("evaluateExpression — full truth table for 1 AND (2 OR 3)", () => {
  const cases: Array<[boolean, boolean, boolean, boolean]> = [
    // r1, r2, r3, expected
    [false, false, false, false],
    [false, false, true, false],
    [false, true, false, false],
    [false, true, true, false],
    [true, false, false, false],
    [true, false, true, true],
    [true, true, false, true],
    [true, true, true, true],
  ];

  it.each(cases)("1=%s 2=%s 3=%s -> %s", (r1, r2, r3, expected) => {
    expect(evalWith("1 AND (2 OR 3)", { 1: r1, 2: r2, 3: r3 })).toBe(expected);
  });
});

describe("evaluateExpression — missing rule results", () => {
  it("treats an unknown rule id as false rather than throwing", () => {
    // Safe direction: false means "do not send".
    expect(evaluateExpression(parseOk("1 AND 2"), new Map([[1, true]]))).toBe(false);
    expect(evaluateExpression(parseOk("1 OR 2"), new Map([[1, true]]))).toBe(true);
  });
});

describe("parseConditionExpression — rejections", () => {
  it("rejects an empty expression", () => {
    expect(parseConditionExpression("").ok).toBe(false);
    expect(parseConditionExpression("    ").ok).toBe(false);
  });

  it("rejects an unclosed bracket", () => {
    const r = parseConditionExpression("1 AND (2 OR 3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/never closed/i);
  });

  it("rejects an unopened bracket", () => {
    const r = parseConditionExpression("1 AND 2)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no matching opening bracket/i);
  });

  it("rejects unknown words", () => {
    const r = parseConditionExpression("1 NOT 2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not something this box understands/i);
  });

  it("rejects a dangling operator", () => {
    expect(parseConditionExpression("1 AND").ok).toBe(false);
    expect(parseConditionExpression("AND 1").ok).toBe(false);
    expect(parseConditionExpression("1 OR OR 2").ok).toBe(false);
  });

  it("rejects rule number zero", () => {
    const r = parseConditionExpression("0 AND 1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/start at 1/i);
  });

  it("rejects anything resembling code injection", () => {
    // This string reaches a service-role code path. It must be inert data.
    for (const evil of [
      "1; DROP TABLE contacts",
      "process.exit(1)",
      "require('fs')",
      "1 AND $(whoami)",
      "__proto__",
      "1 && 2",
      "'; SELECT * FROM accounts--",
    ]) {
      expect(parseConditionExpression(evil).ok).toBe(false);
    }
  });

  it("rejects an expression referencing a rule that does not exist", () => {
    const r = parseConditionExpression("1 AND 4", [1, 2]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no such rule exists/i);
  });

  it("rejects an expression that silently ignores a configured rule", () => {
    // The dangerous case: admin adds rule 3, forgets the format box, and the
    // automation quietly stops filtering on it.
    const r = parseConditionExpression("1 AND 2", [1, 2, 3]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not used in the condition format/i);
  });

  it("accepts an expression that uses exactly the configured rules", () => {
    expect(parseConditionExpression("1 AND (2 OR 3)", [1, 2, 3]).ok).toBe(true);
  });
});

describe("buildExpressionFromRelations", () => {
  it("returns empty for no rules", () => {
    expect(buildExpressionFromRelations([])).toBe("");
  });

  it("returns the bare id for one rule", () => {
    expect(buildExpressionFromRelations([{ id: 1 }])).toBe("1");
  });

  it("joins AND relations without redundant brackets at the top level", () => {
    expect(
      buildExpressionFromRelations([
        { id: 1, relation_with_next: "AND" },
        { id: 2, relation_with_next: "AND" },
        { id: 3 },
      ]),
    ).toBe("(1 AND 2 AND 3)");
  });

  it("brackets AND runs so the reader sees the real precedence", () => {
    expect(
      buildExpressionFromRelations([
        { id: 1, relation_with_next: "OR" },
        { id: 2, relation_with_next: "AND" },
        { id: 3 },
      ]),
    ).toBe("1 OR (2 AND 3)");
  });

  it("defaults a missing relation to AND", () => {
    expect(
      buildExpressionFromRelations([{ id: 1 }, { id: 2 }]),
    ).toBe("(1 AND 2)");
  });

  it("produces a string the parser accepts and agrees with", () => {
    const rules = [
      { id: 1, relation_with_next: "OR" as const },
      { id: 2, relation_with_next: "AND" as const },
      { id: 3, relation_with_next: null },
    ];
    const expr = buildExpressionFromRelations(rules);
    const parsed = parseConditionExpression(expr, [1, 2, 3]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // 1 OR (2 AND 3) — same answer the precedence rule would give.
      expect(evaluateExpression(parsed.node, new Map([[1, false], [2, true], [3, true]]))).toBe(true);
      expect(evaluateExpression(parsed.node, new Map([[1, false], [2, true], [3, false]]))).toBe(false);
    }
  });
});
