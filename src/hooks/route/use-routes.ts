"use client";

// Route Management — read hooks (Phase 2a). Thin React Query wrappers over the Route SDK.
// Components never call the SDK or Supabase directly — they use these hooks.

import { useQuery } from "@tanstack/react-query";
import { getRouteSdk } from "@/lib/route";
import { routeKeys } from "./query-keys";

/** List routes for an account (with customer counts + assignee names). */
export function useRoutes(accountId: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.list(accountId ?? "none"),
    queryFn: () => getRouteSdk().listRoutes(accountId as string),
    enabled: !!accountId,
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

/** Weekly planner assignments for an account. */
export function usePlanner(accountId: string | null | undefined) {
  return useQuery({
    queryKey: routeKeys.planner(accountId ?? "none"),
    queryFn: () => getRouteSdk().getPlanner(accountId as string),
    enabled: !!accountId,
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
