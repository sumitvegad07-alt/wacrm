// ------------------------------------------------------------
// WhatsApp connection health.
//
// WHY THIS EXISTS: a WhatsApp connection dying is invisible. Nothing errors,
// no screen turns red — messages just stop, and you find out from a customer.
// This account had exactly that happen, and the stored status still read
// "connected" the whole time.
//
// Two distinct causes, which need distinct handling:
//
//   1. THE TOKEN EXPIRED. Meta's Developer Console issues TEMPORARY tokens
//      that die in ~24 hours. A connection set up with one breaks the next day.
//      This cannot be self-healed — only a human can mint a new token — so the
//      job here is to warn EARLY and say plainly what to do.
//
//   2. THE WABA APP SUBSCRIPTION LAPSED. This one governs INBOUND messages: if
//      the app is not subscribed to the WhatsApp Business Account, Meta stops
//      delivering webhooks and replies never arrive, while outbound sending
//      keeps working — so the connection looks fine. Meta's subscribe call is
//      idempotent, so this CAN be self-healed automatically, with no
//      reconnection and no re-entering credentials.
//
// The design goal is the founder's own words: don't lose the connection, and
// don't make me reconnect everything. So: fix silently what can be fixed, and
// warn loudly and early about what cannot.
// ------------------------------------------------------------

import { debugToken, getSubscribedApps, subscribeWabaToApp, verifyPhoneNumber } from './meta-api'

export type HealthLevel = 'healthy' | 'warning' | 'broken'

export interface ConnectionHealth {
  level: HealthLevel
  /** One sentence, written for a non-technical admin. */
  summary: string
  /** What the admin should actually do. Empty when nothing is needed. */
  actions: string[]
  checks: {
    tokenValid: boolean
    tokenExpiresAt: string | null
    tokenDaysRemaining: number | null
    /** True when Meta reports a non-expiring System User token. */
    tokenIsPermanent: boolean
    tokenType?: string
    phoneReachable: boolean
    phoneLabel?: string
    subscribedToWaba: boolean
    /**
     * 'unknown' means the check itself could not run — never treat it as "not
     * subscribed". Callers persisting this state must leave the stored value
     * alone rather than clearing it.
     */
    subscriptionState: 'yes' | 'no' | 'unknown'
    /** True when this run repaired a missing subscription. */
    subscriptionRepaired: boolean
  }
  checkedAt: string
}

/** Warn this far ahead of expiry, so there's time to act before messages stop. */
const EXPIRY_WARNING_DAYS = 7

export interface CheckConnectionArgs {
  phoneNumberId: string
  wabaId: string | null
  /** Already decrypted by the caller. Never logged. */
  accessToken: string
  /**
   * When true, a missing WABA subscription is re-subscribed automatically.
   * Meta's subscribe endpoint is idempotent, so this is safe to run on a
   * schedule. Set false for a pure read-only diagnostic.
   */
  repair?: boolean
}

