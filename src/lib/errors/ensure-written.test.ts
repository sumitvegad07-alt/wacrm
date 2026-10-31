import { describe, it, expect } from 'vitest';
import { ensureWritten, NOT_PERMITTED_MESSAGE } from './ensure-written';

describe('ensureWritten', () => {
  it('passes a write that touched a row', () => {
    expect(() => ensureWritten({ data: [{ id: '1' }], error: null }, 'company profile')).not.toThrow();
  });

  it('passes a single-row write', () => {
    expect(() => ensureWritten({ data: { id: '1' }, error: null }, 'company profile')).not.toThrow();
  });

  // The real hole: PostgREST answers an UPDATE that row-level security filtered
  // out with 204 and no error, so the panel announced "Company profile updated"
  // and nothing had been written. Verified against production on 31 Oct 2026.
  it('throws when the write matched no row, instead of reporting success', () => {
    expect(() => ensureWritten({ data: [], error: null }, 'company profile')).toThrow(
      NOT_PERMITTED_MESSAGE('company profile'),
    );
  });

  it('throws when the write came back empty', () => {
    expect(() => ensureWritten({ data: null, error: null }, 'company profile')).toThrow(/company profile/);
  });

  it('reports the database error ahead of the row count', () => {
    expect(() =>
      ensureWritten(
        { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null } },
        'company profile',
      ),
    ).toThrow(/duplicate key/);
  });

  it('turns an expired session into plain English', () => {
    expect(() =>
      ensureWritten({ data: null, error: { code: 'PGRST301', message: 'No suitable key or wrong key type' } }, 'company profile'),
    ).toThrow(/sign-in has expired/i);
  });

  it('throws a real Error, so callers that test instanceof still work', () => {
    try {
      ensureWritten({ data: [], error: null }, 'company profile');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});
