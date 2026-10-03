import { describe, it, expect } from 'vitest';
import { canViewServiceAssets } from './access';

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
