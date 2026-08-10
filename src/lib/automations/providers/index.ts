// ------------------------------------------------------------
// Provider selection.
//
// Which sender the automation engine uses, in priority order:
//
//   1. An explicitly injected provider — how tests and the Preview screen
//      guarantee nothing reaches Meta.
//   2. AUTOMATION_SEND_MODE=simulate — a deliberate global switch for staging,
//      or for running production with automations configured but muted while
//      templates are still awaiting Meta approval.
//   3. The real Meta provider.
//
// Note this is separate from the master kill switch. The kill switch stops
// events being processed at all; simulate mode processes everything normally
// and just doesn't send, which is what you want when you're testing conditions
// and recipients against real data.
// ------------------------------------------------------------

import { MetaProvider } from './meta-provider'
import { SimulatorProvider } from './simulator-provider'
import type { MessageProvider } from './types'

export * from './types'
export { MetaProvider, classifyMetaError } from './meta-provider'
export { SimulatorProvider, type SimulatedSend } from './simulator-provider'

export function isSimulateMode(): boolean {
  return (process.env.AUTOMATION_SEND_MODE ?? '').toLowerCase() === 'simulate'
}

export function resolveProvider(injected?: MessageProvider): MessageProvider {
  if (injected) return injected
  if (isSimulateMode()) return new SimulatorProvider()
  return new MetaProvider()
}
