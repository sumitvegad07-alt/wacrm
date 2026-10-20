# Platform Invoices + Subscription Renewals — Design

**Date:** 2026-10-20
**Status:** Approved for planning
**Owner:** Founder (platform owner only)

## Problem

OZZO bills its own tenants, and today nothing in the product records that.

1. **No invoice exists.** The price calculator (`/admin/calculator`) and the proposal builder
   (`/admin/proposals`) both produce a *quote* — a document that may be rewritten freely and carries
   no number. Once a customer says yes, the founder has no way to issue the tax invoice that gets
   filed, no record of what was billed to whom, and no list of what is outstanding. Some customers
   are charged GST and some are not, and both kinds of document have to be produced.
2. **No renewal list exists.** `accounts.subscription_expires_at` holds an expiry date, but there is
   no screen that answers "whose subscription ends today", the account row has no salesman and no
   subscription start date, and no record of which periods a customer has already paid for. The
   founder wants to open one screen each morning and see exactly who is due.

## Scope

**In:**

- A founder-only invoice module: GST (full tax invoice) and non-GST variants, numbered per financial
  year, stored, printable to PDF, with payment status and a WhatsApp hand-off.
- A founder-only Invoice Settings screen holding OZZO's own seller details.
- A founder-only renewal module: a standalone table of subscription periods the founder maintains by
  hand, with a daily "due today" screen and per-customer renewal history.

**Out:**

- Any link between the two modules. The founder's explicit instruction: the renewal module "does not
  have any relation with invoice module". Renewing does not create an invoice, and paying an invoice
  does not move a renewal date.
- Any tenant-facing surface. No tenant, and no second superadmin, may read either module.
- Automatic recurring invoicing, credit notes, e-invoice / IRN (not required under ₹5 crore
  turnover), emailing, a payment gateway, multi-currency, TDS handling.
- Changing `accounts.subscription_expires_at`. Neither module writes to the `accounts` table.

## Decisions

1. **Invoices get their own table, not a flag on `platform_proposals`.** That table already carries
   `gst_enabled` and `billing_term`, which makes reuse tempting. Rejected: a proposal is a draft the
   founder may rewrite at will, while an issued invoice is a numbered document that must never change
   afterwards. Sharing one table would let an ordinary proposal edit silently alter a filed invoice.

2. **Platform-level storage, RLS-denied, service-role only.** Same doctrine as `platform_proposals`
   (migration `20260926120000`): no `account_id`, RLS enabled with **no policies**,
   `revoke all ... from anon, authenticated`. Every read and write goes through `/api/admin/...`
   behind `requireFounder()` using `serviceClient()` (`src/lib/auth/superadmin.ts`). Consequence:
   unreachable by any tenant, and unreachable by a second superadmin or a compromised superadmin
   session.

3. **PDF via a print route, not a server-side PDF library.** `/print/invoice/[id]` renders A4 and a
   button calls `window.print()`. This is what every other document in the app does
   (`/print/order/[id]`, `/print/proposal/[id]`, ...) and the app carries no PDF dependency. The
   print route is **founder-gated server-side**, unlike the tenant print routes which rely on RLS.

4. **Money comes from `lib/plans/pricing.ts`, never from new arithmetic.** The plan line is priced by
   the existing `quote()` — the same function the calculator, the proposal builder and the billing
   page use. `gstRate: 0` is already its documented way of expressing "a customer who is not charged
   GST". A second implementation of the term uplifts is exactly how a proposal ends up quoting a
   price the billing page does not recognise.

5. **GST determination reuses `src/lib/gst/states.ts`.** `gstStateCodeFromGstin()` and
   `determineGstType(supplierStateCode, placeOfSupplyCode)` already exist and are the TS mirror of
   the SQL `gst_state_code()` in migration `20260911120000`. The only new tax code is the split of a
   taxable value into CGST/SGST or IGST. Nothing about the state list or the intra/inter rule is
   re-derived here.

6. **Separate number series per financial year, and issued invoices are cancelled, never deleted.**
   GST requires a consecutive series, unique within a financial year. GST invoices run
   `OZZO/26-27/001`; non-GST run `OZZO/26-27/B001`. Both restart at 001 on 1 April. A unique index
   makes a duplicate impossible rather than unlikely. `DELETE` is permitted only while
   `status = 'draft'`, enforced by a trigger — a deleted issued invoice would leave a gap in the
   series.

7. **An issued invoice is a frozen snapshot.** Seller details, buyer details and line items are
   written into the row's `data` JSONB at issue time. Editing Invoice Settings or a tenant's company
   profile afterwards changes nothing on an already-issued invoice.

