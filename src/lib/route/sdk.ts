// Route Management — Service Layer / SDK (Phase 2a).
//
//   React UI → React Hooks → [ THIS SDK ] → Supabase RPC → Database
//
// The ONLY place allowed to talk to Supabase for routes. UI/hooks never call
// supabase.rpc / .from directly. Responsibilities: RPC calls, typed error mapping,
// input validation, DTO shaping, retry, and offline-queue integration (via an injected
// executor). Framework-agnostic and cache-agnostic so it can be reused VERBATIM on
// mobile (mirroring src/lib/pricing/). Optimistic updates + cache invalidation are the
// hook layer's job (they are bound to a specific query cache) and live outside the SDK.

import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPostgrestError, RouteError } from './errors';
import { withRetry } from '@/lib/sdk/retry';
import { createDirectExecutor, type RpcExecutor, type RpcCapableClient } from '@/lib/sdk/executor';
import {
  validateUpsertRoute,
  validateImportCustomers,
  validatePlannerSet,
  validatePlannerMove,
  validateExecutionStart,
  validateStopComplete,
  validateStopSkip,
} from './validation';
import type {
  Route,
  RouteWithMeta,
  RouteListParams,
  RouteListResult,
  RouteCustomerWithContact,
  RoutePlanAssignment,
  RoutePlanAssignmentWithRoute,
  RouteExecution,
  RouteHealth,
  RouteHistoryEntry,
  RouteForToday,
  RouteStatus,
  UpsertRouteInput,
  ImportCustomersInput,
  ImportCustomersResult,
  ImportableContact,
  ImportableContactsParams,
  ImportableContactsResult,
  PlannerSetInput,
  PlannerMoveInput,
  ExecutionStartInput,
  StopCompleteInput,
  StopSkipInput,
  IsoDayOfWeek,
} from './types';

/**
 * Route SDK executor — alias of the generic RpcExecutor (@/lib/sdk/executor). Web uses the
 * direct executor; mobile injects one backed by SyncEngine.enqueueRpc so writes work offline.
 * Idempotency is the caller's responsibility (pass a stable client-generated id in args).
 */
export type RouteRpcExecutor = RpcExecutor;

export interface RouteSdkOptions {
  executor?: RouteRpcExecutor;
  maxRetries?: number;
}

