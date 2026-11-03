# Database and API map

Where a thing actually lives, so a question can be answered from the data rather than guessed at.

**Label:** VERIFIED against the production database on 2026-10-27 (read-only, via PostgREST) and
VERIFIED IN CODE for the call sites.

⚠️ **Read-only.** Everything in this file is for *looking*. The production database is the only
database — there is no staging — and the rules in [README.md](README.md) apply: never write, and
never touch account 001001.

---

## The shape of it

**191 tables and views** in production, one Supabase project, in Mumbai. Every tenant's rows live
in the same tables, separated by `account_id` and enforced by Row Level Security.

### The three functions every policy is built from

| Function | Answers |
| --- | --- |
| `is_account_member(account_id, min_role)` | Is this user in this account, at least at this role? |
| `account_has_line(account_id, line)` | Does the account's plan include `crm` / `wfa` / `sfa` / `fsm`? |
| `has_permission(user_id, account_id, key)` | Does this user hold this right? Owner/admin/superadmin bypass |

`account_has_line` is the **plan ceiling in the database** — it is why a CRM tenant cannot create
an order even with a crafted request. Its definition mirrors the plan catalogue in the app, and
legacy plans resolve to full access **except FSM**.

`has_permission` is the SQL mirror of the app's own check, including the owner/admin bypass and
the wildcard support. Both sides treat `true` and `"true"` as granted.

---

## The tables you will actually look in

### Who and what an account is

| Table | Holds |
| --- | --- |
| `accounts` | One row per tenant: the **plan**, the Customer ID, expiry, and `settings` (a JSON blob holding the module toggles and most configuration) |
| `profiles` | One row per user in an account — **and `web_access`**, the per-employee web portal switch |
| `employee_roles` | The named roles and their JSON permission map |
| `account_invitations` | Pending invites |
| `member_presence` | Who is online |

**`accounts.settings` is where most configuration lives** — module settings, order settings,
product settings, geo-fencing, the duplicate rules. When a toggle's effect is in question, that
is the column to read.

### The business records

| Thing | Table | Note |
| --- | --- | --- |
| Customers | **`contacts`** | Not `customers`. This trips everyone |
| Leads | `leads` | |
| Deals | `deals` + `deal_items` | |
| Pipelines | `pipelines`, `pipeline_stages` | Stage probability drives Weighted Value |
| Quotations | `quotations` + `quotation_items` | Plus `quotation_activities`, `quotation_terms_templates` |
| Orders | `orders` + `order_items` | |
| Dispatch | `order_dispatches` + `dispatch_items` | Status is derived from `dispatch_items` |
| Payments | `payments` + `payment_attachments` | Plus `payment_types`, `order_outstanding_balances` |
| Expenses | `expenses` | Plus `expense_types` (**the name column is `expense_name`**), `expense_rate_tiers` |
| Products | `products` | Plus `product_categories`, `product_units`, `product_unit_conversions`, `tax_slabs` |
| Pricing | `price_lists`, `price_list_items` | |
| Schemes | `schemes`, `scheme_slabs`, `scheme_products`, `scheme_customers` | |
| Stock | `stock_ledger`, `stock_positions` | **Closing stock is summed from the ledger, not stored** |
| Tasks | `tasks`, `task_assignees`, `task_checklists`, `task_comments`, `task_attachments` | Several assignees per task |
| Visits | **`site_visits`** | |
| Attendance | **`tracking_sessions`** | **There is no `attendance` table** |
| Location | `location_pings`, `location_daily_summary`, `tracking_events`, `device_health_snapshots` | |
| Leave | `leaves`, `leave_days`, `leave_types`, `holiday_lists`, `holidays` | Working week is per employee |
| Territories | `territories`, `employee_area_assignments` | |
| Routes | `routes`, `route_customers`, `route_schedules`, `route_executions`, `route_execution_stops`, `route_plan_assignments` | |
| WhatsApp | `conversations`, `messages`, `message_templates`, `broadcasts`, `broadcast_recipients`, `automations`, `automation_events`, `flows`, `flow_runs` | |
| Announcements | **`tenant_announcements`** | Not `announcements` |
| Custom fields | `custom_fields`, `custom_field_sections`, and one `*_custom_values` table per module | |
| Import | `import_jobs`, `import_templates`, `import_row_map` | `import_row_map` is what makes undo possible |
| Onboarding | 14 `impl_*` tables | Getting Started is configured, not hard-coded |
| Reports | `report_registry_*`, `saved_reports`, `table_views` | The report engine is data-driven too |
| Notifications | `notifications`, `notification_outbox`, `notification_preferences`, `push_tokens` | |

### Two naming traps worth memorising

- **Customers are `contacts`.**
- **Attendance is `tracking_sessions`.** There is no `attendance` table, and a report that seems
  to be missing one is looking in the wrong place.

### Polymorphic tables

**`site_visits` can target a customer or a lead.** It carries a legacy `contact_id` with a real
foreign key *and* a polymorphic `target_type` / `target_id` pair with none. `target_type` values
in production are the capitalised strings `'Customer'` and `'Lead'`.

