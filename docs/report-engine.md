# Generic Reporting Engine (OZZO CRM)

This document covers the architectural design and rules for the permanent generic reporting engine introduced to OZZO CRM.

## 1. Architecture Overview
The reporting engine operates strictly on a **Database-Side Aggregation** model. 
We anticipate massive data scaling (100k+ Orders, 1M+ Location Pings). Client-side aggregation and massive JSON payloads over REST are strictly prohibited. The engine uses a single, hardened RPC function (`execute_dynamic_report`) that receives generic configurations (Dimensions, Measures, Filters) and dynamically constructs and executes PostgreSQL aggregation queries natively.

## 2. Core Principles
- **No Client-Side Aggregation**: All sorting, grouping, and summation happen in Postgres.
- **Registry-Driven**: Module configurations (like Orders, Visits, Expenses) are defined via rows in configuration tables, not via hardcoded SQL in the codebase.
- **Module Agnostic**: A single React component (`<ReportViewer />`) and a single RPC (`execute_dynamic_report`) power EVERY report in OZZO.
- **Configuration-Driven Visibility**: If an OZZO CRM module or feature (e.g., Territory Management, Product Categories) is disabled, its associated reports, filters, and dimensions automatically hide.
- **Tenant Isolation**: Strict RLS is enforced at the query executor level.

## 3. Required Registry Tables
The engine is driven by 5 core tables:

1. **`report_registry_dimensions`**: Defines what users can "Group By". E.g., `key: 'state'`, `sql_select: 'c.state'`, `required_joins: ['contacts']`.
2. **`report_registry_measures`**: Defines mathematical aggregations. E.g., `key: 'gross_amount'`, `sql_select: 'SUM(base.sub_total)'`.
3. **`report_registry_filters`**: Defines how UI filters map to WHERE clauses. E.g., `key: 'status'`, `sql_where: 'base.status = ($2::jsonb->''status''->>''value'')'`.
4. **`report_registry_joins`**: Stores reusable SQL join fragments. E.g., `join_key: 'contacts'`, `sql_join: 'LEFT JOIN contacts c ON base.contact_id = c.id'`.
5. **`saved_reports`**: Stores user-configured report presets (combinations of dimensions, measures, and filters) with sharing scopes (`private`, `team`, `organization`).

## 4. Security Rules
- **`SECURITY INVOKER`**: The `execute_dynamic_report` RPC must ALWAYS remain a `SECURITY INVOKER`. This ensures the dynamic SQL executes within the exact permissions of the authenticated user's JWT, automatically inheriting all RLS rules (e.g. Area-Based visibility, Tenant Isolation).
- **No Frontend SQL**: The React frontend must NEVER generate SQL strings. It must only pass generic keys (e.g. `['state', 'city']`) that the RPC maps to registered internal SQL fragments.

## 5. Fan-Out Prevention Strategy (Crucial)
When building reports, a classic SQL issue is "Fan-Out", which occurs when a base table (e.g., `orders`) is joined to a 1-to-N relation (e.g., `order_items`). 
If a user groups by an item-level dimension (like `product_category`), and the system aggregates `SUM(orders.sub_total)`, the total is mathematically inflated because the order's subtotal is duplicated for every item row.

**The Solution:**
The registry separates measures. When grouping by product categories, users must use an item-level measure (e.g., `item_amount = SUM(order_items.sub_total)`). This ensures exact reconciliation without modifying the engine code.

## 5b. Module Aliasing (Sales reuses Order)

Some modules are the same dataset seen through a narrower window. The **Sales** report is exactly the Order report restricted to orders that are *fully dispatched* — and "fully dispatched" is already recorded by the dispatch trigger, which auto-closes an order the moment its last outstanding item ships (`sync_order_dispatch_status`).

Rather than duplicate 11 dimensions, 10 measures, 19 filters and 5 joins under `module_name = 'sales'` — which would drift out of sync the first time someone edited one of them — `execute_report` resolves registry keys against an **ordered list of modules**:

| `p_module` | base table | registry lookup order |
| --- | --- | --- |
| `order` | `orders` | `['order']` |
| `sales` | `orders` | `['sales', 'order']` |
| `payment` | `payments` | `['payment']` |
| `quotation` | `quotations` | `['quotation']` |
| `expense` | `expenses` | `['expense']` |

