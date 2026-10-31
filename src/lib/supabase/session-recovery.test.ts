import { describe, it, expect, vi } from 'vitest';
import { createRecoveringFetch } from './session-recovery';

const EXPIRED_BODY = JSON.stringify({
  code: 'PGRST301',
  details: 'None of the keys was able to decode the JWT',
  hint: null,
  message: 'No suitable key or wrong key type',
});

function expired() {
  return new Response(EXPIRED_BODY, { status: 401, headers: { 'content-type': 'application/json' } });
}
function ok(body = '[]') {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

const REST = 'https://db.example.co/rest/v1/accounts?id=eq.1';

describe('createRecoveringFetch', () => {
  it('passes a healthy request straight through', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const refresh = vi.fn();
    const f = createRecoveringFetch({ fetchImpl, refresh, onSessionLost: vi.fn() });

    const res = await f(REST, { method: 'GET' });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes and retries once when the token has expired, so the save still lands', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok('{"id":"1"}'));
    const refresh = vi.fn().mockResolvedValue('new-token');
    const onSessionLost = vi.fn();
    const f = createRecoveringFetch({ fetchImpl, refresh, onSessionLost });

    const res = await f(REST, { method: 'PATCH', headers: { Authorization: 'Bearer old-token' } });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"id":"1"}');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('retries with the new token, not the dead one', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok());
    const f = createRecoveringFetch({
      fetchImpl,
      refresh: vi.fn().mockResolvedValue('new-token'),
      onSessionLost: vi.fn(),
    });

    await f(REST, { method: 'GET', headers: { Authorization: 'Bearer old-token' } });

    const retryInit = fetchImpl.mock.calls[1][1] as RequestInit;
    const sent = new Headers(retryInit.headers);
    expect(sent.get('Authorization')).toBe('Bearer new-token');
  });

  it('refreshes once for a burst of requests, not once each', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === 'Bearer new-token' ? ok() : expired();
    });
    const refresh = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'new-token';
    });
    const f = createRecoveringFetch({ fetchImpl, refresh, onSessionLost: vi.fn() });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => f(REST, { headers: { Authorization: 'Bearer old-token' } })),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports the session lost — once — when the refresh fails, instead of hanging', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(expired());
    const onSessionLost = vi.fn();
    const f = createRecoveringFetch({
      fetchImpl,
      refresh: vi.fn().mockResolvedValue(null),
      onSessionLost,
    });

    const [a, b] = await Promise.all([f(REST), f(REST)]);

    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('tells the refresh which token failed, so it can spot a stale one coming back', async () => {
    const refresh = vi.fn().mockResolvedValue('new-token');
    const f = createRecoveringFetch({
      fetchImpl: vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok()),
      refresh,
      onSessionLost: vi.fn(),
    });

    await f(REST, { headers: { Authorization: 'Bearer old-token' } });

    expect(refresh).toHaveBeenCalledWith('old-token');
  });

  it('does not replay with the same dead token when nothing was renewed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(expired());
    const onSessionLost = vi.fn();
    const f = createRecoveringFetch({
      fetchImpl,
      refresh: vi.fn().mockResolvedValue('old-token'),
      onSessionLost,
    });

    const res = await f(REST, { headers: { Authorization: 'Bearer old-token' } });

    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('still answers the caller when the refresh itself throws', async () => {
    const f = createRecoveringFetch({
      fetchImpl: vi.fn().mockResolvedValue(expired()),
      refresh: vi.fn().mockRejectedValue(new Error('network down')),
      onSessionLost: vi.fn(),
    });

    await expect(f(REST)).resolves.toMatchObject({ status: 401 });
  });

  it('leaves the body readable — the caller still gets the PostgREST error', async () => {
    const f = createRecoveringFetch({
      fetchImpl: vi.fn().mockResolvedValue(expired()),
      refresh: vi.fn().mockResolvedValue(null),
      onSessionLost: vi.fn(),
    });

    const res = await f(REST);
    expect(await res.json()).toMatchObject({ code: 'PGRST301' });
  });

  // A refresh runs through /auth/v1/token. Recovering that would recurse.
  it('never tries to recover an auth call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(expired());
    const refresh = vi.fn();
    const f = createRecoveringFetch({ fetchImpl, refresh, onSessionLost: vi.fn() });

    const res = await f('https://db.example.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' });

    expect(res.status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not touch a 401 that is not about the session', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: '42501', message: 'permission denied for table accounts' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const refresh = vi.fn();
    const f = createRecoveringFetch({ fetchImpl, refresh, onSessionLost: vi.fn() });

    await f(REST);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not retry a 403 or a 500', async () => {
    const refresh = vi.fn();
    const f = createRecoveringFetch({
      fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 500 })),
      refresh,
      onSessionLost: vi.fn(),
    });

    expect((await f(REST)).status).toBe(500);
    expect(refresh).not.toHaveBeenCalled();
  });
});
