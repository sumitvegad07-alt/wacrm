"use server";

// ============================================================
// The switch that lets an AI tool read employee location, attendance and
// device health.
//
// Owner-gated, not admin-gated. Every other data set describes the business;
// these three describe people — where they were, when they worked, what phone
// they carry. An Admin can already read them in OZZO itself, but sending them
// to an outside AI service is a different decision, and it belongs to whoever
// owns the account rather than to anyone with an admin seat.
//
// Off by default. Nothing here turns it on implicitly.
// ============================================================
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface WorkforceAccessState {
  enabled: boolean;
  /** False when the signed-in user may see the switch but not change it. */
  canChange: boolean;
}

// A "use server" file may export ONLY async functions — every export becomes a
// callable server endpoint. Exporting an error class here broke the entire
// production build, not just this setting. Plain Errors instead; the caller
// shows err.message, which is all it ever used.

async function loadContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  const row = profile as {
    account_id: string | null;
    account_role: string | null;
  } | null;
  if (!row?.account_id) {
    throw new Error("This sign-in is not attached to an account.");
  }
  return {
    supabase,
    accountId: row.account_id,
    isOwner: String(row.account_role ?? "").toLowerCase() === "owner",
  };
}

/** Current value, plus whether this user is allowed to change it. */
export async function getMcpWorkforceAccess(): Promise<WorkforceAccessState> {
  const { supabase, accountId, isOwner } = await loadContext();
  const { data } = await supabase
    .from("accounts")
    .select("settings")
    .eq("id", accountId)
    .maybeSingle();
  const settings =
    ((data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as
      Record<string, unknown>;
  return {
    // Only an explicit true counts. A truthy string must not enable this.
    enabled: settings.mcp_allow_workforce_data === true,
    canChange: isOwner,
  };
}

export async function setMcpWorkforceAccess(enabled: boolean): Promise<void> {
  const { supabase, accountId, isOwner } = await loadContext();
  if (!isOwner) {
    throw new Error(
      "Only the account owner can change what an AI tool may read about employees.",
    );
  }

  // Read-modify-write on the whole settings object, because it holds every
  // other account setting and a bare update would wipe them.
  const { data } = await supabase
    .from("accounts")
    .select("settings")
    .eq("id", accountId)
    .maybeSingle();
  const settings =
    ((data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as
      Record<string, unknown>;

  const { error } = await supabase
    .from("accounts")
    .update({ settings: { ...settings, mcp_allow_workforce_data: enabled === true } })
    .eq("id", accountId);
  if (error) {
    throw new Error("Could not save that setting. Please try again.");
  }

  revalidatePath("/settings");
}
