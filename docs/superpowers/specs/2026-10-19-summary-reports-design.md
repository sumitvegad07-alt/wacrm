# Summary Reports — Product Summary + Customer Outstanding

**Date:** 2026-10-19
**Status:** approved by founder, ready to build
**Scope:** a new "Summary Report" sidebar section holding two new reports on the
existing generic report engine. No new tables.

---

## 1. Why

Two questions the product cannot answer today:

1. **"For today's orders, which customer bought which product, how many, how
   much?"** The Order report has a Customer tab and a Product tab but never both
   dimensions in one table, so customer-and-product in one row is impossible.
2. **"Who owes me money, on which order, and what is their phone number?"**
   Outstanding exists only as a whole-customer figure.

The founder also asked for a dedicated section so this kind of flat, operational
summary can keep growing without crowding the 12-row "Report" group.

## 2. The constraint that shaped report 2

`payments` has `contact_id` but **no `order_id`** (see
`20260813170000_payment_collection_module.sql`). A payment settles a customer,
not an invoice. So OZZO has never held a per-order balance, and
`customer_outstanding(contact_id)` is defined as:

```
opening_balance + SUM(counted orders) - SUM(counted payments)
```

Founder decision, 2026-10-19: derive a per-order balance by **oldest-first
(FIFO) allocation**. A customer's received payments settle their opening balance
first, then their oldest counted order, then the next. Each order row shows what
is still unpaid *on that order*.

Closed form, per order:

```
prior_debt(X)  = opening_balance(C)
               + SUM(total_amount of C's counted orders ordered before X)
received(C)    = SUM(COALESCE(verified_amount, amount) of C's counted payments)
allocated(X)   = LEAST(X.total_amount, GREATEST(received(C) - prior_debt(X), 0))
outstanding(X) = X.total_amount - allocated(X)      -- 0 if X is not a counted status
```

"Ordered before" is the tuple `(date, created_at, id)`, which is total and
stable — two orders written on the same date still have a deterministic order,
so allocation never double-counts or skips.

### Where the maths lives — changed during implementation

The design said a scalar `order_outstanding_amount(order_id)` called per row,
mirroring `customer_outstanding()`. It was written, registered and executed
against prod first, per §5i — and it **cancelled on statement timeout (57014)**
on Balaji Agencies, a 3,338-order account. "Sum every earlier order of this
customer" is a correlated subquery whose cost is quadratic in a customer's order
count, re-run for every row of the report.

Shipped instead as a view, `order_outstanding_balances`, where `prior_debt` is a
**window SUM** over each customer's orders: the whole account is computed in one
pass and the report joins the answer per row rather than recomputing it per row.
`order_outstanding_amount()` survives as a thin read of the view, for callers
that have an order and not a report, so there is still exactly one
implementation of the rule.

The view is deliberately **not** `security_invoker`. Allocation needs the
customer's whole ledger, and `execute_report` is SECURITY INVOKER — under the
caller's own RLS a rep who sees only their own orders would compute a smaller
prior debt, allocate too much, and read a different balance than their manager
for the same order. Owner rights fix that, exactly as the SECURITY DEFINER
`customer_outstanding()` already does. Tenant isolation is kept inside the view:
the `rules` CTE is gated by `is_account_member()` and every other CTE joins it,
so the view cannot emit a row for an account the caller does not belong to.
Supabase's advisor will flag it as an RLS-bypassing view; that is expected.

**Which statuses count is NOT redefined here.** The measures call the existing
`outstanding_order_statuses(account_id)` and
`outstanding_payment_statuses(account_id)`
(`20261005130000_outstanding_rule_and_stored_balance.sql`), so this report can
never disagree with the customer list or the dashboard. An account that changes
the rule in Settings moves this report with it.

### Consequence that must be stated in the UI

`SUM(outstanding per order)` equals the customer's balance **minus any
opening balance still unsettled**, because opening balance is debt with no order
row to sit on. The Customer tab therefore offers a `customer_balance` column
(`MAX(c.outstanding_balance)`, the stored cache) so the true full figure is one
click away. It is excluded from the Order tab via `availableMeasures` — one value
per customer repeated across their order rows would make the footer lie.

