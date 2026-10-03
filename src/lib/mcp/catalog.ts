// ============================================================
// The data sets the AI may read.
//
// Route A is DERIVED from the existing report configs, so a report added
// later is exposed to the AI with no code change here. Route B is
// hand-written because those modules have no report.
//
// This file is the single source of truth for gating: tools, prompts and
// the Allow screen all read `line`, `requiredModule` and `sensitive` from
// these descriptors, so they cannot drift apart.
// ============================================================
import { getReportByModule } from "@/lib/reports/registry";
import type { ModuleKey } from "@/lib/plans/catalog";
import type { DataSetDescriptor, FieldDef, FilterDef, ProductLine } from "./types";
import { MCP_PERIODS } from "./periods";

/** Report module -> the name the AI uses, its plan line, and its prose notes. */
const REPORT_SETS: Array<{
  name: string;
  reportModule: string;
  line: ProductLine;
  notes: string;
  examples: string[];
}> = [
  {
    name: "visits",
    reportModule: "visit",
    line: "wfa",
    notes:
      "Customer visits logged by field employees. A visit is 'productive' only if it produced an order — never infer productivity from duration or from a photo being attached. Check-in and check-out are separate timestamps; an open visit has no check-out.",
    examples: [
      'fetch_data({ dataset: "visits", period: "last_180_days", filters: { customer: "<id>" }, measures: ["visit_count"] })',
      'fetch_data({ dataset: "visits", period: "today", group_by: ["user"], measures: ["visit_count"] })',
    ],
  },
  {
    name: "orders",
    reportModule: "order",
    line: "crm",
    notes:
      "Sales orders with their line items. Amounts are in INR. An order's value is its net amount after scheme discounts, not the sum of list prices. Cancelled orders are included unless you filter them out by status.",
    examples: [
      'fetch_data({ dataset: "orders", period: "today", group_by: ["user","customer"], measures: ["order_count","net_amount"] })',
      'fetch_data({ dataset: "orders", period: "this_month", fields: ["customer","user","net_amount"] })',
    ],
  },
  {
    name: "sales",
    reportModule: "sales",
    line: "crm",
    notes:
      "Closed sales only — orders with status Closed, dated by when the dispatch completed rather than when the order was placed. This is the figure to use for 'how much did we actually sell', not the orders data set.",
    examples: [
      'fetch_data({ dataset: "sales", period: "this_month", measures: ["net_amount"] })',
      'fetch_data({ dataset: "sales", period: "previous_quarter", group_by: ["user"], measures: ["net_amount"] })',
    ],
  },
  {
    name: "quotations",
    reportModule: "quotation",
    line: "crm",
    notes:
      "Quotations issued to customers and leads. A quotation is not revenue — it becomes revenue only when it converts to an order. Quotations can be raised against a lead that has no customer record yet.",
    examples: [
      'fetch_data({ dataset: "quotations", period: "this_month", group_by: ["status"], measures: ["quotation_count"] })',
      'fetch_data({ dataset: "quotations", period: "last_90_days", fields: ["customer","net_amount","status"] })',
    ],
  },
  {
    name: "payments",
    reportModule: "payment",
    line: "crm",
    notes:
      "Payments received. Collected totals exclude Cancelled payments. A payment can be partly allocated across several orders, so payment totals need not equal any single order's value.",
    examples: [
      'fetch_data({ dataset: "payments", period: "this_month", measures: ["amount"] })',
      'fetch_data({ dataset: "payments", period: "this_week", group_by: ["user"], measures: ["amount"] })',
    ],
  },
  {
    name: "outstanding",
    reportModule: "ageing",
    line: "crm",
    notes:
      "Outstanding receivables by age bucket. This is an absence report: it shows what has NOT been paid, so a customer with no row owes nothing. 'Days Since Last Order' must never be summed across customers — adding one customer's 40 days to another's 90 gives 130, which means nothing.",
    examples: [
      'fetch_data({ dataset: "outstanding", group_by: ["customer"], measures: ["outstanding_amount"], sort: "outstanding_amount", limit: 10 })',
      'fetch_data({ dataset: "outstanding", fields: ["customer","days_since_last_order"] })',
    ],
  },
  {
    name: "leads",
    reportModule: "lead",
    line: "crm",
    notes:
      "Leads not yet converted to customers. Lead sources, statuses and industries are per-account configurable lists, so do not assume a fixed set of values — read them from the filter options.",
    examples: [
      'fetch_data({ dataset: "leads", period: "previous_quarter", group_by: ["source"], measures: ["lead_count"] })',
      'fetch_data({ dataset: "leads", period: "this_month", group_by: ["status"], measures: ["lead_count"] })',
    ],
  },
  {
    name: "deals",
    reportModule: "deal",
    line: "crm",
    notes:
      "Opportunities moving through a pipeline. Pipelines and their stages are per-account configurable. A deal's value is expected, not realised — do not report it as revenue.",
    examples: [
      'fetch_data({ dataset: "deals", group_by: ["stage"], measures: ["deal_count","deal_amount"] })',
      'fetch_data({ dataset: "deals", period: "this_month", group_by: ["pipeline"], measures: ["deal_amount"] })',
    ],
  },
  {
    name: "expenses",
    reportModule: "expense",
    line: "wfa",
    notes:
      "Employee expense claims. Status is a pivot: Pending, Approved and Rejected are separate measures rather than rows. Expense types and their rate tiers are per-account configurable. Approval may be advisory only — an account can run without enforced approval.",
    examples: [
      'fetch_data({ dataset: "expenses", period: "this_month", group_by: ["user"], measures: ["expense_approved"] })',
      'fetch_data({ dataset: "expenses", period: "last_month", group_by: ["expense_type"], measures: ["expense_claimed"] })',
    ],
  },
  {
    name: "tasks",
    reportModule: "task",
    line: "crm",
    notes:
      "Tasks and follow-ups. Activity types are per-account configurable (read the filter options rather than assuming). A task is overdue when its due date has passed and it is not Completed.",
    examples: [
      'fetch_data({ dataset: "tasks", group_by: ["user"], measures: ["task_count"] })',
      'fetch_data({ dataset: "tasks", period: "this_week", group_by: ["activity_type"], measures: ["task_count"] })',
    ],
  },
  {
    name: "daily_summary",
    reportModule: "dsr",
    line: "wfa",
    notes:
      "Daily Sales Report — one row per employee per day combining visits, orders, collections and distance travelled. Distance comes from odometer readings, not GPS. Use this for 'how was each rep's day' rather than stitching several data sets together.",
    examples: [
      'fetch_data({ dataset: "daily_summary", period: "today", group_by: ["user"], measures: ["visit_count","order_count","distance_km"] })',
      'fetch_data({ dataset: "daily_summary", period: "this_week", group_by: ["user"], measures: ["visit_count","order_count"] })',
    ],
  },
];