A row registered under `sales` wins; otherwise the `order` row is used verbatim. Sales registers exactly **three** rows of its own — the `sales_date` join, the `date` dimension and the `date_range` filter — because a sale is dated by *dispatch completion* (the order's latest `order_dispatches.dispatched_at`, falling back to the order date when an order was closed without any dispatch). Every other dimension, measure, filter and join is inherited from `order` and cannot drift.

The `Closed` restriction is **not** a registry filter — it is appended to the WHERE clause by the RPC whenever `p_module = 'sales'`, so no caller can drop it, widen it, or override it by passing a `status` filter.

Because Sales runs on the dispatch date while Orders runs on the order date, the two reports are **not** expected to reconcile for the same period. An order placed in July and shipped in August is July in one and August in the other.

Use this pattern for any future "same data, fixed subset" report. Do not copy registry rows.

## 5c. Status-Pivot Columns (Payments)

The Payment report does not group by status — it **pivots on it**. Rather than one row per status, every row carries one column per status:

```
approved_amount  = SUM(CASE WHEN status = 'Approved'  THEN COALESCE(verified_amount, amount) ELSE 0 END)
pending_amount   = SUM(CASE WHEN status = 'Pending'   THEN amount ELSE 0 END)
...
total_amount     = SUM(CASE WHEN status = 'Approved'  THEN COALESCE(verified_amount, amount) ELSE amount END)
```

So every tab — Customer, User, Area, Period, Status — shows identical columns, and each row reads "of this much collected, X is approved and Y is still pending". `Total` reconciles exactly against the sum of the status columns because each payment lands in exactly one bucket and the Total's `CASE` mirrors the buckets' choice of amount column. Reuse this shape for any report where a lifecycle state is a *property of the measure* rather than something to group by.

Note the deliberate asymmetry: Approved uses `verified_amount` (what was actually confirmed received) with a fallback to `amount`; every other status has no verified figure, so it uses `amount`.

Filters are registered per module, so a module simply does not register what it cannot answer — payments have no product dimension and therefore no product/category filters. Filter drawer sections are likewise derived from each module's own filters, not a fixed global list.

## 5d. Twin Measures — the real fix for fan-out (Quotations)

§5 says users "must use an item-level measure" when grouping by an item-level dimension. Quotations implement that properly rather than leaving it to the user: every fan-out-prone measure is registered **twice** under the same label.

| Tab kind | Quantity | Sub Amount | joins |
| --- | --- | --- | --- |
| Lead / Customer / User / Area / Period | `product_quantity` — `SUM(qsum.product_quantity)` | `gross_amount` — `SUM(base.sub_total)` | pre-aggregated `qsum` |
| Product / Category / Sub-Category | `item_product_quantity` — `SUM(i.quantity)` | `item_gross_amount` — `SUM(i.sub_total)` | `quotation_items` |

The tab config picks the correct twin, and `TabConfig.availableMeasures` keeps the wrong one out of Manage Column so a user cannot select an inflating column by hand. Both sets carry identical labels, so the report reads the same on every tab.

Verified on prod: record-level and item-level quantity both total **85**. (Amounts differ only because 38 of 49 quotations have no line items at all — the item-level view can only account for quotations that have items.)

**When adding a module, register twins for any measure that would fan out.** Do not rely on the user choosing correctly. The Order/Sales product tabs still have the un-twinned version of this bug.

### Nullable-entity dimensions

A quotation belongs to a lead **or** a customer. Grouping on a nullable column would collapse the entire other side into one blank row, so the Lead and Customer dimensions **INNER JOIN** their own entity (aliases `lq` / `cq`) while geography keeps LEFT JOINs (`c` / `l`) and `COALESCE`s across both. Use this shape for any dimension whose entity is optional.

## 6. Future Compatibility & Onboarding Modules
To onboard a new module (e.g. `Visits`):
1. Create a migration that inserts the required dimensions, measures, filters, and joins into the registry tables with `module_name = 'visit'`.
2. Update the `execute_dynamic_report` RPC's base table switch statement (e.g., `ELSIF p_module = 'visit' THEN v_base_table := 'site_visits';`).
3. Define the Typescript `ReportDefinition` config.
4. Pass it to the `<ReportViewer />`.

There is no need to write new queries, new API routes, or new UI components.

## 7. Future Architectural Enhancements (Planned)
- **Cursor Pagination:** For MVP, reports utilize `LIMIT` and `OFFSET` for pagination. However, for extremely large datasets (millions of rows), deep OFFSET degrades performance. Future architecture will switch to Cursor-based pagination (`WHERE id > last_seen_id`) for table views.
- **Currency Conversion Architecture:** Currently, reports fall back to the Organization's Default Currency or utilize transaction-level currencies dynamically. Future iterations will introduce **Native Currency vs Reporting Currency**. This will allow dynamic conversion to a unified reporting currency inside the database using daily exchange rate tables, without performing conversion math in the React frontend.
