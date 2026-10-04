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
import { clusterPings, type Ping } from "./dwell";
import { assertDataSetAllowed } from "./gating";
import { clampLimit, wasTruncated } from "./limits";
import {
  toAccountLocalIso,
  localRangeToUtc,
  resolveCustomRange,
  resolveDaysBack,
  resolveMonth,
  resolvePeriod,
  type ResolvedPeriod,
} from "./periods";
import type { McpContext } from "./session";
import type { DataSetDescriptor } from "./types";

export interface FetchArgs {
  dataset: string;
  period?: string;
  /** Exactly this many days ending today, in the account's timezone. */
  days_back?: number;
  /** An explicit account-local range. Both or neither. */
  start_date?: string;
  end_date?: string;
  /** A whole calendar month, "YYYY-MM". */
  month?: string;
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

/**
 * Put a filter value into the shape the report engine expects.
 *
 * Most filters take a bare value, but a `customer` filter wants
 * `{ contact_id: <id> }`. The engine does not complain about the wrong
 * shape — it simply matches nothing and returns 0, which is indistinguishable
 * from a genuine "no visits" and therefore far more dangerous than an error.
 */
function wrapFilterValue(
  s: DataSetDescriptor,
  key: string,
  value: unknown,
): unknown {
  const def = s.filters.find((f) => f.key === key);
  if (!def?.wrapIn) return value;
  // Already nested (an AI that copied the dashboard's shape): leave it be
  // rather than double-wrapping it into oblivion.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return { [def.wrapIn]: value };
}

/**
 * The window to apply, in the account's timezone.
 *
 * Three ways to ask, in order of precedence, so a caller that sends more than
 * one gets the most specific rather than a silent pick:
 *   start_date + end_date  an explicit range
 *   days_back              exactly N days ending today
 *   period                 a named preset
 */
function periodFor(
  s: DataSetDescriptor,
  args: FetchArgs,
  timezone: string,
): ResolvedPeriod | undefined {
  const hasStart = Boolean(args.start_date);
  const hasEnd = Boolean(args.end_date);
  if (hasStart !== hasEnd) {
    fail(
      "start_date and end_date must be given together. For an open-ended window use days_back or a named period.",
    );
  }
  if (hasStart && hasEnd) {
    return resolveCustomRange(args.start_date!, args.end_date!, timezone);
  }
  if (args.month) {
    return resolveMonth(args.month, timezone);
  }
  if (args.days_back !== undefined) {
    return resolveDaysBack(args.days_back, timezone);
  }
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
    !args.period &&
    args.days_back === undefined &&
    !args.month &&
    !args.start_date &&
    Object.keys(args.filters ?? {}).length === 0;
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
    if (SYNTHETIC_FILTERS.has(k)) continue;
    filters[k] = wrapFilterValue(s, k, v);
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
    as_of: toAccountLocalIso(new Date().toISOString(), ctx.timezone),
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
  gte: (col: string, val: unknown) => QueryBuilder;
  lt: (col: string, val: unknown) => QueryBuilder;
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
  period?: ResolvedPeriod,
): QueryBuilder {
  // Belt and braces: RLS already scopes this to the admin's account, and the
  // explicit filter means a future RLS mistake is not a cross-tenant leak.
  let q = query.eq("account_id", accountId);

  // The window, as real instants. A reader data set that declares no date
  // column has nothing to filter on, and the caller is told so rather than
  // being handed the whole history as if it were the period asked for.
  if (period && s.dateColumn) {
    const { from, to } = localRangeToUtc(period);
    q = q.gte(s.dateColumn, from).lt(s.dateColumn, to);
  }

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

  // Never `*`: the allow-list is the security boundary. A transformed data
  // set reads its source columns, because its `fields` are the shape of the
  // ANSWER rather than anything stored.
  const columns = s.transform
    ? (s.sourceFields ?? s.fields.map((f) => f.key))
    : wantsSummary
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
      period,
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
        as_of: toAccountLocalIso(new Date().toISOString(), ctx.timezone),
        note:
          `There are ${count} matching records — too many to total accurately in one read. ` +
          `Narrow it with a filter and ask again. (OZZO will not report a partial total as if it were complete.)`,
      };
    }
  }

  if (period && !s.dateColumn) {
    fail(
      `"${s.name}" has no date to filter on, so a time period cannot be applied to it. Ask without a period, or use a data set that records time.`,
    );
  }

  let query = applyFilters(
    supabase.from(s.table!).select(columns.join(",")),
    s,
    args,
    ctx.accountId,
    period,
  );

  // A measure is computed in this process, never stored, so it must not reach
  // the database as a sort column — that is a guaranteed "column does not
  // exist". In a grouped question it is applied after grouping instead; in a
  // record listing it is meaningless, and saying so beats silently ignoring it.
  const sortsByMeasure = Boolean(
    args.sort && s.measures.some((m) => m.key === args.sort),
  );
  if (sortsByMeasure && !wantsSummary) {
    fail(
      `"${args.sort}" is a total, so it can only sort a grouped question. Add group_by to total by something, or sort by one of the data set's own columns.`,
    );
  }

  // A transform must see the trail in time order and, when the ceiling bites,
  // must keep the most recent readings rather than an arbitrary thousand.
  const sortColumn = s.transform
    ? s.dateColumn
    : sortsByMeasure
      ? columns[0]
      : (args.sort ?? (wantsSummary ? columns[0] : defaultSort(s)));
  if (sortColumn) query = query.order(sortColumn, { ascending: !args.sort });

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) {
    // Returning [] here is how an AI confidently says "you have none" when
    // the query simply broke.
    fail(`"${s.name}" could not be read: ${error.message}`);
  }

  let rows = data ?? [];

  if (s.transform === "dwell") {
    const trail = buildTrail(rows, args, period, ctx.timezone);
    return {
      dataset: s.name,
      mode: "detail",
      rows: localiseTimes(trail.rows, s, ctx.timezone),
      row_count: trail.rows.length,
      truncated: wasTruncated((data ?? []).length, limit),
      period_resolved: period,
      as_of: toAccountLocalIso(new Date().toISOString(), ctx.timezone),
      note: trail.note,
    };
  }

  if (wantsSummary) {
    const measure = args.measures?.[0] ?? s.measures[0]?.key ?? "count";
    const grouped = groupRows(rows, args.group_by as string[], measure);
    // Sorting by a total has to happen HERE: it is computed in this process,
    // so asking Postgres to order by it is asking for a column that does not
    // exist. Descending, because "sort by the total" always means largest
    // first in practice.
    if (args.sort && s.measures.some((m) => m.key === args.sort)) {
      grouped.sort((a, b) => Number(b[args.sort!] ?? 0) - Number(a[args.sort!] ?? 0));
    }
    return {
      dataset: s.name,
      mode: "summary",
      // The rows RETURNED, not the rows read. Reporting 146 here when five
      // cities came back would have the AI announce 146 cities.
      rows: grouped,
      row_count: grouped.length,
      truncated: false,
      period_resolved: period,
      as_of: toAccountLocalIso(new Date().toISOString(), ctx.timezone),
    };
  }

  return {
    dataset: s.name,
    mode: "detail",
    rows: localiseTimes(rows, s, ctx.timezone),
    row_count: rows.length,
    truncated: wasTruncated(rows.length, limit),
    period_resolved: period,
    as_of: toAccountLocalIso(new Date().toISOString(), ctx.timezone),
  };
}

