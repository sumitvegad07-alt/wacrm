import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { drainNotifications } from '@/lib/notifications/generator'
import { dispatchPush } from '@/lib/notifications/dispatcher'

/**
 * GET /api/notifications/cron
 *
 * One tick of the Notifications pipeline: drain notification_outbox into
 * per-recipient `notifications` rows (generator), then deliver undelivered rows
 * to devices via Expo (dispatcher). Web reads `notifications` over Realtime, so
 * the in-app centre updates without this route.
 *
 * Secured with the shared AUTOMATION_CRON_SECRET (same scheme as the automations
 * cron) rather than inventing a second secret. Recommended schedule: every minute.
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
    const db = supabaseAdmin()
    const generated = await drainNotifications({ db })
    const dispatched = await dispatchPush({ db })
    return NextResponse.json({ generated, dispatched })
  } catch (err) {
    console.error('[notifications/cron] failed:', err)
    return NextResponse.json({ error: 'notifications tick failed' }, { status: 500 })
  }
}
