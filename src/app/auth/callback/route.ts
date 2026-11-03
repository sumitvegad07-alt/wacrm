import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { requestOrigin } from "@/lib/auth/request-origin";

// ============================================================
// Where every link we email lands: confirm-your-email, password reset and
// invitations.
//
// Supabase sends the user to `<project>/auth/v1/verify`, which marks the
// e-mail confirmed and then bounces them here with a one-time `code`. That
// code is worthless on its own — it has to be traded for a session, which is
// what this route does, writing the auth cookies on the way through.
//
// Until 3 Nov 2026 this route did not exist. Password-reset links pointed at
// it and 404'd, and signup confirmations never named a destination at all, so
// Supabase fell back to the project's Site URL — `http://localhost:3000`.
// Every new user who clicked "confirm your email" got "This site can't be
// reached". The signup page now always names this route.
//
// The browser that started the flow holds the PKCE verifier in a cookie, so
// the exchange only succeeds in that browser. Opening the mail on a different
// phone is normal and must not look like a failure: the account is confirmed
// either way, so those users are sent to sign in with a plain explanation
// rather than an error.
// ============================================================

export const dynamic = "force-dynamic";

/** The e-mail link types Supabase can hand us as a `token_hash`. */
const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function isOtpType(value: string | null): value is EmailOtpType {
  return !!value && (OTP_TYPES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const next = safeNextPath(url.searchParams.get("next")) ?? "/dashboard";
  const landing = (query: string) =>
    NextResponse.redirect(new URL(`/login?link=${query}`, origin));

  // A dead or already-clicked link never reaches the exchange: Supabase
  // redirects here with the failure in the query string instead.
  if (url.searchParams.get("error") || url.searchParams.get("error_code")) {
    return landing("expired");
  }

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  // A reset is the one flow where signing in is not a usable fallback — the
  // whole point is that the user cannot. Send them back for a fresh link.
  const fallback = next === "/reset-password" ? "expired" : "verified";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? landing(fallback) : NextResponse.redirect(new URL(next, origin));
  }

  // Templates built on `{{ .TokenHash }}` instead of `{{ .ConfirmationURL }}`
  // arrive in this shape. Supported so a changed e-mail template cannot break
  // sign-up again.
  if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    return error ? landing(fallback) : NextResponse.redirect(new URL(next, origin));
  }

  return landing("invalid");
}