/**
 * Report-config `requiredModule` -> the real accounts.module_settings key.
 *
 * These have to be translated, not passed through. ReportDefinition.
 * requiredModule is declared on eight report configs but consumed nowhere in
 * the app, so its values were never checked against the real module keys —
 * and most of them are not real keys at all. Production has exactly eleven:
 * whatsapp, quotation, expense, dispatch, pending_dispatch, territory,
 * reporting_hierarchy, route, payment, scheme, stock. There is no "orders",
 * "quotations", "payments", "leads" or "deals".
 *
 * Passing the raw value through would make the module gate a silent no-op:
 * a tenant who switched Quotations off would still see quotations in their
 * AI, because nothing would ever match the key "quotations". null means the
 * module is core and has no toggle.
 */
const REPORT_MODULE_TOGGLE: Record<string, ModuleKey | null> = {
  orders: null, // core — no toggle exists
  leads: null, // core
  deals: null, // core
  quotations: "quotation",
  payments: "payment",
  expense: "expense",
};

/** Translate a report config's requiredModule, or undefined when it has none. */
function toggleForReport(requiredModule: unknown): string | undefined {
  if (typeof requiredModule !== "string") return undefined;
  const mapped = REPORT_MODULE_TOGGLE[requiredModule];
  if (mapped === null) return undefined;
  if (mapped) return mapped;
  // An unmapped value is a new report config we have not triaged. Treating it
  // as "no toggle" is the safe default (the plan line still gates it) and the
  // catalog test fails loudly so it gets mapped.
  return requiredModule;
}

