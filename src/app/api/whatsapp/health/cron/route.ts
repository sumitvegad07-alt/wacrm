import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkConnectionHealth } from '@/lib/whatsapp/connection-health'

/**
 * GET /api/whatsapp/health/cron
 *
 * Checks every account's WhatsApp connection and repairs what can be repaired.
 *
 * The problem this solves: a WhatsApp connection dies silently. Nothing errors,
 * the saved status still reads "connected", and messages simply stop. This
 * account experienced exactly that. Automations make it worse — every automation
 * depends on a live connection, so an expired token turns into every customer
 * message silently failing.
 *
 * Two outcomes per account:
 *   * The WABA app subscription has lapsed (inbound messages stop while outbound
 *     keeps working, so nothing looks wrong) — re-subscribed automatically. Meta's
 *     endpoint is idempotent, so no reconnection and no re-entered credentials.
 *   * The token is expiring or dead — cannot be self-healed, so the row is marked
 *     and the UI warns, ideally days before it stops working.
 *
 * Secured the same way as the existing automations cron: a shared secret in the
 * `x-cron-secret` header. Recommended schedule: once every 6 hours. That is
 * frequent enough to catch a 24-hour temporary token before it kills a whole
 * working day, without hammering Meta.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const { data: configs, error } = await db
    .from('whatsapp_config')
    .select('account_id, phone_number_id, waba_id, access_token, status')

  if (error) {
    console.error('[whatsapp-health] could not read configs:', error)
    return NextResponse.json({ error: 'could not read configurations' }, { status: 500 })
  }
  if (!configs || configs.length === 0) {
    return NextResponse.json({ checked: 0, repaired: 0, degraded: 0 })
  }

  let repaired = 0
  let degraded = 0

  for (const config of configs) {
    try {
      // A token that cannot be decrypted is a broken row, not a Meta problem —
      // usually a changed ENCRYPTION_KEY. Record it rather than crashing the
      // whole sweep for every other account.
      let accessToken: string
      try {
        accessToken = decrypt(config.access_token as string)
      } catch {
        await persist(config.account_id as string, {
          status: 'disconnected',
          last_registration_error:
            'The saved access token could not be read. Re-save it in Settings → WhatsApp.',
        })
        degraded++
        continue
      }

      const health = await checkConnectionHealth({
        phoneNumberId: config.phone_number_id as string,
        wabaId: (config.waba_id as string | null) ?? null,
        accessToken,
        repair: true,
      })

      if (health.checks.subscriptionRepaired) repaired++
      if (health.level !== 'healthy') degraded++

      const patch: Record<string, unknown> = {
        status: health.level === 'broken' ? 'disconnected' : 'connected',
        // Reuse the existing column the settings UI already surfaces, so the
        // warning appears without waiting on new UI.
        last_registration_error:
          health.level === 'healthy' ? null : [health.summary, ...health.actions].join(' '),
        updated_at: new Date().toISOString(),
      }

      // Only write this when Meta actually answered. On 'unknown' the stored
      // value is left untouched — clearing it on a network blip would make a
      // working connection look broken, which is precisely the false signal
      // that caused a wrong diagnosis on this account before.
      if (health.checks.subscriptionState === 'yes') {
        patch.subscribed_apps_at = new Date().toISOString()
      } else if (health.checks.subscriptionState === 'no') {
        patch.subscribed_apps_at = null
      }

      await persist(config.account_id as string, patch)
    } catch (err) {
      // One account's failure must never stop the sweep for the others.
      console.error('[whatsapp-health] check failed for account:', config.account_id, err)
      degraded++
    }
  }

  return NextResponse.json({ checked: configs.length, repaired, degraded })
}

async function persist(accountId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('whatsapp_config')
    .update(patch)
    .eq('account_id', accountId)
  if (error) {
    console.error('[whatsapp-health] could not persist health for', accountId, error)
  }
}
