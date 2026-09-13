// Client-safe founder identity. Kept separate from superadmin.ts because that
// module imports the server Supabase client (next/headers) and therefore cannot
// be imported into client components.

/**
 * The single platform owner allowed to grant/revoke superadmin. Changing who
 * can do this is a deliberate code change, not a click in the UI.
 */
export const FOUNDER_EMAIL = "sumitvegad07@gmail.com";

export function isFounderEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === FOUNDER_EMAIL;
}
