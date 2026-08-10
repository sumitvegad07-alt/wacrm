// ------------------------------------------------------------
// Simulator provider — records what WOULD be sent, sends nothing.
//
// Used by:
//   * every automated test, so the suite never needs a Meta token and can never
//     message a real customer;
//   * the Preview / Test-mode screen, so an admin can see exactly who would be
//     messaged and with what text before going live;
//   * local development and any account with no WhatsApp configured.
//
// It deliberately imitates the real provider's failure modes rather than always
// succeeding — a simulator that can only succeed teaches you nothing about the
// retry and dead-letter paths, which is where the real bugs live.
// ------------------------------------------------------------

import {
  PermanentSendError,
  type MessageProvider,
  type SendTemplateRequest,
  type SendTemplateResult,
} from './types'

export interface SimulatedSend extends SendTemplateRequest {
  at: string
  messageId: string
}

export class SimulatorProvider implements MessageProvider {
  readonly name = 'simulator'

  private readonly sent: SimulatedSend[] = []
  private counter = 0

  /**
   * Optional hook so a test can make a specific recipient fail. Return an Error
   * to fail that send, or undefined to let it through.
   */
  constructor(private readonly failFor?: (req: SendTemplateRequest) => Error | undefined) {}

  async sendTemplate(request: SendTemplateRequest): Promise<SendTemplateResult> {
    const failure = this.failFor?.(request)
    if (failure) throw failure

    // Mirror the real provider's cheap guards so the simulator catches the same
    // configuration mistakes a live send would.
    if (!request.toPhone) {
      throw new PermanentSendError('no recipient phone number')
    }
    if (!request.templateName) {
      throw new PermanentSendError('no template selected')
    }

    this.counter += 1
    const messageId = `sim-${this.counter}`
    this.sent.push({ ...request, at: new Date().toISOString(), messageId })
    return { messageId, simulated: true }
  }

  /** Everything this provider was asked to send, in order. */
  get log(): readonly SimulatedSend[] {
    return this.sent
  }

  sentTo(phone: string): SimulatedSend[] {
    return this.sent.filter((s) => s.toPhone === phone)
  }

  get count(): number {
    return this.sent.length
  }

  reset(): void {
    this.sent.length = 0
    this.counter = 0
  }
}
