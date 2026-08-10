// ------------------------------------------------------------
// Recipient resolution for module automations.
//
// "Send to" is configured per automation and allows several recipients at once,
// because who should hear about an event genuinely depends on the event: a new
// customer gets a welcome, a dispatch goes to the customer AND the rep who took
// the order. Founder decision, 2026-08-10.
//
// THE FAILURE MODE THIS FILE EXISTS TO PREVENT: silent non-delivery. Verified in
// production, only 3 of 13 employees have a phone number saved, and
// `profiles.mobile` is empty for all 13 (a dead column — do not read it). So
// choosing "the employee who created the record" reaches nobody for most of the
// team. Every resolution therefore returns an explicit reachable/unreachable
// verdict WITH a reason, so the builder can warn at configuration time and the
// Preview screen can show it before anything is switched on. An automation that
// quietly messages no one is worse than one that visibly fails.
// ------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

export const RECIPIENT_TYPES = [
  'customer',
  'creator',
  'creator_manager',
  'fixed_number',
] as const

export type RecipientType = (typeof RECIPIENT_TYPES)[number]

export const RECIPIENT_LABELS: Record<RecipientType, string> = {
  customer: 'Customer on the record',
  creator: 'Employee who created the record',
  creator_manager: "That employee's manager",
  fixed_number: 'A specific number',
}

export interface RecipientConfig {
  type: RecipientType
  /** Required for `fixed_number`; ignored otherwise. */
  phone?: string
  /** Optional admin note shown in the builder, e.g. "dispatch desk". */
  label?: string
}

export interface ResolvedRecipient {
  type: RecipientType
  /** Stable identity for the delivery ledger's unique constraint. */
  key: string
  /** Human name for Preview and logs. */
  label: string
  /**
   * Digits only, no leading '+' — the format Meta's API expects. Null when
   * unreachable.
   */
  phone: string | null
  reachable: boolean
  /** Plain-English explanation when unreachable. Shown to the admin verbatim. */
  reason?: string
  /**
   * Set when the number looks sendable but is likely to be rejected — today
   * that means "no country code". Reachable stays true (we don't block on a
   * guess), but the builder and Preview must show this prominently.
   */
  warning?: string
  /** Set for customer recipients so their message lands in the inbox thread. */
  contactId?: string
}

/**
 * Shortest plausible international number: a 1-3 digit country code plus a
 * national number. Anything with 10 digits or fewer is almost certainly a bare
 * national number — 9 of 27 production customers are stored that way, as plain
 * 10-digit Indian mobiles.
 *
 * This is a WARNING, not a block. `isValidE164` accepts a bare 10-digit number,
 * and a hard block would be a guess: a handful of countries do produce short
 * international numbers legitimately. So the send is still attempted, but the
 * admin is told which numbers are likely to bounce BEFORE they switch the
 * automation on, rather than discovering it from a cryptic Meta error after.
 */
const LIKELY_MISSING_COUNTRY_CODE_MAX_DIGITS = 10

export interface RecipientContext {
  accountId: string
  /** The customer on the triggering record, if any. */
  contactId?: string | null
  /** `user_id` from the triggering record — who created it. */
  creatorUserId?: string | null
}

interface ContactRow {
  id: string
  name: string | null
  company: string | null
  phone: string | null
}

interface ProfileRow {
  user_id: string
  full_name: string | null
  phone: string | null
  manager_id: string | null
}

/**
 * Resolve every configured recipient for one event.
 *
 * Never throws. An unresolvable recipient comes back `reachable: false` with a
 * reason, so the caller records a skipped delivery rather than losing the whole
 * event — one employee without a phone number must not stop the customer
 * getting their order confirmation.
 */
