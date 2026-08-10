// ------------------------------------------------------------
// Shared conversation lookup/creation.
//
// Extracted from the WhatsApp webhook so the automation engine can reuse it
// rather than copying it. Before this existed, the automation engine's
// `resolveConversationId` threw "no conversation for contact" whenever a
// customer had never messaged in — which is every newly created customer, and
// therefore broke the single most obvious automation there is: welcome a new
// customer. Business-initiated messages need a thread to live in just as much
// as inbound ones do.
// ------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Find the conversation for a contact, creating one if it doesn't exist.
 *
 * `db` must be a service-role client — conversations are created on behalf of
 * the account, not the caller. Tenancy is enforced by the explicit account_id
 * filter here, since the service-role client bypasses RLS.
 *
 * Returns null rather than throwing: callers are fire-and-forget paths where a
 * bookkeeping failure must not take down message delivery.
 */
export async function findOrCreateConversation(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    /** Audit column only — who the thread is attributed to. */
    ownerUserId: string
  },
): Promise<{ id: string } | null> {
  const { data: existing, error: findError } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .maybeSingle()

  if (findError) {
    console.error('[conversations] lookup failed:', findError)
    return null
  }
  if (existing?.id) return { id: existing.id as string }

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: args.accountId,
      user_id: args.ownerUserId,
      contact_id: args.contactId,
    })
    .select('id')
    .single()

  if (createError) {
    // Two events for the same brand-new customer can race here (order created
    // and dispatch created, drained in the same batch). Re-read rather than
    // failing the send — the other one won, which is fine.
    const { data: raced } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', args.accountId)
      .eq('contact_id', args.contactId)
      .maybeSingle()
    if (raced?.id) return { id: raced.id as string }

    console.error('[conversations] create failed:', createError)
    return null
  }

  return { id: created.id as string }
}
