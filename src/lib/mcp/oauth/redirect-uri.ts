// ============================================================
// Redirect-URI rules for Dynamic Client Registration.
//
// These are the load-bearing checks of the whole OAuth surface. A redirect
// URI that is accepted at registration and then honoured at /authorize is
// where an authorization code gets delivered, so a loose rule here turns
// OZZO into an open redirector that hands codes to an attacker's host.
//
// Pure functions, so they can be tested exhaustively without a request.
// ============================================================

/** Why a URI was refused. Phrased for a developer reading an API error. */
export type RedirectUriProblem = string;

export interface RedirectUriCheck {
  ok: boolean;
  problem?: RedirectUriProblem;
}

/**
 * One redirect URI, validated.
 *
 * https is required, with an exception only for genuine loopback hosts so a
 * local MCP client can be tested. Fragments are forbidden by RFC 6749 §3.1.2,
 * and userinfo (https://user:pass@host) is rejected because it makes the real
 * host hard to read at a glance on the Allow screen.
 */
export function checkRedirectUri(raw: unknown): RedirectUriCheck {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, problem: "redirect_uris entries must be non-empty strings" };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: `"${raw}" is not an absolute URI` };
  }

  if (url.hash) {
    return { ok: false, problem: `"${raw}" must not contain a fragment` };
  }
  if (url.username || url.password) {
    return { ok: false, problem: `"${raw}" must not contain userinfo` };
  }

  const loopback = isLoopbackHost(url.hostname);

  if (url.protocol === "https:") {
    return { ok: true };
  }
  if (url.protocol === "http:" && loopback) {
    // Loopback over http is explicitly allowed for native clients
    // (RFC 8252 §7.3) and is what the MCP Inspector uses locally.
    return { ok: true };
  }
  if (url.protocol === "http:") {
    return {
      ok: false,
      problem: `"${raw}" must use https (http is only allowed for loopback addresses)`,
    };
  }
  return {
    ok: false,
    problem: `"${raw}" must use https; the "${url.protocol}" scheme is not accepted`,
  };
}

/** Loopback only — never a name that merely looks local. "localhost.evil.com"
 *  resolves wherever its owner points it. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

/**
 * The whole redirect_uris array. Returns the first problem found, so the
 * client gets one actionable message rather than a list.
 */
export function checkRedirectUris(raw: unknown): RedirectUriCheck {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, problem: "redirect_uris must be a non-empty array" };
  }
  if (raw.length > 10) {
    return { ok: false, problem: "redirect_uris may list at most 10 entries" };
  }
  for (const entry of raw) {
    const r = checkRedirectUri(entry);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Exact-match check used at /authorize. Deliberately not a prefix or origin
 * comparison: "starts with the registered URI" would let
 * https://good.example/cb.evil.com through.
 */
export function isRegisteredRedirectUri(
  candidate: string,
  registered: string[],
): boolean {
  return registered.some((r) => r === candidate);
}
