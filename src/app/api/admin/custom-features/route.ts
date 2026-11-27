import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { CUSTOM_FEATURES } from "@/lib/plans/custom-features";
import { isUndefinedColumn } from "@/lib/auth/account-select";

/**
 * The per-client feature register: every custom feature, and which companies
 * hold it.
 *
 * Why a route rather than a browser read: the superadmin screens may not read
 * `accounts` from the browser at all — the `OR is_superadmin()` branch that
 * used to allow it also fired inside the ordinary tenant area and leaked other
 * tenants' rows (migration 20261017120000). So this reads with the service role,
 * behind requireSuperadmin.
 *
 * It also answers honestly when the migration has not been pasted into Supabase
 * yet: `columnMissing` is true, and the screen says so instead of showing an
 * empty register that looks like "nobody has anything".
 */
export async function GET() {
  try {
    await requireSuperadmin();
    const admin = serviceClient();

    const { data, error } = await admin
      .from("accounts")
      .select("id, customer_id, name, custom_features")
      .not("custom_features", "is", null)
      .order("customer_id", { ascending: true })
      .limit(2000);

    if (error) {
      if (isUndefinedColumn(error)) {
        return NextResponse.json({
          columnMissing: true,
          features: CUSTOM_FEATURES.map((f) => ({ ...f, accounts: [] })),
          grantedKeysNotInCatalog: [],
        });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    type Row = {
      id: string;
      customer_id: string | null;
      name: string | null;
      custom_features: string[] | null;
    };
    const rows = ((data ?? []) as Row[]).filter(
      (r) => Array.isArray(r.custom_features) && r.custom_features.length > 0,
    );

    const features = CUSTOM_FEATURES.map((f) => ({
      ...f,
      accounts: rows
        .filter((r) => r.custom_features!.includes(f.key))
        .map((r) => ({ id: r.id, customer_id: r.customer_id, name: r.name })),
    }));

    // A key sitting on an account that this build's catalogue does not know:
    // pasted by hand, or left behind by a key that was deleted from the code
    // instead of being marked retired. It grants nothing, so it is reported
    // here rather than silently ignored.
    const known = new Set(CUSTOM_FEATURES.map((f) => f.key));
    const strays = new Map<string, { id: string; customer_id: string | null; name: string | null }[]>();
    for (const r of rows) {
      for (const k of r.custom_features!) {
        if (known.has(k)) continue;
        const list = strays.get(k) ?? [];
        list.push({ id: r.id, customer_id: r.customer_id, name: r.name });
        strays.set(k, list);
      }
    }

    return NextResponse.json({
      columnMissing: false,
      features,
      grantedKeysNotInCatalog: Array.from(strays, ([key, accounts]) => ({ key, accounts })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
