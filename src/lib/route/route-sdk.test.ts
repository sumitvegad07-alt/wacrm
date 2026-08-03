// Route SDK — unit + light integration tests (Phase 2a).
// Pure, fast, real assertions (vitest). NOTE: end-to-end integration, permission, and RLS
// behavior were verified directly against production as an authenticated owner + agent (see
// docs/engineering/specifications/route-management-architecture-review.md and the Phase 1
// smoke test): create/import/planner/execution/site_visit linkage/audit, agent sees only
// assigned routes (RLS), agent create denied (42501). This file covers the client SDK layer.

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPostgrestError, RouteError } from './errors';
import { isTransient } from '@/lib/sdk/retry';
import {
  validateUpsertRoute,
  validatePlannerSet,
  validateImportCustomers,
} from './validation';
import { hasRoutePermission, ROUTE_PERMISSIONS, ALL_ROUTE_PERMISSION_KEYS } from './permissions';
import { routeKeys } from '@/hooks/route/query-keys';
import { createRouteSdk, type RouteRpcExecutor } from './sdk';

// RFC-valid v4 UUIDs (version nibble 4, variant nibble 8) — zod's uuid() checks these bits.
const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

// ── error mapping ─────────────────────────────────────────────
describe('mapPostgrestError', () => {
  it('maps 40001 to concurrency', () => {
    expect(mapPostgrestError({ code: '40001', message: 'x' }).kind).toBe('concurrency');
  });
  it('maps 23505 to conflict', () => {
    expect(mapPostgrestError({ code: '23505', message: 'dup' }).kind).toBe('conflict');
  });
  it('maps 23503 to contact_missing', () => {
    expect(mapPostgrestError({ code: '23503', message: 'fk' }).kind).toBe('contact_missing');
  });
  it('distinguishes module_disabled from permission within 42501', () => {
    expect(mapPostgrestError({ code: '42501', message: 'Route Management is not enabled' }).kind).toBe('module_disabled');
    expect(mapPostgrestError({ code: '42501', message: 'denied' }).kind).toBe('permission');
  });
  it('passes 23514 validation messages through', () => {
    const e = mapPostgrestError({ code: '23514', message: 'A reason is required to skip a stop' });
    expect(e.kind).toBe('validation');
    expect(e.message).toContain('reason is required');
  });
  it('treats a fetch TypeError as transient network', () => {
    const err = new TypeError('Failed to fetch');
    const mapped = mapPostgrestError(err);
    expect(mapped.kind).toBe('network');
    expect(isTransient(mapped)).toBe(true);
  });
  it('is idempotent on an already-mapped RouteError', () => {
    const e = new RouteError('permission', 'no');
    expect(mapPostgrestError(e)).toBe(e);
  });
});

// ── validation ────────────────────────────────────────────────
describe('validation', () => {
  it('accepts a valid upsert', () => {
    expect(validateUpsertRoute({ routeId: UUID, name: 'North Route' }).name).toBe('North Route');
  });
  it('rejects a blank name', () => {
    expect(() => validateUpsertRoute({ routeId: UUID, name: '  ' })).toThrow(RouteError);
  });
  it('rejects a non-uuid route id', () => {
    expect(() => validateUpsertRoute({ routeId: 'nope', name: 'X' })).toThrow(/Invalid|uuid/i);
  });
  it('rejects planner day out of range', () => {
    expect(() =>
      validatePlannerSet({ routeId: UUID, assigneeId: UUID2, dayOfWeek: 9 as unknown as 1 })
    ).toThrow(RouteError);
  });
  it('requires contactIds when import mode is select', () => {
    expect(() => validateImportCustomers({ routeId: UUID, mode: 'select', contactIds: [] })).toThrow(RouteError);
    expect(validateImportCustomers({ routeId: UUID, mode: 'all' }).mode).toBe('all');
  });
});

// ── permissions ───────────────────────────────────────────────
describe('permissions', () => {
  it('owner/admin (all) bypasses every key', () => {
    for (const k of ALL_ROUTE_PERMISSION_KEYS) {
      expect(hasRoutePermission({ all: true }, k)).toBe(true);
    }
  });
  it('grants only the explicitly enabled key', () => {
    const perms = { [ROUTE_PERMISSIONS.VIEW]: true };
    expect(hasRoutePermission(perms, ROUTE_PERMISSIONS.VIEW)).toBe(true);
    expect(hasRoutePermission(perms, ROUTE_PERMISSIONS.ADD)).toBe(false);
  });
  it('denies when permissions are null', () => {
    expect(hasRoutePermission(null, ROUTE_PERMISSIONS.VIEW)).toBe(false);
  });
  it('exposes 19 distinct keys', () => {
    expect(new Set(ALL_ROUTE_PERMISSION_KEYS).size).toBe(19);
  });
});

