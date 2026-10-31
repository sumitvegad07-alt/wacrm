/**
 * Keeps a browser tab working when its access token lapses.
 *
 * WHAT WENT WRONG. A Supabase access token lives about an hour. supabase-js
 * refreshes it on a timer, but the timer does not fire while a laptop sleeps,
 * and the refresh token is rotated on every use — so a second tab, or the
 * phone app, can spend the one this tab is holding. When that happens the
 * tab keeps its cookie and looks signed in, while every request it makes gets
 *
 *     401 { code: 'PGRST301', message: 'No suitable key or wrong key type' }
 *
 * Before this module the app had no answer for that. Lists sat on their
 * spinner forever, because a panel that cannot resolve an account id returns
 * before it clears its loading flag. Saves failed with whatever generic
 * sentence the panel happened to carry. Nothing sent the user back to the
 * sign-in page, so the tab stayed broken until they guessed at a reload.
 * Reported 31 Oct 2026 by tenant 001300 as "everything keeps loading" and
 * "Failed to save company profile", and it could happen in any tenant.
 *
 * WHAT THIS DOES. One wrapper around `fetch`, installed on the single browser
 * client, so it covers every query and every save in the app at once: on a
 * session 401 it refreshes the session and replays the request. The user sees
 * nothing. Only if the refresh itself fails is the session really gone, and
 * then `onSessionLost` fires once and sends them to sign in again.
 *
 * Kept free of browser globals so it can be tested directly.
 */

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RecoveringFetchOptions {
  /** The real fetch. */
  fetchImpl: FetchImpl;
  /**
   * Refreshes the session; resolves to the new access token, or null if it
   * could not. `staleToken` is the one the rejected request carried, so an
   * implementation can tell a genuine renewal from the same dead token back.
   */
  refresh: (staleToken: string | null) => Promise<string | null>;
  /** Called once when the session is past saving. */
  onSessionLost: () => void;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url ?? '';
}

/** A refresh goes through /auth/v1 itself; recovering it would recurse. */
function isAuthCall(input: RequestInfo | URL): boolean {
  return urlOf(input).includes('/auth/v1/');
}

/**
 * Is this 401 about the session, rather than a row the user may not touch?
 * Reads a clone, so the caller's copy of the body stays unread.
 */
async function isExpiredSessionResponse(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = (await res.clone().json()) as { code?: string; message?: string };
    const code = body?.code ?? '';
    if (code === 'PGRST301' || code === 'PGRST302') return true;
    const message = (body?.message ?? '').toLowerCase();
    return (
      message.includes('jwt') ||
      message.includes('token') ||
      message.includes('invalid claim') ||
      message.includes('no suitable key')
    );
  } catch {
    // A 401 with no readable body is treated as a session failure: one refresh
    // is cheap, and leaving the tab dead is not.
    return true;
  }
}

function withToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export function createRecoveringFetch({
  fetchImpl,
  refresh,
  onSessionLost,
}: RecoveringFetchOptions): FetchImpl {
  // One refresh for a burst of 401s. A page load fires a dozen queries at
  // once; refreshing per request would spend — and invalidate — the rotated
  // refresh token a dozen times over and lose the session for real.
  let inFlight: Promise<string | null> | null = null;
  let reported = false;

  const refreshOnce = (staleToken: string | null): Promise<string | null> => {
    if (!inFlight) {
      inFlight = refresh(staleToken)
        .catch(() => null)
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  return async function recoveringFetch(input, init) {
    const res = await fetchImpl(input, init);

    if (res.status !== 401 || isAuthCall(input)) return res;
    if (!(await isExpiredSessionResponse(res))) return res;

    const sent = new Headers(init?.headers).get('Authorization');
    const staleToken = sent?.startsWith('Bearer ') ? sent.slice(7) : null;

    const token = await refreshOnce(staleToken);
    // The same token back is not a recovery — replaying with it would just
    // earn a second 401 and leave the tab stuck where it was.
    if (!token || token === staleToken) {
      if (!reported) {
        reported = true;
        onSessionLost();
      }
      return res; // body untouched, so the caller still sees the real error
    }

    // The session came back. Replay the request exactly once.
    reported = false;
    return fetchImpl(input, withToken(init, token));
  };
}
