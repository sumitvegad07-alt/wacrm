// ------------------------------------------------------------
// Condition rule evaluation for module automations.
//
// A rule is: <field> <operator> <value>, resolved against the event context
// (the triggering record plus its related customer / order). The parsed
// Condition Format expression then combines each rule's boolean.
//
// Two deliberate choices run through this whole file:
//
//  1. NOTHING THROWS. This runs inside the event worker, draining a batch of
//     events. One badly-configured automation must not take down the drain and
//     stall every other customer's messages. A rule that cannot be evaluated
//     returns false — the safe direction, because false means "don't send".
//
//  2. TEXT COMPARISON IS CASE-INSENSITIVE AND TRIMMED. The data being matched
//     is typed by field reps on phones: "gujarat", "Gujarat " and "GUJARAT"
//     are the same place. Exact matching would make conditions look broken.
// ------------------------------------------------------------

import {
  buildExpressionFromRelations,
  evaluateExpression,
  parseConditionExpression,
} from './condition-expression'
import type { FieldType } from './field-catalog'

export const CONDITION_OPERATORS = [
  'is_null',
  'is_not_null',
  'exist_in',
  'not_exist_in',
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'contains',
] as const

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

/** Operators that take no value input — the builder hides the Value box. */
export const VALUELESS_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  'is_null',
  'is_not_null',
])

/** Operators whose value is a list of choices rather than a single scalar. */
export const LIST_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  'exist_in',
  'not_exist_in',
])

export interface ConditionRule {
  /** 1-based, matches the "Rule" column and the Condition Format box. */
  id: number
  /** Catalog key, e.g. 'customer.state' or 'order.custom:<uuid>'. */
  field: string
  operator: ConditionOperator
  value?: unknown
  /** Only used to derive a default expression; the expression is authoritative. */
  relation_with_next?: 'AND' | 'OR' | null
}

export interface RuleOutcome {
  id: number
  field: string
  operator: ConditionOperator
  value: unknown
  /** What the record actually held, for the Preview screen. */
  actual: unknown
  passed: boolean
  /** Set when the rule could not be evaluated properly. Surfaced in logs. */
  note?: string
}

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is_null: 'is empty',
  is_not_null: 'is not empty',
  exist_in: 'is one of',
  not_exist_in: 'is not one of',
  equals: 'equals',
  not_equals: 'does not equal',
  greater_than: 'is greater than',
  less_than: 'is less than',
  contains: 'contains',
}

// ------------------------------------------------------------
// Value resolution
// ------------------------------------------------------------

/**
 * Read a catalog field key out of the event context.
 *
 * Keys are `<group>.<field>`, e.g. `customer.state`, `order.total_amount`,
 * or `customer.custom:<uuid>` for a custom field. Custom values are expected
 * to be pre-flattened onto the group object by the worker under their
 * `custom:<uuid>` key, so this function stays a pure lookup with no I/O.
 */
export function resolveFieldValue(
  fieldKey: string,
  context: Record<string, Record<string, unknown> | undefined>,
): unknown {
  const separator = fieldKey.indexOf('.')
  if (separator <= 0) return undefined
  const group = fieldKey.slice(0, separator)
  const field = fieldKey.slice(separator + 1)
  const source = context[group]
  if (!source) return undefined
  return source[field]
}

// ------------------------------------------------------------
// Coercion helpers
// ------------------------------------------------------------

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

function normalizeText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v).trim().toLowerCase()
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return null
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (trimmed === '') return null
    // Postgres numerics arrive as strings like "75000.00"; strip common
    // thousands separators an admin might type into the Value box.
    const cleaned = trimmed.replace(/,/g, '')
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toTime(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/**
 * Comparable pair for greater_than / less_than.
 *
 * Dates are compared as dates when the catalog says so; everything else is
 * compared numerically. A pair that cannot be coerced yields null, which the
 * caller turns into a failed rule with an explanatory note rather than a
 * silently-passing one.
 */
function comparablePair(
  actual: unknown,
  expected: unknown,
  fieldType: FieldType | undefined,
): { a: number; b: number } | null {
  if (fieldType === 'date') {
    const a = toTime(actual)
    const b = toTime(expected)
    return a === null || b === null ? null : { a, b }
  }
  const a = toNumber(actual)
  const b = toNumber(expected)
  if (a !== null && b !== null) return { a, b }
  // Fall back to date comparison for untyped fields that happen to hold
  // timestamps — orders carry several, and an admin filtering on one should
  // not have to know it wasn't registered with a type.
  const ta = toTime(actual)
  const tb = toTime(expected)
  return ta === null || tb === null ? null : { a: ta, b: tb }
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(normalizeText).filter((s) => s !== '')
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => normalizeText(s))
      .filter((s) => s !== '')
  }
  if (v === null || v === undefined) return []
  return [normalizeText(v)]
}

