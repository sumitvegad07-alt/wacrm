// ------------------------------------------------------------
// The event worker: turns queued business events into WhatsApp messages.
//
// Reads `automation_events`, decides what should be sent and to whom, and
// sends it. Everything here is written to be run unattended on a schedule, so
// the governing principle is: NEVER lose an event, and never send twice.
//
// The order of the guards below is deliberate and each one exists for a
// specific failure:
//
//   claim → kill switch → staleness → automations → conditions → recipients
//         → record delivery → send
//
//   * claim before anything else, so two overlapping cron runs cannot both
//     process the same event;
//   * kill switch before any work, so the emergency stop is genuinely
//     immediate;
//   * staleness before sending, so an order that syncs from a rep's phone
//     hours later doesn't tell a customer their order was "just received";
//   * the delivery row is written BEFORE the send, because its unique
//     constraint is what makes a retry after a timeout safe. Writing it after
//     would leave a window where the message went out but nothing recorded it,
//     and the retry would send it again.
//
// Nothing in here throws out to the caller. A single malformed automation must
// not stall the queue for every other customer.
// ------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateConditions, type ConditionSet } from './condition-eval'
import {
  buildFieldCatalog,
  fieldTypeMap,
  EVENT_MODULE,
  type AutomationEventType,
} from './field-catalog'
import { resolveRecipients, type RecipientConfig, type ResolvedRecipient } from './recipients'
import { findOrCreateConversation } from '@/lib/whatsapp/conversations'
import {
  isPermanentSendError,
  type MessageProvider,
  type SendTemplateRequest,
} from './providers'

export const DEFAULT_STALE_EVENT_HOURS = 12
const MAX_ATTEMPTS = 3
const DEFAULT_BATCH_SIZE = 50
/** A row left 'processing' this long belongs to a worker that died mid-flight. */
const STUCK_PROCESSING_MINUTES = 10

export interface AutomationEventRow {
  id: string
  account_id: string
  module: string
  event_type: string
  record_id: string
  record_snapshot: Record<string, unknown>
  previous_snapshot: Record<string, unknown> | null
  changed_fields: string[] | null
  occurred_at: string
  attempts: number
}

export interface EventOutcome {
  eventId: string
  status: 'done' | 'skipped' | 'failed' | 'retry'
  skipReason?: string
  sent: number
  skippedRecipients: number
  failedRecipients: number
}

export interface DrainResult {
  processed: number
  sent: number
  skipped: number
  failed: number
  requeued: number
  outcomes: EventOutcome[]
}

export interface DrainOptions {
  db: SupabaseClient
  provider: MessageProvider
  batchSize?: number
  /** Injectable for tests. */
  now?: () => Date
}

// ------------------------------------------------------------
// Entry point
// ------------------------------------------------------------

export async function drainEvents(opts: DrainOptions): Promise<DrainResult> {
  const { db, provider } = opts
  const now = opts.now ?? (() => new Date())
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE

  await requeueStuckEvents(db, now())

  const { data: due, error } = await db
    .from('automation_events')
    .select('*')
    .eq('status', 'pending')
    // Oldest first. This is what keeps a customer's order confirmation ahead of
    // the dispatch notification for the same order.
    .order('occurred_at', { ascending: true })
    .limit(batchSize)

  const result: DrainResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    requeued: 0,
    outcomes: [],
  }

  if (error) {
    console.error('[event-worker] could not read events:', error)
    return result
  }
  if (!due || due.length === 0) return result

  // Per-drain caches. Without these, 50 events for one account would re-read
  // the same account settings and automation definitions 50 times.
  const cache = new WorkerCache()

  for (const row of due as AutomationEventRow[]) {
    const claimed = await claim(db, row.id)
    if (!claimed) continue // another invocation got there first

    const outcome = await processEvent(db, provider, row, cache, now)
    result.outcomes.push(outcome)
    result.processed++
    result.sent += outcome.sent

    if (outcome.status === 'skipped') result.skipped++
    else if (outcome.status === 'failed') result.failed++
    else if (outcome.status === 'retry') result.requeued++
  }

  return result
}

