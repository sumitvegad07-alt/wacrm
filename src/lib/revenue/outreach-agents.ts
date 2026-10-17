// ============================================================
// The extension's credential.
//
// WHY A TOKEN AND NOT THE FOUNDER'S SESSION
//
// The extension's background service worker cannot borrow the logged-in
// session: Supabase's auth cookies are SameSite=Lax and a fetch from a
// chrome-extension:// origin is cross-site, so they are never sent. And a
// service-role key must not sit in an unpacked extension folder on a laptop.
//
// So: one row per installed extension, holding a random token's hash. Shown
// once at mint. Revoking the row stops that extension dead without touching
// anything else — the same narrow, individually revocable shape as
// re_discovery_runs.worker_token, but multi-use, because the extension comes
// back eighty times a day.
// ============================================================

import { createHash, randomBytes } from "node:crypto";

export const AGENT_TOKEN_HEADER = "x-ozzo-agent-token";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken(): { token: string; tokenHash: string } {
  // base64url so it survives being pasted into a header and an options field
  // without any +, / or = to mangle.
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
