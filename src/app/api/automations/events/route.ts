import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/automations/events
 *
 * Recent business events and what each one actually did.
 *
 * This screen exists to answer one question in ten seconds: "why didn't my
 * customer get a message?" Without it the only honest answer is "open the
 * database", which is not an answer. Every outcome the worker can produce —
 * sent, skipped as stale, blocked by the kill switch, no automation matched,
 * recipient unreachable — is recorded and surfaced here rather than inferred.
 *
 * Admin+ only: the delivery rows contain customer phone numbers.
 */
const querySchema = z.object({
  module: z.enum(['customer', 'order', 'dispatch']).optional(),
  status: z.enum(['pending', 'processing', 'done', 'skipped', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const params = new URL(request.url).searchParams

    const parsed = querySchema.safeParse({
      module: params.get('module') ?? undefined,
      status: params.get('status') ?? undefined,
      limit: params.get('limit') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid filter values' }, { status: 400 })
    }
    const { module: moduleKey, status, limit } = parsed.data

    let query = ctx.supabase
      .from('automation_events')
      .select(
        'id, module, event_type, record_id, record_snapshot, occurred_at, enqueued_at, status, skip_reason, attempts, last_error, processed_at',
      )
      .eq('account_id', ctx.accountId)
      .order('enqueued_at', { ascending: false })
      .limit(limit)

    if (moduleKey) query = query.eq('module', moduleKey)
    if (status) query = query.eq('status', status)

    const { data: events, error } = await query
    if (error) {
      console.error('[automations/events] query failed:', error)
      return NextResponse.json({ error: 'Could not load events' }, { status: 500 })
    }

    const rows = events ?? []
    if (rows.length === 0) return NextResponse.json({ events: [] })

    // One extra query for every delivery in the page, rather than one per event.
    const { data: deliveries } = await ctx.supabase
      .from('automation_event_deliveries')
      .select('event_id, automation_id, recipient_type, recipient_phone, status, detail, created_at')
      .eq('account_id', ctx.accountId)
      .in(
        'event_id',
        rows.map((r) => r.id as string),
      )

    const byEvent = new Map<string, unknown[]>()
    for (const d of deliveries ?? []) {
      const key = d.event_id as string
      const list = byEvent.get(key) ?? []
      list.push(d)
      byEvent.set(key, list)
    }

    return NextResponse.json({
      events: rows.map((e) => ({
        ...e,
        // A label the admin recognises, so the table doesn't show bare UUIDs.
        record_label: recordLabel(e.record_snapshot as Record<string, unknown> | null),
        deliveries: byEvent.get(e.id as string) ?? [],
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function recordLabel(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return '—'
  const order = snapshot.order_number
  if (typeof order === 'string' && order) return order
  const dispatch = snapshot.dispatch_number
  if (typeof dispatch === 'string' && dispatch) return dispatch
  const company = snapshot.company
  if (typeof company === 'string' && company) return company
  const name = snapshot.name
  if (typeof name === 'string' && name) return name
  return '—'
}
