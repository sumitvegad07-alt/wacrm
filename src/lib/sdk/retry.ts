// Generic SDK infrastructure — retry (reusable across modules).
// Extracted from the Route SDK (Phase 2a refinement) so future service layers inherit the
// same transient-retry behavior. Transport-agnostic: knows nothing about Supabase.

/** An error is transient (worth retrying) if it is explicitly flagged retryable, or it is a
 *  transport-level failure with no backend status code (e.g. a fetch TypeError). */
export function isTransient(error: unknown): boolean {
  const e = error as { retryable?: boolean; code?: unknown } | undefined;
  if (e?.retryable === true) return true;
  if (e && e.code === undefined && (error as Error)?.name === 'TypeError') return true;
  return false;
}

/** Run `fn`, retrying transient failures with linear backoff up to `maxRetries` times. */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastErr;
}
