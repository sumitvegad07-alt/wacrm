import { describe, it, expect } from 'vitest';
import { hasPermission, getDataScope, type RolePermissions } from './rbac';
import { PERMISSIONS } from './permissions-registry';

/**
 * Role fixtures mirroring the real shapes in production: a full-access owner, a
 * finance approver, a field rep who collects but must not approve, and the legacy
 * `add_*` spelling that older roles and installed mobile builds still use.
 */
const OWNER: RolePermissions = { all: true };

const FINANCE: RolePermissions = {
  view_payments: true,
  create_payments: true,
  approve_payments: true,
  reject_payments: true,
  cancel_payments: true,
  view_payment_reports: true,
  view_customer_credit_limit: true,
};

const FIELD_REP: RolePermissions = {
  view_payments: true,
  create_payments: true,
  view_customer_outstanding: true,
  global_scope: 'own',
};

const LEGACY_REP: RolePermissions = {
  view_payments: true,
  add_payments: true,
  add_orders: true,
  add_contacts: true,
};

describe('payment permission gating', () => {
  it('grants everything to a full-access role', () => {
    expect(hasPermission(OWNER, PERMISSIONS.PAYMENTS.APPROVE)).toBe(true);
    expect(hasPermission(OWNER, PERMISSIONS.CUSTOMERS.MANAGE_CREDIT)).toBe(true);
  });

  it('lets finance approve and cancel', () => {
    expect(hasPermission(FINANCE, PERMISSIONS.PAYMENTS.APPROVE)).toBe(true);
    expect(hasPermission(FINANCE, PERMISSIONS.PAYMENTS.CANCEL)).toBe(true);
  });

  it('lets a field rep collect but never approve their own collection', () => {
    // Separation of duties: the person holding the cash must not clear it.
    expect(hasPermission(FIELD_REP, PERMISSIONS.PAYMENTS.CREATE)).toBe(true);
    expect(hasPermission(FIELD_REP, PERMISSIONS.PAYMENTS.APPROVE)).toBe(false);
    expect(hasPermission(FIELD_REP, PERMISSIONS.PAYMENTS.REJECT)).toBe(false);
    expect(hasPermission(FIELD_REP, PERMISSIONS.PAYMENTS.CANCEL)).toBe(false);
  });

  it('does not leak credit limits to a rep who only sees outstanding', () => {
    expect(hasPermission(FIELD_REP, PERMISSIONS.CUSTOMERS.VIEW_OUTSTANDING)).toBe(true);
    expect(hasPermission(FIELD_REP, PERMISSIONS.CUSTOMERS.VIEW_CUSTOMER_CREDIT_LIMIT)).toBe(false);
    expect(hasPermission(FIELD_REP, PERMISSIONS.CREDIT_CONTROL.OVERRIDE_CREDIT_LIMIT)).toBe(false);
  });

  it('returns false for a role with no permissions at all', () => {
    expect(hasPermission({}, PERMISSIONS.PAYMENTS.CREATE)).toBe(false);
    expect(hasPermission(null, PERMISSIONS.PAYMENTS.CREATE)).toBe(false);
    expect(hasPermission(undefined, PERMISSIONS.PAYMENTS.CREATE)).toBe(false);
  });
});

describe('legacy add_/create_ prefix compatibility', () => {
  it('resolves create_* against a role storing the legacy add_* spelling', () => {
    // Installed APKs check `add_payments` and cannot be updated retroactively, so
    // renaming stored keys would silently revoke rights in the field.
    expect(hasPermission(LEGACY_REP, 'create_payments')).toBe(true);
    expect(hasPermission(LEGACY_REP, 'create_orders')).toBe(true);
    expect(hasPermission(LEGACY_REP, 'create_contacts')).toBe(true);
  });

  it('resolves add_* against a role storing the current create_* spelling', () => {
    expect(hasPermission(FINANCE, 'add_payments')).toBe(true);
    expect(hasPermission(FIELD_REP, 'add_payments')).toBe(true);
  });

  it('does not invent rights the role was never granted under either spelling', () => {
    expect(hasPermission(LEGACY_REP, 'create_leads')).toBe(false);
    expect(hasPermission(LEGACY_REP, 'approve_payments')).toBe(false);
    expect(hasPermission(FIELD_REP, 'add_orders')).toBe(false);
  });

  it('leaves non-creation keys untouched by aliasing', () => {
    expect(hasPermission(FIELD_REP, 'view_payments')).toBe(true);
    expect(hasPermission(FIELD_REP, 'delete_payments')).toBe(false);
  });
});

describe('data scope', () => {
  it('scopes a field rep to their own records', () => {
    expect(getDataScope(FIELD_REP, 'payments')).toBe('own');
  });

  it('defaults to own when nothing is configured', () => {
    expect(getDataScope({}, 'payments')).toBe('own');
    expect(getDataScope(null, 'payments')).toBe('own');
  });
});
