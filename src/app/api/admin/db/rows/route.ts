import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";
import { isRedacted } from "@/lib/admin/table-registry";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** Filter operators the browser exposes, mapped to PostgREST methods. */
const OPERATORS = {
  eq: "eq",
  neq: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  like: "ilike",
  is: "is",
} as const;

type Operator = keyof typeof OPERATORS;

interface Filter {
  column: string;
  op: Operator;
  value: string;
}

function parseFilters(raw: string | null): Filter[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((f): Filter[] => {
    if (!f || typeof f !== "object") return [];
    const { column, op, value } = f as Record<string, unknown>;
    if (typeof column !== "string" || typeof value !== "string") return [];
    if (typeof op !== "string" || !(op in OPERATORS)) return [];
    return [{ column, op: op as Operator, value }];
  });
}

/**
 * Read rows from any table in `public`.
 *
 * Read-only by design — there is no POST/PATCH/DELETE here. The panel exists so
 * nobody has to open Supabase to look something up; editing stays in the real
 * modules, where the business rules live.
 *
 * Every call is audited before the response is returned.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const params = req.nextUrl.searchParams;

    const table = params.get("table");
    if (!table) {
      return NextResponse.json({ error: "Missing `table`" }, { status: 400 });
    }

    // Validate against the live table list rather than trusting the parameter.
    // The service-role client would happily read anything, including internal
    // schemas, so the allowlist is what keeps this to public tables.
    const { data: tableRows, error: tableErr } = await admin.rpc("admin_list_tables");
    if (tableErr) {
      return NextResponse.json({ error: tableErr.message }, { status: 400 });
    }
    const known = new Set(
      ((tableRows ?? []) as { table_name: string }[]).map((r) => r.table_name),
    );
    if (!known.has(table)) {
      return NextResponse.json({ error: `Unknown table: ${table}` }, { status: 404 });
    }

    // Column list, so redacted columns are dropped from the select rather than
    // fetched and stripped afterwards — they never leave Postgres.
    const { data: colRows, error: colErr } = await admin.rpc("admin_table_columns", {
      p_table: table,
    });
    if (colErr) return NextResponse.json({ error: colErr.message }, { status: 400 });

    const allColumns = ((colRows ?? []) as { column_name: string; data_type: string }[]);
    const visibleColumns = allColumns.filter((c) => !isRedacted(c.column_name));
    const redactedColumns = allColumns
      .filter((c) => isRedacted(c.column_name))
      .map((c) => c.column_name);

    if (visibleColumns.length === 0) {
      return NextResponse.json({ error: "No readable columns" }, { status: 400 });
    }

    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(params.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
    );
    const from = (page - 1) * pageSize;

    const columnNames = new Set(allColumns.map((c) => c.column_name));
    const filters = parseFilters(params.get("filters")).filter(
      (f) => columnNames.has(f.column) && !isRedacted(f.column),
    );

    const accountId = params.get("accountId");
    const scopedToTenant =
      accountId && columnNames.has("account_id") ? accountId : null;

    let query = admin
      .from(table)
      .select(visibleColumns.map((c) => c.column_name).join(","), { count: "exact" });

    // An explicit switch rather than `query[OPERATORS[f.op]](...)`: the builder
    // methods form a union whose signatures are not mutually callable, so the
    // dynamic form does not typecheck.
    for (const f of filters) {
      switch (f.op) {
        case "eq":
          query = query.eq(f.column, f.value);
          break;
        case "neq":
          query = query.neq(f.column, f.value);
          break;
        case "gt":
          query = query.gt(f.column, f.value);
          break;
        case "gte":
          query = query.gte(f.column, f.value);
          break;
        case "lt":
          query = query.lt(f.column, f.value);
          break;
        case "lte":
          query = query.lte(f.column, f.value);
          break;
        case "like":
          query = query.ilike(f.column, `%${f.value}%`);
          break;
        case "is": {
          // `is` only takes null / true / false, not arbitrary text.
          const v = f.value.toLowerCase();
          if (v !== "null" && v !== "true" && v !== "false") break;
          query = query.is(f.column, v === "null" ? null : v === "true");
          break;
        }
      }
    }

    if (scopedToTenant) query = query.eq("account_id", scopedToTenant);

    const sort = params.get("sort");
    if (sort && columnNames.has(sort) && !isRedacted(sort)) {
      query = query.order(sort, { ascending: params.get("dir") !== "desc" });
    } else if (columnNames.has("created_at")) {
      query = query.order("created_at", { ascending: false });
    }

    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAccess(admin, ctx, {
      action: "browse_table",
      table,
      targetAccountId: scopedToTenant,
      filters: {
        filters: filters.map((f) => ({ column: f.column, op: f.op, value: f.value })),
        sort,
        dir: params.get("dir"),
        page,
        pageSize,
      },
      rowCount: data?.length ?? 0,
    });

    return NextResponse.json({
      rows: data ?? [],
      columns: visibleColumns.map((c) => ({
        name: c.column_name,
        type: c.data_type,
      })),
      redactedColumns,
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
