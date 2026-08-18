import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";

/**
 * Cross-tenant user list for the superadmin panel.
 *
 * The page used to query `profiles` directly from the browser, but
 * `profiles_select` is account-scoped, so it only ever returned the
 * superadmin's own company.
 */
export async function GET() {
  try {
    await requireSuperadmin();
    const admin = serviceClient();

    const { data, error } = await admin
      .from("profiles")
      .select(
        "id, full_name, email, account_role, is_superadmin, account_id, accounts(name)",
      )
      .order("email");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ users: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Grant or revoke platform superadmin. The `is_superadmin` column is no longer
 * writable by `authenticated` (see migration 20260818200000), so this is the
 * only path that can change it.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const { id, is_superadmin } = await req.json();

    if (!id || typeof is_superadmin !== "boolean") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = serviceClient();

    // Refuse to strip your own flag — that would lock the last superadmin out
    // of the panel with no way back in short of a SQL console.
    const { data: target } = await admin
      .from("profiles")
      .select("user_id")
      .eq("id", id)
      .single();

    if (target?.user_id === ctx.userId && !is_superadmin) {
      return NextResponse.json(
        { error: "You cannot remove your own superadmin access" },
        { status: 400 },
      );
    }

    const { error } = await admin
      .from("profiles")
      .update({ is_superadmin })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
