import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";

/**
 * Cross-tenant company list for the superadmin panel.
 *
 * One account == one Customer ID. Team members (salesmen, agents) are profiles
 * under that account, never separate accounts, so they are surfaced here as a
 * user count and shown in full on the company detail screen — not as their own
 * rows.
 *
 * Goes through the service-role key (after the superadmin guard) so counts and
 * owner info are correct regardless of RLS, and soft-deleted accounts are
 * excluded.
 */
export async function GET() {
  try {
    await requireSuperadmin();
    const admin = serviceClient();

    const { data, error } = await admin
      .from("accounts")
      .select(
        "id, customer_id, name, industry, subscription_status, subscription_plan, created_at, profiles(full_name, email, account_role)",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const companies = (data ?? []).map((c: any) => {
      const members = Array.isArray(c.profiles) ? c.profiles : [];
      const owner =
        members.find((m: any) => m.account_role === "owner") ?? members[0] ?? null;
      return {
        id: c.id,
        customer_id: c.customer_id,
        name: c.name,
        industry: c.industry,
        subscription_status: c.subscription_status,
        subscription_plan: c.subscription_plan,
        created_at: c.created_at,
        owner_name: owner?.full_name ?? null,
        owner_email: owner?.email ?? null,
        user_count: members.length,
      };
    });

    return NextResponse.json({ companies });
  } catch (err) {
    return toErrorResponse(err);
  }
}