/**
 * Return rows a crashed worker left mid-flight.
 *
 * Without this an event stuck in 'processing' is invisible forever — the
 * customer never hears anything and nothing reports a problem. This is the
 * same class of defect as the RetryHandler zombie already known elsewhere in
 * this codebase, so it is handled explicitly rather than assumed away.
 */
async function requeueStuckEvents(db: SupabaseClient, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STUCK_PROCESSING_MINUTES * 60_000).toISOString()
  const { error } = await db
    .from('automation_events')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('processed_at', cutoff)
  if (error) console.error('[event-worker] could not requeue stuck events:', error)
}

async function claim(db: SupabaseClient, eventId: string): Promise<boolean> {
  const { data } = await db
    .from('automation_events')
    .update({ status: 'processing', processed_at: new Date().toISOString() })
    .eq('id', eventId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  return Boolean(data)
}

// ------------------------------------------------------------
// Single event
// ------------------------------------------------------------

async function processEvent(
  db: SupabaseClient,
  provider: MessageProvider,
  event: AutomationEventRow,
  cache: WorkerCache,
  now: () => Date,
): Promise<EventOutcome> {
  const base: EventOutcome = {
    eventId: event.id,
    status: 'done',
    sent: 0,
    skippedRecipients: 0,
    failedRecipients: 0,
  }

  try {
    const settings = await cache.accountSettings(db, event.account_id)

    // 1. Master kill switch. Absent means enabled — a missing key must never
    //    silently disable a working account.
    if (settings.automationsEnabled === false) {
      await finish(db, event.id, 'skipped', { skip_reason: 'kill_switch' })
      return { ...base, status: 'skipped', skipReason: 'kill_switch' }
    }

    // 2. Staleness. Recorded, never silently dropped.
    const ageHours = (now().getTime() - new Date(event.occurred_at).getTime()) / 3_600_000
    if (ageHours > settings.staleEventHours) {
      await finish(db, event.id, 'skipped', { skip_reason: 'stale' })
      return { ...base, status: 'skipped', skipReason: 'stale' }
    }

    // 3. Matching automations.
    const automations = await cache.automations(db, event.account_id, event.event_type)
    if (automations.length === 0) {
      await finish(db, event.id, 'done', { skip_reason: 'no_matching_automation' })
      return { ...base, status: 'done', skipReason: 'no_matching_automation' }
    }

    const context = await buildContext(db, event, cache)

    let sent = 0
    let skippedRecipients = 0
    let failedRecipients = 0

    for (const automation of automations) {
      const config = (automation.trigger_config ?? {}) as {
        conditions?: ConditionSet
      }
      const action = await cache.action(db, automation.id)
      if (!action) continue

      // 4. Conditions.
      const catalog = cache.catalog(event.event_type as AutomationEventType)
      const verdict = evaluateConditions(config.conditions, context, catalog.types)
      if (!verdict.passed) continue

      // 5. Recipients.
      const recipients = await resolveRecipients(db, action.recipients, {
        accountId: event.account_id,
        contactId: contactIdFor(event, context),
        creatorUserId: creatorUserIdFor(context),
      })

      for (const recipient of recipients) {
        const outcome = await deliver({
          db,
          provider,
          event,
          automationId: automation.id,
          automationUserId: automation.user_id,
          recipient,
          action,
          context,
        })
        if (outcome === 'sent') sent++
        else if (outcome === 'skipped') skippedRecipients++
        else failedRecipients++
      }
    }

    await finish(db, event.id, 'done')
    return { ...base, status: 'done', sent, skippedRecipients, failedRecipients }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const attempts = (event.attempts ?? 0) + 1

    if (attempts >= MAX_ATTEMPTS) {
      // Terminal, and VISIBLE. Deliberately not left in the queue to be
      // skipped forever on every future drain — that zombie pattern already
      // exists elsewhere in this codebase and hides real failures.
      await finish(db, event.id, 'failed', { attempts, last_error: message })
      return { ...base, status: 'failed' }
    }

    await finish(db, event.id, 'pending', { attempts, last_error: message })
    return { ...base, status: 'retry' }
  }
}

async function finish(
  db: SupabaseClient,
  eventId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db
    .from('automation_events')
    .update({ status, processed_at: new Date().toISOString(), ...extra })
    .eq('id', eventId)
  if (error) console.error('[event-worker] could not finalise event', eventId, error)
}

// ------------------------------------------------------------
// Delivery
// ------------------------------------------------------------

interface DeliverArgs {
  db: SupabaseClient
  provider: MessageProvider
  event: AutomationEventRow
  automationId: string
  automationUserId: string
  recipient: ResolvedRecipient
  action: ActionConfig
  context: EventContext
}

async function deliver(args: DeliverArgs): Promise<'sent' | 'skipped' | 'failed'> {
  const { db, provider, event, automationId, recipient, action, context } = args

  if (!recipient.reachable || !recipient.phone) {
    await recordDelivery(db, {
      event,
      automationId,
      recipient,
      status: 'skipped',
      detail: recipient.reason ?? 'recipient could not be reached',
    })
    return 'skipped'
  }

  // Claim this recipient BEFORE sending. The unique constraint on
  // (event, automation, recipient) is the only thing standing between a
  // retried timeout and a customer receiving the same message twice.
  const claimed = await recordDelivery(db, {
    event,
    automationId,
    recipient,
    status: 'pending',
    detail: null,
  })
  if (!claimed) return 'skipped' // already handled by another run

  try {
    const request: SendTemplateRequest = {
      accountId: event.account_id,
      toPhone: recipient.phone,
      templateName: action.templateName,
      language: action.language,
      params: renderParams(action.variables, context),
    }

    // Only a customer's message belongs in the inbox thread. Employees and
    // fixed numbers are not contacts, so they get no conversation — internal
    // alerts must not pollute the customer inbox.
    if (recipient.type === 'customer' && recipient.contactId) {
      const conversation = await findOrCreateConversation(db, {
        accountId: event.account_id,
        contactId: recipient.contactId,
        ownerUserId: args.automationUserId,
      })
      if (conversation) {
        request.conversation = {
          conversationId: conversation.id,
          contactId: recipient.contactId,
        }
      }
    }

    const result = await provider.sendTemplate(request)
    await updateDelivery(db, event.id, automationId, recipient.key, {
      status: 'sent',
      detail: result.simulated ? `simulated (${result.messageId})` : result.messageId,
    })
    return 'sent'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateDelivery(db, event.id, automationId, recipient.key, {
      status: 'failed',
      detail: message,
    })
    // A permanent rejection (bad template, invalid number) is this recipient's
    // problem alone — it must not fail the whole event and trigger a retry that
    // re-sends to everyone else.
    if (isPermanentSendError(err)) return 'failed'
    throw err
  }
}

async function recordDelivery(
  db: SupabaseClient,
  args: {
    event: AutomationEventRow
    automationId: string
    recipient: ResolvedRecipient
    status: string
    detail: string | null
  },
): Promise<boolean> {
  const { error } = await db.from('automation_event_deliveries').insert({
    account_id: args.event.account_id,
    event_id: args.event.id,
    automation_id: args.automationId,
    recipient_key: args.recipient.key,
    recipient_type: args.recipient.type,
    recipient_phone: args.recipient.phone,
    status: args.status,
    detail: args.detail,
  })
  // A unique violation means someone already claimed this recipient.
  return !error
}

async function updateDelivery(
  db: SupabaseClient,
  eventId: string,
  automationId: string,
  recipientKey: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .from('automation_event_deliveries')
    .update(patch)
    .eq('event_id', eventId)
    .eq('automation_id', automationId)
    .eq('recipient_key', recipientKey)
}

// ------------------------------------------------------------
// Context assembly
// ------------------------------------------------------------

export type EventContext = Record<string, Record<string, unknown> | undefined>

async function buildContext(
  db: SupabaseClient,
  event: AutomationEventRow,
  cache: WorkerCache,
): Promise<EventContext> {
  const snapshot = event.record_snapshot ?? {}
  const context: EventContext = {}

  switch (event.event_type) {
    case 'customer_created':
      context.customer = snapshot
      break

    case 'order_created':
    case 'order_status_changed': {
      context.order = snapshot
      const contactId = snapshot.contact_id as string | undefined
      if (contactId) {
        context.customer = await cache.contact(db, event.account_id, contactId)
      }
      break
    }

    case 'dispatch_created': {
      context.dispatch = snapshot
      const orderId = snapshot.order_id as string | undefined
      if (orderId) {
        context.order = await cache.order(db, event.account_id, orderId)
      }
      // Resolved by the trigger at emit time, so it reflects who the customer
      // was when the dispatch happened.
      const contactId = snapshot._resolved_contact_id as string | undefined
      if (contactId) {
        context.customer = await cache.contact(db, event.account_id, contactId)
      }
      break
    }
  }

  if (event.previous_snapshot) context.previous = event.previous_snapshot
  return context
}

function contactIdFor(event: AutomationEventRow, context: EventContext): string | null {
  if (event.event_type === 'customer_created') return event.record_id
  const customer = context.customer
  return (customer?.id as string | undefined) ?? null
}

function creatorUserIdFor(context: EventContext): string | null {
  const source = context.order ?? context.dispatch ?? context.customer
  return (source?.user_id as string | undefined) ?? null
}

// ------------------------------------------------------------
// Template variables
// ------------------------------------------------------------

/**
 * Turn the admin's variable mapping into Meta's positional parameter list.
 *
 * A mapping value written as `{{customer.company}}` is read from the event;
 * anything else is used as literal text. Keys are sorted NUMERICALLY — sorting
 * "1","2",…,"10" as text yields 1,10,2, which silently scrambles every template
 * with ten or more variables. The existing engine already learned this lesson;
 * the same rule is applied here.
 *
 * An unresolvable variable becomes an empty string rather than being dropped,
 * because Meta rejects a template call with a missing positional parameter — a
 * blank is recoverable, a gap is not.
 */
export function renderParams(
  variables: Record<string, string> | undefined,
  context: EventContext,
): string[] {
  if (!variables) return []
  return Object.keys(variables)
    .sort((a, b) => {
      const na = Number(a)
      const nb = Number(b)
      const aNum = Number.isFinite(na)
      const bNum = Number.isFinite(nb)
      if (aNum && bNum) return na - nb
      if (aNum) return -1
      if (bNum) return 1
      return a.localeCompare(b)
    })
    .map((key) => resolveVariable(variables[key], context))
}

function resolveVariable(spec: string | undefined, context: EventContext): string {
  if (spec === undefined || spec === null) return ''
  const match = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(String(spec))
  if (!match) return String(spec)

  const path = match[1]
  const separator = path.indexOf('.')
  if (separator <= 0) return ''
  const group = path.slice(0, separator)
  const field = path.slice(separator + 1)
  const value = context[group]?.[field]
  if (value === null || value === undefined) return ''
  return String(value)
}

// ------------------------------------------------------------
// Caches
// ------------------------------------------------------------

interface AccountSettings {
  automationsEnabled: boolean
  staleEventHours: number
}

interface AutomationRow {
  id: string
  user_id: string
  trigger_config: Record<string, unknown> | null
}

interface ActionConfig {
  templateName: string
  language?: string
  variables?: Record<string, string>
  recipients: RecipientConfig[]
}

class WorkerCache {
  private settings = new Map<string, AccountSettings>()
  private automationsByKey = new Map<string, AutomationRow[]>()
  private actions = new Map<string, ActionConfig | null>()
  private contacts = new Map<string, Record<string, unknown> | undefined>()
  private orders = new Map<string, Record<string, unknown> | undefined>()
  private catalogs = new Map<string, ReturnType<typeof buildCatalogFor>>()

  async accountSettings(db: SupabaseClient, accountId: string): Promise<AccountSettings> {
    const hit = this.settings.get(accountId)
    if (hit) return hit

    const { data } = await db
      .from('accounts')
      .select('settings')
      .eq('id', accountId)
      .maybeSingle()

    const raw = ((data?.settings ?? {}) as Record<string, unknown>).automation_settings as
      | Record<string, unknown>
      | undefined

    const value: AccountSettings = {
      // Absent means enabled. Only an explicit false switches automations off.
      automationsEnabled: raw?.enabled !== false,
      staleEventHours:
        typeof raw?.stale_event_hours === 'number' && raw.stale_event_hours > 0
          ? raw.stale_event_hours
          : DEFAULT_STALE_EVENT_HOURS,
    }
    this.settings.set(accountId, value)
    return value
  }

  async automations(
    db: SupabaseClient,
    accountId: string,
    eventType: string,
  ): Promise<AutomationRow[]> {
    const key = `${accountId}:${eventType}`
    const hit = this.automationsByKey.get(key)
    if (hit) return hit

    const { data } = await db
      .from('automations')
      .select('id, user_id, trigger_config')
      .eq('account_id', accountId)
      .eq('trigger_type', eventType)
      .eq('is_active', true)

    const rows = (data ?? []) as AutomationRow[]
    this.automationsByKey.set(key, rows)
    return rows
  }

  /**
   * The single send_template step that carries the action config.
   *
   * Stored in `automation_steps` rather than a new table so module automations
   * reuse the existing step storage, builder and validation — extend before
   * replace.
   */
  async action(db: SupabaseClient, automationId: string): Promise<ActionConfig | null> {
    if (this.actions.has(automationId)) return this.actions.get(automationId) ?? null

    const { data } = await db
      .from('automation_steps')
      .select('step_type, step_config, position')
      .eq('automation_id', automationId)
      .order('position', { ascending: true })

    const step = (data ?? []).find(
      (s: { step_type: string }) => s.step_type === 'send_template',
    ) as { step_config: Record<string, unknown> } | undefined

    let value: ActionConfig | null = null
    if (step) {
      const cfg = step.step_config ?? {}
      const templateName = cfg.template_name as string | undefined
      if (templateName) {
        value = {
          templateName,
          language: cfg.language as string | undefined,
          variables: cfg.variables as Record<string, string> | undefined,
          recipients: (cfg.recipients as RecipientConfig[] | undefined) ?? [
            { type: 'customer' },
          ],
        }
      }
    }
    this.actions.set(automationId, value)
    return value
  }

  async contact(
    db: SupabaseClient,
    accountId: string,
    contactId: string,
  ): Promise<Record<string, unknown> | undefined> {
    if (this.contacts.has(contactId)) return this.contacts.get(contactId)
    const { data } = await db
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    const row = (data as Record<string, unknown> | null) ?? undefined
    this.contacts.set(contactId, row)
    return row
  }

  async order(
    db: SupabaseClient,
    accountId: string,
    orderId: string,
  ): Promise<Record<string, unknown> | undefined> {
    if (this.orders.has(orderId)) return this.orders.get(orderId)
    const { data } = await db
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('account_id', accountId)
      .maybeSingle()
    const row = (data as Record<string, unknown> | null) ?? undefined
    this.orders.set(orderId, row)
    return row
  }

  catalog(eventType: AutomationEventType) {
    const hit = this.catalogs.get(eventType)
    if (hit) return hit
    const built = buildCatalogFor(eventType)
    this.catalogs.set(eventType, built)
    return built
  }
}

function buildCatalogFor(eventType: AutomationEventType) {
  const moduleKey = EVENT_MODULE[eventType] ?? 'customer'
  // Custom-field labels are irrelevant to the worker — it only needs types for
  // numeric/date coercion, so the registry is not fetched here.
  const { groups } = buildFieldCatalog(moduleKey, [])
  return { groups, types: fieldTypeMap(groups) }
}
