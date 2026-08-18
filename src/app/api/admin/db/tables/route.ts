import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { groupFor, sortTables } from "@/lib/admin/table-registry";

export interface AdminTableInfo {
  name: string;
  group: "primary" | "system" | "other";
  rowEstimate: number;
  hasAccountId: boolean;
}

/**
 * Every table in `public`, tagged with the group that decides where it shows up
 * in the browser's nav. Nothing is filtered out — grouping is presentation only.
 *
 * `rowEstimate` comes from pg_class.reltuples, which is a planner estimate, not
 * a count. That is deliberate: an exact count(*) across 116 tables on every nav
 * load would be slow and pointless. Exact counts are computed per table when
 * one is actually opened.
 */
export async function GET() {
  try {
    await requireSuperadmin();
    const admin = serviceClient();

    const { data, error } = await admin.rpc("admin_list_tables");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rows = (data ?? []) as {
      table_name: string;
      row_estimate: number;
      has_account_id: boolean;
    }[];

    const byName = new Map(rows.map((r) => [r.table_name, r]));

    const tables: AdminTableInfo[] = sortTables(rows.map((r) => r.table_name)).map(
      (name) => ({
        name,
        group: groupFor(name),
        rowEstimate: Number(byName.get(name)?.row_estimate ?? 0),
        hasAccountId: byName.get(name)?.has_account_id ?? false,
      }),
    );

    // Listing table names is not itself a tenant data read, so it is not
    // audited — opening a table is, in the rows route.
    return NextResponse.json({ tables });
  } catch (err) {
    return toErrorResponse(err);
  }
}
