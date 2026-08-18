import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";

/**
 * View-As: what would this user see?
 *
 * Deliberately NOT impersonation. No session is created, no magic link is
 * minted, and `auth.uid()` never changes — the superadmin stays themselves
 * throughout, so every query underneath is still attributable to them and the
 * audit trail stays intact.
 *
 * This returns the target user's permission context (role, granular
 * permissions, module toggles, scope). The client renders the real navigation
 * tree against it, which answers the support questions that matter — "why
 * can't they see Orders", "why is the Route screen blank" — without handing
 * anyone a session they should not have.
 *
 * What it cannot answer: "the button does nothing when I click it". That needs
 * real impersonation, which was deliberately rejected.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();

    const userId = req.nextUrl.searchParams.get("profileId");
    if (!userId) {
      return NextResponse.json({ error: "Missing profileId" }, { status: 400 });
    }

    const { data: profile, error } = await admin
      .from("profiles")
      .select(
        "id, user_id, full_name, email, account_role, account_id, status, web_access, mobile_access, employee_role_id, employee_roles(id, name, permissions)",
      )
      .eq("id", userId)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { data: account } = await admin
      .from("accounts")
      .select("id, name, module_settings, settings, subscription_plan, deleted_at")
      .eq("id", profile.account_id)
      .single();

    const role = Array.isArray(profile.employee_roles)
      ? profile.employee_roles[0]
      : profile.employee_roles;

    await recordAdminAccess(admin, ctx, {
      action: "view_as_user",
      table: "profiles",
      targetAccountId: profile.account_id,
      filters: {
        target_profile_id: profile.id,
        target_email: profile.email,
        // No session was created; recorded so the trail distinguishes this
        // from a hypothetical future impersonation event.
        mode: "view_as_readonly",
      },
      rowCount: 1,
    });

    return NextResponse.json({
      target: {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        account_role: profile.account_role,
        status: profile.status,
        web_access: profile.web_access,
        mobile_access: profile.mobile_access,
        employee_role_name: role?.name ?? null,
        permissions: (role?.permissions as Record<string, unknown>) ?? {},
      },
      account: {
        id: account?.id ?? profile.account_id,
        name: account?.name ?? "Unknown",
        subscription_plan: account?.subscription_plan ?? null,
        module_settings: account?.module_settings ?? {},
        // The sidebar branches on this for territory-based navigation.
        assignment_mode:
          (account?.settings as Record<string, unknown> | null)?.assignment_mode ??
          "direct",
        deleted: account?.deleted_at !== null && account?.deleted_at !== undefined,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