const asField = (
  x: { key: string; label: string },
  type: FieldDef["type"],
): FieldDef => ({ key: x.key, label: x.label, type });

/** The one way to ask for time. Prepended to every report data set in place
 *  of the report's own raw-date filter — see dropRawDateFilters below. */
const PERIOD_FILTER: FilterDef = {
  key: "period",
  label: "Period",
  type: "date_range",
  options: [...MCP_PERIODS],
};

function fromReportConfig(entry: (typeof REPORT_SETS)[number]): DataSetDescriptor | null {
  const def = getReportByModule(entry.reportModule);
  if (!def) return null;

  const dimensions = def.dimensions.map((d) => asField(d, "text"));
  const measures = def.measures.map((m) =>
    asField(m, m.type === "currency" ? "currency" : "number"),
  );

  // Every report config carries its own `date_range` filter taking raw
  // start_date / end_date. Exposing it would hand the AI a raw-date door
  // right beside the named-period one, defeating the rule that makes date
  // correctness OZZO's job rather than the AI's. Drop it; `period` replaces it.
  const derived: FilterDef[] = def.filters
    .filter((f) => f.type !== "date_range")
    .map((f) => ({
      key: f.key,
      label: f.label,
      type: (f.type === "select" || f.type === "multiselect" ? "select" : "id") as
        FilterDef["type"],
      options: f.options?.map((o) => o.value),
    }));

  return {
    name: entry.name,
    title: def.label,
    route: "report",
    line: entry.line,
    requiredModule: toggleForReport(def.requiredModule),
    reportModule: entry.reportModule,
    // For a report data set the readable "fields" are its dimensions plus its
    // measures — exactly what execute_report can return, so the allow-list and
    // the engine's capability are the same set by construction.
    fields: [...dimensions, ...measures],
    filters: [PERIOD_FILTER, ...derived],
    dimensions,
    measures,
    notes: entry.notes,
    examples: entry.examples,
  };
}

