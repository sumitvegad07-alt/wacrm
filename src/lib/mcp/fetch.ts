// ============================================================
// The one place a question becomes a query.
//
// Route A hands the request to the existing report engine, so the connector
// and the dashboard compute identical numbers from identical code. Route B
// builds a query strictly from the descriptor — the AI never writes a query,
// it picks from a list, and anything not on the list is refused before the
// database is touched.
//
// Two rules here matter more than the plumbing:
//
//  * Nothing is ever selected with `*`. The columns come from the
//    descriptor's allow-list, so the next sensitive column someone adds to
//    `contacts` is invisible to the AI by default rather than by vigilance.
//  * A number is either right or refused. Where an exact answer cannot be
//    computed (a grouped total over more rows than we will read), this
//    returns no rows and says why, because a confidently wrong total is the
//    worst thing this feature could produce.
// ============================================================
import { runReport } from "@/lib/dashboard/report-rpc";
import { assertDataSetAllowed } from "./gating";
import { clampLimit, wasTruncated } from "./limits";
import { resolvePeriod, type ResolvedPeriod } from "./periods";
import type { McpContext } from "./session";
import type { DataSetDescriptor } from "./types";

export interface FetchArgs {
  dataset: string;
  period?: string;
  time_of_day?: { from: string; to: string };
  filters?: Record<string, unknown>;
  group_by?: string[];
  measures?: string[];
  fields?: string[];
  sort?: string;
  limit?: number;
  page?: number;
}

export interface FetchResult {
  dataset: string;
  mode: "summary" | "detail";
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  period_resolved?: ResolvedPeriod;
  as_of: string;
  note?: string;
}

/** Filters the server interprets rather than passing to Postgres as a column. */
const SYNTHETIC_FILTERS = new Set(["period", "search", "time_of_day"]);

function fail(message: string): never {
  throw new Error(message);
}

function assertKnown(
  values: string[] | undefined,
  allowed: Set<string>,
  dataset: string,
  what: string,
  verb: string,
): void {
  for (const v of values ?? []) {
    if (!allowed.has(v)) {
      fail(
        `"${v}" ${verb} "${dataset}". Call describe_data for what is available.`,
      );
    }
  }
}

/** Everything the AI is allowed to name on this data set. */
function vocabulary(s: DataSetDescriptor) {
  return {
    fields: new Set(s.fields.map((f) => f.key)),
    dimensions: new Set(s.dimensions.map((d) => d.key)),
    measures: new Set(s.measures.map((m) => m.key)),
    filters: new Set(s.filters.map((f) => f.key)),
  };
}

function validate(s: DataSetDescriptor, args: FetchArgs) {
  const v = vocabulary(s);

  assertKnown(args.fields, v.fields, s.name, "field", "is not available on");
  assertKnown(args.group_by, v.dimensions, s.name, "dimension", "cannot group");
  assertKnown(args.measures, v.measures, s.name, "measure", "is not a measure on");

  for (const key of Object.keys(args.filters ?? {})) {
    if (!v.filters.has(key)) {
      fail(`"${key}" is not a filter on "${s.name}". Call describe_data for what is.`);
    }
  }

  if (args.sort) {
    const sortable = new Set([...v.fields, ...v.measures, ...v.dimensions]);
    if (!sortable.has(args.sort)) {
      fail(`"${args.sort}" cannot sort "${s.name}". Call describe_data for what is available.`);
    }
  }
}

/** The period to apply: what was asked for, or the report's own default. */
function periodFor(
  s: DataSetDescriptor,
  args: FetchArgs,
  timezone: string,
): ResolvedPeriod | undefined {
  if (args.period) return resolvePeriod(args.period, timezone);
  // A report data set without a period would scan the whole history, which is
  // neither what the admin meant nor affordable.
  if (s.route === "report") return resolvePeriod("this_month", timezone);
  return undefined;
}

