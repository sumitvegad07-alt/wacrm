// Route Management — React Query key factory (Phase 2a).
// Central, hierarchical keys so invalidation is precise and consistent. Everything
// under routeKeys.all can be invalidated at once; narrower keys target one route.

export const routeKeys = {
  all: ['routes'] as const,

  lists: () => [...routeKeys.all, 'list'] as const,
  list: (
    accountId: string,
    filters?: { statuses?: string[]; search?: string; limit?: number; offset?: number }
  ) => [...routeKeys.lists(), accountId, filters ?? {}] as const,

  details: () => [...routeKeys.all, 'detail'] as const,
  detail: (routeId: string) => [...routeKeys.details(), routeId] as const,
  customers: (routeId: string) => [...routeKeys.detail(routeId), 'customers'] as const,
  health: (routeId: string) => [...routeKeys.detail(routeId), 'health'] as const,
  history: (routeId: string) => [...routeKeys.detail(routeId), 'history'] as const,

  importableContacts: (accountId: string, search: string, offset: number) =>
    [...routeKeys.all, 'importable-contacts', accountId, search, offset] as const,

  planner: (accountId: string) => [...routeKeys.all, 'planner', accountId] as const,

  today: (assigneeId: string, date?: string) =>
    [...routeKeys.all, 'today', assigneeId, date ?? 'current'] as const,
} as const;
