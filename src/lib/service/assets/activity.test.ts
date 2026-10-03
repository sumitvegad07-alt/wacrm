import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ASSET_ACTIVITY_MODULE,
  buildAssetActivity,
  describeUpdate,
  logAssetActivity,
  type LoggedAsset,
} from './activity';

const asset: LoggedAsset = { id: 'asset-1', account_id: 'acct-1', asset_code: 'AST-000007', name: 'Test pump' };
const AUTH_ID = 'auth-user-1';

describe('describeUpdate', () => {
  it('names one changed field', () => {
    expect(describeUpdate(['notes'])).toBe('Updated notes');
  });

  it('joins several with commas and "and"', () => {
    expect(describeUpdate(['serial_no', 'notes'])).toBe('Updated serial number and notes');
    expect(describeUpdate(['serial_no', 'warranty_end', 'status'])).toBe(
      'Updated serial number, warranty end and status',
    );
  });

  it('never prints a raw column name', () => {
    expect(describeUpdate(['model_no', 'asset_type_id', 'territory_id'])).toBe(
      'Updated model number, asset type and territory',
    );
  });

  it('lists a field once even if it is repeated', () => {
    expect(describeUpdate(['notes', 'notes'])).toBe('Updated notes');
  });

  it('falls back to a plain sentence when no changed field is one it names', () => {
    expect(describeUpdate([])).toBe('Asset updated');
    expect(describeUpdate(['asset_code', 'deleted_at'])).toBe('Asset updated');
  });
});

describe('buildAssetActivity', () => {
  it('shapes a created row for the customer_asset module', () => {
    expect(buildAssetActivity({ kind: 'created', asset }, AUTH_ID)).toEqual({
      account_id: 'acct-1',
      user_id: AUTH_ID,
      module_name: 'customer_asset',
      record_id: 'asset-1',
      action: 'created',
      message: 'Asset AST-000007 created',
      details: { asset_code: 'AST-000007', name: 'Test pump' },
    });
    expect(ASSET_ACTIVITY_MODULE).toBe('customer_asset');
  });

  it('uses action "updated" (the Timeline files that under Changelog) and records the changed fields', () => {
    const row = buildAssetActivity({ kind: 'updated', asset, changed: ['notes', 'serial_no'] }, AUTH_ID);
    expect(row.action).toBe('updated');
    expect(row.message).toBe('Updated notes and serial number');
    expect(row.details).toEqual({ asset_code: 'AST-000007', name: 'Test pump', changed_fields: ['notes', 'serial_no'] });
  });

  it('shapes archived and restored rows', () => {
    expect(buildAssetActivity({ kind: 'archived', asset }, AUTH_ID)).toMatchObject({
      action: 'archived',
      message: 'Moved to Inactive',
    });
    expect(buildAssetActivity({ kind: 'restored', asset, recoded: false }, AUTH_ID)).toMatchObject({
      action: 'restored',
      message: 'Re-activated',
      details: { asset_code: 'AST-000007', name: 'Test pump' },
    });
  });

  it('says so when a restore also changed the code, and flags it in details', () => {
    const row = buildAssetActivity({ kind: 'restored', asset, recoded: true }, AUTH_ID);
    expect(row.message).toBe('Re-activated with new code AST-000007');
    expect(row.details).toMatchObject({ recoded: true });
  });

  it('writes exactly the given user id into user_id', () => {
    expect(buildAssetActivity({ kind: 'created', asset }, AUTH_ID).user_id).toBe(AUTH_ID);
  });

  it('does not copy anything else from the asset row into the log', () => {
    const noisy = { ...asset, serial_no: 'SECRET', notes: 'private' } as LoggedAsset;
    expect(JSON.stringify(buildAssetActivity({ kind: 'created', asset: noisy }, AUTH_ID))).not.toMatch(/SECRET|private/);
  });
});

/** A client whose insert and session are controllable; enough of the surface for logAssetActivity. */
function fakeClient(opts: { userId?: string | null; insert?: () => Promise<{ error: { message: string } | null }> }) {
  const insert = vi.fn((row: unknown) => {
    void row; // typed so mock.calls[0][0] is readable in the assertions
    return (opts.insert ?? (async () => ({ error: null })))();
  });
  const from = vi.fn(() => ({ insert }));
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: opts.userId === null ? null : { user: { id: opts.userId ?? AUTH_ID } } },
      })),
    },
    from,
  };
  return { client: client as unknown as SupabaseClient, insert, from };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('logAssetActivity', () => {
  it('inserts one row into module_activities with the auth user id', async () => {
    const { client, insert, from } = fakeClient({});
    logAssetActivity(client, { kind: 'created', asset });
    await flush();
    expect(from).toHaveBeenCalledWith('module_activities');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ user_id: AUTH_ID, module_name: 'customer_asset', action: 'created' });
  });

  it('returns before the write finishes: it hands back nothing to await', () => {
    let release: () => void = () => undefined;
    const { client } = fakeClient({
      insert: () => new Promise((resolve) => (release = () => resolve({ error: null }))),
    });
    const result = logAssetActivity(client, { kind: 'created', asset });
    expect(result).toBeUndefined();
    release();
  });

  it('swallows a failed insert', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = fakeClient({ insert: async () => ({ error: { message: 'nope' } }) });
    expect(() => logAssetActivity(client, { kind: 'archived', asset })).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('swallows a thrown insert', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = fakeClient({
      insert: async () => {
        throw new Error('network down');
      },
    });
    expect(() => logAssetActivity(client, { kind: 'archived', asset })).not.toThrow();
    await flush();
    warn.mockRestore();
  });

  it('writes nothing when there is no session', async () => {
    const { client, insert } = fakeClient({ userId: null });
    logAssetActivity(client, { kind: 'created', asset });
    await flush();
    expect(insert).not.toHaveBeenCalled();
  });
});