export function createRouteSdk(supabase: SupabaseClient, opts: RouteSdkOptions = {}) {
  const maxRetries = opts.maxRetries ?? 2;

  // Default (web/online) executor: direct RPC + retry + typed route error mapping.
  const executor =
    opts.executor ??
    createDirectExecutor(supabase as unknown as RpcCapableClient, {
      maxRetries,
      mapError: mapPostgrestError,
    });

  /** Read RPC (always direct + retried; reads never need the offline executor). */
  async function readRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return withRetry(async () => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw mapPostgrestError(error);
      return data as T;
    }, maxRetries);
  }

  // ── reads ───────────────────────────────────────────────────
  /**
   * Paginated, filterable route list. Scales to 500+ routes: fetches only the requested page
   * (server range + exact count), and resolves customer counts + assignee names ONLY for the
   * ~pageSize routes on that page (bounded — never fetches all route_customers).
   */
  async function listRoutes(params: RouteListParams): Promise<RouteListResult> {
    const { accountId, statuses, search, limit = 25, offset = 0 } = params;
    return withRetry(async () => {
      let q = supabase
        .from('routes')
        .select('*', { count: 'exact' })
        .eq('account_id', accountId);
      if (statuses && statuses.length > 0) q = q.in('status', statuses);
      if (search && search.trim()) q = q.ilike('name', `%${search.trim()}%`);
      const { data: routes, error, count } = await q
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw mapPostgrestError(error);
      const rows = (routes ?? []) as Route[];
      const total = count ?? rows.length;
      if (rows.length === 0) return { rows: [], total };

      const pageIds = rows.map((r) => r.id);
      // active customer counts for THIS page's routes only (bounded)
      const { data: rc, error: rcErr } = await supabase
        .from('route_customers')
        .select('route_id')
        .in('route_id', pageIds)
        .is('archived_at', null);
      if (rcErr) throw mapPostgrestError(rcErr);
      const counts = new Map<string, number>();
      (rc ?? []).forEach((r: { route_id: string }) => counts.set(r.route_id, (counts.get(r.route_id) ?? 0) + 1));

      // assignee names for this page (keyed by profiles.id)
      const assigneeIds = [...new Set(rows.map((r) => r.primary_assignee_id).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (assigneeIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', assigneeIds);
        (profs ?? []).forEach((p: { id: string; full_name: string }) => names.set(p.id, p.full_name));
      }

      return {
        rows: rows.map((r) => ({
          ...r,
          customer_count: counts.get(r.id) ?? 0,
          primary_assignee_name: r.primary_assignee_id ? names.get(r.primary_assignee_id) ?? null : null,
        })),
        total,
      };
    }, maxRetries);
  }

  async function getRoute(routeId: string): Promise<Route | null> {
    return withRetry(async () => {
      const { data, error } = await supabase.from('routes').select('*').eq('id', routeId).maybeSingle();
      if (error) throw mapPostgrestError(error);
      return (data as Route) ?? null;
    }, maxRetries);
  }

  async function getRouteCustomers(routeId: string): Promise<RouteCustomerWithContact[]> {
    return withRetry(async () => {
      const { data, error } = await supabase
        .from('route_customers')
        .select(
          'id, account_id, route_id, contact_id, sequence, archived_at, created_at, updated_at, ' +
            'contacts ( company, name, latitude, longitude, address, territory_id, needs_territory_review )'
        )
        .eq('route_id', routeId)
        .is('archived_at', null)
        .order('sequence', { ascending: true });
      if (error) throw mapPostgrestError(error);
      type Row = Record<string, unknown> & { contacts: Record<string, unknown> | null };
      return ((data ?? []) as unknown as Row[]).map((row) => {
        const c = row.contacts ?? {};
        return {
          id: row.id as string,
          account_id: row.account_id as string,
          route_id: row.route_id as string,
          contact_id: row.contact_id as string,
          sequence: row.sequence as number,
          archived_at: (row.archived_at as string | null) ?? null,
          created_at: row.created_at as string,
          updated_at: row.updated_at as string,
          company: (c.company as string | null) ?? null,
          name: (c.name as string | null) ?? null,
          latitude: (c.latitude as number | null) ?? null,
          longitude: (c.longitude as number | null) ?? null,
          address: (c.address as string | null) ?? null,
          territory_id: (c.territory_id as string | null) ?? null,
          needs_territory_review: Boolean(c.needs_territory_review),
        } as RouteCustomerWithContact;
      });
    }, maxRetries);
  }

  /**
   * Planner assignments. Pass `assigneeIds` to fetch only the visible page of salesmen
   * (enterprise scale: never loads the whole account's 3500+ assignments at once). Omit for the
   * whole account (used by the workspace Planning tab, which filters to one route client-side).
   */
  async function getPlanner(
    accountId: string,
    assigneeIds?: string[]
  ): Promise<RoutePlanAssignmentWithRoute[]> {
    return withRetry(async () => {
      let q = supabase
        .from('route_plan_assignments')
        .select(
          'id, account_id, route_id, assignee_id, day_of_week, start_date, end_date, is_active, ' +
            'paused_at, created_at, updated_at, routes ( name, status )'
        )
        .eq('account_id', accountId);
      if (assigneeIds && assigneeIds.length > 0) q = q.in('assignee_id', assigneeIds);
      const { data, error } = await q;
      if (error) throw mapPostgrestError(error);
      type Row = Record<string, unknown> & { routes: { name: string; status: RouteStatus } | null };
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const { routes, ...rest } = r;
        return {
          ...(rest as unknown as RoutePlanAssignment),
          route_name: routes?.name ?? null,
          route_status: routes?.status ?? null,
        };
      });
    }, maxRetries);
  }

  /**
   * Route audit history (module_activities keyed by module_name='route', record_id=routeId).
   * Enriches the actor name via a separate profiles query — module_activities.user_id FKs
   * auth.users (NOT profiles), so embedding it would silently return zero rows (house gotcha).
   */
  async function getRouteHistory(routeId: string, limit = 200): Promise<RouteHistoryEntry[]> {
    return withRetry(async () => {
      const { data, error } = await supabase
        .from('module_activities')
        .select('id, action, message, details, created_at, user_id')
        .eq('module_name', 'route')
        .eq('record_id', routeId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw mapPostgrestError(error);
      const rows = (data ?? []) as {
        id: string; action: string; message: string | null;
        details: Record<string, unknown> | null; created_at: string; user_id: string | null;
      }[];
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (userIds.length > 0) {
        // profiles.user_id → auth.users id (matches module_activities.user_id)
        const { data: profs } = await supabase.from('profiles').select('user_id, full_name').in('user_id', userIds);
        (profs ?? []).forEach((p: { user_id: string; full_name: string }) => names.set(p.user_id, p.full_name));
      }
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        message: r.message,
        details: r.details,
        created_at: r.created_at,
        actor_name: r.user_id ? names.get(r.user_id) ?? null : null,
      }));
    }, maxRetries);
  }

  async function getRouteHealth(routeId: string): Promise<RouteHealth> {
    return readRpc<RouteHealth>('route_health', { p_route_id: routeId });
  }

  /**
   * Paginated + searchable contacts for the "Select customers" import picker. Lists account
   * contacts (RLS-scoped); territory eligibility + already-routed filtering is enforced by the
   * import RPC, which reports skipped counts. Bounded by range — scales to large contact books.
   */
  async function searchImportableContacts(
    params: ImportableContactsParams
  ): Promise<ImportableContactsResult> {
    const { accountId, search, limit = 25, offset = 0 } = params;
    return withRetry(async () => {
      let q = supabase
        .from('contacts')
        .select('id, company, name, territory_id, needs_territory_review', { count: 'exact' })
        .eq('account_id', accountId);
      const s = (search ?? '').trim().replace(/[,()*]/g, ''); // strip PostgREST-or metachars
      if (s) q = q.or(`company.ilike.%${s}%,name.ilike.%${s}%`);
      const { data, error, count } = await q
        .order('company', { ascending: true, nullsFirst: false })
        .range(offset, offset + limit - 1);
      if (error) throw mapPostgrestError(error);
      return { rows: (data ?? []) as ImportableContact[], total: count ?? 0 };
    }, maxRetries);
  }

  async function getRouteForToday(assigneeId: string, date?: string): Promise<RouteForToday | null> {
    const res = await readRpc<RouteForToday | null>('get_route_for', {
      p_assignee_id: assigneeId,
      ...(date ? { p_date: date } : {}),
    });
    return res ?? null;
  }

  // ── writes (validated → executor → typed errors) ────────────
  async function saveRoute(input: UpsertRouteInput): Promise<Route> {
    const v = validateUpsertRoute(input);
    return executor.runRpc<Route>('route_upsert', {
      p_route_id: v.routeId,
      p_name: v.name,
      p_description: v.description ?? null,
      p_primary_assignee_id: v.primaryAssigneeId ?? null,
      p_customer_ids: v.customerIds ?? null,
      p_expected_version: v.expectedVersion ?? null,
    });
  }

  async function importCustomers(input: ImportCustomersInput): Promise<ImportCustomersResult> {
    const v = validateImportCustomers(input);
    return executor.runRpc<ImportCustomersResult>('route_import_customers', {
      p_route_id: v.routeId,
      p_mode: v.mode,
      p_contact_ids: v.contactIds ?? null,
    });
  }

  async function addCustomers(routeId: string, contactIds: string[]): Promise<ImportCustomersResult> {
    return executor.runRpc<ImportCustomersResult>('route_add_customers', {
      p_route_id: routeId,
      p_contact_ids: contactIds,
    });
  }

  async function removeCustomer(routeId: string, contactId: string): Promise<{ ok: boolean }> {
    return executor.runRpc('route_remove_customer', { p_route_id: routeId, p_contact_id: contactId });
  }

  async function reorderCustomers(routeId: string, orderedContactIds: string[]): Promise<{ ok: boolean }> {
    return executor.runRpc('route_reorder_customers', {
      p_route_id: routeId,
      p_ordered_contact_ids: orderedContactIds,
    });
  }

  async function updateStatus(routeId: string, newStatus: RouteStatus, reason?: string | null) {
    return executor.runRpc<{ status: RouteStatus }>('route_update_status', {
      p_route_id: routeId,
      p_new_status: newStatus,
      p_reason: reason ?? null,
    });
  }
  const submitRoute = (routeId: string) => updateStatus(routeId, 'pending_approval');
  const activateRoute = (routeId: string) => updateStatus(routeId, 'active');
  const approveRoute = (routeId: string) => updateStatus(routeId, 'active');
  const rejectRoute = (routeId: string, reason?: string) => updateStatus(routeId, 'rejected', reason);
  const archiveRoute = (routeId: string) => updateStatus(routeId, 'archived');
  const restoreRoute = (routeId: string) => updateStatus(routeId, 'active');
  const reopenRoute = (routeId: string) => updateStatus(routeId, 'draft');

  async function cloneRoute(routeId: string, newName?: string): Promise<{ id: string }> {
    return executor.runRpc('route_clone', { p_route_id: routeId, p_new_name: newName ?? null });
  }

  async function plannerSet(input: PlannerSetInput): Promise<{ id: string }> {
    const v = validatePlannerSet(input);
    return executor.runRpc('route_planner_set', {
      p_route_id: v.routeId,
      p_assignee_id: v.assigneeId,
      p_day_of_week: v.dayOfWeek,
      p_is_active: v.isActive ?? true,
      p_start_date: v.startDate ?? null,
      p_end_date: v.endDate ?? null,
    });
  }

  async function plannerClear(assigneeId: string, dayOfWeek: IsoDayOfWeek): Promise<{ ok: boolean }> {
    return executor.runRpc('route_planner_clear', { p_assignee_id: assigneeId, p_day_of_week: dayOfWeek });
  }

  async function plannerMove(input: PlannerMoveInput): Promise<{ id: string }> {
    const v = validatePlannerMove(input);
    return executor.runRpc('route_planner_move', {
      p_route_id: v.routeId,
      p_from_assignee: v.fromAssigneeId,
      p_from_dow: v.fromDayOfWeek,
      p_to_assignee: v.toAssigneeId,
      p_to_dow: v.toDayOfWeek,
    });
  }

  // ── execution ───────────────────────────────────────────────
  async function startExecution(input: ExecutionStartInput): Promise<RouteExecution> {
    const v = validateExecutionStart(input);
    return executor.runRpc<RouteExecution>('route_execution_start', {
      p_execution_id: v.executionId,
      p_route_id: v.routeId,
      p_execution_date: v.executionDate ?? null,
      p_tracking_session_id: v.trackingSessionId ?? null,
      p_stops: v.stops.map((s) => ({
        stop_id: s.stopId,
        contact_id: s.contactId,
        planned_sequence: s.plannedSequence,
      })),
    });
  }

  async function addStop(executionId: string, stopId: string, contactId: string): Promise<{ id: string }> {
    return executor.runRpc('route_stop_add', {
      p_execution_id: executionId,
      p_stop_id: stopId,
      p_contact_id: contactId,
    });
  }

  async function completeStop(input: StopCompleteInput): Promise<{ ok: boolean; site_visit_id: string }> {
    const v = validateStopComplete(input);
    return executor.runRpc('route_stop_complete', {
      p_stop_id: v.stopId,
      p_site_visit_id: v.siteVisitId,
      p_visit: v.visit ?? {},
      p_actual_sequence: v.actualSequence ?? null,
    });
  }

  async function skipStop(input: StopSkipInput): Promise<{ ok: boolean }> {
    const v = validateStopSkip(input);
    return executor.runRpc('route_stop_skip', {
      p_stop_id: v.stopId,
      p_reason: v.reason ?? null,
      p_actual_sequence: v.actualSequence ?? null,
    });
  }

  async function completeExecution(executionId: string): Promise<{ ok: boolean }> {
    return executor.runRpc('route_execution_complete', { p_execution_id: executionId });
  }

  return {
    // reads
    listRoutes,
    getRoute,
    getRouteCustomers,
    getPlanner,
    getRouteHealth,
    getRouteHistory,
    getRouteForToday,
    searchImportableContacts,
    // route authoring
    saveRoute,
    importCustomers,
    addCustomers,
    removeCustomer,
    reorderCustomers,
    updateStatus,
    submitRoute,
    activateRoute,
    approveRoute,
    rejectRoute,
    archiveRoute,
    restoreRoute,
    reopenRoute,
    cloneRoute,
    // planner
    plannerSet,
    plannerClear,
    plannerMove,
    // execution
    startExecution,
    addStop,
    completeStop,
    skipStop,
    completeExecution,
  };
}

export type RouteSdk = ReturnType<typeof createRouteSdk>;
export { RouteError };
