// Route Management SDK — public barrel + web binding.
//
// Web binding: lazily creates the SDK with the browser Supabase client. Hooks/components
// import `getRouteSdk()` and never touch supabase directly. Mobile creates its own binding
// with its supabase client + a SyncEngine-backed executor (see Phase 3), reusing the same
// createRouteSdk() core from ./sdk.

import { createClient } from '@/lib/supabase/client';
import { createRouteSdk, type RouteSdk } from './sdk';

let _sdk: RouteSdk | undefined;

/** The web Route SDK singleton (browser Supabase client, online/direct executor). */
export function getRouteSdk(): RouteSdk {
  if (!_sdk) _sdk = createRouteSdk(createClient());
  return _sdk;
}

export * from './types';
export * from './errors';
export * from './permissions';
export { createRouteSdk } from './sdk';
export type { RouteSdk, RouteRpcExecutor, RouteSdkOptions } from './sdk';
