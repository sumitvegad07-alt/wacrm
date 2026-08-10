// ------------------------------------------------------------
// Condition-format expression parser.
//
// Admins can group condition rules explicitly, e.g. "1 AND (2 OR 3)" — the
// "Condition Format" box in the automation builder. This module turns that
// string into a tiny syntax tree and evaluates it against per-rule booleans.
//
// SECURITY: this is admin-supplied text that reaches a service-role code path
// (the event worker runs with the Supabase service key and bypasses RLS).
// It is parsed by hand, never with eval() / new Function(). The grammar below
// understands four token kinds and nothing else, so there is no construction
// of this string that can execute code or reach any other data.
//
// Grammar (AND binds tighter than OR, as in SQL and every spreadsheet):
//   expr   := term (OR term)*
//   term   := factor (AND factor)*
//   factor := NUMBER | '(' expr ')'
// ------------------------------------------------------------

export type ExpressionNode =
  | { kind: 'rule'; id: number }
  | { kind: 'and'; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'or'; left: ExpressionNode; right: ExpressionNode }

export interface ParseSuccess {
  ok: true
  node: ExpressionNode
  /** Every rule id the expression references, ascending, de-duplicated. */
  referenced: number[]
}

export interface ParseFailure {
  ok: false
  /** Plain-English, shown directly under the Condition Format box. */
  error: string
  /** Character offset of the problem, for caret positioning. -1 when unknown. */
  position: number
}

export type ParseResult = ParseSuccess | ParseFailure

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'and'; pos: number }
  | { type: 'or'; pos: number }
  | { type: 'lparen'; pos: number }
  | { type: 'rparen'; pos: number }

// ------------------------------------------------------------
// Tokenizer
// ------------------------------------------------------------

function tokenize(input: string): { tokens: Token[] } | ParseFailure {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (/\s/.test(ch)) {
      i++
      continue
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', pos: i })
      i++
      continue
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen', pos: i })
      i++
      continue
    }

    if (/[0-9]/.test(ch)) {
      const start = i
      while (i < input.length && /[0-9]/.test(input[i])) i++
      const value = Number(input.slice(start, i))
      // Rules are numbered from 1 in the UI. A "0" can only come from a typo,
      // and silently treating it as a missing rule would be confusing.
      if (value === 0) {
        return {
          ok: false,
          error: 'Rule numbers start at 1, so "0" is not a valid rule.',
          position: start,
        }
      }
      tokens.push({ type: 'number', value, pos: start })
      continue
    }

    if (/[a-z]/i.test(ch)) {
      const start = i
      while (i < input.length && /[a-z]/i.test(input[i])) i++
      const word = input.slice(start, i).toUpperCase()
      if (word === 'AND') {
        tokens.push({ type: 'and', pos: start })
        continue
      }
      if (word === 'OR') {
        tokens.push({ type: 'or', pos: start })
        continue
      }
      return {
        ok: false,
        error: `"${input.slice(start, i)}" is not something this box understands. Use rule numbers, AND, OR, and brackets — for example: 1 AND (2 OR 3)`,
        position: start,
      }
    }

    return {
      ok: false,
      error: `"${ch}" is not allowed here. Use rule numbers, AND, OR, and brackets — for example: 1 AND (2 OR 3)`,
      position: i,
    }
  }

  return { tokens }
}

// ------------------------------------------------------------
// Parser
// ------------------------------------------------------------

/**
 * Parse a condition-format string.
 *
 * `availableRuleIds` is checked so the admin cannot save an expression
 * referencing a rule they deleted — the classic way this feature silently
 * stops matching. Pass an empty array to skip the cross-check (used by the
 * unit tests for the grammar itself).
 */