export async function resolveRecipients(
  db: SupabaseClient,
  configs: RecipientConfig[],
  ctx: RecipientContext,
): Promise<ResolvedRecipient[]> {
  const out: ResolvedRecipient[] = []

  // Fetch each related record at most once, even when several recipient types
  // need it (creator and creator_manager both start from the same profile).
  let contact: ContactRow | null | undefined
  let creator: ProfileRow | null | undefined

  const loadContact = async (): Promise<ContactRow | null> => {
    if (contact !== undefined) return contact
    if (!ctx.contactId) {
      contact = null
      return null
    }
    const { data } = await db
      .from('contacts')
      .select('id, name, company, phone')
      .eq('id', ctx.contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    contact = (data as ContactRow | null) ?? null
    return contact
  }

  const loadCreator = async (): Promise<ProfileRow | null> => {
    if (creator !== undefined) return creator
    if (!ctx.creatorUserId) {
      creator = null
      return null
    }
    const { data } = await db
      .from('profiles')
      .select('user_id, full_name, phone, manager_id')
      .eq('user_id', ctx.creatorUserId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    creator = (data as ProfileRow | null) ?? null
    return creator
  }

  for (const config of configs) {
    switch (config.type) {
      case 'customer': {
        const c = await loadContact()
        if (!c) {
          out.push({
            type: 'customer',
            key: 'customer:none',
            label: 'Customer',
            phone: null,
            reachable: false,
            reason: 'this record has no customer linked to it',
          })
          break
        }
        const display = c.company || c.name || 'Unnamed customer'
        out.push({
          ...phoneVerdict(c.phone, `no phone number saved for ${display}`),
          type: 'customer',
          key: `customer:${c.id}`,
          label: display,
          contactId: c.id,
        })
        break
      }

      case 'creator': {
        const p = await loadCreator()
        if (!p) {
          out.push({
            type: 'creator',
            key: 'creator:none',
            label: 'Employee who created the record',
            phone: null,
            reachable: false,
            reason: 'the employee who created this record could not be found',
          })
          break
        }
        const display = p.full_name || 'Employee'
        out.push({
          ...phoneVerdict(p.phone, `no phone number saved for ${display}`),
          type: 'creator',
          key: `creator:${p.user_id}`,
          label: display,
        })
        break
      }

      case 'creator_manager': {
        const p = await loadCreator()
        if (!p) {
          out.push({
            type: 'creator_manager',
            key: 'creator_manager:none',
            label: "Employee's manager",
            phone: null,
            reachable: false,
            reason: 'the employee who created this record could not be found',
          })
          break
        }
        if (!p.manager_id) {
          out.push({
            type: 'creator_manager',
            key: 'creator_manager:none',
            label: "Employee's manager",
            phone: null,
            reachable: false,
            reason: `${p.full_name || 'that employee'} has no manager set`,
          })
          break
        }
        // manager_id points at profiles.id, not profiles.user_id.
        const { data: mgr } = await db
          .from('profiles')
          .select('user_id, full_name, phone, manager_id')
          .eq('id', p.manager_id)
          .eq('account_id', ctx.accountId)
          .maybeSingle()
        const manager = mgr as ProfileRow | null
        if (!manager) {
          out.push({
            type: 'creator_manager',
            key: 'creator_manager:none',
            label: "Employee's manager",
            phone: null,
            reachable: false,
            reason: 'the assigned manager could not be found',
          })
          break
        }
        const display = manager.full_name || 'Manager'
        out.push({
          ...phoneVerdict(manager.phone, `no phone number saved for ${display}`),
          type: 'creator_manager',
          key: `creator_manager:${manager.user_id}`,
          label: display,
        })
        break
      }

      case 'fixed_number': {
        const label = config.label?.trim() || 'Fixed number'
        out.push({
          ...phoneVerdict(config.phone, 'no number was entered for this recipient'),
          type: 'fixed_number',
          key: `phone:${sanitizePhoneForMeta(config.phone ?? '')}`,
          label,
        })
        break
      }

      default: {
        const unknown: string = config.type
        out.push({
          type: config.type,
          key: `unknown:${unknown}`,
          label: unknown,
          phone: null,
          reachable: false,
          reason: `unknown recipient type "${unknown}"`,
        })
      }
    }
  }

  return dedupeByPhone(out)
}

function phoneVerdict(
  raw: string | null | undefined,
  missingReason: string,
): { phone: string | null; reachable: boolean; reason?: string; warning?: string } {
  if (!raw || raw.trim() === '') {
    return { phone: null, reachable: false, reason: missingReason }
  }
  // Meta wants digits only, so the '+' is stripped here and never sent.
  const sanitized = sanitizePhoneForMeta(raw)
  if (!isValidE164(sanitized)) {
    return {
      phone: null,
      reachable: false,
      reason: `"${raw}" is not a usable WhatsApp number`,
    }
  }
  if (sanitized.length <= LIKELY_MISSING_COUNTRY_CODE_MAX_DIGITS) {
    return {
      phone: sanitized,
      reachable: true,
      warning: `"${raw}" has no country code, so WhatsApp will probably reject it. Add one, e.g. +91${sanitized}.`,
    }
  }
  return { phone: sanitized, reachable: true }
}

/** Format a resolved number for display. Meta gets digits; humans get a '+'. */
export function displayPhone(phone: string | null): string {
  if (!phone) return '—'
  return phone.startsWith('+') ? phone : `+${phone}`
}

/**
 * Collapse recipients that resolve to the same number.
 *
 * A rep who saved their own mobile as the customer's contact number would
 * otherwise get the same message twice — and be billed twice. The first
 * occurrence wins so the customer entry (listed first by convention) keeps its
 * conversation context and the message still reaches the inbox thread.
 */
function dedupeByPhone(recipients: ResolvedRecipient[]): ResolvedRecipient[] {
  const seen = new Set<string>()
  const out: ResolvedRecipient[] = []
  for (const r of recipients) {
    if (!r.reachable || !r.phone) {
      out.push(r)
      continue
    }
    if (seen.has(r.phone)) continue
    seen.add(r.phone)
    out.push(r)
  }
  return out
}

/**
 * Which recipient types make sense for an event.
 *
 * Every event can reach the customer, the creator, their manager, or a fixed
 * number — the founder's point was that the CHOICE must be the admin's, not
 * hardcoded per event. This exists so the builder can order the list sensibly
 * and default to the obvious one, not to restrict it.
 */
export function defaultRecipientsForEvent(eventType: string): RecipientType[] {
  switch (eventType) {
    case 'customer_created':
      return ['customer']
    case 'order_created':
      return ['customer']
    case 'order_status_changed':
      return ['customer']
    case 'dispatch_created':
      return ['customer', 'creator']
    default:
      return ['customer']
  }
}
