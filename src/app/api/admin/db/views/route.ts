import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";

/**
 * Saved Data Browser views, personal to the superadmin who created them.
 *
 * Not audited: a saved view records an intent to look, not a look. The read it
 * produces is audited when it runs, through the rows route.
 */
export async function GET() {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();

    const { data, error } = await admin
      .from("admin_saved_views")
      .select("id, name, table_name, filters, sort, dir, account_id, created_at")
      .eq("owner_id", ctx.userId)
      .order("name");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ views: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const { name, table, filters, sort, dir, accountId } = await req.json();

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (typeof table !== "string" || !table) {
      return NextResponse.json({ error: "Table is required" }, { status: 400 });
    }

    // Upsert on (owner, name) so re-saving a view under the same name updates
    // it rather than failing on the unique constraint.
    const { error } = await admin.from("admin_saved_views").upsert(
      {
        owner_id: ctx.userId,
        name: name.trim(),
        table_name: table,
        filters: filters ?? [],
        sort: sort ?? null,
        dir: dir ?? null,
        account_id: accountId || null,
      },
      { onConflict: "owner_id,name" },
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
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

    // Scoped to the owner: one superadmin must not delete another's views.
    const { error } = await admin
      .from("admin_saved_views")
      .delete()
      .eq("id", id)
      .eq("owner_id", ctx.userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