8. **The renewal module stores its own rows and reads nothing from `accounts`.** The founder adds
   each row by hand. This was chosen over auto-syncing from `accounts` because the platform tracks no
   salesman, no subscription start date and no renewal amount, and because auto-sync would keep
   re-creating rows for test and dead tenants. `customer_id` is free text, so a customer who is not
   yet a tenant in the app can still be tracked.

9. **"Due today" is computed in IST on the server.** `end_date` is a `date` column, compared against
   today in `Asia/Kolkata`. The attendance tabs currently have a live bug of exactly this kind (the
   shift window is browser-local); this module must not repeat it. No `toISOString()` anywhere near a
   day boundary.

10. **Non-GST invoices are built as asked, with one flagged risk.** If the issuing firm is
    GST-registered, issuing non-GST invoices for the same service can leave these documents
    disagreeing with the filed GSTR-1. Keeping the series separate makes that visible rather than
    hidden. This is the founder's commercial decision; recorded here, not litigated.

---

# Part 1 — Invoice module

## Data model

### `platform_invoices`

Denormalised columns for everything the list, the filters and the books need; `data` JSONB for the
frozen document payload.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `invoice_no` | text not null | `OZZO/26-27/001`. Unique. Auto-filled, editable while draft |
| `series` | text not null | `'gst'` or `'non_gst'`, CHECK-constrained |
| `fy` | text not null | `'26-27'` — the Indian financial year of `invoice_date` |
| `seq` | integer not null | Counter within (`series`, `fy`) |
| `invoice_date` | date not null | default `current_date` |
| `account_id` | uuid null | to `accounts(id)` ON DELETE SET NULL. Nullable so deleting a tenant never deletes its invoice history |
| `customer_id` | text | OZZO Customer ID, snapshotted |
| `client_name` | text not null default `''` | Snapshotted buyer name, for the list |
| `plan` | text | `PlanId` |
| `billing_term` | text | `'quarterly'`, `'half_yearly'` or `'yearly'`, CHECK-constrained |
| `users_billed` | integer not null default 0 | |
| `period_start`, `period_end` | date | Service period printed on the document |
| `gst_enabled` | boolean not null default true | |
| `gst_rate` | numeric(5,2) not null default 18 | Stored, so a rate change is data not a deploy |
| `gst_type` | text null | `'intrastate'`, `'interstate'` or `'unknown'`; **null exactly when `gst_enabled` is false** (a CHECK enforces the pairing) |
| `place_of_supply_code` | text null | 2 digits |
| `subtotal` | numeric(12,2) | Sum of line amounts |
| `discount_amount` | numeric(12,2) default 0 | |
| `taxable_value` | numeric(12,2) | `subtotal` minus `discount_amount` |
| `cgst_amount`, `sgst_amount`, `igst_amount` | numeric(12,2) default 0 | Only one pair is ever non-zero |
| `total` | numeric(12,2) | `taxable_value` plus tax |
| `amount_received` | numeric(12,2) not null default 0 | |
| `status` | text not null default `'draft'` | `'draft'`, `'issued'`, `'part_paid'`, `'paid'`, `'cancelled'` |
| `paid_at` | date null | |
| `data` | jsonb not null default `'{}'` | Frozen payload (below) |
| `created_by` | uuid null | to `auth.users(id)` ON DELETE SET NULL |
| `created_at`, `updated_at` | timestamptz | `touch_..._updated_at` trigger, as on `platform_proposals` |

Indexes: `unique (invoice_no)`, `unique (series, fy, seq)`, `(invoice_date desc)`, `(status)`,
`(account_id)`.

Trigger `platform_invoices_block_hard_delete`: `BEFORE DELETE`, raises unless
`OLD.status = 'draft'`.

**`data` payload** (`src/lib/invoices/types.ts`):

```ts
interface InvoiceData {
  seller: SellerSnapshot;   // firm name, address, state, gst_state_code, gstin, pan,
                            // bank_name, account_no, ifsc, upi, declaration, signature_url
  buyer: BuyerSnapshot;     // name, address, pincode, state, gst_state_code, gstin,
                            // contact_person, phone, email
  lines: InvoiceLine[];     // { label, description, sac, users, months, rate, amount }
  discountPct: number;      // 0 when a flat amount was entered instead
  discountAmount: number;
  notes: string;
  terms: string;
}
```

The plan line is line 1, built from `quote()`; extra charge lines (setup, training, data import,
add-on module) follow. SAC defaults to `998314` (IT design and development services) and is editable
per line.

