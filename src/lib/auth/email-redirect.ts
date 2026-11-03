// ============================================================
// Where a link we e-mail has to bring the user back to.
//
// Every one of these links — confirm your address, accept an invitation,
// resend a confirmation — must name this URL explicitly. Leave it out and
// Supabase builds the link from the project's Site URL instead, which is how
// every new user ended up on `http://localhost:3000` until 3 Nov 2026.
//
// `/auth/callback` is what turns the one-time code in the link into a real
// session; `next` is where the user goes once it has.
// ============================================================

/**
 * @param origin  Scheme + host the user is browsing (`window.location.origin`),
 *                so the link returns them to the site they started on — that is
 *                the only browser holding the PKCE verifier the code needs.
 * @param inviteToken  Set when the signup came from an invitation, so the user
 *                lands on the invitation instead of the dashboard.
 */
export function emailRedirectUrl(
  origin: string,
  inviteToken?: string | null,
): string {
  const next = inviteToken
    ? `/join/${encodeURIComponent(inviteToken)}`
    : "/dashboard";
  return `${origin.replace(/\/+$/, "")}/auth/callback?next=${encodeURIComponent(next)}`;
}
