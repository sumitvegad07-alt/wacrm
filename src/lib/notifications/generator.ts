// ------------------------------------------------------------
// Notification generator — drains notification_outbox and fans each business
// event out into per-recipient `notifications` rows.
//
// IO lives here; the decision rules (rights, mute, self-skip, active) live in
// generator-core.ts and are unit-tested. This file's job is to fetch the right
// data, normalise the id-space footgun (actor/assignee columns are a mix of
// profiles.id and auth user_id — we resolve by matching EITHER), and write rows
// idempotently.
//
// Idempotency: notifications has UNIQUE(source_event_id, recipient_user_id) and
// we upsert with ignoreDuplicates, so re-processing an outbox row (overlapping
// cron runs, retries) never double-notifies. Marking the outbox row done is
// itself idempotent, so we deliberately keep the claim lightweight.
// ------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RolePermissions } from '@/lib/auth/rbac'
import {
  EVENT_SPECS,
  buildContent,
  extractActorRawId,
  extractAssigneeRawId,
  extractAnnouncementTargets,
} from './catalog'
import { decideRecipients, type CandidateProfile } from './generator-core'

const BATCH_SIZE = 100
const MAX_ATTEMPTS = 3

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

interface OutboxRow {
  id: string
  account_id: string
  event_type: string
  record_id: string
  record_snapshot: Record<string, unknown>
  actor_user_id: string | null
  occurred_at: string
  attempts: number
}

export interface GenerateResult {
  processed: number
  created: number
  skipped: number
  failed: number
}

