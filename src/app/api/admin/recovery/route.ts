import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";

/**
 * Soft-deleted tenants awaiting restore or purge.
 *
 * Deleted tenants are invisible to their own members — is_account_member()
 * excludes them — so this route is the only way back to them, which is why it
 * reads through the service-role client.
 */
export async function GET() {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();

    const { data, error } = await admin
      .from("accounts")
      .select(
        "id, name, subscription_plan, deleted_at, deleted_by, purge_after, created_at",
      )
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rows = data ?? [];

    // Attach who deleted it and how much data is at stake, so the decision to
    // purge is made with the size of the loss visible.
    const enriched = await Promise.all(
      rows.map(async (a) => {
        const [{ count: users }, { count: orders }, { count: contacts }] =
          await Promise.all([
            admin
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("account_id", a.id),
            admin
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("account_id", a.id),
            admin
              .from("contacts")
              .select("id", { count: "exact", head: true })
              .eq("account_id", a.id),
          ]);

        let deletedByEmail: string | null = null;
        if (a.deleted_by) {
          const { data: actor } = await admin
            .from("profiles")
            .select("email")
            .eq("user_id", a.deleted_by)
            .maybeSingle();
          deletedByEmail = actor?.email ?? null;
        }

        return {
          ...a,
          deleted_by_email: deletedByEmail,
          users: users ?? 0,
          orders: orders ?? 0,
          contacts: contacts ?? 0,
          purgeable: a.purge_after ? new Date(a.purge_after) <= new Date() : false,
        };
      }),
    );

    await recordAdminAccess(admin, ctx, {
      action: "view_recovery_center",
      table: "accounts",
      targetAccountId: null,
      filters: { deleted: true },
      rowCount: enriched.length,
    });

    return NextResponse.json({ accounts: enriched });
  } catch (err) {
    return toErrorResponse(err);
  }
}
