import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, requireFounder, serviceClient } from "@/lib/auth/superadmin";

/**
 * Cross-tenant user list for the superadmin panel.
 *
 * Every superadmin screen that needs other tenants' profiles comes through
 * here, because the browser cannot read them any more: `profiles_select` is
 * account-scoped again (see migration 20261016120000). It used to carry an
 * `OR is_superadmin()` branch, which also fired inside the ordinary tenant
 * admin area and showed the founder every tenant's staff — in the Employees
 * list and in every owner / assignee picker.
 *
 * Query params:
 *   - `accountId` — only that company's profiles, for the company detail screen.
 *   - `count=1`   — return just `{ count }`, for the dashboard tile.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperadmin();
    const admin = serviceClient();

    const accountId = req.nextUrl.searchParams.get("accountId");
    const countOnly = req.nextUrl.searchParams.get("count") === "1";

    if (countOnly) {
      let countQuery = admin
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (accountId) countQuery = countQuery.eq("account_id", accountId);

      const { count, error } = await countQuery;
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ count: count ?? 0 });
    }

    let query = admin
      .from("profiles")
      .select(
        "id, full_name, email, account_role, is_superadmin, account_id, accounts(name)",
      );

    if (accountId) query = query.eq("account_id", accountId);

    const { data, error } = await query.order("email");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ users: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Grant or revoke platform superadmin. The `is_superadmin` column is no longer
 * writable by `authenticated` (see migration 20260818200000), so this is the
 * only path that can change it — and now only the platform founder may call it.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireFounder();
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
