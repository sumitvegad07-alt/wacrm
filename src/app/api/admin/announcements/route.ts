import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";

/**
 * Platform announcements. A row with account_id NULL is visible to every
 * tenant; a row with an account_id targets that tenant only.
 *
 * Reads here are limited to superadmin-authored rows so the panel does not
 * become a window onto tenants' internal announcements — that is what the Data
 * Browser is for, and it audits every read.
 */
export async function GET() {
  try {
    await requireSuperadmin();
    const admin = serviceClient();

    const { data, error } = await admin
      .from("tenant_announcements")
      .select("id, account_id, title, content, expiry_date, created_at")
      .is("account_id", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ announcements: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();

    const { title, content, expiry_date, account_id } = await req.json();

    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // account_id omitted or null means platform-wide. When one is supplied,
    // check it exists rather than writing a dangling reference.
    let target: string | null = null;
    if (account_id) {
      const { data: acct } = await admin
        .from("accounts")
        .select("id")
        .eq("id", account_id)
        .single();
      if (!acct) {
        return NextResponse.json({ error: "Unknown account" }, { status: 404 });
      }
      target = acct.id;
    }

    const { data, error } = await admin
      .from("tenant_announcements")
      .insert({
        account_id: target,
        title: title.trim(),
        content: content.trim(),
        expiry_date: expiry_date || null,
        // Empty targeting arrays mean "everyone in scope", matching how the
        // tenant-side view policy reads them.
        employee_ids: [],
        employee_role_ids: [],
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAccess(admin, ctx, {
      action: "publish_announcement",
      table: "tenant_announcements",
      targetAccountId: target,
      filters: { title: title.trim(), platformWide: target === null },
      rowCount: 1,
    });

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // Scoped to platform-wide rows: this route must not be able to delete a
    // tenant's own announcements.
    const { error } = await admin
      .from("tenant_announcements")
      .delete()
      .eq("id", id)
      .is("account_id", null);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAccess(admin, ctx, {
      action: "delete_announcement",
      table: "tenant_announcements",
      filters: { id },
      rowCount: 1,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
