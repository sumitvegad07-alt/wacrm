// ============================================================
// The origin a redirect built inside a route handler must point at.
//
// `request.url` is not dependable behind a proxy: the serverless function
// often sees an internal URL, so a redirect built from it can drop the user
// on a host they were never browsing. Every proxy in front of the app
// (Vercel, Cloudflare, nginx) sets `x-forwarded-host`, so that comes first.
//
// The header is client-controllable on a bare deployment, but the only
// person affected by a forged one is whoever sent it, and the result is
// still a path on this app — so there is nothing to steal here.
// ============================================================

/** Scheme + host to resolve a redirect path against. No trailing slash. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (!forwardedHost) return url.origin;

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  return `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost}`;
}
