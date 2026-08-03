"use client";

// Route Management — read hooks (Phase 2a). Thin React Query wrappers over the Route SDK.
// Components never call the SDK or Supabase directly — they use these hooks.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getRouteSdk, type RouteListParams, type RouteExecutionListParams, type ApprovalQueueParams } from "@/lib/route";
import { routeKeys } from "./query-keys";

/**
 * Paginated route list. Pass filters/pagination; the key includes them so each page/filter is
 * cached independently. `keepPreviousData` avoids a flash while paging/filtering.
 */
export function useRoutes(params: RouteListParams | null | undefined) {
  return useQuery({
    queryKey: routeKeys.list(params?.accountId ?? "none", {
      statuses: params?.statuses,
      search: params?.search,
      limit: params?.limit,
      offset: params?.offset,
    }),
    queryFn: () => getRouteSdk().listRoutes(params as RouteListParams),
    enabled: !!params?.accountId,
    placeholderData: keepPreviousData,
  });
}

/**
 * Dedicated hook for the Manager Inbox (/routes/approvals).
 * Fetches the enriched approval queue with salesman name, creator name, next scheduled day, and bounded health score.
 */
export function useApprovalQueue(params: ApprovalQueueParams | null | undefined) {
  return useQuery({
    queryKey: routeKeys.approvalQueue(params?.accountId ?? "none", {
      statuses: params?.statuses,
      search: params?.search,
      limit: params?.limit,
      offset: params?.offset,
    }),
    queryFn: () => getRouteSdk().getApprovalQueue(params as ApprovalQueueParams),
    enabled: !!params?.accountId,
    placeholderData: keepPreviousData,
  });
}

/** A single route header. */
export function useRoute(routeId: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.detail(routeId ?? "none"),
    queryFn: () => getRouteSdk().getRoute(routeId as string),
    enabled: !!routeId,
  });
}

/** A route's active customers (joined with contact display fields), ordered by sequence. */
export function useRouteCustomers(routeId: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.customers(routeId ?? "none"),
    queryFn: () => getRouteSdk().getRouteCustomers(routeId as string),
    enabled: !!routeId,
  });
}

/** Non-blocking route health (score + warnings). Gated server-side by view_routes. */
export function useRouteHealth(routeId: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.health(routeId ?? "none"),
    queryFn: () => getRouteSdk().getRouteHealth(routeId as string),
    enabled: !!routeId,
  });
}

/** Route audit history (module_activities), for the History tab. */
export function useRouteHistory(routeId: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.history(routeId ?? "none"),
    queryFn: () => getRouteSdk().getRouteHistory(routeId as string),
    enabled: !!routeId,
  });
}

/** All planner assignments for an account (used by the workspace, filtered client-side). */
export function usePlanner(accountId: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.planner(accountId ?? "none"),
    queryFn: () => getRouteSdk().getPlanner(accountId as string),
    enabled: !!accountId,
  });
}

/** Planner assignments for a specific page of salesmen (enterprise-scale board). */
export function usePlannerAssignments(
  accountId: string | null | undefined,
  assigneeIds: string[] | undefined
) {
  const ids = assigneeIds ?? [];
  const sig = ids.slice().sort().join(",");
  return useQuery({
    queryKey: routeKeys.planner(accountId ?? "none", sig || "none"),
    queryFn: () => getRouteSdk().getPlanner(accountId as string, ids),
    enabled: !!accountId && ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** Execution monitor list (web read-only). Paginated + date/status filtered. */
export function useExecutions(params: RouteExecutionListParams | null | undefined) {
  const sig = params
    ? `${params.date ?? "all"}|${(params.statuses ?? []).join(",")}|${params.offset ?? 0}`
    : "none";
  return useQuery({
    queryKey: routeKeys.executions(params?.accountId ?? "none", sig),
    queryFn: () => getRouteSdk().listExecutions(params as RouteExecutionListParams),
    enabled: !!params?.accountId,
    placeholderData: keepPreviousData,
  });
}

/** Date-wide execution tallies for the monitor tiles. */
export function useExecutionSummary(accountId: string | null | undefined, date: string) {
  return useQuery({
    queryKey: routeKeys.executionSummary(accountId ?? "none", date),
    queryFn: () => getRouteSdk().getExecutionSummary(accountId as string, date),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

/** Stops of one execution (monitor detail). */
export function useExecutionStops(executionId: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.executionStops(executionId ?? "none"),
    queryFn: () => getRouteSdk().getExecutionStops(executionId as string),
    enabled: !!executionId,
  });
}

/** "Today's route" for a salesman (resolved via get_route_for). */
export function useTodayRoute(assigneeId: string | null | undefined, date?: string) {
  return useQuery({
    queryKey: routeKeys.today(assigneeId ?? "none", date),
    queryFn: () => getRouteSdk().getRouteForToday(assigneeId as string, date),
    enabled: !!assigneeId,
  });
}
