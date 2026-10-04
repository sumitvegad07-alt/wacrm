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
      "Customer visits logged by field employees. Group by `day` for a date-by-date breakdown; the `date` dimension buckets by MONTH, not by day. To count visits FOR one customer, first find that customer in the `customers` data set, then pass its id as the `customer` filter here — do not filter by `user`, which is the employee who made the visit, not the customer who received it. A visit is 'productive' only if it produced an order — never infer productivity from duration or from a photo being attached. Check-in and check-out are separate timestamps; an open visit has no check-out.",
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

/**
 * Report modules whose engine honours a `day` dimension.
 *
 * Verified against production one module at a time, because the others do NOT
 * reject it — they silently ignore it and return a single ungrouped total.
 * An AI that asked for a daily breakdown of payments would get one row and
 * present it as a day's figure. Only these three are safe.
 */
const DAY_DIMENSION_MODULES = new Set(["visit", "order", "sales"]);

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
  if (DAY_DIMENSION_MODULES.has(entry.reportModule)) {
    // The config's own `date` dimension buckets by MONTH ("September 2026"),
    // which is why "how many visits in the last 15 days" could not be
    // answered even once a 15-day period existed.
    dimensions.push({ key: "day", label: "Day", type: "date" });
  }
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
      // A 'customer' filter is the one shape execute_report expects nested.
      // The dashboard's own drawer sends { contact_id: val } for it and a
      // bare value for every other type; see report-filter-drawer.tsx.
      wrapIn: f.type === "customer" ? "contact_id" : undefined,
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
    name: "visit_log",
    title: "Visit Log",
    route: "reader",
    line: "wfa",
    table: "mcp_visit_details",
    dateColumn: "check_in_at",
    searchFields: ["customer_company", "customer_contact_person", "employee_name"],
    fields: [
      { key: "id", label: "Visit ID", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "customer_contact_person", label: "Contact Person", type: "text" },
      { key: "customer_city", label: "City", type: "text" },
      { key: "customer_area", label: "Area", type: "text" },
      { key: "employee_name", label: "Visited By", type: "text" },
      { key: "check_in_at", label: "Check In", type: "datetime" },
      { key: "check_out_at", label: "Check Out", type: "datetime" },
      { key: "duration_minutes", label: "Time Spent (minutes)", type: "number" },
      { key: "feedback_type", label: "Feedback", type: "text" },
      { key: "feedback_text", label: "Feedback Notes", type: "text" },
      { key: "notes", label: "Visit Notes", type: "text" },
      { key: "target_type", label: "Visited", type: "text" },
      { key: "check_in_distance_m", label: "Check-in Distance (m)", type: "number" },
    ],
    filters: [
      { key: "search", label: "Company, person or employee contains", type: "text" },
      { key: "contact_id", label: "Customer ID", type: "id" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "feedback_type", label: "Feedback", type: "select" },
      { key: "target_type", label: "Visited", type: "select", options: ["Customer", "Lead"] },
    ],
    dimensions: [
      { key: "employee_name", label: "Visited By", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "feedback_type", label: "Feedback", type: "text" },
      { key: "customer_city", label: "City", type: "text" },
    ],
    measures: [{ key: "visit_count", label: "Visits", type: "number" }],
    notes:
      "INDIVIDUAL visits, one row each — use this whenever the question is about particular visits rather than a total: how long each visit lasted, what feedback was left, what notes were written, who was seen and when. The `visits` data set totals visits and cannot show any of that. `duration_minutes` is check-out minus check-in and is EMPTY while a visit is still open, so an unusually large number usually means the rep forgot to check out rather than a long meeting — say so rather than averaging it in silently. Feedback is a per-account list, so read the values you get back rather than assuming a fixed set.",
    examples: [
      'fetch_data({ dataset: "visit_log", days_back: 15, fields: ["customer_company","employee_name","check_in_at","duration_minutes","feedback_type"] })',
      'fetch_data({ dataset: "visit_log", start_date: "2026-09-20", end_date: "2026-10-04", filters: { search: "Dhaval" }, fields: ["customer_company","duration_minutes","feedback_type"] })',
    ],
  },
  {
    name: "order_log",
    title: "Order Log",
    route: "reader",
    line: "crm",
    table: "mcp_order_details",
    dateColumn: "created_at",
    searchFields: ["customer_company", "customer_contact_person", "order_number", "employee_name"],
    fields: [
      { key: "id", label: "Order ID", type: "text" },
      { key: "order_number", label: "Order Number", type: "text" },
      { key: "order_date", label: "Order Date", type: "date" },
      { key: "created_at", label: "Created", type: "datetime" },
      { key: "status", label: "Status", type: "text" },
      { key: "classification", label: "Classification", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "customer_contact_person", label: "Contact Person", type: "text" },
      { key: "customer_city", label: "City", type: "text" },
      { key: "customer_area", label: "Area", type: "text" },
      { key: "employee_name", label: "Taken By", type: "text" },
      { key: "sub_total", label: "Sub Total", type: "currency" },
      { key: "discount_total", label: "Discount", type: "currency" },
      { key: "tax_total", label: "Tax", type: "currency" },
      { key: "total_amount", label: "Order Value", type: "currency" },
      { key: "item_count", label: "Line Items", type: "number" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    filters: [
      { key: "search", label: "Company, person or order number contains", type: "text" },
      { key: "contact_id", label: "Customer ID", type: "id" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "status", label: "Status", type: "select" },
      { key: "order_number", label: "Order Number", type: "text" },
    ],
    dimensions: [
      { key: "status", label: "Status", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "employee_name", label: "Taken By", type: "text" },
      { key: "customer_city", label: "City", type: "text" },
    ],
    measures: [{ key: "order_count", label: "Orders", type: "number" }],
    notes:
      "INDIVIDUAL orders, one row each - use this when the question is about particular orders rather than a total: which orders, for whom, worth how much, in what status. The `orders` data set totals them and cannot list them. `total_amount` is the net value after discount and tax. Cancelled orders are included unless you filter by status, so check the status before calling a figure revenue. `item_count` is how many product lines the order has; the lines themselves are not exposed.",
    examples: [
      "fetch_data({ dataset: \"order_log\", days_back: 15, fields: [\"order_number\",\"customer_company\",\"total_amount\",\"status\"] })",
      "fetch_data({ dataset: \"order_log\", period: \"this_month\", filters: { search: \"Brahmani\" }, fields: [\"order_number\",\"total_amount\",\"status\"] })",
    ],
  },
  {
    name: "payment_log",
    title: "Payment Log",
    route: "reader",
    line: "crm",
    table: "mcp_payment_details",
    dateColumn: "created_at",
    searchFields: ["customer_company", "customer_contact_person", "payment_number", "employee_name"],
    fields: [
      { key: "id", label: "Payment ID", type: "text" },
      { key: "payment_number", label: "Payment Number", type: "text" },
      { key: "payment_date", label: "Payment Date", type: "date" },
      { key: "created_at", label: "Recorded", type: "datetime" },
      { key: "amount", label: "Amount", type: "currency" },
      { key: "verified_amount", label: "Verified Amount", type: "currency" },
      { key: "payment_type", label: "Payment Mode", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "reference_number", label: "Reference", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "customer_contact_person", label: "Contact Person", type: "text" },
      { key: "customer_city", label: "City", type: "text" },
      { key: "employee_name", label: "Collected By", type: "text" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    filters: [
      { key: "search", label: "Company, person or payment number contains", type: "text" },
      { key: "contact_id", label: "Customer ID", type: "id" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "status", label: "Status", type: "select" },
      { key: "payment_type", label: "Payment Mode", type: "text" },
    ],
    dimensions: [
      { key: "status", label: "Status", type: "text" },
      { key: "payment_type", label: "Payment Mode", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "employee_name", label: "Collected By", type: "text" },
    ],
    measures: [{ key: "payment_count", label: "Payments", type: "number" }],
    notes:
      "INDIVIDUAL payments, one row each - which customer paid, how much, by what mode, collected by whom. Cancelled payments ARE included here, unlike the `payments` totals which exclude them, so filter by status before calling a figure collected. `verified_amount` can differ from `amount` where an account verifies collections. A payment may be spread across several orders, so it need not match any one order's value.",
    examples: [
      "fetch_data({ dataset: \"payment_log\", days_back: 30, fields: [\"payment_number\",\"customer_company\",\"amount\",\"status\"] })",
      "fetch_data({ dataset: \"payment_log\", period: \"this_month\", group_by: [\"employee_name\"], measures: [\"payment_count\"] })",
    ],
  },
  {
    name: "expense_log",
    title: "Expense Log",
    route: "reader",
    line: "wfa",
    table: "mcp_expense_details",
    dateColumn: "created_at",
    requiredModule: "expense",
    searchFields: ["employee_name", "expense_number", "expense_type"],
    fields: [
      { key: "id", label: "Expense ID", type: "text" },
      { key: "expense_number", label: "Expense Number", type: "text" },
      { key: "expense_date", label: "Expense Date", type: "date" },
      { key: "created_at", label: "Submitted", type: "datetime" },
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "expense_type", label: "Expense Type", type: "text" },
      { key: "amount", label: "Claimed", type: "currency" },
      { key: "approved_amount", label: "Approved", type: "currency" },
      { key: "status", label: "Status", type: "text" },
      { key: "travel_km", label: "Travel (km)", type: "number" },
      { key: "rate_per_km", label: "Rate per km", type: "currency" },
      { key: "odometer_start", label: "Odometer Start", type: "number" },
      { key: "odometer_end", label: "Odometer End", type: "number" },
      { key: "approved_by_name", label: "Approved By", type: "text" },
      { key: "remarks", label: "Remarks", type: "text" },
      { key: "rejection_reason", label: "Rejection Reason", type: "text" },
    ],
    filters: [
      { key: "search", label: "Employee, number or type contains", type: "text" },
      { key: "employee_id", label: "Employee ID", type: "id" },
      { key: "status", label: "Status", type: "select" },
      { key: "expense_type", label: "Expense Type", type: "text" },
    ],
    dimensions: [
      { key: "status", label: "Status", type: "text" },
      { key: "expense_type", label: "Expense Type", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
    ],
    measures: [{ key: "expense_count", label: "Expenses", type: "number" }],
    notes:
      "INDIVIDUAL expense claims, one row each - who claimed what, for how much, and whether it was approved. `amount` is what was CLAIMED and `approved_amount` what was granted; they differ, and reporting the claimed figure as a cost is the usual mistake. A pending claim has no approved amount yet. Expense types and their per-km rates are per-account configurable. `employee_id` is in the profiles.id space, which the `employees` data set returns.",
    examples: [
      "fetch_data({ dataset: \"expense_log\", days_back: 30, fields: [\"employee_name\",\"expense_type\",\"amount\",\"approved_amount\",\"status\"] })",
      "fetch_data({ dataset: \"expense_log\", period: \"last_month\", group_by: [\"status\"], measures: [\"expense_count\"] })",
    ],
  },
  {
    name: "order_items",
    title: "Order Line Items",
    route: "reader",
    line: "crm",
    table: "mcp_order_item_details",
    dateColumn: "created_at",
    searchFields: ["product_name", "customer_company", "order_number"],
    fields: [
      { key: "id", label: "Line ID", type: "text" },
      { key: "order_id", label: "Order ID", type: "text" },
      { key: "order_number", label: "Order Number", type: "text" },
      { key: "order_date", label: "Order Date", type: "date" },
      { key: "order_status", label: "Order Status", type: "text" },
      { key: "product_id", label: "Product ID", type: "text" },
      { key: "product_name", label: "Product", type: "text" },
      { key: "hsn_code", label: "HSN Code", type: "text" },
      { key: "unit", label: "Unit", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "base_quantity", label: "Base Quantity", type: "number" },
      { key: "unit_price", label: "Rate", type: "currency" },
      { key: "discount_amount", label: "Discount", type: "currency" },
      { key: "scheme_discount_amount", label: "Scheme Discount", type: "currency" },
      { key: "tax_amount", label: "Tax", type: "currency" },
      { key: "sub_total", label: "Sub Total", type: "currency" },
      { key: "line_value", label: "Line Value", type: "currency" },
      { key: "is_scheme_goods", label: "Free Goods", type: "boolean" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "customer_contact_person", label: "Contact Person", type: "text" },
      { key: "customer_city", label: "City", type: "text" },
      { key: "employee_name", label: "Taken By", type: "text" },
    ],
    filters: [
      { key: "search", label: "Product, company or order number contains", type: "text" },
      { key: "order_id", label: "Order ID", type: "id" },
      { key: "product_id", label: "Product ID", type: "id" },
      { key: "contact_id", label: "Customer ID", type: "id" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "order_status", label: "Order Status", type: "select" },
    ],
    dimensions: [
      { key: "product_name", label: "Product", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "employee_name", label: "Taken By", type: "text" },
      { key: "order_status", label: "Order Status", type: "text" },
    ],
    measures: [{ key: "line_count", label: "Lines", type: "number" }],
    notes:
      "The ONLY correct source for how much of each product was sold and for how much money. An order has many lines, so the order's total belongs to the order and NOT to each product in it - taking a product's value from `order_log` repeats the whole order against every product and overstates it badly. Use `line_value` for money and `quantity` for units. `base_quantity` is the same quantity converted to the product's base unit, which is what to compare across orders when Multi Unit is on. A line with `is_scheme_goods` true is free goods given under an offer, so it carries quantity but little or no value. Cancelled orders appear here too - filter `order_status`.",
    examples: [
      "fetch_data({ dataset: \"order_items\", days_back: 46, group_by: [\"product_name\"], measures: [\"line_count\"] })",
      "fetch_data({ dataset: \"order_items\", period: \"this_month\", fields: [\"product_name\",\"quantity\",\"line_value\",\"customer_company\"] })",
    ],
  },
  {
    name: "routes",
    title: "Routes",
    route: "reader",
    line: "sfa",
    table: "mcp_route_details",
    dateColumn: "created_at",
    requiredModule: "route",
    searchFields: ["name", "assigned_to"],
    fields: [
      { key: "id", label: "Route ID", type: "text" },
      { key: "name", label: "Route Name", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "assigned_to", label: "Assigned To", type: "text" },
      { key: "primary_assignee_id", label: "Assignee ID", type: "text" },
      { key: "customer_count", label: "Customers On Route", type: "number" },
      { key: "must_visit_count", label: "Must-Visit Customers", type: "number" },
      { key: "created_at", label: "Created", type: "datetime" },
      { key: "archived_at", label: "Archived", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Route or assignee contains", type: "text" },
      { key: "id", label: "Route ID", type: "id" },
      { key: "status", label: "Status", type: "select" },
      { key: "primary_assignee_id", label: "Assignee ID", type: "id" },
    ],
    dimensions: [
      { key: "status", label: "Status", type: "text" },
      { key: "assigned_to", label: "Assigned To", type: "text" },
    ],
    measures: [{ key: "route_count", label: "Routes", type: "number" }],
    notes:
      "Route PLANS - the beat a rep is supposed to cover, not what they actually did. Use `route_runs` for what happened on a given day and `route_stops` for which customers were visited or skipped. Route Management belongs to the SFA line, not WFA. `primary_assignee_id` is in the profiles.id space. An archived route has `archived_at` set and is no longer in use.",
    examples: [
      "fetch_data({ dataset: \"routes\", fields: [\"name\",\"assigned_to\",\"customer_count\",\"status\"] })",
      "fetch_data({ dataset: \"routes\", group_by: [\"assigned_to\"], measures: [\"route_count\"] })",
    ],
  },
  {
    name: "route_runs",
    title: "Route Runs",
    route: "reader",
    line: "sfa",
    table: "mcp_route_run_details",
    dateColumn: "created_at",
    requiredModule: "route",
    searchFields: ["route_name", "employee_name"],
    fields: [
      { key: "id", label: "Run ID", type: "text" },
      { key: "route_id", label: "Route ID", type: "text" },
      { key: "route_name", label: "Route", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "employee_profile_id", label: "Employee ID", type: "text" },
      { key: "execution_date", label: "Date", type: "date" },
      { key: "status", label: "Status", type: "text" },
      { key: "started_at", label: "Started", type: "datetime" },
      { key: "completed_at", label: "Completed", type: "datetime" },
      { key: "stop_count", label: "Planned Stops", type: "number" },
      { key: "visited_count", label: "Visited", type: "number" },
      { key: "skipped_count", label: "Skipped", type: "number" },
      { key: "created_at", label: "Created", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Route or employee contains", type: "text" },
      { key: "route_id", label: "Route ID", type: "id" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "status", label: "Status", type: "select" },
    ],
    dimensions: [
      { key: "status", label: "Status", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "route_name", label: "Route", type: "text" },
    ],
    measures: [{ key: "run_count", label: "Runs", type: "number" }],
    notes:
      "One row per employee per route per day - whether they ran their beat, and how much of it. `visited_count` against `stop_count` is route adherence in one line, so this answers 'is everyone following their route plan' without comparing two data sets. For WHICH customers were skipped, use `route_stops`.",
    examples: [
      "fetch_data({ dataset: \"route_runs\", period: \"today\", fields: [\"employee_name\",\"route_name\",\"stop_count\",\"visited_count\",\"skipped_count\"] })",
      "fetch_data({ dataset: \"route_runs\", days_back: 7, group_by: [\"employee_name\"], measures: [\"run_count\"] })",
    ],
  },
  {
    name: "route_stops",
    title: "Route Stops",
    route: "reader",
    line: "sfa",
    table: "mcp_route_stop_details",
    dateColumn: "created_at",
    requiredModule: "route",
    searchFields: ["customer_company", "employee_name", "route_name"],
    fields: [
      { key: "id", label: "Stop ID", type: "text" },
      { key: "execution_id", label: "Run ID", type: "text" },
      { key: "execution_date", label: "Date", type: "date" },
      { key: "route_name", label: "Route", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "employee_profile_id", label: "Employee ID", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "customer_contact_person", label: "Contact Person", type: "text" },
      { key: "contact_id", label: "Customer ID", type: "text" },
      { key: "planned_sequence", label: "Planned Order", type: "number" },
      { key: "actual_sequence", label: "Actual Order", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "skip_reason", label: "Skip Reason", type: "text" },
      { key: "visited_at", label: "Visited At", type: "datetime" },
      { key: "site_visit_id", label: "Visit ID", type: "text" },
      { key: "created_at", label: "Created", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Company, employee or route contains", type: "text" },
      { key: "execution_id", label: "Run ID", type: "id" },
      { key: "contact_id", label: "Customer ID", type: "id" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "status", label: "Status", type: "select" },
    ],
    dimensions: [
      { key: "status", label: "Status", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "customer_company", label: "Company", type: "text" },
      { key: "skip_reason", label: "Skip Reason", type: "text" },
    ],
    measures: [{ key: "stop_count", label: "Stops", type: "number" }],
    notes:
      "Every planned stop, with what happened to it. This answers 'who skipped, and which customers' DIRECTLY - filter status to the skipped value and read the company names and skip reasons. Do not try to work it out by comparing the route plan against the visit list; that is slower and gets the answer wrong when a rep visits a customer who was not on the beat. `planned_sequence` against `actual_sequence` shows a rep who resequenced the route rather than skipping it.",
    examples: [
      "fetch_data({ dataset: \"route_stops\", period: \"today\", filters: { status: \"skipped\" }, fields: [\"employee_name\",\"customer_company\",\"skip_reason\"] })",
      "fetch_data({ dataset: \"route_stops\", days_back: 7, group_by: [\"status\"], measures: [\"stop_count\"] })",
    ],
  },
  {
    name: "territories",
    title: "Territories",
    route: "reader",
    line: "sfa",
    table: "territories",
    dateColumn: "created_at",
    requiredModule: "territory",
    searchFields: ["name", "code"],
    fields: [
      { key: "id", label: "Territory ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "level", label: "Level", type: "number" },
      { key: "parent_id", label: "Parent", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "created_at", label: "Created", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Name or code contains", type: "text" },
      { key: "id", label: "Territory ID", type: "id" },
      { key: "parent_id", label: "Parent ID", type: "id" },
      { key: "level", label: "Level", type: "select", options: ["1", "2", "3", "4"] },
      { key: "status", label: "Status", type: "select" },
    ],
    dimensions: [
      { key: "level", label: "Level", type: "number" },
      { key: "status", label: "Status", type: "text" },
    ],
    measures: [{ key: "territory_count", label: "Territories", type: "number" }],
    notes:
      "The geography hierarchy: level 1 = Country, 2 = State, 3 = City, 4 = Area. A customer's flat city/state/country/area fields are copied from this by a database trigger, so for most questions about where customers are you want the `customers` data set, not this one. Use this to understand the hierarchy itself. Accounts can hold tens of thousands of rows here, so always filter by level or parent.",
    examples: [
      "fetch_data({ dataset: \"territories\", filters: { level: \"4\", search: \"Rajkot\" }, fields: [\"name\",\"code\",\"level\"] })",
      "fetch_data({ dataset: \"territories\", group_by: [\"level\"], measures: [\"territory_count\"] })",
    ],
  },
  {
    name: "leave",
    title: "Leave",
    route: "reader",
    line: "wfa",
    table: "mcp_leave_details",
    dateColumn: "created_at",
    searchFields: ["employee_name", "leave_number", "leave_type"],
    fields: [
      { key: "id", label: "Leave ID", type: "text" },
      { key: "leave_number", label: "Leave Number", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "employee_id", label: "Employee ID", type: "text" },
      { key: "leave_type", label: "Leave Type", type: "text" },
      { key: "from_date", label: "From", type: "date" },
      { key: "to_date", label: "To", type: "date" },
      { key: "total_days", label: "Days", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "reason", label: "Reason", type: "text" },
      { key: "is_backdated", label: "Backdated", type: "boolean" },
      { key: "approved_by_name", label: "Approved By", type: "text" },
      { key: "rejection_reason", label: "Rejection Reason", type: "text" },
      { key: "created_at", label: "Applied", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Employee, number or type contains", type: "text" },
      { key: "employee_id", label: "Employee ID", type: "id" },
      { key: "status", label: "Status", type: "select" },
      { key: "leave_type", label: "Leave Type", type: "text" },
    ],
    dimensions: [
      { key: "status", label: "Status", type: "text" },
      { key: "leave_type", label: "Leave Type", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
    ],
    measures: [{ key: "leave_count", label: "Leave Requests", type: "number" }],
    notes:
      "Leave requests, one row each. `total_days` already accounts for half days, so do not recount it from the date range. The working week is per-account configurable - never assume Monday to Friday - and holidays are kept separately, so a request spanning a weekend may count fewer days than the calendar suggests. A pending request is not time off yet; filter by status before reporting absence. `employee_id` is in the profiles.id space.",
    examples: [
      "fetch_data({ dataset: \"leave\", period: \"this_month\", fields: [\"employee_name\",\"leave_type\",\"from_date\",\"to_date\",\"total_days\",\"status\"] })",
      "fetch_data({ dataset: \"leave\", days_back: 90, group_by: [\"status\"], measures: [\"leave_count\"] })",
    ],
  },
  {
    name: "stock",
    title: "Stock",
    route: "reader",
    line: "crm",
    table: "mcp_stock_levels",
    requiredModule: "stock",
    searchFields: ["product_name", "sku"],
    fields: [
      { key: "product_id", label: "Product ID", type: "text" },
      { key: "product_name", label: "Product", type: "text" },
      { key: "sku", label: "SKU", type: "text" },
      { key: "hsn_code", label: "HSN Code", type: "text" },
      { key: "closing_stock", label: "Closing Stock", type: "number" },
      { key: "ledger_entries", label: "Ledger Entries", type: "number" },
      { key: "last_movement_at", label: "Last Movement", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Product or SKU contains", type: "text" },
      { key: "product_id", label: "Product ID", type: "id" },
    ],
    dimensions: [{ key: "product_name", label: "Product", type: "text" }],
    measures: [{ key: "product_count", label: "Products", type: "number" }],
    notes:
      "Closing stock per product. It is DERIVED - the running sum of every movement in the stock ledger - not a stored number, so a product with no ledger entries does not appear here at all rather than showing zero. Stock Management is opt-in and off by default, so an account that has not switched it on has an empty ledger; that is not the same as being out of stock. Quantities are in the product's base unit.",
    examples: [
      "fetch_data({ dataset: \"stock\", fields: [\"product_name\",\"sku\",\"closing_stock\"], sort: \"closing_stock\" })",
      "fetch_data({ dataset: \"stock\", filters: { search: \"wafers\" }, fields: [\"product_name\",\"closing_stock\"] })",
    ],
  },
  {
    name: "schemes",
    title: "Schemes",
    route: "reader",
    line: "crm",
    table: "mcp_scheme_details",
    dateColumn: "created_at",
    requiredModule: "scheme",
    searchFields: ["name"],
    fields: [
      { key: "id", label: "Scheme ID", type: "text" },
      { key: "name", label: "Scheme Name", type: "text" },
      { key: "scheme_type", label: "Type", type: "text" },
      { key: "slab_mode", label: "Slab Mode", type: "text" },
      { key: "target_type", label: "Applies To", type: "text" },
      { key: "priority", label: "Priority", type: "number" },
      { key: "starts_on", label: "Starts", type: "date" },
      { key: "ends_on", label: "Ends", type: "date" },
      { key: "is_active", label: "Active", type: "boolean" },
      { key: "max_free_units_per_order", label: "Max Free Units", type: "number" },
      { key: "slab_count", label: "Slabs", type: "number" },
      { key: "created_at", label: "Created", type: "datetime" },
    ],
    filters: [
      { key: "search", label: "Scheme name contains", type: "text" },
      { key: "id", label: "Scheme ID", type: "id" },
      { key: "scheme_type", label: "Type", type: "select" },
      { key: "is_active", label: "Active only", type: "select", options: ["true", "false"] },
    ],
    dimensions: [
      { key: "scheme_type", label: "Type", type: "text" },
      { key: "target_type", label: "Applies To", type: "text" },
    ],
    measures: [{ key: "scheme_count", label: "Schemes", type: "number" }],
    notes:
      "Discount and offer schemes. A scheme is why an order's value can be below the list price, so this is where to look when a total seems low. Scheme Management is opt-in via Catalogue Settings and off by default. The slab thresholds themselves are not exposed, only how many slabs a scheme has. Free goods given under a scheme appear in `order_items` with `is_scheme_goods` set.",
    examples: [
      "fetch_data({ dataset: \"schemes\", filters: { is_active: \"true\" }, fields: [\"name\",\"scheme_type\",\"starts_on\",\"ends_on\"] })",
      "fetch_data({ dataset: \"schemes\", group_by: [\"scheme_type\"], measures: [\"scheme_count\"] })",
    ],
  },
  {
    name: "attendance",
    title: "Attendance",
    route: "reader",
    line: "wfa",
    sensitive: true,
    table: "mcp_attendance_details",
    dateColumn: "started_at",
    searchFields: ["employee_name"],
    fields: [
      { key: "id", label: "Session ID", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "employee_profile_id", label: "Employee ID", type: "text" },
      { key: "started_at", label: "Punch In", type: "datetime" },
      { key: "ended_at", label: "Punch Out", type: "datetime" },
      { key: "duration_minutes", label: "Duration (minutes)", type: "number" },
      { key: "end_reason", label: "End Reason", type: "text" },
      { key: "punch_in_distance_m", label: "Punch-in Distance (m)", type: "number" },
      { key: "punch_out_distance_m", label: "Punch-out Distance (m)", type: "number" },
      { key: "punch_in_is_mocked", label: "Punch-in Faked", type: "boolean" },
      { key: "punch_out_is_mocked", label: "Punch-out Faked", type: "boolean" },
      { key: "odometer_in_reading", label: "Odometer In", type: "number" },
      { key: "odometer_out_reading", label: "Odometer Out", type: "number" },
      { key: "odometer_distance", label: "Distance (odometer)", type: "number" },
    ],
    filters: [
      { key: "search", label: "Employee contains", type: "text" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "end_reason", label: "End Reason", type: "select" },
    ],
    dimensions: [
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "end_reason", label: "End Reason", type: "text" },
    ],
    measures: [{ key: "session_count", label: "Sessions", type: "number" }],
    notes:
      "Punch in and out sessions. Shift times NEVER gate tracking: punched in means tracked at any hour, and shift times only classify the attendance afterwards - so a session outside shift hours is normal, not an anomaly. A session with no `ended_at` is still open, and its duration is empty rather than zero. `punch_in_distance_m` is how far the employee was from their assigned location and is only present when geo-fencing is switched on. `odometer_distance` is from the readings the employee entered, not from GPS.",
    examples: [
      "fetch_data({ dataset: \"attendance\", period: \"today\", fields: [\"employee_name\",\"started_at\",\"ended_at\",\"duration_minutes\"] })",
      "fetch_data({ dataset: \"attendance\", days_back: 7, group_by: [\"employee_name\"], measures: [\"session_count\"] })",
    ],
  },
  {
    name: "device_health",
    title: "Device Health",
    route: "reader",
    line: "wfa",
    sensitive: true,
    table: "mcp_device_health_details",
    dateColumn: "recorded_at",
    searchFields: ["employee_name", "model", "manufacturer"],
    fields: [
      { key: "id", label: "Snapshot ID", type: "text" },
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "employee_profile_id", label: "Employee ID", type: "text" },
      { key: "recorded_at", label: "Recorded", type: "datetime" },
      { key: "reason", label: "Reason", type: "text" },
      { key: "app_version", label: "App Version", type: "text" },
      { key: "os_version", label: "OS Version", type: "text" },
      { key: "manufacturer", label: "Manufacturer", type: "text" },
      { key: "model", label: "Model", type: "text" },
      { key: "battery_pct", label: "Battery %", type: "number" },
      { key: "is_charging", label: "Charging", type: "boolean" },
      { key: "low_power_mode", label: "Low Power Mode", type: "boolean" },
      { key: "battery_optimization_on", label: "Battery Optimisation On", type: "boolean" },
      { key: "location_services_on", label: "Location Services On", type: "boolean" },
      { key: "fg_location_permission", label: "Foreground Location", type: "text" },
      { key: "bg_location_permission", label: "Background Location", type: "text" },
      { key: "notification_permission", label: "Notifications", type: "text" },
    ],
    filters: [
      { key: "search", label: "Employee, model or make contains", type: "text" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "manufacturer", label: "Manufacturer", type: "text" },
      { key: "location_services_on", label: "Location Services On", type: "select", options: ["true", "false"] },
    ],
    dimensions: [
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "manufacturer", label: "Manufacturer", type: "text" },
      { key: "model", label: "Model", type: "text" },
    ],
    measures: [{ key: "snapshot_count", label: "Snapshots", type: "number" }],
    notes:
      "Why a phone may not be reporting its location. `battery_optimization_on` true, or `bg_location_permission` denied, is the usual reason a rep appears stationary all day while actually working - check this before concluding someone did not travel. Each row is a point in time, NOT the current state of the phone, so read the most recent snapshot rather than treating any row as today's setting.",
    examples: [
      "fetch_data({ dataset: \"device_health\", days_back: 7, fields: [\"employee_name\",\"model\",\"battery_optimization_on\",\"bg_location_permission\",\"recorded_at\"] })",
      "fetch_data({ dataset: \"device_health\", period: \"today\", group_by: [\"employee_name\"], measures: [\"snapshot_count\"] })",
    ],
  },
  {
    name: "location_trail",
    title: "Location Trail",
    route: "reader",
    line: "wfa",
    sensitive: true,
    table: "mcp_location_ping_details",
    dateColumn: "recorded_at",
    transform: "dwell",
    sourceFields: [
      "employee_name",
      "recorded_at",
      "lat",
      "lng",
      "is_mocked",
    ],
    searchFields: ["employee_name"],
    fields: [
      { key: "employee_name", label: "Employee", type: "text" },
      { key: "from", label: "Arrived", type: "datetime" },
      { key: "to", label: "Left", type: "datetime" },
      { key: "minutes", label: "Minutes There", type: "number" },
      { key: "lat", label: "Latitude", type: "number" },
      { key: "lng", label: "Longitude", type: "number" },
      { key: "ping_count", label: "Readings", type: "number" },
    ],
    filters: [
      { key: "search", label: "Employee contains", type: "text" },
      { key: "employee_profile_id", label: "Employee ID", type: "id" },
      { key: "time_of_day", label: "Time of day (local HH:mm)", type: "time_of_day" },
    ],
    dimensions: [{ key: "employee_name", label: "Employee", type: "text" }],
    measures: [{ key: "stop_count", label: "Stops", type: "number" }],
    notes:
      "Where each employee STOPPED and for how long, worked out from their GPS trail. It returns stops and dwell time, never raw readings - a six-hour day is about 4,000 readings, and a dozen places with times is both the honest answer and the useful one. Faked locations are excluded from the stops and reported separately as `mocked_count`. Tracking only runs while an employee is punched IN, so a gap means 'not punched in', NEVER 'stopped moving' - check the `attendance` data set before reading anything into a quiet afternoon, and `device_health` before concluding someone did not travel. Use `time_of_day` with local HH:mm values, e.g. { from: \"11:00\", to: \"17:00\" }. Always ask for a short window; a wide one is cut off and the answer says so.",
    examples: [
      "fetch_data({ dataset: \"location_trail\", period: \"today\", filters: { search: \"Dhaval\", time_of_day: { from: \"11:00\", to: \"17:00\" } } })",
      "fetch_data({ dataset: \"location_trail\", period: \"yesterday\", filters: { employee_profile_id: \"<id>\" } })",
    ],
  },
  {
    name: "customers",
    title: "Customers",
    route: "reader",
    line: "crm",
    table: "contacts",
    dateColumn: "created_at",
    // `company` first: the reports display the company name, so that is the
    // name an admin will quote back.
    searchFields: ["company", "name", "customer_code"],
    fields: [
      { key: "id", label: "Customer ID", type: "text" },
      // contacts.company is the FIRM, contacts.name is the PERSON at it.
      { key: "company", label: "Company Name", type: "text" },
      { key: "name", label: "Contact Person", type: "text" },
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
      { key: "search", label: "Company, contact person or code contains", type: "text" },
      { key: "id", label: "Customer ID", type: "id" },
      { key: "company", label: "Company Name", type: "text" },
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
      "The customer master — the firms and people this business SELLS TO. EACH RECORD HAS TWO NAMES: `company` is the firm (\"Brahmani casting\") and `name` is the contact person at it (\"Laxmi mittal\"). Every report — visits, orders, payments, outstanding — displays the COMPANY, so that is the name an answer should use. The `search` filter looks in both, so either name finds the record; say which you matched if they differ, because the admin may know the customer by only one of them. Start here whenever a question names a company OR a person who is not staff. Indian B2B customers are very often recorded under an individual's name rather than a company name, so a person-sounding name is at least as likely to be a customer as an employee: if a question says \"customer\", search here, and if a name is not found in one master, search the other before saying it does not exist. Use the `search` filter to turn a name into an id — use the `search` filter to turn a name into an id, then pass that id to another data set. City, state, country and area are denormalised from the territory hierarchy by a database trigger, so they are filled even for customers created with only a Territory. Inactive customers are soft-deleted, not removed; filter is_active unless the question is about history. There is no outstanding balance on this table — money owed is derived, so use the `outstanding` data set for that. Who owns a customer resolves in three steps: `employee_id` if set (a direct assignment, in the profiles.id space), otherwise whoever covers its territory, otherwise `user_id`, which is only the salesman who created the record and is in the auth-user id space, NOT profiles.id.",
    examples: [
      'fetch_data({ dataset: "customers", filters: { search: "Shah Traders" }, fields: ["id","company","name","city"] })',
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
      "The employee roster — the staff who WORK FOR this business, not the people it sells to. A person-sounding name is not evidence of an employee: in Indian B2B most customers are recorded under an individual's name, so check the `customers` data set too before reporting that someone does not exist. IMPORTANT id trap: this data set's `id` is profiles.id, which is NOT the same as the auth user id. Visits, deals and expenses key on profiles.id; leads, payments and some task columns key on the auth user id. Always pass the id this data set returns and let OZZO map it. `manager_id` is the reporting-hierarchy parent and is only meaningful when that module is switched on.",
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
