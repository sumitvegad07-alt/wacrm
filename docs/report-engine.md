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