export async function fetchData(
  args: FetchArgs,
  ctx: McpContext,
): Promise<FetchResult> {
  const descriptor = assertDataSetAllowed(args.dataset, ctx.tenant);
  validate(descriptor, args);

  const period = periodFor(descriptor, args, ctx.timezone);
  const limit = clampLimit(args.limit);
  const wantsSummary = Boolean(args.group_by?.length || args.measures?.length);

  // Summary before detail. A record listing with no period and no filter
  // against a reporting data set is a request for the whole history, which is
  // never what was meant — answer with the shape of it instead.
  const noNarrowing =
    !args.period && Object.keys(args.filters ?? {}).length === 0;
  if (!wantsSummary && descriptor.route === "report" && noNarrowing) {
    const dimension = descriptor.dimensions[0]?.key;
    const measure = descriptor.measures[0]?.key;
    if (dimension && measure) {
      const summary = await runReportRoute(
        descriptor,
        { ...args, group_by: [dimension], measures: [measure], fields: undefined },
        ctx,
        period,
        limit,
      );
      return {
        ...summary,
        note:
          "Too broad for a record listing — here is a summary instead. " +
          "Add a period or a filter to see individual rows.",
      };
    }
  }

  return descriptor.route === "report"
    ? runReportRoute(descriptor, args, ctx, period, limit)
    : runReaderRoute(descriptor, args, ctx, period, limit);
}

// ── Route A: the existing report engine ─────────────────────

async function runReportRoute(
  s: DataSetDescriptor,
  args: FetchArgs,
  ctx: McpContext,
  period: ResolvedPeriod | undefined,
  limit: number,
): Promise<FetchResult> {
  const filters: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.filters ?? {})) {
    if (!SYNTHETIC_FILTERS.has(k)) filters[k] = v;
  }
  if (period) {
    filters.date_range = { start_date: period.start_date, end_date: period.end_date };
  }

  const dimensions = args.group_by ?? [];
  const measures =
    args.measures ?? (args.fields ?? []).filter((f) =>
      s.measures.some((m) => m.key === f),
    );
  // A detail request names fields; those that are dimensions become the
  // grouping, which is how the report engine expresses "list these columns".
  const detailDimensions = (args.fields ?? []).filter((f) =>
    s.dimensions.some((d) => d.key === f),
  );

  const rows = await runReport(
    ctx.supabase,
    ctx.accountId,
    s.reportModule!,
    dimensions.length ? dimensions : detailDimensions,
    measures,
    filters,
    args.sort,
    limit,
  );

  return {
    dataset: s.name,
    mode: args.group_by?.length || args.measures?.length ? "summary" : "detail",
    rows: rows as Record<string, unknown>[],
    row_count: rows.length,
    truncated: wasTruncated(rows.length, limit),
    period_resolved: period,
    as_of: new Date().toISOString(),
  };
}

// ── Route B: the described reader ───────────────────────────

/**
 * Make a search term safe inside PostgREST's `or=(...)` grammar, where a
 * comma separates conditions and a parenthesis closes the group. Without
 * this, searching for "a,b)" would change the shape of the filter rather
 * than looking for that text.
 */
function escapeForOr(term: string): string {
  return term.replace(/[(),\\]/g, " ").replace(/\s+/g, " ").trim();
}

type QueryBuilder = {
  select: (cols: string, opts?: { count?: "exact"; head?: boolean }) => QueryBuilder;
  eq: (col: string, val: unknown) => QueryBuilder;
  or: (expr: string) => QueryBuilder;
  order: (col: string, opts?: { ascending?: boolean }) => QueryBuilder;
  range: (from: number, to: number) => Promise<{
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
    count: number | null;
  }>;
};

/** Apply the account filter and every validated filter to a query. */
function applyFilters(
  query: QueryBuilder,
  s: DataSetDescriptor,
  args: FetchArgs,
  accountId: string,
): QueryBuilder {
  // Belt and braces: RLS already scopes this to the admin's account, and the
  // explicit filter means a future RLS mistake is not a cross-tenant leak.
  let q = query.eq("account_id", accountId);

  for (const [key, value] of Object.entries(args.filters ?? {})) {
    if (key === "search") {
      const term = escapeForOr(String(value));
      const columns = s.searchFields ?? [];
      if (term && columns.length) {
        q = q.or(columns.map((c) => `${c}.ilike.*${term}*`).join(","));
      }
      continue;
    }
    if (SYNTHETIC_FILTERS.has(key)) continue;
    q = q.eq(key, value);
  }
  return q;
}

