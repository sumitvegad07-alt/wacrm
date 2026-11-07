// Wording for portal-login counts. A count followed by a hard-coded plural
// noun reads "1 portal logins"; every sentence that embeds a count goes here.

export function portalLoginsNoun(n: number): string {
  return n === 1 ? "portal login" : "portal logins";
}

/** Confirm text shown before removing the DMS from an account with logins in use. */
export function revokeLoginsConfirmText(seatsUsed: number): string {
  const tail =
    seatsUsed === 1
      ? "Removing the DMS will stop it signing in."
      : "Removing the DMS will stop all of them signing in.";
  return `This account has ${seatsUsed} ${portalLoginsNoun(seatsUsed)} in use. ${tail} Nothing is deleted. Continue?`;
}

/** Seats line, e.g. "1 of 1 login used", "2 of 3 logins used". */
export function seatsUsedLine(used: number, limit: number): string {
  if (limit <= 0) return "No logins included";
  return `${used} of ${limit} ${limit === 1 ? "login" : "logins"} used`;
}

/** Blocked-state message when every seat is taken. */
export function seatsFullText(limit: number): string {
  const lead = limit === 1 ? "The only portal login is in use." : `All ${limit} portal logins are in use.`;
  return `${lead} Remove access from another customer, or ask OZZO for more.`;
}