/** Route B descriptors — modules with no report behind them. */
const READER_SETS: DataSetDescriptor[] = [
  {
    name: "customers",
    title: "Customers",
    route: "reader",
    line: "crm",
    table: "contacts",
    searchFields: ["name", "customer_code"],
    fields: [
      { key: "id", label: "Customer ID", type: "text" },
      { key: "name", label: "Customer Name", type: "text" },
      { key: "customer_code", label: "Customer Code", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "address", label: "Address", type: "text" },
      { key: "area", label: "Area", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
      { key: "country", label: "Country", type: "text" },
      { key: "gst_number", label: "GSTIN", type: "text" },
      { key: "credit_limit", label: "Credit Limit", type: "currency" },
      { key: "credit_days", label: "Credit Days", type: "number" },
      { key: "employee_id", label: "Assigned Employee", type: "text" },
      { key: "territory_id", label: "Territory", type: "text" },
      { key: "user_id", label: "Created By (auth user id)", type: "text" },
      { key: "is_active", label: "Active", type: "boolean" },
      { key: "created_at", label: "Created", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Name or code contains", type: "text" },
      { key: "id", label: "Customer ID", type: "id" },
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
      { key: "area", label: "Area", type: "text" },
      { key: "employee_id", label: "Assigned Employee", type: "id" },
      { key: "territory_id", label: "Territory", type: "id" },
      { key: "is_active", label: "Active only", type: "select", options: ["true", "false"] },
    ],
    dimensions: [
      { key: "city", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
      { key: "area", label: "Area", type: "text" },
    ],
    measures: [{ key: "customer_count", label: "Customers", type: "number" }],
    notes:
      "The customer master. Start here whenever a question names a company — use the `search` filter to turn a name into an id, then pass that id to another data set. City, state, country and area are denormalised from the territory hierarchy by a database trigger, so they are filled even for customers created with only a Territory. Inactive customers are soft-deleted, not removed; filter is_active unless the question is about history. There is no outstanding balance on this table — money owed is derived, so use the `outstanding` data set for that. Who owns a customer resolves in three steps: `employee_id` if set (a direct assignment, in the profiles.id space), otherwise whoever covers its territory, otherwise `user_id`, which is only the salesman who created the record and is in the auth-user id space, NOT profiles.id.",
    examples: [
      'fetch_data({ dataset: "customers", filters: { search: "Shah Traders" }, fields: ["id","name","city","employee_id"] })',
      'fetch_data({ dataset: "customers", group_by: ["city"], measures: ["customer_count"] })',
    ],
  },
  {
    name: "products",
    title: "Products",
    route: "reader",
    line: "crm",
    table: "products",
    searchFields: ["name", "sku"],
    fields: [
      { key: "id", label: "Product ID", type: "text" },
      { key: "name", label: "Product Name", type: "text" },
      { key: "sku", label: "SKU", type: "text" },
      { key: "category_id", label: "Category", type: "text" },
      { key: "unit_id", label: "Base Unit", type: "text" },
      { key: "price", label: "Price", type: "currency" },
      { key: "hsn_code", label: "HSN Code", type: "text" },
      { key: "active", label: "Active", type: "boolean" },
    ],
    filters: [
      { key: "search", label: "Name or SKU contains", type: "text" },
      { key: "id", label: "Product ID", type: "id" },
      { key: "category_id", label: "Category", type: "id" },
      { key: "active", label: "Active only", type: "select", options: ["true", "false"] },
    ],
    dimensions: [{ key: "category_id", label: "Category", type: "text" }],
    measures: [{ key: "product_count", label: "Products", type: "number" }],
    notes:
      "The product master. `price` is the base-unit price: an account with Multi Unit enabled sells in other units whose prices are derived by conversion factor, so a line item's rate need not equal this price. Customer-specific pricing from Price Lists overrides it again. Use this data set for the catalogue, not to compute what a customer was charged. Note the activity flag on this table is `active`, not `is_active` as on customers.",
    examples: [
      'fetch_data({ dataset: "products", filters: { search: "turmeric" }, fields: ["id","name","sku","price"] })',
      'fetch_data({ dataset: "products", group_by: ["category_id"], measures: ["product_count"] })',
    ],
  },
  {
    name: "employees",
    title: "Employees",
    route: "reader",
    line: "wfa",
    table: "profiles",
    searchFields: ["full_name", "employee_code"],
    fields: [
      { key: "id", label: "Employee ID", type: "text" },
      { key: "full_name", label: "Name", type: "text" },
      { key: "employee_code", label: "Employee Code", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "mobile", label: "Mobile", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "branch", label: "Branch", type: "text" },
      { key: "manager_id", label: "Reports To", type: "text" },
      { key: "account_role", label: "Role", type: "text" },
      { key: "status", label: "Status", type: "text" },
    ],
    filters: [
      { key: "search", label: "Name or code contains", type: "text" },
      { key: "id", label: "Employee ID", type: "id" },
      { key: "manager_id", label: "Reports To", type: "id" },
      { key: "department", label: "Department", type: "text" },
      { key: "status", label: "Status", type: "select", options: ["active", "inactive"] },
    ],
    dimensions: [
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "branch", label: "Branch", type: "text" },
    ],
    measures: [{ key: "employee_count", label: "Employees", type: "number" }],
    notes:
      "The employee roster. Start here whenever a question names a person. IMPORTANT id trap: this data set's `id` is profiles.id, which is NOT the same as the auth user id. Visits, deals and expenses key on profiles.id; leads, payments and some task columns key on the auth user id. Always pass the id this data set returns and let OZZO map it. `manager_id` is the reporting-hierarchy parent and is only meaningful when that module is switched on.",
    examples: [
      'fetch_data({ dataset: "employees", filters: { search: "Ramesh" }, fields: ["id","full_name","employee_code","designation"] })',
      'fetch_data({ dataset: "employees", group_by: ["department"], measures: ["employee_count"] })',
    ],
  },
];

export function allDataSets(): DataSetDescriptor[] {
  const a = REPORT_SETS.map(fromReportConfig).filter(
    (x): x is DataSetDescriptor => x !== null,
  );
  return [...a, ...READER_SETS];
}

const BY_NAME = new Map(allDataSets().map((s) => [s.name, s]));

export function getDataSet(name: string): DataSetDescriptor | undefined {
  return BY_NAME.get(name);
}
