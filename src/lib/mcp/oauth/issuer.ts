// ============================================================
// The base URL this OAuth server advertises as its issuer.
//
// This has to be exactly the origin the client fetched the metadata from.
// A client that requests https://app.ozzo.co.in/.well-known/... and reads
// back an issuer of http://localhost:3000 rejects the document, and the
// failure surfaces in ChatGPT as an unhelpful "could not connect" with
// nothing naming the cause.
//
// So the origin is derived from the request itself, honouring the proxy
// headers Vercel sets. NEXT_PUBLIC_APP_URL overrides it for the rare case
// where the public origin genuinely differs from what reaches the handler,
// and the production host is the last resort when a caller has no request
// to hand.
// ============================================================

export const FALLBACK_BASE_URL = "https://app.ozzo.co.in";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The origin for this request, or the configured/default one. */
export function issuerBaseUrl(request?: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.trim()) return trimTrailingSlash(configured.trim());

  if (request) {
    const derived = originFromRequest(request);
    if (derived) return derived;
  }

  return FALLBACK_BASE_URL;
}

/**
 * Origin from the request's proxy headers, falling back to the URL the
 * handler actually received. Returns null when neither yields a host.
 */
export function originFromRequest(request: Request): string | null {
  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host") ?? headers.get("host");
  if (forwardedHost) {
    const proto =
      headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (isLocalHost(forwardedHost) ? "http" : "https");
    return trimTrailingSlash(`${proto}://${forwardedHost}`);
  }
  try {
    return trimTrailingSlash(new URL(request.url).origin);
  } catch {
    return null;
  }
}

/** Local development hosts, which are served over http. */
export function isLocalHost(host: string): boolean {
  const name = host.split(":")[0].toLowerCase();
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "[::1]" ||
    name === "::1" ||
    name.endsWith(".localhost")
  );
}
