// ============================================================
// Where a post-sign-in redirect is allowed to go.
//
// The login page accepts a `next` parameter so the MCP OAuth consent screen
// can send a signed-out admin to sign in and get them back on the same
// /authorize URL with its query intact.
//
// That parameter is attacker-controllable, so it is constrained to
// same-origin, path-absolute destinations. Without this the login page
// becomes an open redirector: a link that genuinely signs the user into OZZO
// and then drops them on a lookalike site, which is far more convincing than
// a plain phishing page because the sign-in really happened.
// ============================================================

/** The destination to use, or null to fall back to the default. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Must be a path on this origin.
  if (!raw.startsWith("/")) return null;
  // "//evil.com" is protocol-relative and leaves the origin.
  if (raw.startsWith("//")) return null;
  // Some browsers normalise backslashes to forward slashes, so "/\evil.com"
  // and "/\evil.com" can also escape the origin.
  if (raw.startsWith("/\\")) return null;
  // A control character or newline can split a header or confuse a parser.
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;
  return raw;
}
