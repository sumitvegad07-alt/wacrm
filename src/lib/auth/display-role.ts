// ============================================================
// displayRoleName — the ONLY way a role may reach a screen.
//
// This product has exactly one kind of role: the one an admin
// created in Team → Roles. A fresh account is seeded with two of
// them — "Admin" and "Sales Executive" (plus the FSM service roles
// when the plan includes that line) — and every other role carries
// whatever name the admin typed.
//
// `profiles.account_role` ('owner' | 'admin' | 'agent' | 'viewer')
// is NOT a role and must never be printed. It is an internal
// database-security flag left over from the WhatsApp-CRM era: RLS
// and `is_account_member(account_id, min_role)` read it to answer
// "does this person have full access?", nothing more. It is derived
// from the employee role (Full Access → 'admin', otherwise
// 'agent'), and the signup user is pinned to 'owner' so no other
// admin can demote or remove the account's first administrator.
//
// Printing that flag is how "Owner" and "Agent" — two words that
// name nothing in this product — ended up on the superadmin
// Members list and the Settings → Overview chip. Route every role
// label through here so they cannot come back.
// ============================================================

/** Shown when a profile has no employee role linked at all. */
export const NO_ROLE_LABEL = "No role assigned";

/**
 * The role name to show for one person.
 *
 * @param roleName    `employee_roles.name` for this profile, if any.
 * @param accountRole the internal `profiles.account_role` flag — used
 *                    only as a fallback, never printed verbatim.
 */
export function displayRoleName(
  roleName: string | null | undefined,
  accountRole?: string | null,
): string {
  const name = typeof roleName === "string" ? roleName.trim() : "";
  if (name) return name;

  // No employee role linked (old rows, or a profile created before the
  // Roles module). The account_role flag still tells us whether this
  // person has full access, so say "Admin" rather than inventing a
  // name — but never leak the flag's own wording.
  const flag = String(accountRole ?? "").trim().toLowerCase();
  if (flag === "owner" || flag === "admin") return "Admin";

  return NO_ROLE_LABEL;
}

/**
 * True when this person has account-wide (full) access. Used for
 * sorting and for neutral "is this an administrator?" badges, so the
 * callers never have to look at the raw flag themselves.
 */
export function hasFullAccess(accountRole?: string | null): boolean {
  const flag = String(accountRole ?? "").trim().toLowerCase();
  return flag === "owner" || flag === "admin";
}
