# QA plan — the four modules built 3 Nov 2026

Scope: Buying Status (incl. Blacklist), Customer mapping, Automatic codes, the
territory "area is not mandatory" fix, plus the Organisation Settings panel that
gates three of them.

Written 4 Nov 2026, after the founder reported three bugs that all turned out to
be one unsaveable settings panel. Everything behind those toggles had therefore
**never executed in production**, so this plan assumes nothing is known to work.

## How each scenario is checked

| Mark | Means |
|---|---|
| `unit` | A vitest unit test, run in CI |
| `db` | Executed against a real PostgreSQL with the four migrations applied |
| `ui` | Clicked through in a browser against the live app |
| `prod` | Read-only assertion over live production data, all tenants |

A scenario is only "passed" when its evidence exists. "Looks right in the code"
is not a pass — that is exactly how the original three bugs shipped.

---

## A. Buying Status

| # | Scenario | Expected | How |
|---|---|---|---|
| A1 | Module off | No column, filter, form field or report dimension anywhere | ui |
| A2 | Module on | Column, filter, Manage Column entry, detail select all appear | ui |
| A3 | Customer with ≥1 live order | `buyer` | prod |
| A4 | Order Cancelled or Rejected only | `yet_to_buy` — those do not count | db |
| A5 | First live order saved | Flips `yet_to_buy` → `buyer`, sets `first_order_at` | db |
| A6 | That order later cancelled | Reverts to `yet_to_buy` when not locked | db |
| A7 | Human sets the status | Locks the row, records who and when | ui + db |
| A8 | Locked row, new order arrives | Status does **not** change | db |
| A9 | Blacklist with no reason | Refused, in the form **and** in the database | ui + db |
| A10 | Blacklist with a whitespace reason | Refused | ui + db |
| A11 | Release the lock while blacklisted | Refused; button not offered | db |
| A12 | Move off blacklist | Reason cleared, not left behind | db |
| A13 | Invalid status value | Refused by CHECK constraint | db |
| A14 | Non-admin without `manage_buying_status` | Refused by the RPC | db |
| A15 | Order saved on a tenant with Customer Level on, customer has no level | Order still saves — the status write must not trip migration 076's trigger | db |
| A16 | `first_order_at` | Matches the earliest live order | prod |
| A17 | Mobile list | Badge gated on the same flag | code |

## B. Customer mapping

| # | Scenario | Expected | How |
|---|---|---|---|
| B1 | Mode off | No supplier UI; `parent_id` stays null | ui |
| B2 | Mode manual | Supplied By box on the form, column + filter on the list | ui |
| B3 | Customer supplies itself | Refused | db |
| B4 | Supplier from another account | Refused | db |
| B5 | Loop: A supplies B supplies A | Refused | db |
| B6 | Levels on, dealer named as a distributor's supplier | Refused | db |
| B7 | Levels off | Rule cannot apply; any customer allowed | db |
| B8 | Mode beat, beat given a supplier | Every permanent customer on it takes it | db |
| B9 | One-time stop on a beat | Supplier unchanged — a visit is not a home | db |
| B10 | Beat mode, form | Box is read-only and names the beat | ui |
| B11 | Re-map dry run | Counts exactly what the write would change | db |
| B12 | Order saved | `orders.parent_contact_id` stamped from the customer | db |
| B13 | Supplier saved on the detail page | Shown immediately, without a reload | ui |
| B14 | Import with `parent_code` | Resolved in the second pass | unit |
| B15 | `customer_suppliers` RPC | Scoped to the caller's account only | db |

## C. Automatic codes

| # | Scenario | Expected | How |
|---|---|---|---|
| C1 | Rule off | Code left blank; nothing renumbered | db |
| C2 | Rule on, preview | Next code matches what the trigger will mint | ui |
| C3 | Customer saved with the code box empty | Code minted | db |
| C4 | Customer saved with a code typed | That code kept, sequence untouched | db |
| C5 | Sequence passes the digit width | Code grows (`CUST-10000`), never truncates | db |
| C6 | Concurrent inserts | No duplicates, no gaps | db |
| C7 | Backfill dry run | Count matches the blanks | ui + db |
| C8 | Backfill write | Oldest record gets the lowest number | db |
| C9 | Profile created during signup before an account exists | No code, and no error | db |
| C10 | Product | Writes `sku` | db |
| C11 | Two tenants | Sequences independent | db |

## D. Territory — area is not mandatory

| # | Scenario | Expected | How |
|---|---|---|---|
| D1 | Customer tagged only to a City, rep assigned the Area | Visible — coverage walks **up** as well as down | unit + db |
| D2 | `employee_area_territory_ids` | Still downward-only; not widened | db |
| D3 | Create guard | Still restricted to the assigned subtree | db |
| D4 | Sibling areas | Excluded both ways | unit + db |
| D5 | `contacts_select` | `collaborator_ids`, `employee_id` and `data_scope_extends` branches all present | db |
| D6 | TypeScript `coverage.ts` | Agrees with the SQL | unit |

## E. Organisation Settings panel (the regression that started this)

| # | Scenario | Expected | How |
|---|---|---|---|
| E1 | Change only Buying Status, Save | Persists | ui |
| E2 | Change only Customer mapping, Save | Persists | ui |
| E3 | Change only an auto-code rule, Save | Persists | ui |
| E4 | Discard | Every control returns to what the account holds | ui |
| E5 | Save | Settings owned by other panels are not reverted | ui |
| E6 | Any future state added to the panel | Guarded by `module-settings.deps.test.ts` | unit |

---

## Cross-cutting

| # | Scenario | Expected | How |
|---|---|---|---|
| X1 | Every rule above | Enforced in the **database**, so mobile, import and API cannot break it | db |
| X2 | All tenants | No cross-tenant supplier, no invalid status, no reasonless blacklist | prod |
| X3 | Tenants with the modules off | Completely unaffected | prod |