**PostgREST cannot embed the polymorphic side** — there is no foreign key to `leads` — so a lead
target has to be resolved with a second query. This is why a "simple" join on visits fails.

---

## The database functions the app calls

**50 of them.** These are the operations that are *not* plain reads and writes, and knowing one
exists is often the answer to "how does it do that?".

### Money and orders

| Function | What it does |
| --- | --- |
| `calculate_order_pricing` | **The single source of truth for order money.** Fixed sequence, not configurable |
| `create_order` / `update_order` | Write header and lines in one transaction, priced through the above. `update_order` is blocked once the order is locked by a dispatch |
| `update_order_status` | The only supported path for a status change. Checks the permission, validates the transition, logs it |
| `detect_eligible_schemes` | Which schemes apply to a basket |
| `update_payment_status` / `check_duplicate_payment` | Payment approval, and catching a double entry |
| `rebuild_account_outstanding` | Recomputes a customer's outstanding balance |
| `stock_adjust` / `stock_bulk_adjust` | Write stock ledger movements |

### Conversions and chains

`convert_lead_to_customer` · `convert_deal_to_quotation` · `quotation_version_chain`

### People, access and tenancy

`set_member_role` · `remove_account_member` · `transfer_account_ownership` ·
`redeem_invitation` · `peek_invitation` · `get_approver` · `touch_presence`

### Territory, routes and leave

`territory_bulk_seed` · `territory_customer_counts` · `route_upsert` ·
`create_leave_request` · `update_leave_request` · `update_leave_status`

### Import — and how undo works

`import_commit` writes a run; **`import_undo` reverses it**, which is what `import_row_map` is
for. A bad import is recoverable.

### Reports and documents

`execute_report` · `get_all_reports` · `resolve_document_template` ·
`set_default_document_template`

### Admin and platform

`admin_list_tables` · `admin_table_columns` · `admin_tenant_health` · `admin_sync_health` ·
`admin_account_timeline` · `renew_platform_subscription` · `retention_pending_days` ·
plus the revenue-engine functions.

---

## The HTTP APIs

**86 route handlers.** Most of the app talks to Supabase directly; these exist where something
more than a query is needed.

### Tenant-facing

| Area | Routes |
| --- | --- |
| Account | `account`, `account/members`, `account/invitations`, `account/module-settings`, `account/route-settings`, `account/transfer-ownership`, `account/api-keys` |
| WhatsApp | `whatsapp/send`, `whatsapp/broadcast`, `whatsapp/config`, `whatsapp/templates/*`, `whatsapp/media/*`, **`whatsapp/webhook`** |
| Automations & flows | `automations/*`, `flows/*`, including their `cron` and `engine` endpoints |
| Mobile | `v1/location/pings`, `v1/location/sessions`, `v1/me` |
| Invitations | `invitations/[token]/peek`, `invitations/[token]/redeem` |
| Assistant | `ozzo/ask`, `ozzo/health` |
| MCP | `mcp`, plus its OAuth endpoints |
| Scheduled | `cron/retention`, `cron/demo-refresh`, `notifications/cron` |

**`account/module-settings` is the one that clamps module toggles to the plan** — the server-side
ceiling that makes a plan enforceable, whatever the UI sends.

### The public API — `/api/v1`

A **groundwork release**: authentication, scopes, rate limiting and a `GET /api/v1/me` probe ship
now; the data endpoints arrive one at a time.

- Authenticates with a **bearer API key**, `wacrm_live_…`
- **Keys are account-scoped** — a key acts on exactly one account, with no cross-account access
- Created at **Settings → API keys**, by **admins and owners only**, with explicit scopes

**If a customer asks "can we integrate?"** — the answer is yes in principle, today for identity
and tomorrow for the data endpoints. See `docs/public-api.md` in the repo for the live detail.

### Founder-only

29 `/admin/*` routes: billing, invoices, proposals, renewals, retention, the data browser, tenant
health, and the revenue engine. Not part of a customer's world.

---

## How to look something up safely

The pattern used throughout this knowledge base:

1. **Read the screen first.** The page's own words are the better evidence of what a customer
   sees.
2. **Query only to settle a disagreement** — when the browser and the data appear to differ. That
   is how the "0 products" reading was traced to a loading race rather than missing data, and how
   the raw id on the task form was confirmed to be a real profile id.
3. **Read-only, always.** Select. Never insert, update or delete.
4. **Know which account you are in.** `accounts.id` for the test tenant is not the Customer ID
   the customer quotes — Customer ID `001288` is a separate column.

### A caution about reading as the service key

A query run with the service key **bypasses Row Level Security**. It shows you what is *stored*,
not what the *user can see*. For a question about visibility, the data alone will mislead you —
the answer is in [access-control-matrix.md](access-control-matrix.md).

Equally, a view that filters on account membership returns **nothing** under a service key,
because there is no member to be. An empty result there is not an empty table.

---

## What is not mapped here

- **Column-level detail.** This file maps *where things live*, not every column. The repository's
  `PROJECT.md` carries the verified schema notes for the areas that have them, and is the
  developer source of truth.
- **The RLS policies themselves.** They are the real rules; this file names the three functions
  they are built from.
- **The mobile app's local storage and offline queue.** Nothing mobile has been verified here.
