import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";

/** Recovery window. Deliberately generous: B2B customers ask for last quarter's
 *  data well after they asked to be deleted. */
export const PURGE_WINDOW_DAYS = 90;

/**
 * Tenant lifecycle: soft delete, restore, and purge.
 *
 * There is no hard delete outside `purge`, and purge is gated on the window
 * having elapsed AND an exact name confirmation. All 80 foreign keys
 * referencing `accounts` are ON DELETE CASCADE, so purge destroys a tenant's
 * data across 80 tables with no undo — every other operation here is
 * reversible, and that asymmetry is the point.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const { id } = await params;
    const { action } = await req.json();

    if (action !== "delete" && action !== "restore") {
      return NextResponse.json(
        { error: "action must be 'delete' or 'restore'" },
        { status: 400 },
      );
    }

    const { data: account } = await admin
      .from("accounts")
      .select("id, name, deleted_at")
      .eq("id", id)
      .single();

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    if (action === "delete") {
      if (account.deleted_at) {
        return NextResponse.json({ error: "Already deleted" }, { status: 400 });
      }
      const now = new Date();
      const purgeAfter = new Date(
        now.getTime() + PURGE_WINDOW_DAYS * 86_400_000,
      );

      const { error } = await admin
        .from("accounts")
        .update({
          deleted_at: now.toISOString(),
          deleted_by: ctx.userId,
          purge_after: purgeAfter.toISOString(),
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      await recordAdminAccess(admin, ctx, {
        action: "soft_delete_account",
        table: "accounts",
        targetAccountId: id,
        filters: { name: account.name, purge_after: purgeAfter.toISOString() },
        rowCount: 1,
      });

      return NextResponse.json({ ok: true, purge_after: purgeAfter.toISOString() });
    }

    // restore
    if (!account.deleted_at) {
      return NextResponse.json({ error: "Account is not deleted" }, { status: 400 });
    }

    const { error } = await admin
      .from("accounts")
      .update({ deleted_at: null, deleted_by: null, purge_after: null })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAccess(admin, ctx, {
      action: "restore_account",
      table: "accounts",
      targetAccountId: id,
      filters: { name: account.name },
      rowCount: 1,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Permanent purge. The only irreversible operation in the panel.
 *
 * Three independent gates, because a mistake here is unrecoverable:
 *   1. the tenant must already be soft-deleted
 *   2. the purge window must have elapsed
 *   3. the caller must retype the tenant's exact name
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const { id } = await params;
    const confirmName = req.nextUrl.searchParams.get("confirm");

    const { data: account } = await admin
      .from("accounts")
      .select("id, name, deleted_at, purge_after")
      .eq("id", id)
      .single();

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    if (!account.deleted_at) {
      return NextResponse.json(
        { error: "Soft-delete the tenant first" },
        { status: 400 },
      );
    }
    if (account.purge_after && new Date(account.purge_after) > new Date()) {
      return NextResponse.json(
        {
          error: `Cannot purge until ${new Date(account.purge_after).toDateString()}`,
        },
        { status: 400 },
      );
    }
    if (confirmName !== account.name) {
      return NextResponse.json(
        { error: "Confirmation name does not match" },
        { status: 400 },
      );
    }

    // Audit BEFORE the delete: the cascade removes the tenant, and an entry
    // written afterwards would reference a row that no longer exists.
    await recordAdminAccess(admin, ctx, {
      action: "purge_account",
      table: "accounts",
      targetAccountId: id,
      filters: { name: account.name, deleted_at: account.deleted_at },
      rowCount: 1,
    });

    const { error } = await admin.from("accounts").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
