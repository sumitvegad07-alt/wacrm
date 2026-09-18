// ------------------------------------------------------------
// Pure recipient decision logic for the notification generator.
//
// No IO. Given an event's candidate profiles (already resolved to profiles.id),
// their roles/permissions, and the account's mutes, it returns exactly who
// should receive a notification. This is where the founder's control model lives:
//   right gate  → no right, no notification (owner/admin resolve all-true)
//   personal mute → a granted category the user has silenced is suppressed
//   self-skip   → never notify someone about their own action
//   active only → inactive employees are never notified
// Kept separate from the DB drain so every one of these rules is unit-tested.
// ------------------------------------------------------------

import { hasPermission, type RolePermissions } from '@/lib/auth/rbac'
import { CATEGORY_RIGHT, type NotificationCategory } from './catalog'

export interface CandidateProfile {
  id: string // profiles.id
  accountRole: string | null // owner | admin | agent | viewer
  status: string | null
  permissions: RolePermissions | null // employee_roles.permissions jsonb
}

/** owner/admin resolve as all-true (mirrors the has_permission() DB function). */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function isActive(status: string | null | undefined): boolean {
  return status !== 'inactive'
}

/** Does this profile hold the right that gates the category? */
export function holdsCategoryRight(
  profile: CandidateProfile,
  category: NotificationCategory,
): boolean {
  if (isAdminRole(profile.accountRole)) return true
  return hasPermission(profile.permissions, CATEGORY_RIGHT[category])
}

export interface DecideInput {
  category: NotificationCategory
  /** Distinct profiles.id candidates for this event. */
  candidateIds: string[]
  /** The actor (profiles.id) to skip; null if unknown. */
  actorProfileId: string | null
  profilesById: Map<string, CandidateProfile>
  /** profiles.id that have muted THIS category. */
  mutedIds: Set<string>
}

/**
 * Returns the profiles.id set that should receive the notification, after
 * applying: existence, active, self-skip, right gate, and mute.
 */
export function decideRecipients(input: DecideInput): string[] {
  const { category, candidateIds, actorProfileId, profilesById, mutedIds } = input
  const seen = new Set<string>()
  const out: string[] = []

  for (const id of candidateIds) {
    if (seen.has(id)) continue
    seen.add(id)

    if (id === actorProfileId) continue // never notify about your own action
    const profile = profilesById.get(id)
    if (!profile) continue
    if (!isActive(profile.status)) continue
    if (!holdsCategoryRight(profile, category)) continue
    if (mutedIds.has(id)) continue

    out.push(id)
  }

  return out
}
