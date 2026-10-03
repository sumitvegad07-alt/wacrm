// ============================================================
// PKCE (RFC 7636) verification. OAuth 2.1 requires it and forbids the
// "plain" method, so only S256 is accepted here.
// ============================================================
import { createHash, timingSafeEqual } from "node:crypto";

export function isSupportedChallengeMethod(m: unknown): m is "S256" {
  return m === "S256";
}

export function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (!isSupportedChallengeMethod(method)) return false;
  if (!verifier || !challenge) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // a truncated challenge must be a clean false, not a 500.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
