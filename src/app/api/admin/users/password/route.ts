import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";

/**
 * POST /api/admin/users/password
 *
 * Platform-owner password reset. Lets a superadmin set a new password for ANY
 * user in ANY tenant (an account owner or one of their team members) — the
 * security/support capability the owner needs to get a locked-out user back in.
 *
 * Passwords are stored as one-way bcrypt hashes, so the CURRENT password can
 * never be read back (not by us, not by Supabase). Reset is the only safe,
 * industry-standard answer, so this route sets a new one rather than revealing
 * the old.
 *
 * Body: { profile_id: string, password: string }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const { profile_id, password } = await req.json();

    if (!profile_id || typeof password !== "string") {
      return NextResponse.json(
        { error: "profile_id and password are required" },
        { status: 400 },
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    const admin = serviceClient();

    // Resolve the auth user behind this profile.
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("user_id, email, full_name, account_id")
      .eq("id", profile_id)
      .single();

    if (profileErr || !profile?.user_id) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { error: authErr } = await admin.auth.admin.updateUserById(
      profile.user_id,
      { password },
    );

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    // Audit trail: record who reset whose password, without ever storing the
    // password itself. Best-effort — never fail the reset if logging does.
    try {
      await admin.from("superadmin_audit_log").insert({
        actor_user_id: ctx.userId,
        actor_email: ctx.email,
        action: "reset_password",
        table_name: "auth.users",
        target_account_id: profile.account_id,
        filters: {
          profile_id,
          target_user_id: profile.user_id,
          target_email: profile.email,
        },
      });
    } catch {
      /* best-effort; never fail the reset on a logging error */
    }

    return NextResponse.json({
      ok: true,
      email: profile.email,
      full_name: profile.full_name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