async function runReaderRoute(
  s: DataSetDescriptor,
  args: FetchArgs,
  ctx: McpContext,
  period: ResolvedPeriod | undefined,
  limit: number,
): Promise<FetchResult> {
  const supabase = ctx.supabase as unknown as {
    from: (table: string) => QueryBuilder;
  };
  const wantsSummary = Boolean(args.group_by?.length);

  // Never `*`: the allow-list is the security boundary.
  const columns = wantsSummary
    ? (args.group_by as string[])
    : (args.fields?.length ? args.fields : s.fields.map((f) => f.key));

  const page = Math.max(1, Math.floor(args.page ?? 1));
  const offset = (page - 1) * limit;

  if (wantsSummary) {
    // Grouping happens in this process, so it is only honest while the whole
    // filtered set fits in one read. Beyond that, refuse rather than return a
    // total that is quietly a fraction of the truth.
    const countQuery = applyFilters(
      supabase.from(s.table!).select(columns.join(","), { count: "exact", head: true }),
      s,
      args,
      ctx.accountId,
    ) as unknown as Promise<{ count: number | null; error: { message: string } | null }>;
    const { count, error: countError } = await countQuery;
    if (countError) {
      fail(`"${s.name}" could not be read: ${countError.message}`);
    }
    if ((count ?? 0) > limit) {
      return {
        dataset: s.name,
        mode: "summary",
        rows: [],
        row_count: 0,
        truncated: true,
        period_resolved: period,
        as_of: new Date().toISOString(),
        note:
          `There are ${count} matching records — too many to total accurately in one read. ` +
          `Narrow it with a filter and ask again. (OZZO will not report a partial total as if it were complete.)`,
      };
    }
  }

  let query = applyFilters(
    supabase.from(s.table!).select(columns.join(",")),
    s,
    args,
    ctx.accountId,
  );

  const sortColumn = args.sort ?? (wantsSummary ? columns[0] : defaultSort(s));
  if (sortColumn) query = query.order(sortColumn, { ascending: !args.sort });

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) {
    // Returning [] here is how an AI confidently says "you have none" when
    // the query simply broke.
    fail(`"${s.name}" could not be read: ${error.message}`);
  }

  const rows = data ?? [];

  if (wantsSummary) {
    const measure = args.measures?.[0] ?? s.measures[0]?.key ?? "count";
    return {
      dataset: s.name,
      mode: "summary",
      rows: groupRows(rows, args.group_by as string[], measure),
      row_count: rows.length,
      truncated: false,
      period_resolved: period,
      as_of: new Date().toISOString(),
    };
  }

  return {
    dataset: s.name,
    mode: "detail",
    rows,
    row_count: rows.length,
    truncated: wasTruncated(rows.length, limit),
    period_resolved: period,
    as_of: new Date().toISOString(),
  };
}

/** Newest first where the table records a creation time. */
function defaultSort(s: DataSetDescriptor): string | undefined {
  return s.fields.some((f) => f.key === "created_at") ? "created_at" : undefined;
}

/** Count rows per distinct combination of the grouping columns. */
function groupRows(
  rows: Record<string, unknown>[],
  groupBy: string[],
  measure: string,
): Record<string, unknown>[] {
  const buckets = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = groupBy.map((g) => String(row[g] ?? "")).join("\u0000");
    const existing = buckets.get(key);
    if (existing) {
      existing[measure] = (existing[measure] as number) + 1;
      continue;
    }
    const base: Record<string, unknown> = {};
    for (const g of groupBy) base[g] = row[g] ?? null;
    base[measure] = 1;
    buckets.set(key, base);
  }
  return [...buckets.values()];
}