**Discount is applied once, at invoice level.** `quote()` accepts a `discountPct` of its own, so the
rule is: the invoice calls `quote()` with `discountPct: 0` and `gstRate: 0`, using it only for the
per-user-per-month rate and the gross plan-line amount. The discount (percent or flat) and the whole
tax calculation then happen once in `invoiceTotals()` over every line, extra charges included.
Otherwise a discount would come off the plan line inside `quote()` and off the subtotal again, and
the extra lines would escape it.

### `platform_invoice_settings`

One row, with `id` fixed by a CHECK so a second row cannot exist: firm name, address, pincode, state,
`gst_state_code`, `gstin`, `pan`, `bank_name`, `bank_account_no`, `ifsc`, `upi_id`, `declaration`,
`default_terms`, `signature_url`, `logo_url`, `next_gst_seq_override`, `next_non_gst_seq_override`
(both nullable, for starting a series mid-year at a number the founder's books already use).

Signature and logo upload to the existing `document_assets` bucket under a `platform/` prefix,
written through the service-role API route.

## New pure-logic files (each with a `*.test.ts` beside it)

`src/lib/invoices/`

| File | Responsibility |
|---|---|
| `types.ts` | `InvoiceData`, `InvoiceLine`, `SellerSnapshot`, `BuyerSnapshot`, `InvoiceStatus`, `InvoiceSeries` |
| `fy.ts` | `financialYear(date)` returns `'26-27'` — Indian FY, starting 1 April. A date in Jan–Mar belongs to the previous April's year |
| `number.ts` | `buildInvoiceNo(series, fy, seq)` returns `OZZO/26-27/001` or `OZZO/26-27/B001`; `parseInvoiceNo()` for the reverse |
| `tax.ts` | `splitTax(taxableValue, ratePct, gstType)` returns `{ cgst, sgst, igst }`. Intrastate halves the rate; interstate puts it all in IGST; `unknown` and non-GST return zeros. Rounded once, at the whole rupee |
| `totals.ts` | `invoiceTotals(lines, discount)` returns subtotal / discountAmount / taxableValue / tax / total; `amountInWords(total)` in Indian lakh–crore form ("Rupees One Lakh Twenty Three Thousand Four Hundred Only") |
| `status.ts` | Legal status transitions: draft to issued or cancelled; issued to part_paid, paid or cancelled; part_paid to paid or cancelled; paid and cancelled terminal. Rejects the rest |

Reused as-is, not reimplemented: `quote()`, `TERM_MONTHS`, `TERM_LABEL`, `asTerm()`, `renewalDate()`
from `lib/plans/pricing.ts`; `PLAN_LABEL` from `lib/plans/catalog.ts`; `gstStateCodeFromGstin()`,
`determineGstType()`, `gstStateName()`, `GST_STATES` from `lib/gst/states.ts`; `formatCurrency` from
`lib/currency`.

## Routes and files

```
src/app/(superadmin)/admin/invoices/
  page.tsx                  server; requireFounder() -> notFound(); renders the list
  invoices-client.tsx       list: DataTable + data-table-filter-row + manage-columns
  new/page.tsx              server guard; renders <InvoiceForm mode="create">
  [id]/page.tsx             server guard; loads one row
  [id]/invoice-detail.tsx   detail + status actions + Print + WhatsApp
  [id]/edit/page.tsx        drafts only; an issued invoice is read-only
  invoice-form.tsx          the form (client)

src/app/(superadmin)/admin/invoice-settings/
  page.tsx                  server guard
  settings-form.tsx         seller details + signature/logo upload

src/app/print/invoice/[id]/
  page.tsx                  server; requireFounder() -> notFound(); A4 template
  download-button.tsx       mirrors print/proposal/[id]/download-button.tsx

src/app/api/admin/invoices/
  route.ts                  GET list, POST create (assigns seq + invoice_no)
  [id]/route.ts             GET, PATCH (draft edits + status changes), DELETE (draft only)
src/app/api/admin/invoice-settings/
  route.ts                  GET, PUT
```

Nav: `FOUNDER_NAV_ITEMS` in `admin-shell.tsx` gains `{ /admin/invoices, "Invoices", Receipt }`.
Invoice Settings is reached from a button on the invoice list, not its own nav row.

## Behaviour

**Creating.** Pick an account from a dropdown (fed by `/api/admin/companies`). Name, address,
pincode, state, `gst_state_code` and `gstin` pre-fill from `accounts.settings.company_profile`;
`plan` and seats pre-fill from `subscription_plan` and `user_count`. Every field stays editable. Pick
the term and a start date: `period_end` fills via `renewalDate(start, term)` minus one day, and stays
overridable. The plan line's rate and amount come from
`quote({ plan, users, term, discountPct, gstRate })`.

**GST.** Supplier state code is the first two digits of the settings GSTIN. Place of supply is the
first two digits of the buyer GSTIN, or the code of the state picked when the buyer has no GSTIN.
`gst_type` comes from `determineGstType()`. **An invoice cannot be issued with
`gst_type = 'unknown'` while `gst_enabled` is true** — the API rejects it with a message naming what
is missing, because the alternative is a document with a silently wrong tax split.

**Numbering.** On POST, the API reads `max(seq)` for that (`series`, `fy`), adds one, and builds the
number. The unique index is the real guard: on a `23505` collision the route retries once, then
returns the error. Single-user module, so contention is theoretical.

**Status.** Draft, then Issue (freezes the snapshot), then Mark Part Paid (amount received), then
Mark Paid (sets `paid_at`). Cancel is available from any non-terminal state and keeps the row and its
number. Transitions are validated in `lib/invoices/status.ts` **and** re-checked in the API.

**Print.** `/print/invoice/[id]` renders A4 with `@page { size: A4; margin: 0 }`, following the
proposal template. Two variants from one component: with GST it is titled **TAX INVOICE** and prints
both GSTINs, place of supply, SAC per line, the taxable value and the CGST/SGST or IGST rows; without
GST it is titled **INVOICE**, prints no GSTIN and no tax rows. Both print the service period, amount
in words, bank details, declaration, terms and the signature image.

**Sharing.** A WhatsApp button opens `https://wa.me/<phone>?text=...` pre-filled with the invoice
number, service period, amount and bank details. **It does not include a link to the print page** —
that page is behind `requireFounder()` and would not open for the customer. The founder downloads the
PDF and attaches it. A publicly readable tokenised invoice page is deliberately out of scope; if it
is wanted later it is a signed-token route, not a change to this design.

**List.** Columns: number, date, customer, plan, period, taxable value, tax, total, received,
balance, status. A filter row on each, per the house pattern (`data-table-filter-row.tsx`), with
money-range filters where the existing tables use them, plus series, status and FY selects. Footer
totals for total, received and balance.

---

# Part 2 — Renewal module

## Data model

### `platform_subscriptions` — the current period, one row per customer

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `customer_id` | text not null default `''` | Free text. Not a foreign key — a prospect need not be a tenant |
| `company_name` | text not null | |
| `plan` | text | Free text with a `PlanId` picker; free so a legacy or custom package can be recorded |
| `billing_term` | text null | `'quarterly'`, `'half_yearly'` or `'yearly'`, CHECK-constrained |
| `users` | integer not null default 0 | |
| `amount` | numeric(12,2) not null default 0 | Renewal value, for the "due this month" figure |
| `start_date` | date not null | |
| `end_date` | date not null | CHECK `end_date >= start_date` |
| `salesman_name` | text | Free text — the platform has no salesman record to pick from |
| `contact_person` | text | |
| `phone` | text | |
| `status` | text not null default `'active'` | `'active'`, `'renewed'`, `'in_discussion'`, `'lost'`, `'on_hold'` |
| `remarks` | text | |
| `follow_up_date` | date null | |
| `created_by`, `created_at`, `updated_at` | | touch trigger |

Indexes: `(end_date)` — the daily screen's only hot filter, `(status)`, `(company_name)`.

### `platform_subscription_periods` — history

`id`, `subscription_id` (to `platform_subscriptions` ON DELETE CASCADE), `plan`, `billing_term`,
`users`, `amount`, `start_date`, `end_date`, `renewed_at timestamptz`, `renewed_by`. Index on
`(subscription_id, start_date desc)`.

### `renew_platform_subscription(...)`

One SQL function so the archive-and-advance is atomic: it inserts the current period into
`platform_subscription_periods`, then updates the row with the new plan, term, users, amount, start
and end, and sets `status = 'active'`. Called by the API with the service role.
`SECURITY INVOKER`, `set search_path = public, pg_temp` — the project's convention for new functions.

## Routes and files

```
src/app/(superadmin)/admin/renewals/
  page.tsx                  server; requireFounder() -> notFound()
  renewals-client.tsx       tabs + tiles + table
  subscription-form.tsx     add / edit dialog
  renew-dialog.tsx          the renew action

src/app/api/admin/renewals/
  route.ts                  GET list (?bucket=today|overdue|7|30|all), POST create
  [id]/route.ts             GET (row + history), PATCH, DELETE
  [id]/renew/route.ts       POST -> renew_platform_subscription()

src/lib/renewals/
  buckets.ts + buckets.test.ts    todayInIST(), daysUntil(endDate), bucketOf(endDate)
  types.ts
```

Nav: `FOUNDER_NAV_ITEMS` gains `{ /admin/renewals, "Renewals", CalendarClock }`.

## Behaviour

**The daily screen** opens on **Due today**. Tabs: Today, Overdue, Next 7 days, Next 30 days, All.
Tiles above the table: count and rupee value for due today, overdue, and due this month.

**Bucketing** is date-only arithmetic against today in `Asia/Kolkata`, computed server-side in
`lib/renewals/buckets.ts` via `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })` to get
`YYYY-MM-DD`, then compared as strings against the `date` column. Buckets: `overdue`
(`end_date < today`), `today` (equal), `next_7` and `next_30` (within N days, inclusive). Rows with
status `lost` are excluded from the due tabs and tiles but remain under **All**.

**Renew** opens a dialog pre-filled with the next period: start is the old `end_date` plus one day,
with the same term, plan, users and amount, all editable; end is start plus the term's months, minus
one day, via `TERM_MONTHS`. On save the RPC archives and advances. The row's detail panel lists every
past period.

**Table.** Customer ID, company, plan, term, users, amount, start, end, days left, salesman, contact
person, phone, status, follow-up, remarks — with the house filter row and Manage Columns, so every
field is filterable and nothing is a dead filter. Row actions: Renew, Edit, WhatsApp, Call, Delete.
Days left renders as a coloured badge (overdue red, today amber, 7 days or fewer amber, else muted).

---

# Testing

**Unit (vitest; only files matching `src/**/*.test.ts(x)` are picked up — a `.spec.ts` is not):**

- `fy.ts` — 1 April and 31 March boundaries both ways; a January date lands in the previous FY.
- `number.ts` — both series; zero-padding at 1, 99 and 100; round-trip through `parseInvoiceNo`.
- `tax.ts` — intrastate halves, and the halves sum to the whole rate at odd amounts; interstate puts
  everything in IGST; `unknown` and non-GST give zeros; rounding never makes the printed rows
  disagree with the printed total.
- `totals.ts` — multi-line subtotal, percent and flat discount, and `amountInWords` across
  hundreds, thousands, lakhs and crores, plus zero and a value ending in a round hundred.
- `status.ts` — every legal transition passes and every illegal one is refused.
- `buckets.ts` — overdue, today, next_7 and next_30 at the IST day boundary, with a fake clock set to
  23:40 IST and to 00:10 IST, proving the result does not shift with the machine's timezone.

**Manual, on the real screens:** create a GST invoice for an intra-state tenant and an inter-state
one and check the tax rows; create a non-GST invoice and check no GSTIN or tax line prints; print
both to PDF; try to delete an issued invoice (it must refuse); add a renewal row, renew it, and
confirm the history line.

**Commands:** `npm test`, `npm run typecheck`, `npm run build` — real output pasted, per rule 6 of
the project rules.

# Migrations and deployment

Two migration files:

- `20261020120000_platform_invoices.sql` — `platform_invoices`, `platform_invoice_settings`, the
  delete-guard trigger, touch triggers, indexes, RLS-with-no-policies and the revokes.
- `20261020130000_platform_subscriptions.sql` — `platform_subscriptions`,
  `platform_subscription_periods`, `renew_platform_subscription()`, touch triggers, indexes,
  RLS-with-no-policies and the revokes.

**The founder applies both by hand.** The Supabase MCP connection can no longer reach the Mumbai
project (permission denied since 2026-10-16), so the SQL is handed over rather than applied from
here. Both screens stay dead until it runs. Code goes straight to `main`; Vercel deploys `main`.

Rollback notes go in `supabase/migrations/ROLLBACK-platform-invoices.md` and
`supabase/migrations/ROLLBACK-platform-subscriptions.md`, listing the drops, following the existing
ROLLBACK files.

# Build order

Invoices first, then renewals. They share no table, no library and no route, so the renewal module
can also be built in parallel in its own session without conflict.

# Open items

- **Series starting numbers.** If the founder has already issued invoices outside the app this
  financial year, the first number here must continue that series. `next_gst_seq_override` and
  `next_non_gst_seq_override` in Invoice Settings exist for this; the values are his to enter.
- **Seller details.** Firm name, address, GSTIN, PAN, bank account and signature image are typed into
  Invoice Settings after deployment. None of them are hardcoded, so the build does not wait on them.
