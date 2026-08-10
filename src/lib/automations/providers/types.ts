// ------------------------------------------------------------
// Message provider abstraction for automations.
//
// WHY THIS EXISTS:
//
//  1. The build must not be blocked on Meta. Business-initiated WhatsApp needs
//     an approved template, approval takes time, and a developer test number
//     can only reach a handful of pre-verified recipients. Routing every send
//     through an interface means the whole automation module — worker,
//     conditions, recipients, retries, idempotency — can be built and verified
//     end to end with zero Meta dependency, then switched to the real sender.
//
//  2. Tests must never call Meta. Automated tests run against the simulator, so
//     the suite needs no live token and costs no money. A test that could send a
//     real WhatsApp message to a real customer is a test nobody dares run.
//
//  3. Future channels. SMS, or a different WhatsApp business provider, becomes a
//     third implementation of this interface rather than a rewrite of the engine.
//
// The interface is deliberately phone-first rather than contact-first: internal
// recipients (an employee, a manager, a fixed number) are not contacts and must
// not have conversation threads created for them.
// ------------------------------------------------------------

export interface SendTemplateRequest {
  /** Tenancy key. Providers must scope every lookup by this. */
  accountId: string
  /** E.164, already sanitized and validated by the caller. */
  toPhone: string
  templateName: string
  language?: string
  /** Positional {{1}}, {{2}}, … values, already in numeric order. */
  params: string[]
  /**
   * Present only for customer recipients, whose message belongs in the inbox
   * thread. Absent for internal recipients — the provider must then send
   * without creating a conversation or a `messages` row.
   */
  conversation?: {
    conversationId: string
    contactId: string
  }
}

export interface SendTemplateResult {
  /** Meta's message id, or a simulated id prefixed `sim-` in the simulator. */
  messageId: string
  /** True when nothing left the building. Recorded in the delivery ledger. */
  simulated: boolean
}

export interface MessageProvider {
  /** Stable identifier recorded in delivery rows and logs: 'meta' | 'simulator'. */
  readonly name: string
  sendTemplate(request: SendTemplateRequest): Promise<SendTemplateResult>
}

/** Thrown for a permanent rejection — the worker must not retry these. */
export class PermanentSendError extends Error {
  readonly permanent = true
  constructor(message: string) {
    super(message)
    this.name = 'PermanentSendError'
  }
}

/** Thrown for a transient failure (network, rate limit) — safe to retry. */
export class TransientSendError extends Error {
  readonly permanent = false
  constructor(message: string) {
    super(message)
    this.name = 'TransientSendError'
  }
}

export function isPermanentSendError(err: unknown): boolean {
  return err instanceof PermanentSendError
}
