import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";
import {
  BillingValidationError,
  validateBillingChange,
  type AccountBillingState,
} from "@/lib/admin/billing";

/**
 * Billing and module changes for one tenant.
 *
 * Replaces hand-editing `accounts` in Supabase for plan changes, seat
 * adjustments, trial extensions and module toggles. Validation lives in
 * lib/admin/billing.ts; this route owns auth, persistence and audit.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const { id } = await params;

    const { data: current, error: readErr } = await admin
      .from("accounts")
      .select(
        "id, name, subscription_plan, subscription_status, subscription_expires_at, user_count, module_settings",
      )
      .eq("id", id)
      .single();

    if (readErr || !current) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Real profile count, so a seat reduction cannot strand existing users.
    const { count: activeUsers } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id);

    const body = await req.json();

    let patch;
    try {
      patch = validateBillingChange(
        current as AccountBillingState,
        body,
        activeUsers ?? 0,
      );
    } catch (e) {
      if (e instanceof BillingValidationError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, changed: {} });
    }

    const { error: writeErr } = await admin
      .from("accounts")
      .update(patch)
      .eq("id", id);

    if (writeErr) {
      return NextResponse.json({ error: writeErr.message }, { status: 400 });
    }

    // Record before and after for each changed field: "plan changed" is much
    // less useful six months later than "Basic -> Enterprise".
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      before[key] = (current as Record<string, unknown>)[key];
    }

    await recordAdminAccess(admin, ctx, {
      action: "update_account_billing",
      table: "accounts",
      targetAccountId: id,
      filters: { before, after: patch },
      rowCount: 1,
    });

    return NextResponse.json({ ok: true, changed: patch });
  } catch (err) {
    return toErrorResponse(err);
  }
}
