// Generic SDK infrastructure — RPC executor (reusable across modules).
// The transport-agnostic seam: the SDK calls executor.runRpc(fn, args); the executor decides
// HOW that runs. Web uses the direct executor (below); mobile injects one backed by
// SyncEngine.enqueueRpc for offline queueing. Idempotency is the caller's responsibility
// (pass a stable client-generated id inside args).

import { withRetry } from './retry';

export interface RpcExecutor {
  runRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
}

/** Minimal shape of the piece of the Supabase client the direct executor needs. */
export interface RpcCapableClient {
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface DirectExecutorOptions {
  maxRetries?: number;
  /** Map a raw backend error into a domain error before it is thrown. */
  mapError?: (error: unknown) => unknown;
}

/** Direct (online) executor: calls the client's RPC with retry + optional error mapping. */
export function createDirectExecutor(
  client: RpcCapableClient,
  opts: DirectExecutorOptions = {}
): RpcExecutor {
  const maxRetries = opts.maxRetries ?? 2;
  const mapError = opts.mapError ?? ((e) => e);
  return {
    runRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      return withRetry(async () => {
        const { data, error } = await client.rpc(fn, args);
        if (error) throw mapError(error);
        return data as T;
      }, maxRetries);
    },
  };
}
