import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { drainEvents } from '@/lib/automations/event-worker'
import { resolveProvider, isSimulateMode } from '@/lib/automations/providers'

/**
 * GET /api/automations/events/cron
 *
 * Drains the `automation_events` outbox: evaluates each queued business event
 * against the account's automations and sends the resulting WhatsApp messages.
 *
 * Secured with the same shared secret as the existing automations cron
 * (`x-cron-secret` / AUTOMATION_CRON_SECRET) rather than inventing a second
 * scheme. Recommended schedule: every minute.
 *
 * Set AUTOMATION_SEND_MODE=simulate to run the full pipeline — conditions,
 * recipients, template rendering, delivery records — without contacting Meta.
 * That is the safe way to watch real events flow before letting anything reach
 * a customer.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await drainEvents({
      db: supabaseAdmin(),
      provider: resolveProvider(),
    })

    return NextResponse.json({
      processed: result.processed,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      requeued: result.requeued,
      mode: isSimulateMode() ? 'simulate' : 'live',
    })
  } catch (err) {
    // The drain itself swallows per-event errors; reaching here means something
    // structural failed (no database, bad credentials). Report it without
    // leaking internals to the caller.
    console.error('[automations/events/cron] drain failed:', err)
    return NextResponse.json({ error: 'drain failed' }, { status: 500 })
  }
}
