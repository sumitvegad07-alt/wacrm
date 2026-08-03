"use client";

// Route Management — mutation hooks (Phase 2a). React Query mutations over the Route SDK,
// owning cache invalidation and optimistic updates (the layer that can, since it holds the
// query cache). The SDK stays cache-agnostic. All calls flow SDK → RPC; no direct writes.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteSdk } from "@/lib/route";
import type {
  UpsertRouteInput,
  ImportCustomersInput,
  PlannerSetInput,
  PlannerMoveInput,
  ExecutionStartInput,
  StopCompleteInput,
  StopSkipInput,
  RouteStatus,
  RouteCustomerWithContact,
  IsoDayOfWeek,
} from "@/lib/route";
import { routeKeys } from "./query-keys";

// ── route authoring ───────────────────────────────────────────
export function useSaveRoute(accountId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertRouteInput) => getRouteSdk().saveRoute(input),
    onSuccess: (route) => {
      if (accountId) qc.invalidateQueries({ queryKey: routeKeys.lists() });
      qc.invalidateQueries({ queryKey: routeKeys.detail(route.id) });
    },
  });
}

export function useImportCustomers(accountId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportCustomersInput) => getRouteSdk().importCustomers(input),
    onSuccess: (_res, input) => {
      qc.invalidateQueries({ queryKey: routeKeys.customers(input.routeId) });
      qc.invalidateQueries({ queryKey: routeKeys.health(input.routeId) });
      if (accountId) qc.invalidateQueries({ queryKey: routeKeys.lists() });
    },
  });
}

export function useAddCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { routeId: string; contactIds: string[] }) =>
      getRouteSdk().addCustomers(vars.routeId, vars.contactIds),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: routeKeys.customers(vars.routeId) });
      qc.invalidateQueries({ queryKey: routeKeys.health(vars.routeId) });
    },
  });
}

export function useRemoveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { routeId: string; contactId: string }) =>
      getRouteSdk().removeCustomer(vars.routeId, vars.contactId),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: routeKeys.customers(vars.routeId) });
      qc.invalidateQueries({ queryKey: routeKeys.health(vars.routeId) });
    },
  });
}

/**
 * Reorder with an optimistic cache update (the drag-and-drop path). Snapshots the
 * current order, applies the new order immediately, and rolls back on error.
 */
export function useReorderCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { routeId: string; orderedContactIds: string[] }) =>
      getRouteSdk().reorderCustomers(vars.routeId, vars.orderedContactIds),
    onMutate: async (vars) => {
      const key = routeKeys.customers(vars.routeId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<RouteCustomerWithContact[]>(key);
      if (previous) {
        const byId = new Map(previous.map((c) => [c.contact_id, c]));
        const next = vars.orderedContactIds
          .map((id, idx) => {
            const c = byId.get(id);
            return c ? { ...c, sequence: idx + 1 } : null;
          })
          .filter(Boolean) as RouteCustomerWithContact[];
        qc.setQueryData(key, next);
      }
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSettled: (_res, _err, vars) => {
      qc.invalidateQueries({ queryKey: routeKeys.customers(vars.routeId) });
    },
  });
}

export function useUpdateRouteStatus(accountId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { routeId: string; status: RouteStatus; reason?: string | null }) =>
      getRouteSdk().updateStatus(vars.routeId, vars.status, vars.reason),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: routeKeys.detail(vars.routeId) });
      qc.invalidateQueries({ queryKey: routeKeys.health(vars.routeId) });
      if (accountId) {
        qc.invalidateQueries({ queryKey: routeKeys.lists() });
        qc.invalidateQueries({ queryKey: routeKeys.approvalQueueAll() });
        qc.invalidateQueries({ queryKey: routeKeys.plannerAll() });
      }
    },
  });
}

export function useBulkUpdateRouteStatus(accountId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      routeIds: string[];
      status: RouteStatus;
      reason?: string | null;
      expectedVersion?: number | null;
    }) => getRouteSdk().bulkUpdateStatus(vars.routeIds, vars.status, vars.reason, vars.expectedVersion),
    onSuccess: (res) => {
      res.ok_ids.forEach((id) => {
        qc.invalidateQueries({ queryKey: routeKeys.detail(id) });
        qc.invalidateQueries({ queryKey: routeKeys.health(id) });
      });
      if (accountId) {
        qc.invalidateQueries({ queryKey: routeKeys.lists() });
        qc.invalidateQueries({ queryKey: routeKeys.approvalQueueAll() });
        qc.invalidateQueries({ queryKey: routeKeys.plannerAll() });
      }
    },
  });
}

export function useCloneRoute(accountId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { routeId: string; newName?: string }) =>
      getRouteSdk().cloneRoute(vars.routeId, vars.newName),
    onSuccess: () => {
      if (accountId) qc.invalidateQueries({ queryKey: routeKeys.lists() });
    },
  });
}

// ── planner ───────────────────────────────────────────────────
export function usePlannerSet(accountId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlannerSetInput) => getRouteSdk().plannerSet(input),
    onSuccess: () => {
      if (accountId) qc.invalidateQueries({ queryKey: routeKeys.plannerAll() });
    },
  });
}

export function usePlannerClear(accountId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { assigneeId: string; dayOfWeek: IsoDayOfWeek }) =>
      getRouteSdk().plannerClear(vars.assigneeId, vars.dayOfWeek),
    onSuccess: () => {
      if (accountId) qc.invalidateQueries({ queryKey: routeKeys.plannerAll() });
    },
  });
}

export function usePlannerMove(accountId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlannerMoveInput) => getRouteSdk().plannerMove(input),
    onSuccess: () => {
      if (accountId) qc.invalidateQueries({ queryKey: routeKeys.plannerAll() });
    },
  });
}

// ── execution ─────────────────────────────────────────────────
export function useStartExecution() {
  return useMutation({
    mutationFn: (input: ExecutionStartInput) => getRouteSdk().startExecution(input),
  });
}

export function useCompleteStop(assigneeId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StopCompleteInput) => getRouteSdk().completeStop(input),
    onSuccess: () => {
      if (assigneeId) qc.invalidateQueries({ queryKey: routeKeys.today(assigneeId) });
    },
  });
}

export function useSkipStop(assigneeId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StopSkipInput) => getRouteSdk().skipStop(input),
    onSuccess: () => {
      if (assigneeId) qc.invalidateQueries({ queryKey: routeKeys.today(assigneeId) });
    },
  });
}

export function useCompleteExecution(assigneeId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (executionId: string) => getRouteSdk().completeExecution(executionId),
    onSuccess: () => {
      if (assigneeId) qc.invalidateQueries({ queryKey: routeKeys.today(assigneeId) });
    },
  });
}