// ── query keys (hierarchical / future-proof) ──────────────────
describe('routeKeys', () => {
  it('nests list/detail/customers/health under all', () => {
    expect(routeKeys.list('acc')).toEqual(['routes', 'list', 'acc', {}]);
    expect(routeKeys.list('acc', { search: 'x', offset: 25 })).toEqual([
      'routes', 'list', 'acc', { search: 'x', offset: 25 },
    ]);
    expect(routeKeys.customers(UUID)).toEqual(['routes', 'detail', UUID, 'customers']);
    expect(routeKeys.health(UUID)).toEqual(['routes', 'detail', UUID, 'health']);
    expect(routeKeys.detail(UUID).slice(0, 1)).toEqual(routeKeys.all);
  });
});

// ── SDK wiring (mock executor — no DB) ────────────────────────
function makeSdk() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const executor: RouteRpcExecutor = {
    async runRpc(fn, args) {
      calls.push({ fn, args });
      return {} as never;
    },
  };
  // Reads use client.rpc directly; return a canned value.
  const client = {
    rpc: async () => ({ data: { score: 100, checks: [] }, error: null }),
  } as unknown as SupabaseClient;
  const sdk = createRouteSdk(client, { executor });
  return { sdk, calls };
}

describe('createRouteSdk wiring', () => {
  it('saveRoute calls route_upsert with mapped snake_case args', async () => {
    const { sdk, calls } = makeSdk();
    await sdk.saveRoute({ routeId: UUID, name: 'X', primaryAssigneeId: UUID2, expectedVersion: 3 });
    expect(calls[0].fn).toBe('route_upsert');
    expect(calls[0].args.p_route_id).toBe(UUID);
    expect(calls[0].args.p_primary_assignee_id).toBe(UUID2);
    expect(calls[0].args.p_expected_version).toBe(3);
  });

  it('reorderCustomers calls route_reorder_customers', async () => {
    const { sdk, calls } = makeSdk();
    await sdk.reorderCustomers(UUID, [UUID2, UUID]);
    expect(calls[0].fn).toBe('route_reorder_customers');
    expect(calls[0].args.p_ordered_contact_ids).toEqual([UUID2, UUID]);
  });

  it('status helpers map to route_update_status transitions', async () => {
    const { sdk, calls } = makeSdk();
    await sdk.archiveRoute(UUID);
    expect(calls[0].fn).toBe('route_update_status');
    expect(calls[0].args.p_new_status).toBe('archived');
  });

  it('startExecution serializes client-authoritative stops to snake_case', async () => {
    const { sdk, calls } = makeSdk();
    await sdk.startExecution({
      executionId: UUID,
      routeId: UUID2,
      stops: [{ stopId: UUID, contactId: UUID2, plannedSequence: 1 }],
    });
    expect(calls[0].fn).toBe('route_execution_start');
    expect(calls[0].args.p_stops).toEqual([{ stop_id: UUID, contact_id: UUID2, planned_sequence: 1 }]);
  });

  it('validation rejects before any RPC is issued', async () => {
    const { sdk, calls } = makeSdk();
    await expect(sdk.saveRoute({ routeId: 'bad', name: 'X' })).rejects.toBeInstanceOf(RouteError);
    expect(calls).toHaveLength(0);
  });

  it('getRouteHealth reads via client.rpc', async () => {
    const { sdk } = makeSdk();
    const health = await sdk.getRouteHealth(UUID);
    expect(health.score).toBe(100);
  });

  it('bulkUpdateStatus calls route_bulk_update_status with mapped snake_case args', async () => {
    const { sdk, calls } = makeSdk();
    await sdk.bulkUpdateStatus([UUID, UUID2], 'active', 'Approved in batch', 5);
    expect(calls[0].fn).toBe('route_bulk_update_status');
    expect(calls[0].args.p_route_ids).toEqual([UUID, UUID2]);
    expect(calls[0].args.p_new_status).toBe('active');
    expect(calls[0].args.p_reason).toBe('Approved in batch');
    expect(calls[0].args.p_expected_version).toBe(5);
  });
});
