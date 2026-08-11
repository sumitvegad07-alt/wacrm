import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { evaluateConditions, type ConditionSet } from '@/lib/automations/condition-eval'
import {
  buildFieldCatalog,
  fieldTypeMap,
  EVENT_MODULE,
  EVENT_LABELS,
  type AutomationEventType,
} from '@/lib/automations/field-catalog'
import { resolveRecipients, displayPhone, type RecipientConfig } from '@/lib/automations/recipients'
import { renderParams, type EventContext } from '@/lib/automations/event-worker'
import { ORDER_STATUSES } from '@/lib/orders/statuses'

/**
 * POST /api/automations/[id]/preview  — Test mode.
 *
 * Runs an automation against a REAL record and reports exactly what would
 * happen: which conditions passed, who would be messaged, at which number, and
 * the fully rendered template.
 *
 * It sends nothing. No Meta call, no `messages` row, no conversation, no
 * delivery record. There is no undo on a sent WhatsApp message, so being able
 * to see the outcome before switching an automation on is the difference
 * between a confident release and an apology to a customer.
 */
const bodySchema = z.object({
  record_id: z.string().uuid(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole('admin')
    const { id: automationId } = await context.params

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'A valid record must be selected' }, { status: 400 })
    }

    // Tenancy: every lookup below is scoped to the caller's account, so a
    // forged automation or record id from another tenant returns 404 rather
    // than leaking whether it exists.
    const { data: automation } = await ctx.supabase
      .from('automations')
      .select('id, name, trigger_type, trigger_config, is_active')
      .eq('id', automationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (!automation) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    const eventType = automation.trigger_type as AutomationEventType
    const moduleKey = EVENT_MODULE[eventType]
    if (!moduleKey) {
      return NextResponse.json(
        { error: 'Preview is only available for module automations' },
        { status: 422 },
      )
    }

    const { data: steps } = await ctx.supabase
      .from('automation_steps')
      .select('step_type, step_config, position')
      .eq('automation_id', automationId)
      .order('position', { ascending: true })

    const action = (steps ?? []).find((s) => s.step_type === 'send_template') as
      | { step_config: Record<string, unknown> }
      | undefined

    const blockers: string[] = []
    if (!action) blockers.push('This automation has no WhatsApp message configured yet.')

    const cfg = action?.step_config ?? {}
    const templateName = cfg.template_name as string | undefined
    const recipientConfigs = (cfg.recipients as RecipientConfig[] | undefined) ?? []
    const variables = cfg.variables as Record<string, string> | undefined

    if (!templateName) blockers.push('No WhatsApp template has been chosen.')
    if (recipientConfigs.length === 0) blockers.push('No recipients have been chosen.')

    // ---- Build the same context the worker would ----------------------------
    const built = await buildPreviewContext(ctx, moduleKey, parsed.data.record_id)
    if (!built) {
      return NextResponse.json(
        { error: 'That record could not be found in this account' },
        { status: 404 },
      )
    }
    const { context: eventContext, recordLabel, contactId, creatorUserId } = built

    // ---- Conditions ---------------------------------------------------------
    const { data: fields } = await ctx.supabase
      .from('custom_fields')
      .select(
        'id, field_name, field_type, module_name, source_type, system_key, is_active, field_options',
      )
      .eq('account_id', ctx.accountId)

    const { groups } = buildFieldCatalog(moduleKey, fields ?? [], { order: [...ORDER_STATUSES] })
    const conditionSet = (automation.trigger_config as { conditions?: ConditionSet } | null)
      ?.conditions

    const verdict = evaluateConditions(conditionSet, eventContext, fieldTypeMap(groups))
    if (verdict.error) blockers.push(`The condition format is invalid: ${verdict.error}`)

    // ---- Recipients ---------------------------------------------------------
    const recipients = await resolveRecipients(ctx.supabase, recipientConfigs, {
      accountId: ctx.accountId,
      contactId,
      creatorUserId,
    })

    // ---- Account-level blockers --------------------------------------------
    const { data: account } = await ctx.supabase
      .from('accounts')
      .select('settings')
      .eq('id', ctx.accountId)
      .maybeSingle()

    const automationSettings = (account?.settings as Record<string, unknown> | null)?.[
      'automation_settings'
    ] as Record<string, unknown> | undefined
    if (automationSettings?.enabled === false) {
      blockers.push('Automation sending is currently switched off for this account.')
    }

    const { count: configCount } = await ctx.supabase
      .from('whatsapp_config')
      .select('account_id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
    if (!configCount) {
      blockers.push('WhatsApp is not connected for this account.')
    }

    if (!automation.is_active) {
      blockers.push('This automation is saved as a draft, so it will not run yet.')
    }

    const reachable = recipients.filter((r) => r.reachable)
    if (verdict.passed && reachable.length === 0 && recipientConfigs.length > 0) {
      blockers.push('None of the chosen recipients has a usable WhatsApp number.')
    }

    return NextResponse.json({
      automation: { id: automation.id, name: automation.name },
      event_type: eventType,
      event_label: EVENT_LABELS[eventType] ?? eventType,
      record_label: recordLabel,
      conditions: {
        passed: verdict.passed,
        expression: verdict.expression,
        rules: verdict.outcomes,
      },
      recipients: recipients.map((r) => ({
        type: r.type,
        label: r.label,
        phone: displayPhone(r.phone),
        reachable: r.reachable,
        reason: r.reason,
        warning: r.warning,
      })),
      rendered: templateName
        ? {
            template_name: templateName,
            language: (cfg.language as string | undefined) ?? 'en',
            variables: renderParams(variables, eventContext),
          }
        : null,
      // The honest bottom line, computed rather than assumed.
      would_send: verdict.passed && reachable.length > 0 && blockers.length === 0,
      blockers,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

interface PreviewContext {
  context: EventContext
  recordLabel: string
  contactId: string | null
  creatorUserId: string | null
}

async function buildPreviewContext(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  moduleKey: 'customer' | 'order' | 'dispatch',
  recordId: string,
): Promise<PreviewContext | null> {
  if (moduleKey === 'customer') {
    const { data } = await ctx.supabase
      .from('contacts')
      .select('*')
      .eq('id', recordId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!data) return null
    return {
      context: { customer: data },
      recordLabel: String(data.company || data.name || 'Customer'),
      contactId: data.id as string,
      creatorUserId: (data.user_id as string | null) ?? null,
    }
  }

  if (moduleKey === 'order') {
    const { data: order } = await ctx.supabase
      .from('orders')
      .select('*')
      .eq('id', recordId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!order) return null
    const customer = await loadContact(ctx, order.contact_id as string | null)
    return {
      context: { order, customer },
      recordLabel: String(order.order_number || 'Order'),
      contactId: (order.contact_id as string | null) ?? null,
      creatorUserId: (order.user_id as string | null) ?? null,
    }
  }

  const { data: dispatch } = await ctx.supabase
    .from('order_dispatches')
    .select('*')
    .eq('id', recordId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!dispatch) return null

  const { data: order } = await ctx.supabase
    .from('orders')
    .select('*')
    .eq('id', dispatch.order_id as string)
    .eq('account_id', ctx.accountId)
    .maybeSingle()

  const customer = await loadContact(ctx, (order?.contact_id as string | null) ?? null)
  return {
    context: { dispatch, order: order ?? undefined, customer },
    recordLabel: String(dispatch.dispatch_number || 'Dispatch'),
    contactId: (order?.contact_id as string | null) ?? null,
    creatorUserId: (order?.user_id as string | null) ?? null,
  }
}

async function loadContact(
  ctx: Awaited<ReturnType<typeof requireRole>>,
  contactId: string | null,
): Promise<Record<string, unknown> | undefined> {
  if (!contactId) return undefined
  const { data } = await ctx.supabase
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  return (data as Record<string, unknown> | null) ?? undefined
}
