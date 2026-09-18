// ------------------------------------------------------------
// Push dispatcher — delivers undelivered `notifications` rows to devices via the
// Expo Push API, then stamps pushed_at so nothing is sent twice.
//
// The server POST to Expo needs no FCM credentials; FCM is only required inside
// the Expo project for Android DELIVERY. A recipient with no registered device
// token simply gets the in-app notification (web bell / mobile centre) and no
// push — so we stamp pushed_at after every attempt, token or not, to avoid
// reprocessing the same row forever.
// ------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const BATCH_SIZE = 200
const EXPO_CHUNK = 100

export interface DispatchResult {
  considered: number
  pushed: number
  tokens: number
  pruned: number
}

interface NotifRow {
  id: string
  recipient_user_id: string
  title: string
  body: string | null
  data: Record<string, unknown>
}

export async function dispatchPush({ db }: { db: SupabaseClient }): Promise<DispatchResult> {
  const { data, error } = await db
    .from('notifications')
    .select('id, recipient_user_id, title, body, data')
    .is('pushed_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (error) throw new Error(`unpushed notifications read failed: ${error.message}`)

  const notifs = (data ?? []) as NotifRow[]
  const result: DispatchResult = { considered: notifs.length, pushed: 0, tokens: 0, pruned: 0 }
  if (notifs.length === 0) return result

  // One token lookup for all recipients in the batch.
  const recipientIds = [...new Set(notifs.map((n) => n.recipient_user_id))]
  const { data: tokenRows } = await db
    .from('push_tokens')
    .select('user_id, expo_token')
    .in('user_id', recipientIds)
  const tokensByUser = new Map<string, string[]>()
  for (const t of (tokenRows ?? []) as { user_id: string; expo_token: string }[]) {
    const list = tokensByUser.get(t.user_id) ?? []
    list.push(t.expo_token)
    tokensByUser.set(t.user_id, list)
  }

  const messages: { to: string; title: string; body: string; data: Record<string, unknown> }[] = []
  for (const n of notifs) {
    for (const to of tokensByUser.get(n.recipient_user_id) ?? []) {
      messages.push({ to, title: n.title, body: n.body ?? '', data: n.data ?? {} })
    }
  }
  result.tokens = messages.length

  const deadTokens = new Set<string>()
  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK)
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(chunk),
      })
      const json = (await res.json().catch(() => null)) as
        | { data?: { status: string; details?: { error?: string } }[] }
        | null
      json?.data?.forEach((ticket, idx) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          deadTokens.add(chunk[idx].to)
        }
      })
    } catch (err) {
      // A transient Expo outage must not wedge the queue: leave these rows
      // unpushed so the next run retries them.
      console.error('[notifications/dispatch] Expo push failed:', err)
      return result
    }
  }

  // Prune tokens Expo says are dead so they stop costing us on every run.
  if (deadTokens.size > 0) {
    await db.from('push_tokens').delete().in('expo_token', [...deadTokens])
    result.pruned = deadTokens.size
  }

  // Stamp every considered row (token or not) so it is not reprocessed.
  const ids = notifs.map((n) => n.id)
  const { error: upErr } = await db
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .in('id', ids)
  if (upErr) throw new Error(`pushed_at stamp failed: ${upErr.message}`)
  result.pushed = ids.length

  return result
}
