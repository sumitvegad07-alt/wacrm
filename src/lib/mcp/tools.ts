// ============================================================
// The three tools.
//
// Three, not thirty: AI tools are built to explore a catalog, and a long
// list of named tools is more code to maintain and measurably worse at
// being picked correctly. The AI learns what exists (list_data), then what
// a data set means (describe_data), then asks (fetch_data).
//
// The descriptions below are part of the product. They are what stop the AI
// inventing its own definition of a productive visit, or sending raw dates.
// ============================================================
import { fetchData, type FetchArgs } from "./fetch";
import { assertDataSetAllowed, visibleDataSets } from "./gating";
import { MCP_PERIODS, todayInZone } from "./periods";
import type { McpContext } from "./session";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: ToolDefinition[] = [
  {
    name: "list_data",
    description:
      "List the OZZO business data available to this account, with the account's " +
      "name, its timezone, and today's date in that timezone. Call this FIRST, " +
      "before any other OZZO tool, so you know what exists and how to date your " +
      "answer. The list reflects this account's plan and settings, so anything " +
      "not listed is genuinely unavailable rather than hidden.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "describe_data",
    description:
      "Explain one OZZO data set: its fields, filters, group-by dimensions, " +
      "measures, the periods it accepts, how the business actually defines its " +
      "terms, and worked example calls. Call this before fetch_data on a data " +
      "set you have not used yet — the notes define terms that differ from " +
      "their everyday meaning, and guessing produces confidently wrong answers.",
    inputSchema: {
      type: "object",
      properties: {
        dataset: {
          type: "string",
          description: 'The data set name from list_data, e.g. "visits".',
        },
      },
      required: ["dataset"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_data",
    description:
      "Read OZZO business data. Call list_data first to see what exists, then " +
      "describe_data for the data set you want, then this.\n\n" +
      "Periods are named (today, yesterday, this_week, this_month, last_month, " +
      "this_quarter, current_year, last_90_days, last_180_days, last_365_days…). " +
      "NEVER send raw dates — OZZO resolves the period in the account's own " +
      "timezone, which is the only way the dates are correct.\n\n" +
      "Every timestamp comes back already in the account's own timezone, with " +
      "its offset (2026-10-03T00:43:55+05:30). Do NOT convert it; quote it as " +
      "given.\n\n" +
      "Two modes: pass group_by and/or measures for totals, or fields for " +
      "individual records. Results are capped; when `truncated` is true, more " +
      "rows existed than were returned, so say so rather than presenting the " +
      "total as complete.",
    inputSchema: {
      type: "object",
      properties: {
        dataset: { type: "string", description: "Data set name from list_data." },
        period: {
          type: "string",
          enum: [...MCP_PERIODS],
          description: "A named preset window.",
        },
        days_back: {
          type: "integer",
          minimum: 1,
          description:
            'Exactly this many days ending today, e.g. 9 for "the last 9 days". OZZO counts the days in the account timezone.',
        },
        start_date: {
          type: "string",
          description:
            "Start of an explicit range, YYYY-MM-DD, read in the account's timezone. Must be sent with end_date.",
        },
        end_date: {
          type: "string",
          description: "End of an explicit range, YYYY-MM-DD, inclusive.",
        },
        filters: {
          type: "object",
          description:
            "Filters this data set declares (see describe_data). Use the " +
            "`search` filter on customers/products/employees to turn a name " +
            "into an id first.",
          additionalProperties: true,
        },
        group_by: {
          type: "array",
          items: { type: "string" },
          description: "Dimensions to group by, for a summary.",
        },
        measures: {
          type: "array",
          items: { type: "string" },
          description: "Measures to total, for a summary.",
        },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Columns to return, for a record listing.",
        },
        time_of_day: {
          type: "object",
          description:
            'Local time-of-day window for the location trail, e.g. { "from": "11:00", "to": "17:00" }.',
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
        },
        sort: { type: "string", description: "Column or measure to sort by." },
        limit: {
          type: "integer",
          description: "Maximum rows (capped server-side at 1000).",
        },
        page: { type: "integer", description: "1-based page number." },
      },
      required: ["dataset"],
      additionalProperties: false,
    },
  },
];

/** One line per data set for the menu — enough to choose, not to act. */
function summaryOf(notes: string): string {
  const firstSentence = notes.split(/(?<=\.)\s/)[0] ?? notes;
  return firstSentence.length > 200 ? `${firstSentence.slice(0, 197)}…` : firstSentence;
}

export interface ListDataResult {
  account_name: string;
  timezone: string;
  today: string;
  data_sets: Array<{ name: string; title: string; summary: string }>;
  how_to_use: string;
}

function listData(ctx: McpContext): ListDataResult {
  return {
    account_name: ctx.accountName,
    timezone: ctx.timezone,
    today: todayInZone(ctx.timezone),
    data_sets: visibleDataSets(ctx.tenant).map((s) => ({
      name: s.name,
      title: s.title,
      summary: summaryOf(s.notes),
    })),
    how_to_use:
      "Call describe_data(dataset) before fetching one you have not used. " +
      "All dates are handled by OZZO through named periods — never send raw dates. " +
      "This account's timezone is " +
      ctx.timezone +
      ", and today there is " +
      todayInZone(ctx.timezone) +
      ".",
  };
}

function describeData(args: unknown, ctx: McpContext) {
  const dataset = (args as { dataset?: unknown })?.dataset;
  if (typeof dataset !== "string" || !dataset) {
    throw new Error("describe_data needs a dataset name. Call list_data for the list.");
  }
  // Gating runs here too: describing a data set reveals its shape, and the
  // menu is not the enforcement point.
  const s = assertDataSetAllowed(dataset, ctx.tenant);
  return {
    name: s.name,
    title: s.title,
    fields: s.fields,
    filters: s.filters,
    dimensions: s.dimensions,
    measures: s.measures,
    periods: [...MCP_PERIODS],
    notes: s.notes,
    examples: s.examples,
  };
}

export async function callTool(
  name: string,
  args: unknown,
  ctx: McpContext,
): Promise<unknown> {
  switch (name) {
    case "list_data":
      return listData(ctx);
    case "describe_data":
      return describeData(args, ctx);
    case "fetch_data":
      return fetchData((args ?? {}) as FetchArgs, ctx);
    default:
      throw new Error(
        `Unknown tool "${name}". OZZO offers list_data, describe_data and fetch_data.`,
      );
  }
}

/** The data set a call is about, for the audit log. */
export function dataSetOf(name: string, args: unknown): string | undefined {
  if (name === "list_data") return undefined;
  const d = (args as { dataset?: unknown })?.dataset;
  return typeof d === "string" ? d : undefined;
}