export function parseConditionExpression(
  input: string,
  availableRuleIds: number[] = [],
): ParseResult {
  const trimmed = (input ?? '').trim()
  if (!trimmed) {
    return { ok: false, error: 'Condition format is empty.', position: 0 }
  }

  const lexed = tokenize(trimmed)
  if ('ok' in lexed) return lexed
  const { tokens } = lexed

  if (tokens.length === 0) {
    return { ok: false, error: 'Condition format is empty.', position: 0 }
  }

  let cursor = 0
  const peek = (): Token | undefined => tokens[cursor]

  let failure: ParseFailure | null = null
  const fail = (error: string, position: number): null => {
    // Keep the FIRST failure. Later ones are usually knock-on noise from the
    // parser continuing past the real problem.
    if (!failure) failure = { ok: false, error, position }
    return null
  }

  const parseExpr = (): ExpressionNode | null => {
    let left = parseTerm()
    if (left === null) return null
    for (;;) {
      const t = peek()
      if (t?.type !== 'or') break
      cursor++
      const right = parseTerm()
      if (right === null) return null
      left = { kind: 'or', left, right }
    }
    return left
  }

  const parseTerm = (): ExpressionNode | null => {
    let left = parseFactor()
    if (left === null) return null
    for (;;) {
      const t = peek()
      if (t?.type !== 'and') break
      cursor++
      const right = parseFactor()
      if (right === null) return null
      left = { kind: 'and', left, right }
    }
    return left
  }

  const parseFactor = (): ExpressionNode | null => {
    const t = peek()
    if (!t) {
      const lastPos = tokens.length ? tokens[tokens.length - 1].pos : 0
      return fail('The condition format ends unexpectedly — a rule number is missing.', lastPos)
    }
    if (t.type === 'number') {
      cursor++
      return { kind: 'rule', id: t.value }
    }
    if (t.type === 'lparen') {
      cursor++
      const inner = parseExpr()
      if (inner === null) return null
      const closing = peek()
      if (closing?.type !== 'rparen') {
        return fail('A bracket was opened but never closed.', t.pos)
      }
      cursor++
      return inner
    }
    if (t.type === 'rparen') {
      return fail('There is a closing bracket with no matching opening bracket.', t.pos)
    }
    return fail(
      `Expected a rule number here, but found "${t.type.toUpperCase()}".`,
      t.pos,
    )
  }

  const node = parseExpr()
  if (node === null || failure) {
    return failure ?? { ok: false, error: 'The condition format could not be read.', position: -1 }
  }

  if (cursor < tokens.length) {
    const t = tokens[cursor]
    if (t.type === 'rparen') {
      return {
        ok: false,
        error: 'There is a closing bracket with no matching opening bracket.',
        position: t.pos,
      }
    }
    return {
      ok: false,
      error: 'There is something extra after the end of the condition format.',
      position: t.pos,
    }
  }

  const referenced = collectRuleIds(node)

  if (availableRuleIds.length > 0) {
    const available = new Set(availableRuleIds)
    const missing = referenced.filter((id) => !available.has(id))
    if (missing.length > 0) {
      return {
        ok: false,
        error:
          missing.length === 1
            ? `Rule ${missing[0]} is used in the condition format but no such rule exists.`
            : `Rules ${missing.join(', ')} are used in the condition format but no such rules exist.`,
        position: -1,
      }
    }
    // An unreferenced rule is a real trap: the admin thinks it is filtering,
    // and it silently does nothing. Refuse rather than quietly ignore it.
    const unreferenced = availableRuleIds.filter((id) => !referenced.includes(id))
    if (unreferenced.length > 0) {
      return {
        ok: false,
        error:
          unreferenced.length === 1
            ? `Rule ${unreferenced[0]} is not used in the condition format, so it would be ignored. Add it, or delete the rule.`
            : `Rules ${unreferenced.join(', ')} are not used in the condition format, so they would be ignored. Add them, or delete the rules.`,
        position: -1,
      }
    }
  }

  return { ok: true, node, referenced }
}

function collectRuleIds(node: ExpressionNode): number[] {
  const seen = new Set<number>()
  const walk = (n: ExpressionNode): void => {
    if (n.kind === 'rule') {
      seen.add(n.id)
      return
    }
    walk(n.left)
    walk(n.right)
  }
  walk(node)
  return [...seen].sort((a, b) => a - b)
}

/**
 * Evaluate a parsed expression against each rule's boolean outcome.
 *
 * A rule id with no entry in `results` evaluates false rather than throwing:
 * the worker must never crash mid-drain because of one malformed automation,
 * and "condition not met" is the safe direction — it sends nothing.
 */
export function evaluateExpression(
  node: ExpressionNode,
  results: Map<number, boolean>,
): boolean {
  switch (node.kind) {
    case 'rule':
      return results.get(node.id) ?? false
    case 'and':
      return evaluateExpression(node.left, results) && evaluateExpression(node.right, results)
    case 'or':
      return evaluateExpression(node.left, results) || evaluateExpression(node.right, results)
  }
}

/**
 * Build the default expression from the builder's per-row "Relation with next
 * rule" dropdowns, for admins who never open the Condition Format box.
 *
 * Emits explicit brackets around AND runs so the string the admin sees is
 * exactly what the parser will do with it. Without them, "1 OR 2 AND 3"
 * renders ambiguously to a non-technical reader even though the parser is
 * unambiguous.
 */
export function buildExpressionFromRelations(
  rules: Array<{ id: number; relation_with_next?: 'AND' | 'OR' | null }>,
): string {
  if (rules.length === 0) return ''
  if (rules.length === 1) return String(rules[0].id)

  // Group consecutive rules joined by AND, then OR the groups together.
  const groups: number[][] = [[rules[0].id]]
  for (let i = 0; i < rules.length - 1; i++) {
    const relation = rules[i].relation_with_next ?? 'AND'
    if (relation === 'AND') {
      groups[groups.length - 1].push(rules[i + 1].id)
    } else {
      groups.push([rules[i + 1].id])
    }
  }

  return groups
    .map((g) => (g.length === 1 ? String(g[0]) : `(${g.join(' AND ')})`))
    .join(' OR ')
}