export async function checkConnectionHealth(
  args: CheckConnectionArgs,
): Promise<ConnectionHealth> {
  const checkedAt = new Date().toISOString()
  const actions: string[] = []

  // ---- 1. Token -----------------------------------------------------------
  const token = await debugToken({ accessToken: args.accessToken }).catch((err) => ({
    isValid: false,
    expiresAt: null,
    error: err instanceof Error ? err.message : String(err),
  }))

  const tokenIsPermanent = token.isValid && token.expiresAt === null

  // Meta reports expiry to the second, so a token genuinely 5 days out arrives
  // as 4.9999 days. Truncating would tell the admin "4 days" — quietly wrong,
  // and wrong in a way that erodes trust in every other number on the screen.
  // Round for the human-facing count, but drive the urgent "today" escalation
  // off the raw remaining time, so anything inside 24 hours is still treated as
  // today however it rounds.
  const DAY_MS = 86_400_000
  const remainingMs = token.expiresAt !== null ? token.expiresAt * 1000 - Date.now() : null
  const daysRemaining =
    remainingMs !== null ? Math.max(0, Math.round(remainingMs / DAY_MS)) : null
  const expiresWithinADay = remainingMs !== null && remainingMs < DAY_MS

  // ---- 2. Phone number ----------------------------------------------------
  let phoneReachable = false
  let phoneLabel: string | undefined
  if (token.isValid) {
    try {
      const info = await verifyPhoneNumber({
        phoneNumberId: args.phoneNumberId,
        accessToken: args.accessToken,
      })
      phoneReachable = true
      phoneLabel = info.display_phone_number
    } catch {
      phoneReachable = false
    }
  }

  // ---- 3. WABA subscription (inbound messages) ----------------------------
  let subscription: 'yes' | 'no' | 'unknown' = 'unknown'
  let subscriptionRepaired = false

  if (token.isValid && args.wabaId) {
    subscription = await isSubscribed(args.wabaId, args.accessToken)

    // Repair only on a definite "no". Re-subscribing on "unknown" would fire
    // pointless writes at Meta every time the network hiccups.
    if (subscription === 'no' && args.repair) {
      // Self-heal. Idempotent on Meta's side, so a redundant call is harmless,
      // and this is precisely the case that would otherwise force a full
      // disconnect-and-reconnect.
      try {
        await subscribeWabaToApp({ wabaId: args.wabaId, accessToken: args.accessToken })
        subscription = await isSubscribed(args.wabaId, args.accessToken)
        subscriptionRepaired = subscription === 'yes'
      } catch {
        subscription = 'no'
      }
    }
  }

  const subscribedToWaba = subscription === 'yes'

  // ---- Verdict ------------------------------------------------------------
  let level: HealthLevel = 'healthy'
  let summary = 'WhatsApp is connected and working.'

  if (!token.isValid) {
    level = 'broken'
    summary = 'WhatsApp is disconnected — the access token is no longer accepted by Meta.'
    actions.push(
      'Generate a new System User token in Meta Business Settings and save it in Settings → WhatsApp. Choose expiry "Never" so this does not recur.',
    )
  } else if (!phoneReachable) {
    level = 'broken'
    summary = 'The token works, but the WhatsApp number could not be reached at Meta.'
    actions.push(
      'Check the Phone Number ID in Settings → WhatsApp matches the number shown in your Meta app.',
    )
  } else if (!args.wabaId) {
    level = 'warning'
    summary = 'Sending works, but no WhatsApp Business Account ID is saved, so replies will not arrive.'
    actions.push('Add your WhatsApp Business Account ID in Settings → WhatsApp.')
  } else if (subscription === 'no') {
    level = 'warning'
    summary =
      'Sending works, but this app is not subscribed to your WhatsApp Business Account, so incoming messages will not arrive.'
    actions.push(
      'Open Settings → WhatsApp and click Verify Registration. If it still fails, the token may lack the whatsapp_business_management permission.',
    )
  }

  // Expiry warnings layer on top — a connection can be working today and still
  // be hours from dying.
  if (token.isValid && !tokenIsPermanent && daysRemaining !== null) {
    if (expiresWithinADay) {
      level = 'broken'
      summary = 'The WhatsApp access token expires today. Messages are about to stop.'
      actions.unshift(
        'Replace the token now with a System User token set to never expire.',
      )
    } else if (daysRemaining <= EXPIRY_WARNING_DAYS) {
      if (level === 'healthy') level = 'warning'
      summary =
        daysRemaining === 1
          ? 'WhatsApp is working, but the access token expires tomorrow.'
          : `WhatsApp is working, but the access token expires in ${daysRemaining} days.`
      actions.unshift(
        'Replace it with a System User token set to never expire, so the connection stops breaking on a timer.',
      )
    }
  }

  if (subscriptionRepaired && level === 'healthy') {
    summary = 'WhatsApp is connected. Incoming messages had stopped and were restored automatically.'
  }

  return {
    level,
    summary,
    actions,
    checks: {
      tokenValid: token.isValid,
      tokenExpiresAt: token.expiresAt ? new Date(token.expiresAt * 1000).toISOString() : null,
      tokenDaysRemaining: daysRemaining,
      tokenIsPermanent,
      tokenType: 'type' in token ? token.type : undefined,
      phoneReachable,
      phoneLabel,
      subscribedToWaba,
      subscriptionState: subscription,
      subscriptionRepaired,
    },
    checkedAt,
  }
}

/**
 * Three states, deliberately — not a boolean.
 *
 * "We could not check" is NOT the same as "it is not subscribed", and
 * collapsing the two produces false alarms: a transient network blip would
 * report that inbound messaging is broken when it is working perfectly. That
 * exact confusion already happened once on this account, reasoning from a stale
 * local timestamp instead of Meta's actual answer, so the distinction is kept
 * explicit in the type.
 */
async function isSubscribed(
  wabaId: string,
  accessToken: string,
): Promise<'yes' | 'no' | 'unknown'> {
  try {
    const apps = await getSubscribedApps({ wabaId, accessToken })
    if (!Array.isArray(apps)) return 'unknown'
    return apps.length > 0 ? 'yes' : 'no'
  } catch {
    return 'unknown'
  }
}