// ------------------------------------------------------------
// Single-rule evaluation
// ------------------------------------------------------------

export function evaluateRule(
  rule: ConditionRule,
  context: Record<string, Record<string, unknown> | undefined>,
  fieldTypes?: Map<string, FieldType>,
): RuleOutcome {
  const actual = resolveFieldValue(rule.field, context)
  const fieldType = fieldTypes?.get(rule.field)
  const base = {
    id: rule.id,
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
    actual,
  }

  switch (rule.operator) {
    case 'is_null':
      return { ...base, passed: isBlank(actual) }

    case 'is_not_null':
      return { ...base, passed: !isBlank(actual) }

    case 'equals':
      return { ...base, passed: normalizeText(actual) === normalizeText(rule.value) }

    case 'not_equals':
      // An empty field is genuinely "not equal to Gujarat", so this stays true
      // for blanks. That matches how a person reads the sentence.
      return { ...base, passed: normalizeText(actual) !== normalizeText(rule.value) }

    case 'exist_in': {
      const list = toList(rule.value)
      if (list.length === 0) {
        return { ...base, passed: false, note: 'no values were configured for this rule' }
      }
      return { ...base, passed: list.includes(normalizeText(actual)) }
    }

    case 'not_exist_in': {
      const list = toList(rule.value)
      if (list.length === 0) {
        return { ...base, passed: false, note: 'no values were configured for this rule' }
      }
      return { ...base, passed: !list.includes(normalizeText(actual)) }
    }

    case 'contains': {
      const needle = normalizeText(rule.value)
      if (needle === '') {
        return { ...base, passed: false, note: 'no text was configured for this rule' }
      }
      return { ...base, passed: normalizeText(actual).includes(needle) }
    }

    case 'greater_than':
    case 'less_than': {
      const pair = comparablePair(actual, rule.value, fieldType)
      if (!pair) {
        return {
          ...base,
          passed: false,
          note: isBlank(actual)
            ? 'the field is empty, so it cannot be compared'
            : 'the field and the value could not be compared as numbers or dates',
        }
      }
      return {
        ...base,
        passed: rule.operator === 'greater_than' ? pair.a > pair.b : pair.a < pair.b,
      }
    }

    default: {
      // Unknown operator — treat as not-matched rather than throwing, and say so.
      const unknown: string = rule.operator
      return { ...base, passed: false, note: `unknown operator "${unknown}"` }
    }
  }
}

// ------------------------------------------------------------
// Rule-set evaluation
// ------------------------------------------------------------

export interface ConditionSet {
  rules: ConditionRule[]
  /** Condition Format string. Empty means "derive from relation_with_next". */
  expression?: string | null
}

export interface ConditionEvaluation {
  passed: boolean
  expression: string
  outcomes: RuleOutcome[]
  /** Populated when the expression itself was unusable. */
  error?: string
}

/**
 * Evaluate a whole condition set.
 *
 * Zero rules means the automation always fires. That is deliberate and
 * legitimate — "welcome every new customer" has no conditions — and must not
 * be treated as a misconfiguration.
 */
export function evaluateConditions(
  set: ConditionSet | null | undefined,
  context: Record<string, Record<string, unknown> | undefined>,
  fieldTypes?: Map<string, FieldType>,
): ConditionEvaluation {
  const rules = set?.rules ?? []
  if (rules.length === 0) {
    return { passed: true, expression: '', outcomes: [] }
  }

  const outcomes = rules.map((r) => evaluateRule(r, context, fieldTypes))
  const results = new Map(outcomes.map((o) => [o.id, o.passed]))

  const expression =
    set?.expression && set.expression.trim() !== ''
      ? set.expression.trim()
      : buildExpressionFromRelations(rules)

  const parsed = parseConditionExpression(expression, rules.map((r) => r.id))
  if (!parsed.ok) {
    // A saved automation should never reach here — activation validation
    // rejects a bad expression. If it somehow does, refuse to send rather than
    // guessing what the admin meant.
    return { passed: false, expression, outcomes, error: parsed.error }
  }

  return { passed: evaluateExpression(parsed.node, results), expression, outcomes }
}