## 3. Report A — Product Summary

| | |
| --- | --- |
| Route | `/reports/summary/products` |
| Registry module | `product_summary`, aliased `['product_summary','order']` |
| Base table | `orders` |
| Default period | `today` |
| Gate | SFA line, `orders` module (same as Order Reports) |

One row per customer **and** product.

**Tabs** — both use `extraDimensions` to put two independent dimensions in one
table. Every other report uses `extraDimensions` only for a dimension
functionally determined by the primary one, precisely to avoid splitting rows.
Here splitting rows **is the product**, which is why this is a separate module
with its own documented intent rather than a tab bolted onto Order Reports.

| Tab | Dimension | Extra | Default columns |
| --- | --- | --- | --- |
| Customer wise (default) | `customer` | `product` | Quantity, Amount |
| Product wise | `product` | `customer` | Quantity, Amount |

**Measures.** The whole point of the module's own registry rows: the inherited
`order` measures for quantity and amount are **order-level** and fan out when the
grain is a product line. `product_quantity` on module `order` is
`SUM(COALESCE(isum.product_quantity, 0))` — a per-order rollup, repeated once per
product row. That is the long-standing overstatement recorded in
[report-engine.md §5d] and the `sales-report-shipped` note. This module
overrides the fan-out-prone measures with item-level twins under the same keys;
module-ordered resolution makes the override win without touching `order`.

| Key | Label | SQL | Note |
| --- | --- | --- | --- |
| `product_quantity` | Quantity | `SUM(i.quantity)` | override, item-level |
| `base_quantity` | Base Quantity | `SUM(COALESCE(i.base_quantity, i.quantity))` | override; multi-unit |
| `net_amount` | Amount | `SUM(i.total)` | override; line final amount, incl. tax |
| `gross_amount` | Sub Amount | `SUM(i.sub_total)` | override |
| `tax_amount` | Tax Amount | `SUM(i.tax_amount)` | override |
| `product_count` | # of product | `COUNT(DISTINCT i.product_id)` | override |
| `avg_rate` | Avg Rate | `SUM(i.total) / NULLIF(SUM(i.quantity),0)` | new; ratio, non-additive |
| `order_count` | # of order | inherited `COUNT(DISTINCT base.id)` | fan-out-safe |
| `customer_count` | # of customer | inherited `COUNT(DISTINCT base.contact_id)` | fan-out-safe |

Everything else — all 12 dimensions, all 19 filters, all 5 joins — is inherited.

## 4. Report B — Customer Outstanding

| | |
| --- | --- |
| Route | `/reports/summary/outstanding` |
| Registry module | `order_outstanding`, aliased `['order_outstanding','order']` |
| Base table | `orders` |
| Default period | `last_365_days` |
| Gate | SFA line, `orders` module (same as Ageing Reports) |

One row per order. Period selects **which orders are listed**; it never changes
the allocation maths, which is always lifetime.

**New dimensions**

| Key | Label | SQL |
| --- | --- | --- |
| `order_number` | Order Number | `base.order_number` |
| `order_date` | Order Date | `TO_CHAR(base.date, 'YYYY-MM-DD')` |
| `customer_phone` | Contact Number | `COALESCE(NULLIF(c.phone,''), '-')` |

`order` already registers `date` as `TO_CHAR(base.date,'FMMonth YYYY')` — a month
bucket, right for a Period tab and wrong on an order row, hence `order_date`.

**New measures**

| Key | Label | Type | Note |
| --- | --- | --- | --- |
| `order_amount` | Order Amount | currency | `SUM(base.total_amount)` |
| `received_amount` | Received Amount | currency | FIFO-allocated portion |
| `outstanding_amount` | Outstanding | currency | order amount − allocated |
| `customer_balance` | Customer Balance | currency | `MAX(c.outstanding_balance)`; Customer tab only |

**Tabs**

