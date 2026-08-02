// Centralized React Query configuration (Phase 2a refinement).
// One place for app-wide query defaults so every module (route today, others later) shares
// consistent caching/retry behavior. The SDK already retries transient errors, so React
// Query adds just one extra attempt.

import { QueryClient, type DefaultOptions } from '@tanstack/react-query';

export const APP_QUERY_DEFAULTS: DefaultOptions = {
  queries: {
    staleTime: 30_000, // 30s
    gcTime: 5 * 60_000, // 5m
    retry: 1,
    refetchOnWindowFocus: false,
  },
};

export function createAppQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: APP_QUERY_DEFAULTS });
}