export async function drainNotifications({
  db,
}: {
  db: SupabaseClient
}): Promise<GenerateResult> {
  const { data: rows, error } = await db
    .from('notification_outbox')
    .select('id, account_id, event_type, record_id, record_snapshot, actor_user_id, occurred_at, attempts')
    .eq('status', 'pending')
    .order('occurred_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) throw new Error(`notification_outbox read failed: ${error.message}`)
  const events = (rows ?? []) as OutboxRow[]

  const result: GenerateResult = { processed: 0, created: 0, skipped: 0, failed: 0 }

  for (const ev of events) {
    try {
      const created = await processEvent(db, ev)
      result.processed += 1
      if (created > 0) result.created += created
      else result.skipped += 1
      await db
        .from('notification_outbox')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', ev.id)
    } catch (err) {
      result.failed += 1
      const attempts = (ev.attempts ?? 0) + 1
      await db
        .from('notification_outbox')
        .update({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          last_error: err instanceof Error ? err.message : String(err),
        })
        .eq('id', ev.id)
    }
  }

  return result
}

/** Returns how many notification rows were created for this event. */
async function processEvent(db: SupabaseClient, ev: OutboxRow): Promise<number> {
  const spec = EVENT_SPECS[ev.event_type]
  if (!spec) return 0 // unknown event type — nothing to do

  const snap = ev.record_snapshot ?? {}
  const actorRaw = extractActorRawId(ev.event_type, snap) ?? ev.actor_user_id
  const actorProfileId = actorRaw ? await resolveOne(db, ev.account_id, actorRaw) : null

  const candidateIds = await buildCandidates(db, ev, spec.strategy, actorProfileId)
  if (candidateIds.length === 0) return 0

  const profilesById = await fetchProfiles(db, candidateIds)
  const mutedIds = await fetchMuted(db, candidateIds, spec.category)

  const recipients = decideRecipients({
    category: spec.category,
    candidateIds,
    actorProfileId,
    profilesById,
    mutedIds,
  })
  if (recipients.length === 0) return 0

  const actorName = actorProfileId ? await fetchDisplayName(db, actorProfileId) : null
  const { title, body } = buildContent(ev.event_type, snap, actorName)

  const rows = recipients.map((recipient_user_id) => ({
    account_id: ev.account_id,
    recipient_user_id,
    category: spec.category,
    event_type: ev.event_type,
    source_event_id: ev.id,
    title,
    body,
    data: { entity: spec.entity, id: ev.record_id },
  }))

  const { error } = await db
    .from('notifications')
    .upsert(rows, { onConflict: 'source_event_id,recipient_user_id', ignoreDuplicates: true })
  if (error) throw new Error(`notifications upsert failed: ${error.message}`)

  return rows.length
}

/** profiles.id list of candidates for an event, per recipient strategy. */
async function buildCandidates(
  db: SupabaseClient,
  ev: OutboxRow,
  strategy: 'assignee' | 'team' | 'announcement',
  actorProfileId: string | null,
): Promise<string[]> {
  const snap = ev.record_snapshot ?? {}

  if (strategy === 'assignee') {
    const raw = extractAssigneeRawId(ev.event_type, snap)
    const id = raw ? await resolveOne(db, ev.account_id, raw) : null
    return id ? [id] : []
  }

  if (strategy === 'team') {
    const ids = new Set<string>()
    // The actor's direct manager (hierarchy).
    if (actorProfileId) {
      const { data } = await db
        .from('profiles')
        .select('manager_id')
        .eq('id', actorProfileId)
        .maybeSingle()
      const managerId = (data as { manager_id?: string } | null)?.manager_id
      if (isUuid(managerId)) ids.add(managerId)
    }
    // Plus every admin/owner in the account (they hold the right all-true).
    const { data: admins } = await db
      .from('profiles')
      .select('id')
      .eq('account_id', ev.account_id)
      .in('account_role', ['owner', 'admin'])
      .eq('status', 'active')
    for (const a of (admins ?? []) as { id: string }[]) ids.add(a.id)
    return [...ids]
  }

  // announcement
  const { employeeRawIds, roleIds } = extractAnnouncementTargets(snap)
  if (employeeRawIds.length === 0 && roleIds.length === 0) {
    const { data } = await db
      .from('profiles')
      .select('id')
      .eq('account_id', ev.account_id)
      .eq('status', 'active')
    return ((data ?? []) as { id: string }[]).map((r) => r.id)
  }
  const ids = new Set<string>()
  if (employeeRawIds.length > 0) {
    for (const id of await resolveMany(db, ev.account_id, employeeRawIds)) ids.add(id)
  }
  if (roleIds.length > 0) {
    const { data } = await db
      .from('profiles')
      .select('id')
      .eq('account_id', ev.account_id)
      .in('employee_role_id', roleIds.filter(isUuid))
      .eq('status', 'active')
    for (const r of (data ?? []) as { id: string }[]) ids.add(r.id)
  }
  return [...ids]
}

/**
 * Resolve a raw id (profiles.id OR auth user_id) to a canonical profiles.id,
 * scoped to the account. Returns null if it matches neither.
 */
async function resolveOne(
  db: SupabaseClient,
  accountId: string,
  rawId: string,
): Promise<string | null> {
  const [only] = await resolveMany(db, accountId, [rawId])
  return only ?? null
}

async function resolveMany(
  db: SupabaseClient,
  accountId: string,
  rawIds: string[],
): Promise<string[]> {
  const ids = rawIds.filter(isUuid)
  if (ids.length === 0) return []
  const list = ids.join(',')
  const { data, error } = await db
    .from('profiles')
    .select('id, user_id')
    .eq('account_id', accountId)
    .or(`id.in.(${list}),user_id.in.(${list})`)
  if (error) throw new Error(`profile resolve failed: ${error.message}`)
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

async function fetchProfiles(
  db: SupabaseClient,
  profileIds: string[],
): Promise<Map<string, CandidateProfile>> {
  const map = new Map<string, CandidateProfile>()
  if (profileIds.length === 0) return map

  const { data: profs, error } = await db
    .from('profiles')
    .select('id, account_role, status, employee_role_id')
    .in('id', profileIds)
  if (error) throw new Error(`profiles fetch failed: ${error.message}`)

  const roleIds = [
    ...new Set(
      ((profs ?? []) as { employee_role_id: string | null }[])
        .map((p) => p.employee_role_id)
        .filter(isUuid),
    ),
  ]
  const permsByRole = new Map<string, RolePermissions | null>()
  if (roleIds.length > 0) {
    const { data: roles } = await db
      .from('employee_roles')
      .select('id, permissions')
      .in('id', roleIds)
    for (const r of (roles ?? []) as { id: string; permissions: RolePermissions | null }[]) {
      permsByRole.set(r.id, r.permissions ?? null)
    }
  }

  for (const p of (profs ?? []) as {
    id: string
    account_role: string | null
    status: string | null
    employee_role_id: string | null
  }[]) {
    map.set(p.id, {
      id: p.id,
      accountRole: p.account_role,
      status: p.status,
      permissions: p.employee_role_id ? permsByRole.get(p.employee_role_id) ?? null : null,
    })
  }
  return map
}

async function fetchMuted(
  db: SupabaseClient,
  profileIds: string[],
  category: string,
): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set()
  const { data } = await db
    .from('notification_preferences')
    .select('user_id')
    .in('user_id', profileIds)
    .eq('category', category)
    .eq('muted', true)
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))
}

async function fetchDisplayName(db: SupabaseClient, profileId: string): Promise<string | null> {
  const { data } = await db
    .from('profiles')
    .select('full_name, email')
    .eq('id', profileId)
    .maybeSingle()
  const p = data as { full_name?: string | null; email?: string | null } | null
  return p?.full_name || p?.email || null
}
