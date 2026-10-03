import { describe, it, expect } from 'vitest';
import { canViewServiceAssets, serviceAssetRights } from './access';

describe('canViewServiceAssets', () => {
  it('lets an owner on an FSM plan in without any employee role', () => {
    expect(canViewServiceAssets({ plan: 'FSM', accountRole: 'owner', permissions: null })).toBe(true);
  });

  it('lets an admin on an FSM plan in', () => {
    expect(canViewServiceAssets({ plan: 'CRM_FSM', accountRole: 'admin', permissions: null })).toBe(true);
  });

  it('keeps an owner out when the plan has no fsm line', () => {
    expect(canViewServiceAssets({ plan: 'CRM', accountRole: 'owner', permissions: { all: true } })).toBe(false);
    expect(canViewServiceAssets({ plan: 'SFA', accountRole: 'admin', permissions: null })).toBe(false);
  });

  it('keeps a legacy-plan account out: legacy values are full access to crm/wfa/sfa but not fsm', () => {
    expect(canViewServiceAssets({ plan: 'pro', accountRole: 'owner', permissions: null })).toBe(false);
    expect(canViewServiceAssets({ plan: null, accountRole: 'owner', permissions: null })).toBe(false);
  });

  it('requires view_service_assets for a restricted role on an FSM plan', () => {
    expect(canViewServiceAssets({ plan: 'FSM', accountRole: 'agent', permissions: null })).toBe(false);
    expect(canViewServiceAssets({ plan: 'FSM', accountRole: 'agent', permissions: {} })).toBe(false);
    expect(
      canViewServiceAssets({ plan: 'FSM', accountRole: 'agent', permissions: { view_service_assets: true } }),
    ).toBe(true);
  });

  it('accepts the string "true" that SQL backfills store', () => {
    expect(
      canViewServiceAssets({ plan: 'FSM', accountRole: 'viewer', permissions: { view_service_assets: 'true' } }),
    ).toBe(true);
  });

  it('does not treat another service right as the view right', () => {
    expect(
      canViewServiceAssets({ plan: 'FSM', accountRole: 'agent', permissions: { create_service_assets: true } }),
    ).toBe(false);
  });

  it('honours the all:true override for a restricted role, but never past the plan line', () => {
    expect(canViewServiceAssets({ plan: 'FSM', accountRole: 'agent', permissions: { all: true } })).toBe(true);
    expect(canViewServiceAssets({ plan: 'WFA', accountRole: 'agent', permissions: { all: true } })).toBe(false);
  });
});

describe('serviceAssetRights', () => {
  const none = { view: false, create: false, edit: false, delete: false };
  const all = { view: true, create: true, edit: true, delete: true };

  it('gives an owner or admin on an FSM plan every right without any employee role', () => {
    expect(serviceAssetRights({ plan: 'FSM', accountRole: 'owner', permissions: null })).toEqual(all);
    expect(serviceAssetRights({ plan: 'CRM_FSM', accountRole: 'admin', permissions: null })).toEqual(all);
  });

  it('gives an owner or admin nothing when the plan has no fsm line (the bypass never covers the plan)', () => {
    expect(serviceAssetRights({ plan: 'CRM', accountRole: 'owner', permissions: { all: true } })).toEqual(none);
    expect(serviceAssetRights({ plan: 'pro', accountRole: 'admin', permissions: null })).toEqual(none);
    expect(serviceAssetRights({ plan: null, accountRole: 'owner', permissions: null })).toEqual(none);
  });

  it('resolves each right on its own for a restricted role', () => {
    const permissions = { view_service_assets: true, edit_service_assets: true };
    expect(serviceAssetRights({ plan: 'FSM', accountRole: 'agent', permissions })).toEqual({
      view: true,
      create: false,
      edit: true,
      delete: false,
    });
  });

  it('does not let one right stand in for another', () => {
    expect(
      serviceAssetRights({ plan: 'FSM', accountRole: 'agent', permissions: { delete_service_assets: true } }),
    ).toEqual({ ...none, delete: true });
    expect(
      serviceAssetRights({ plan: 'FSM', accountRole: 'agent', permissions: { create_service_assets: true } }),
    ).toEqual({ ...none, create: true });
  });

  it('accepts the string "true" that SQL backfills store, on every right', () => {
    expect(
      serviceAssetRights({
        plan: 'FSM',
        accountRole: 'viewer',
        permissions: {
          view_service_assets: 'true',
          create_service_assets: 'true',
          edit_service_assets: 'true',
          delete_service_assets: 'true',
        },
      }),
    ).toEqual(all);
  });

  it('gives a role with no permissions at all nothing', () => {
    expect(serviceAssetRights({ plan: 'FSM', accountRole: 'agent', permissions: null })).toEqual(none);
    expect(serviceAssetRights({ plan: 'FSM', accountRole: 'agent', permissions: {} })).toEqual(none);
  });

  it('honours all:true for a restricted role, but only on an fsm plan', () => {
    expect(serviceAssetRights({ plan: 'FSM', accountRole: 'agent', permissions: { all: true } })).toEqual(all);
    expect(serviceAssetRights({ plan: 'WFA', accountRole: 'agent', permissions: { all: true } })).toEqual(none);
  });

  it('agrees with canViewServiceAssets on the view right', () => {
    for (const plan of ['FSM', 'CRM', null]) {
      for (const accountRole of ['owner', 'agent'] as const) {
        for (const permissions of [null, { view_service_assets: true }]) {
          expect(serviceAssetRights({ plan, accountRole, permissions }).view).toBe(
            canViewServiceAssets({ plan, accountRole, permissions }),
          );
        }
      }
    }
  });
});
