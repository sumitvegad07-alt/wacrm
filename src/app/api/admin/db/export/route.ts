import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";
import { isRedacted } from "@/lib/admin/table-registry";

const MAX_EXPORT_ROWS = 10_000;

/** Reasons an export may be performed. A free-text box would collect "test". */
export const EXPORT_REASONS = [
  "customer_support",
  "migration",
  "data_verification",
  "billing_audit",
] as const;

/**
 * Render a value for CSV.
 *
 * Also neutralises spreadsheet formula injection: a cell beginning =, +, - or @
 * is executed as a formula by Excel and Sheets when the file is opened, which
 * turns an exported customer name into code running on the analyst's machine.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Audited CSV export.
 *
 * An export is the highest-risk read in the product: unlike a browse, the data
 * leaves the system entirely and cannot be recalled. So it demands a reason
 * from a fixed list, caps the row count, and is recorded before a single byte
 * is returned — an export that fails midway is still an export that was
 * attempted.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();

    const { table, filters, sort, dir, accountId, reason, note } = await req.json();

    if (!table || typeof table !== "string") {
      return NextResponse.json({ error: "Missing table" }, { status: 400 });
    }
    if (!EXPORT_REASONS.includes(reason)) {
      return NextResponse.json(
        { error: `reason must be one of: ${EXPORT_REASONS.join(", ")}` },
        { status: 400 },
      );
    }

    const { data: tableRows } = await admin.rpc("admin_list_tables");
    const known = new Set(
      ((tableRows ?? []) as { table_name: string }[]).map((r) => r.table_name),
    );
    if (!known.has(table)) {
      return NextResponse.json({ error: `Unknown table: ${table}` }, { status: 404 });
    }

    const { data: colRows } = await admin.rpc("admin_table_columns", {
      p_table: table,
    });
    const columns = ((colRows ?? []) as { column_name: string }[])
      .map((c) => c.column_name)
      .filter((c) => !isRedacted(c));

    if (columns.length === 0) {
      return NextResponse.json({ error: "No exportable columns" }, { status: 400 });
    }

    // Typed loosely on purpose: chaining PostgREST filters in a loop makes the
    // builder's generics recurse until tsc gives up with "type instantiation is
    // excessively deep". The runtime behaviour is unchanged.
    let query: any = admin.from(table).select(columns.join(","));

    if (Array.isArray(filters)) {
      for (const f of filters) {
        if (!f || typeof f.column !== "string" || isRedacted(f.column)) continue;
        if (!columns.includes(f.column)) continue;
        const v = String(f.value ?? "");
        switch (f.op) {
          case "eq": query = query.eq(f.column, v); break;
          case "neq": query = query.neq(f.column, v); break;
          case "gt": query = query.gt(f.column, v); break;
          case "gte": query = query.gte(f.column, v); break;
          case "lt": query = query.lt(f.column, v); break;
          case "lte": query = query.lte(f.column, v); break;
          case "like": query = query.ilike(f.column, `%${v}%`); break;
        }
      }
    }

    if (accountId && columns.includes("account_id")) {
      query = query.eq("account_id", accountId);
    }
    if (sort && columns.includes(sort)) {
      query = query.order(sort, { ascending: dir !== "desc" });
    }

    const { data, error } = await query.limit(MAX_EXPORT_ROWS);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const rows = (data ?? []) as Record<string, unknown>[];

    // Audited before the file is built, so an export that fails on the way out
    // still leaves a trace that it was attempted.
    await recordAdminAccess(admin, ctx, {
      action: "csv_export",
      table,
      targetAccountId: accountId ?? null,
      filters: {
        reason,
        note: typeof note === "string" ? note.slice(0, 500) : null,
        filters: filters ?? [],
        sort,
        dir,
        truncated: rows.length >= MAX_EXPORT_ROWS,
      },
      rowCount: rows.length,
    });

    const header = columns.map(csvCell).join(",");
    const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")).join("\n");
    const csv = `${header}\n${body}`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