| Tab | Dimension | Extra | Default columns |
| --- | --- | --- | --- |
| Order wise (default) | `order_number` | `customer`, `customer_phone` | Order Amount, Outstanding |
| Customer wise | `customer` | `customer_phone` | # of order, Order Amount, Outstanding, Customer Balance |
| Area wise | `area` | — | # of customer, # of order, Order Amount, Outstanding |
| User wise | `user` | — | # of customer, # of order, Order Amount, Outstanding |

KPIs: Order Amount, Outstanding, # of order.

**New filter** `only_outstanding` ("Only unpaid orders", select Yes/No) — tests
the joined balance as `> 0`, so settled orders can be hidden. Written so a
cleared or unexpected value is a no-op: `execute_report` appends a filter's
predicate whenever its key is present, whatever the value.

An order in a status the account does not count as debt (Cancelled, Rejected)
has no row in the view at all, so the report's LEFT JOIN leaves it at
Outstanding 0 **and** Received 0 while still showing its Order Amount. So
"Received + Outstanding = Order Amount" holds **over counted orders only** — the
gap is work that was called off. Verified against prod: on the pilot account the
Closed total reconciles exactly, 63,954.00 = 60,454.00 + 3,500.00, while all
statuses together come to 193,388.05.

## 5. Delivery

1. `supabase/migrations/20261019120000_summary_report_modules.sql`
   - creates the `order_outstanding_balances` view and the thin
     `order_outstanding_amount()` reader over it
   - patches `execute_report`'s base-table switch in place off
     `pg_get_functiondef`, idempotent, refusing to run if the switch has
     drifted — the pattern established by the DSR migration
   - upserts the registry rows for both modules
   - adds `idx_orders_account_contact_date`, matching the view's PARTITION BY /
     ORDER BY so the running total reads off an index instead of a sort
2. `src/lib/reports/productSummaryReportConfig.ts`,
   `src/lib/reports/outstandingReportConfig.ts`, both added to `registry.ts`
3. `src/app/(dashboard)/reports/summary/products/page.tsx`,
   `src/app/(dashboard)/reports/summary/outstanding/page.tsx`
4. Sidebar: new `Summary Report` group after `Report`
5. `src/lib/plans/surface-gates.ts`: `/reports/summary/...` → `line: 'sfa'`
6. `docs/report-engine.md`: new §5l covering the two patterns this introduces
   (deliberate multi-dimension grain; a derived balance precomputed in a view
   rather than per row)

**Applying it.** Supabase MCP has been permission-denied on the Mumbai project
since 2026-10-16, so the founder runs this migration himself.

**What was verified before handover.** Registered SQL is untyped text and fails
silently (§5i), so every expression was executed against prod data by
registering it temporarily under the `order` module with `zz_probe_` keys,
running it through `execute_report`, and deleting the probes afterwards (0 rows
left behind). Results:

- every item-level measure executes and reconciles against `order_items`
  itself — Quantity, Amount and Base Quantity all match to the paisa;
- the inherited order-level `product_quantity` **does** overstate at the
  customer × product grain, confirming the reason this module registers its own
  measures;
- the allocation formula as SQL, including the `(date, created_at, id)` tuple
  comparison, matches an independent recomputation on **all 50 orders** of the
  pilot account, 8 of them carrying a balance, max difference 0.00;
- the `only_outstanding` filter narrows 50 → 8, keeps every unpaid order, and is
  a no-op on "no";
- two dimensions genuinely split rows, 138 → 3,436 on the busiest account;
- and the per-row correlated form times out, which is what moved the maths into
  the view.

Not verifiable until the migration runs, because creating a view is DDL: the
view's own SQL, its privileges, and the two `execute_report` branches. Those are
the first things to check afterwards.

## 6. Out of scope, noted

- `order.product_subcategory` is registered as `COALESCE(p.category,'General')`
  — identical to `product_category`. A pre-existing bug on the Order and Sales
  reports; not touched here, and no sub-category tab is offered on either new
  report.
- The fan-out overstatement on the **Order** and **Sales** reports' own Product
  tabs is left as-is. This design fixes the grain for the new module only;
  changing `order` would move numbers on two shipped reports and needs its own
  decision.
- No mobile build. These are web reports; mobile parity is a separate batch.
