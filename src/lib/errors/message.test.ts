import { describe, it, expect } from 'vitest';
import { errorMessage, isSessionExpired, SESSION_EXPIRED_MESSAGE } from './message';

describe('errorMessage', () => {
  it('reads a plain Error', () => {
    expect(errorMessage(new Error('Image upload failed'), 'Fallback')).toBe('Image upload failed');
  });

  // The bug behind "Failed to save company profile": supabase-js resolves with a
  // plain object, never an Error, so `err instanceof Error` was always false and
  // every call site threw the real reason away.
  it('reads a PostgREST error object, which is not an Error instance', () => {
    const postgrestError = {
      code: '42501',
      details: null,
      hint: null,
      message: 'permission denied for table accounts',
    };
    expect(postgrestError instanceof Error).toBe(false);
    expect(errorMessage(postgrestError, 'Failed to save company profile')).toContain(
      'permission denied for table accounts',
    );
  });

  it('keeps the database code so a report names the exact failure', () => {
    const msg = errorMessage(
      { code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null },
      'Failed to save',
    );
    expect(msg).toContain('23505');
  });

  it('adds details and hint when the message alone does not explain it', () => {
    const msg = errorMessage(
      {
        code: '23503',
        message: 'insert or update on table "orders" violates foreign key constraint',
        details: 'Key (customer_id)=(abc) is not present in table "contacts".',
        hint: null,
      },
      'Failed to save',
    );
    expect(msg).toContain('is not present in table');
  });

  it('turns an expired session into plain English, not PGRST301', () => {
    const msg = errorMessage(
      { code: 'PGRST301', details: 'None of the keys was able to decode the JWT', hint: null, message: 'No suitable key or wrong key type' },
      'Failed to save company profile',
    );
    expect(msg).toBe(SESSION_EXPIRED_MESSAGE);
    expect(msg).not.toContain('PGRST301');
  });

  it('names a lost connection instead of blaming the save', () => {
    expect(errorMessage({ message: 'TypeError: Failed to fetch' }, 'Failed to save')).toMatch(
      /connect|internet|network/i,
    );
  });

  it('falls back only when there is genuinely nothing to report', () => {
    expect(errorMessage(null, 'Failed to save company profile')).toBe('Failed to save company profile');
    expect(errorMessage({}, 'Failed to save company profile')).toBe('Failed to save company profile');
    expect(errorMessage({ message: '   ' }, 'Failed to save company profile')).toBe(
      'Failed to save company profile',
    );
  });

  it('reads a thrown string', () => {
    expect(errorMessage('boom', 'Fallback')).toBe('boom');
  });

  it('never returns the empty string', () => {
    expect(errorMessage(undefined, '')).not.toBe('');
  });
});

describe('isSessionExpired', () => {
  it('matches the shapes PostgREST and GoTrue actually return', () => {
    expect(isSessionExpired({ code: 'PGRST301' })).toBe(true);
    expect(isSessionExpired({ message: 'JWT expired' })).toBe(true);
    expect(isSessionExpired({ message: 'invalid claim: missing sub claim' })).toBe(true);
    expect(isSessionExpired({ message: 'Invalid Refresh Token: Already Used' })).toBe(true);
    expect(isSessionExpired({ status: 401, message: 'Unauthorized' })).toBe(true);
  });

  it('does not mistake an ordinary failure for a dead session', () => {
    expect(isSessionExpired({ code: '42501', message: 'permission denied for table accounts' })).toBe(false);
    expect(isSessionExpired(new Error('Image upload failed'))).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });
});