/**
 * Render every timestamp in the account's timezone before it leaves OZZO.
 *
 * Handing the AI raw UTC made it do the conversion itself — it said so, and a
 * 19:13 UTC ping is 00:43 the NEXT day in India, so one slip turns an evening
 * visit into a midnight one. Dates (no time) are left alone: they are already
 * calendar dates and shifting them would be the bug, not the fix.
 */
function localiseTimes(
  rows: Record<string, unknown>[],
  s: DataSetDescriptor,
  timezone: string,
): Record<string, unknown>[] {
  const stamps = new Set(
    s.fields.filter((f) => f.type === "datetime").map((f) => f.key),
  );
  if (stamps.size === 0) return rows;
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const key of stamps) {
      const v = out[key];
      if (typeof v === "string" && v) out[key] = toAccountLocalIso(v, timezone);
    }
    return out;
  });
}

/** Newest first where the table records a time. */
function defaultSort(s: DataSetDescriptor): string | undefined {
  if (s.dateColumn && s.fields.some((f) => f.key === s.dateColumn)) {
    return s.dateColumn;
  }
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


// ── GPS trail ───────────────────────────────────────────────

interface PingRow {
  employee_name?: string | null;
  recorded_at?: string;
  lat?: number;
  lng?: number;
  is_mocked?: boolean;
}

/**
 * Turn raw pings into per-employee stops.
 *
 * Clustered per employee, because two reps in the same street at the same
 * time are two trails, and merging them would invent a stop neither made.
 */
function buildTrail(
  rows: Record<string, unknown>[],
  args: FetchArgs,
  period: ResolvedPeriod | undefined,
  timezone: string,
): { rows: Record<string, unknown>[]; note?: string } {
  const window = args.time_of_day ?? readTimeOfDay(args.filters?.time_of_day);
  const byEmployee = new Map<string, Ping[]>();

  for (const raw of rows as PingRow[]) {
    if (!raw.recorded_at) continue;
    if (window && !withinLocalWindow(raw.recorded_at, window, timezone)) continue;
    const who = raw.employee_name ?? "Unknown";
    const list = byEmployee.get(who) ?? [];
    list.push({
      lat: Number(raw.lat),
      lng: Number(raw.lng),
      recorded_at: raw.recorded_at,
      is_mocked: Boolean(raw.is_mocked),
    });
    byEmployee.set(who, list);
  }

  const out: Record<string, unknown>[] = [];
  for (const [employee, pings] of byEmployee) {
    const trail = clusterPings(pings);
    for (const stop of trail.stops) {
      out.push({
        employee_name: employee,
        from: stop.from,
        to: stop.to,
        minutes: stop.minutes,
        lat: stop.lat,
        lng: stop.lng,
        ping_count: stop.ping_count,
      });
    }
    if (trail.mocked_count > 0) {
      out.push({
        employee_name: employee,
        from: null,
        to: null,
        minutes: null,
        lat: null,
        lng: null,
        ping_count: trail.mocked_count,
        note: `${trail.mocked_count} reading(s) reported a faked location and were excluded from the stops above.`,
      });
    }
  }

  out.sort((a, b) => String(a.from ?? "").localeCompare(String(b.from ?? "")));

  return {
    rows: out,
    note:
      "These are stops worked out from GPS readings, not the readings themselves. " +
      "Tracking only runs while an employee is punched in, so a gap means they were not punched in, not that they stopped moving.",
  };
}

interface TimeWindow {
  from: string;
  to: string;
}

function readTimeOfDay(value: unknown): TimeWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as { from?: unknown; to?: unknown };
  if (typeof v.from !== "string" || typeof v.to !== "string") return undefined;
  if (!/^\d{2}:\d{2}$/.test(v.from) || !/^\d{2}:\d{2}$/.test(v.to)) {
    fail('time_of_day must look like { from: "11:00", to: "17:00" }.');
  }
  return { from: v.from, to: v.to };
}

/** Is this instant inside the local HH:mm window? */
function withinLocalWindow(
  iso: string,
  window: TimeWindow,
  timezone: string,
): boolean {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  // Intl renders midnight as 24:00 in some locales.
  const hhmm = local === "24:00" ? "00:00" : local;
  return hhmm >= window.from && hhmm <= window.to;
}
