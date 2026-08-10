// ------------------------------------------------------------
// Meta provider — the real WhatsApp sender for automations.
//
// Reuses the existing, working Meta plumbing rather than reimplementing it:
// `sendTemplateMessage` from lib/whatsapp/meta-api, the phone sanitisation and
// variant-retry helpers from lib/whatsapp/phone-utils, and the token decryption
// from lib/whatsapp/encryption.
//
// The one genuinely new behaviour is sending to a phone number that is NOT a
// contact (an employee, a manager, a fixed notification number). Those sends
// must not create a conversation or a `messages` row: conversations are keyed to
// contacts, employees are not contacts, and putting internal alerts into the
// customer inbox would corrupt both the thread list and the customer counts.
// Internal sends are recorded in automation_event_deliveries instead.
// ------------------------------------------------------------

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isRecipientNotAllowedError, phoneVariants } from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from '../admin-client'
import {
  PermanentSendError,
  TransientSendError,
  type MessageProvider,
  type SendTemplateRequest,
  type SendTemplateResult,
} from './types'

interface WhatsAppConfigRow {
  phone_number_id: string
  access_token: string
}

export class MetaProvider implements MessageProvider {
  readonly name = 'meta'

  // Per-drain cache. A batch of 50 events for one account would otherwise
  // re-read and re-decrypt the same credentials 50 times.
  private readonly configCache = new Map<string, WhatsAppConfigRow>()

  async sendTemplate(request: SendTemplateRequest): Promise<SendTemplateResult> {
    const db = supabaseAdmin()
    const config = await this.loadConfig(request.accountId)

    const attempt = async (phone: string): Promise<string> => {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken: config.access_token,
        to: phone,
        templateName: request.templateName,
        language: request.language,
        params: request.params,
      })
      return r.messageId
    }

    // Same variant retry as the manual send path: numbers registered with and
    // without a trunk 0 both need trying before a recipient is declared
    // unreachable.
    const variants = phoneVariants(request.toPhone)
    let messageId = ''
    let lastError: unknown = null

    for (const variant of variants) {
      try {
        messageId = await attempt(variant)
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Only "recipient not allowed" is worth trying another variant for;
        // anything else is a real failure and must surface immediately rather
        // than being retried against every permutation of the number.
        if (!isRecipientNotAllowedError(msg)) {
          throw classifyMetaError(err)
        }
        lastError = err
      }
    }

    if (lastError) throw classifyMetaError(lastError)

    // Customer recipients only: persist to the inbox thread so the automation's
    // message appears in the conversation the agent sees. Internal recipients
    // deliberately skip all of this.
    if (request.conversation) {
      const { error: msgErr } = await db.from('messages').insert({
        conversation_id: request.conversation.conversationId,
        sender_type: 'bot',
        content_type: 'template',
        content_text: null,
        template_name: request.templateName,
        message_id: messageId,
        status: 'sent',
      })
      if (msgErr) {
        // Meta already has the message. Report the bookkeeping failure without
        // claiming the send failed — a retry here would double-message the
        // customer, which is far worse than a missing inbox row.
        throw new PermanentSendError(
          `sent to Meta but the inbox record failed: ${msgErr.message}`,
        )
      }

      await db
        .from('conversations')
        .update({
          last_message_text: `[template:${request.templateName}]`,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.conversation.conversationId)
    }

    return { messageId, simulated: false }
  }

  private async loadConfig(accountId: string): Promise<WhatsAppConfigRow> {
    const cached = this.configCache.get(accountId)
    if (cached) return cached

    const { data, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      throw new TransientSendError(`could not read WhatsApp settings: ${error.message}`)
    }
    if (!data?.phone_number_id || !data.access_token) {
      throw new PermanentSendError('WhatsApp is not connected for this account')
    }

    const row: WhatsAppConfigRow = {
      phone_number_id: data.phone_number_id,
      access_token: decrypt(data.access_token),
    }
    this.configCache.set(accountId, row)
    return row
  }
}

/**
 * Decide whether a Meta failure is worth retrying.
 *
 * Getting this wrong is expensive in both directions: retrying a permanent
 * rejection burns attempts and hides the real problem, while giving up on a
 * transient blip loses a customer's order confirmation for good.
 */
export function classifyMetaError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  const permanentSignals = [
    'template', // unknown / unapproved / paused template
    'invalid parameter',
    'does not exist',
    'not found',
    'unsupported',
    'invalid phone',
    're-engagement message', // outside the 24h window without a template
    'permission',
    'unauthorized',
    'access token',
  ]
  if (permanentSignals.some((s) => lower.includes(s))) {
    return new PermanentSendError(message)
  }

  const transientSignals = [
    'rate limit',
    'too many',
    'timeout',
    'timed out',
    'temporarily',
    'try again',
    'econnreset',
    'enotfound',
    'socket hang up',
    'internal error',
    'service unavailable',
    '503',
    '502',
    '429',
  ]
  if (transientSignals.some((s) => lower.includes(s))) {
    return new TransientSendError(message)
  }

  // Unknown failures are treated as transient. The worker caps attempts at 3 and
  // then marks the event terminally failed, so an unrecognised permanent error
  // costs two extra tries rather than being lost outright.
  return new TransientSendError(message)
}
