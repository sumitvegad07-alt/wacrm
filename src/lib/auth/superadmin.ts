// ============================================================
// Platform superadmin guard + service-role client.
//
// The superadmin panel deliberately reads across every tenant, which RLS is
// built to prevent. Rather than weakening ~200 policies with `OR
// is_superadmin()`, the panel goes through server routes that:
//   1. verify the caller is a superadmin using their own RLS-scoped session, then
//   2. run the actual read with the service-role key.
//
// The service-role key stays server-side. Every route under /api/admin MUST
// call `requireSuperadmin()` before touching `serviceClient()`.
//
// This module is server-only: it imports the SSR client, which reads
// `next/headers` cookies, so a client import fails at build time.
// ============================================================

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "./account";

export interface SuperadminContext {
  userId: string;
  email: string | null;
}

/**
 * Throws `UnauthorizedError` when there is no session, `ForbiddenError` when
 * the caller's profile is not flagged `is_superadmin`.
 */
export async function requireSuperadmin(): Promise<SuperadminContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new UnauthorizedError("Not signed in");

  // Read through the caller's own client: `profiles_select` always permits a
  // user to read their own row, so no service-role escalation is needed to
  // answer "are you a superadmin".
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("user_id", user.id)
    .single();

  if (!profile?.is_superadmin) throw new ForbiddenError("Superadmin only");

  return { userId: user.id, email: user.email ?? null };
}

/**
 * Service-role client. Bypasses RLS entirely — only call it after
 * `requireSuperadmin()` has resolved.
 */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Server is missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL",
    );
  }

  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
