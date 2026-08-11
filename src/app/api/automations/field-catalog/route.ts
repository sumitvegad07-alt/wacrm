import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  buildFieldCatalog,
  MODULE_EVENTS,
  EVENT_LABELS,
  type AutomationModule,
  type CustomFieldRow,
} from '@/lib/automations/field-catalog'
import { ORDER_STATUSES } from '@/lib/orders/statuses'
import { RECIPIENT_LABELS, RECIPIENT_TYPES } from '@/lib/automations/recipients'
import {
  CONDITION_OPERATORS,
  LIST_OPERATORS,
  OPERATOR_LABELS,
  VALUELESS_OPERATORS,
} from '@/lib/automations/condition-eval'

/**
 * GET /api/automations/field-catalog?module=order
 *
 * Everything the automation builder needs to render its dropdowns: the fields a
 * condition can test, the events for the module, the operators, and the
 * recipient types. Returned in one call so the form can't render half-populated
 * selects while three requests race.
 */
const querySchema = z.object({
  module: z.enum(['customer', 'order', 'dispatch']),
})

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()

    const parsed = querySchema.safeParse({
      module: new URL(request.url).searchParams.get('module'),
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'module must be one of: customer, order, dispatch' },
        { status: 400 },
      )
    }
    const moduleKey = parsed.data.module as AutomationModule

    const { data, error } = await ctx.supabase
      .from('custom_fields')
      .select(
        'id, field_name, field_type, module_name, source_type, system_key, is_active, field_options',
      )
      .eq('account_id', ctx.accountId)

    if (error) {
      console.error('[field-catalog] could not read custom_fields:', error)
      return NextResponse.json({ error: 'Could not load fields' }, { status: 500 })
    }

    const { groups, omittedSystemKeys } = buildFieldCatalog(
      moduleKey,
      (data ?? []) as CustomFieldRow[],
      // Status choices come from the enforced state machine, never a settings
      // table — the retired order_statuses list had drifted to names the machine
      // did not recognise, so an automation built on it would match nothing.
      { order: [...ORDER_STATUSES] },
    )

    if (omittedSystemKeys.length > 0) {
      // Registry drift is worth seeing rather than silently swallowing: these
      // are fields an admin was offered somewhere else in the app that do not
      // map to a real column.
      console.warn(
        '[field-catalog] registered fields with no matching column, omitted:',
        omittedSystemKeys.join(', '),
      )
    }

    // Templates and the employee-reachability count are fetched here rather
    // than from the component: UI components must not query Supabase directly,
    // and returning them together means the builder can't render a
    // half-populated form while three requests race.
    const [{ data: templateRows }, { data: profileRows }] = await Promise.all([
      ctx.supabase
        .from('message_templates')
        .select('name, language, body_text, status')
        .eq('account_id', ctx.accountId),
      ctx.supabase.from('profiles').select('phone').eq('account_id', ctx.accountId),
    ])

    const templates = (templateRows ?? [])
      .filter((t) => String(t.status ?? '').toLowerCase() === 'approved')
      .map((t) => ({
        name: t.name as string,
        language: (t.language as string) ?? 'en',
        bodyText: (t.body_text as string) ?? '',
        variableCount: countTemplateVariables((t.body_text as string) ?? ''),
      }))

    const unreachableEmployees = (profileRows ?? []).filter(
      (p) => !String(p.phone ?? '').trim(),
    ).length

    return NextResponse.json({
      groups,
      templates,
      unreachableEmployees,
      events: MODULE_EVENTS[moduleKey].map((e) => ({ value: e, label: EVENT_LABELS[e] })),
      operators: CONDITION_OPERATORS.map((op) => ({
        value: op,
        label: OPERATOR_LABELS[op],
        takesValue: !VALUELESS_OPERATORS.has(op),
        takesList: LIST_OPERATORS.has(op),
      })),
      recipientTypes: RECIPIENT_TYPES.map((t) => ({ value: t, label: RECIPIENT_LABELS[t] })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * Meta templates use positional {{1}}, {{2}}, … placeholders. The highest
 * number is what matters, not the count of distinct ones: a template using
 * {{1}} and {{3}} still needs three parameters, and Meta rejects a call with a
 * gap in the sequence.
 */
function countTemplateVariables(body: string): number {
  let highest = 0
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    highest = Math.max(highest, Number(m[1]))
  }
  return highest
}
