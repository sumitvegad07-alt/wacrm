# Feature Specification: Module Automations v1 (Business-Event WhatsApp Automations)

**Status:** Confirmed
**Module:** WhatsApp CRM (Engagement) — extending the existing Automations engine
**Date:** 2026-08-10
**Spec slug:** `module-automations-v1`

---

## 1. Feature Overview

### Problem

wacrm already contains a capable automation engine (`automations`, `automation_steps`,
`automation_logs`, `automation_pending_executions`, `src/lib/automations/engine.ts`, the
builder at `src/components/automations/automation-builder.tsx`). It supports 11 action
types, if/else branching, delayed steps resumed by cron, per-run logging and tenant
isolation.

**But it can only be started by a WhatsApp inbound event.** Its seven trigger types
(`new_message_received`, `first_inbound_message`, `keyword_match`, `new_contact_created`,
`conversation_assigned`, `tag_added`, `time_based`) are all dispatched from exactly two
places: `src/app/api/whatsapp/webhook/route.ts` (lines 693 and 770) and the manual
`POST /api/automations/engine` route.

Nothing in the business modules — Orders, Dispatches, Customers, Leads, Deals — can start an
automation. Verified in production (project `gxurqwpfvfktmreqmzqb`): **0 rows in
`automations`, 0 in `automation_steps`, 0 in `automation_logs`.** The engine has never run.

So today, when a distributor places an order or a dispatch goes out, nobody is told
automatically. Every confirmation message is typed by hand or not sent at all.

### Business justification

Order confirmation and dispatch notification over WhatsApp is the single most requested
capability in Indian distribution/FMCG software, and it is the reason a customer keeps paying
for a WhatsApp CRM rather than a spreadsheet. It converts wacrm from a system of *record*
into a system of *communication*: the dealer hears from the business automatically at the
three moments that matter (welcome, order taken, goods dispatched).

It also sets up the Automation Add-on tier described in the product bible, and the future
actions (SMS, auto-create activity, update field) plug into the same rails.

### Target use case / industries

Distribution, FMCG, building materials, agri-inputs — any business where a field rep books an
order at a dealer counter and the dealer wants to know it was received and when it ships.

**Worked example (founder's own):** "Send a welcome WhatsApp to every newly created customer,
but only for customers in Gujarat, because that's my current focus area." Module = Customer,
Event = Customer created, Action = send approved WhatsApp template, Send to = Customer,
Conditions = `state equals Gujarat`.

### Gating condition

This feature only functions for accounts with Meta WhatsApp Business API access configured
(a row in `whatsapp_config`). Accounts without it must see the module disabled with a clear
explanation, not a broken form. Founder decision, 2026-08-10: business-initiated template
messages are billed by Meta per conversation, and this cost is disclosed to the end customer.

---

## 2. Scope

### In scope

**Event capture (the new part)**
- A durable event outbox table `automation_events`, written by Postgres row triggers on
  `contacts`, `orders`, and `order_dispatches`.
- A worker endpoint that drains the outbox and dispatches into the existing engine.
- Four new trigger types: `customer_created`, `order_created`, `order_status_changed`,
  `dispatch_created`.

**Automation configuration**
- Module filter + "Add Automation" on the existing `/automations` page.
- Form fields matching the founder's design: Name, Module, Event, Action, WhatsApp template,
  Send to (multi-select), Conditions.
- Condition rows: Field, Operator, Value, Relation with next rule (AND/OR), Rule number.
- A **Condition Format** expression box supporting explicit grouping, e.g. `1 AND (2 OR 3)`.
- Nine operators: `is_null`, `is_not_null`, `exist_in`, `not_exist_in`, `equals`,
  `not_equals`, `greater_than`, `less_than`, `contains`.
- Conditions may reference fields on the triggering record **and on its related customer**
  (required by the founder's Gujarat example — an Order event filtered on the customer's
  state).

**Recipients**
- Configurable per automation, multi-select. Available options vary by event.
- v1 recipient types: `customer` (the customer on the record), `creator` (the employee who
  created the record), `creator_manager` (that employee's manager, via `profiles.manager_id`),
  `fixed_number` (a number typed by the admin).

**Action**
- One action in v1: **send an approved WhatsApp template**, with each template variable
  (`{{1}}`, `{{2}}`, …) mapped to a field by the admin.

**Safety**
- **Test mode / Preview** — pick a real record, see exactly which recipients would be
  messaged, at which phone numbers, with the template fully rendered. Sends nothing.
- **Master kill switch** — one account-level toggle that stops all automation sending
  immediately.
- Idempotency so a worker retry cannot double-send.
- Late-event cutoff of **12 hours** (founder decision).

**Bundled fixes (v1 cannot work without them)**
1. `resolveConversationId` (`src/lib/automations/engine.ts:566-579`) currently throws
   `no conversation for contact` when a customer has never messaged in. That is every newly
   created customer, so the founder's own primary use case fails on the first run. It must
   create the conversation on demand.
2. `automation_pending_executions` has RLS enabled with **zero policies** (independently
   confirmed; already logged in the backlog). Add read policies so the delayed-step queue is
   inspectable from the app.
3. Add `client_created_at` to `contacts` and `orders` so the 12-hour cutoff is meaningful for
   offline-created records — see §4.4 for why this is required, not optional.

### Out of scope

- **Customer Outstanding module and its events.** Verified: there is no payments, invoices,
  receipts or ledger table anywhere in the production schema. Outstanding balance is not
  recorded in wacrm. It cannot be automated until the module exists.
- **"Send to → Parent customer".** Verified: `contacts` has `hierarchy_level` (an integer
  rank) but no `parent_customer_id`. `parent_id` exists on `territories`,
  `product_categories` and `quotations`, but not on customers. The distributor→dealer tree
  does not exist. Being built as a separate prerequisite task (see §10).
- Lead and Deal events — deferred to v2 once the rails are proven.
- Actions other than WhatsApp template: SMS, auto-create activity, update field.
- Customer Visit and Customer Follow-up events.
- Loop guard. Deliberately deferred: in v1 the only action is *send a message*, so an
  automation cannot modify a record and therefore cannot re-trigger itself. **This becomes a
  hard prerequisite the day an "update field" action is added** — recorded in §10.
- Daily send cap. Dropped for v1 at current scale (27 customers); the kill switch covers the
  emergency case.
- Any mobile UI. Mobile is an *event source* only (see §6).
- Free-text WhatsApp messages from automations. Meta only permits free-form text inside a
  24-hour customer-initiated service window; every event in this spec is business-initiated,
  so an approved template is mandatory. This is a Meta platform rule, not a wacrm choice.

---

## 3. User Roles & Permissions

| Role | Can see | Can do | Tenancy / RLS implications |
|---|---|---|---|
| **Owner** | All automations, all logs, all events | Create, edit, activate, delete, run Preview, toggle the kill switch | Full within `account_id` |
| **Admin** | All automations, all logs, all events | Same as Owner | Full within `account_id` |
| **Agent** | Nothing — the Automations nav entry is hidden | Nothing | Read blocked by RLS, not just hidden in UI |
| **Viewer** | Nothing | Nothing | Read blocked by RLS |

Implementation:
- Add a new `CanAction` value `"manage-automations"` to `src/hooks/use-can.ts` and a matching
  predicate in `src/lib/auth/roles.ts`. Follow the exhaustiveness-check pattern already in
  that file. Map to Owner + Admin only.
- Enforce in **both** the UI (via `useCan` / `GatedButton`) **and** the API routes (re-check
  `account_role` server-side before any write). UI-only gating is explicitly insufficient
  here: this feature can message every customer in the account.

**Known context Antigravity must not try to fix in this spec:** the account's granular
permission data is stored in two inconsistent formats (nested vs flat) and granular checks
are unreliable for non-admin users app-wide. This is a tracked, separate deadline item.
Because this spec gates on `account_role` (the reliable Postgres enum) rather than the
JSONB business-role permissions, it is unaffected. **Do not** wire this feature to
`employee_roles.permissions`.

---

## 4. Data Model

### 4.1 New table: `automation_events` (the outbox)

```sql
CREATE TABLE IF NOT EXISTS automation_events (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  module             text NOT NULL,   -- 'customer' | 'order' | 'dispatch'
  event_type         text NOT NULL,   -- 'customer_created' | 'order_created'
                                      -- | 'order_status_changed' | 'dispatch_created'
  record_id          uuid NOT NULL,
  -- Denormalised so the worker never has to re-read a row that may have
  -- changed again since the event fired. This is what makes replay honest.
  record_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_snapshot  jsonb,           -- OLD row on update events, else NULL
  changed_fields     text[],          -- populated on update events only
  -- Business time, NOT insert time. Drives the 12-hour cutoff. See §4.4.
  occurred_at        timestamptz NOT NULL,
  enqueued_at        timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'pending',
                                      -- 'pending'|'processing'|'done'|'skipped'|'failed'
  skip_reason        text,            -- e.g. 'stale', 'kill_switch', 'no_matching_automation'
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  processed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS automation_events_drain_idx
  ON automation_events (status, occurred_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS automation_events_account_idx
  ON automation_events (account_id, enqueued_at DESC);
```

**RLS:** enable. One SELECT policy using `is_account_member(account_id, 'admin')`. **No
INSERT/UPDATE/DELETE policies for clients** — rows are written only by `SECURITY DEFINER`
triggers and updated only by the service-role worker. This fails closed by design.

### 4.2 New table: `automation_event_deliveries` (idempotency)

Prevents a worker retry, a duplicate cron invocation, or an overlapping drain from sending
the same WhatsApp message twice. A duplicate order confirmation is a customer-trust problem
and a billed Meta message.

```sql
CREATE TABLE IF NOT EXISTS automation_event_deliveries (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES automation_events(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  recipient_key text NOT NULL,   -- e.g. 'customer:<uuid>' or 'phone:+919999999999'
  status        text NOT NULL,   -- 'sent' | 'failed' | 'skipped'
  detail        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, automation_id, recipient_key)
);
```

The worker **inserts the delivery row before calling Meta**, relying on the unique
constraint. A conflict means someone already handled this recipient — skip. Then update the
row's status after the send returns.

**RLS:** enable, SELECT for admins of the account, no client writes.

### 4.3 Changes to existing tables

**`automations`** — no schema change. New values in the existing `trigger_type` text column:
`customer_created`, `order_created`, `order_status_changed`, `dispatch_created`.

**`automation_logs`** — add `event_id uuid REFERENCES automation_events(id)` (nullable, so
existing WhatsApp-triggered logs are unaffected). Lets the logs page answer "which business
event caused this message?".

**`contacts`, `orders`** — add `client_created_at timestamptz` (nullable). See §4.4.

**`accounts.settings` (jsonb)** — add an `automation_settings` object. This follows the
existing precedent in that column (`order_settings`, `route_settings`, `territory_settings`):

```json
{
  "automation_settings": {
    "enabled": true,
    "stale_event_hours": 12
  }
}
```

`enabled: false` is the master kill switch. **Absent means enabled** — a missing key must not
silently disable a working account.

### 4.4 `occurred_at` and why `client_created_at` is required

The founder decided: *send on sync, but skip if the event is older than 12 hours.* That rule
is only enforceable if we know when the record was really created.

**It currently isn't knowable.** `orders.created_at` and `contacts.created_at` both default to
`now()` — the moment the row lands in Postgres. An order written offline in a village at
9am and synced at 3pm gets `created_at = 3pm`. To the system it looks brand new, the cutoff
never fires, and the customer receives "Order received!" six hours late — exactly the outcome
the decision was meant to prevent. The `create_order` RPC signature
(`p_order_id, p_account_id, p_contact_id, p_site_visit_id, p_date, p_lines, …`) carries a
`p_date` **date** but no creation timestamp.

Therefore, in scope:

1. Add `client_created_at timestamptz` (nullable) to `contacts` and `orders`.
2. Mobile stamps it from the device clock at the moment the user taps Save, before the
   mutation is queued in `SyncEngine`.
3. `create_order` gains a `p_client_created_at timestamptz DEFAULT NULL` parameter.
   **Adding a parameter with a default changes the function signature** — every existing
   caller must be checked. A previous migration (076) nearly shipped a broken web
   lead-conversion button for exactly this reason. Search for all `create_order` callers on
   web and mobile before applying.
4. The trigger computes:
   `occurred_at := LEAST(COALESCE(NEW.client_created_at, NEW.created_at, now()), now())`

   The `LEAST(..., now())` clamp is deliberate: a device with a wrong clock set to next year
   must not produce an event that is permanently "in the future" and never expires.

5. Devices with badly skewed clocks are handled by the clamp above plus the worker treating
   any `occurred_at` more than `stale_event_hours` in the past as stale.

**`order_dispatches` needs no such column** — dispatches are created from the web back
office, online.

### 4.5 The triggers

One `AFTER INSERT`/`AFTER UPDATE` trigger function per table, `SECURITY DEFINER`, writing
into `automation_events`. This is the architectural centre of the feature.

**Why database triggers rather than application code:** an order or customer can be created
from the web form, the mobile app, the `create_order` RPC, an offline mutation replayed hours
later by `SyncEngine`, or the public `/api/v1/` API. Application hooks would have to be added
to each of those, and to every path added in future; one missed path means a customer
silently never receives their message. A row trigger is the one place every write must pass
through. It also survives a crash mid-process — the event sits in the outbox until drained.
Founder decision, 2026-08-10.

```sql
-- customer_created
CREATE OR REPLACE FUNCTION emit_customer_created_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO automation_events (
    account_id, module, event_type, record_id, record_snapshot, occurred_at
  ) VALUES (
    NEW.account_id, 'customer', 'customer_created', NEW.id, to_jsonb(NEW),
    LEAST(COALESCE(NEW.client_created_at, NEW.created_at, now()), now())
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_emit_customer_created
  AFTER INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION emit_customer_created_event();
```

`order_created` mirrors this on `orders`.

`dispatch_created` mirrors it on `order_dispatches`, additionally resolving
`orders.contact_id` via `order_id` and storing it in `record_snapshot` under a
`_resolved_contact_id` key so the worker does not need a second query.

`order_status_changed` is an `AFTER UPDATE` trigger that emits **only when
`NEW.status IS DISTINCT FROM OLD.status`**:

```sql
CREATE TRIGGER trg_emit_order_status_changed
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION emit_order_status_changed_event();
```

This is the founder's "only fire when a watched field changes" decision enforced at the
lowest possible level: an order edited five times for notes, quantities or discounts emits
**zero** events. Only a genuine status transition emits one, carrying `previous_snapshot` and
`changed_fields = ARRAY['status']` so a template can say "moved from Placed to Dispatched".

**Trigger discipline (non-negotiable):**
- A trigger must never raise. If the INSERT into `automation_events` fails, it must not roll
  back the customer's order. Wrap the body in `BEGIN … EXCEPTION WHEN OTHERS THEN
  RAISE WARNING …; RETURN NEW; END`. A lost automation is annoying; a lost order is a
  business incident.
- Triggers do no network I/O and no heavy computation — one INSERT, nothing else.

### 4.6 Migration notes

- Single migration file, timestamp convention per the repo:
  `supabase/migrations/20260810120000_automation_module_events.sql`
  (the latest existing file is `20260810090000_dense_location_trace.sql`).
- Everything additive. `IF NOT EXISTS` throughout. No column is dropped or renamed.
- **Existing data is untouched and no events are backfilled.** The 27 existing customers, 19
  orders and 2 dispatches must NOT produce events — backfilling would WhatsApp every historic
  customer. Triggers only fire on writes after the migration is applied.
- Write a rollback note file alongside it following the existing convention
  (`ROLLBACK-territory-master.md`, `ROLLBACK-reporting-hierarchy.md`).
- `set_updated_at` is not needed on `automation_events` (append-mostly, no `updated_at`).

---

## 5. API Contract

All new routes are Next.js Route Handlers. **Every input must be validated with `zod`** — the
existing `src/app/api/automations/route.ts` does manual checks; new code must not copy that.
Never leak a raw Postgres error to the client.

### 5.1 `GET /api/automations/field-catalog?module=order`

Returns the field list that populates the Conditions "Field" dropdown and the template
variable mapper.

**Response**
```ts
{
  groups: Array<{
    key: 'order' | 'customer' | 'dispatch',
    label: string,                    // "Order fields" | "Customer fields"
    fields: Array<{
      key: string,                    // 'order.total_amount', 'customer.state',
                                      // 'customer.custom:<uuid>'
      label: string,                  // "Order Total", "State"
      type: 'text'|'number'|'date'|'select'|'phone'|'email'|'boolean',
      options?: string[]              // for 'select'
    }>
  }>
}
```

**Source and the trap.** `custom_fields` already registers system fields per module with a
`system_key` (production: 123 for `contact`, 96 for `lead`, 34 for `order`, 32 for
`dispatch`, 18 for `deal`) — reuse it, do not invent a new registry.

**However it cannot be trusted blindly.** Live inspection found registered entries whose
`system_key` does not correspond to a real column: `contact.type`, `contact.status`,
`order.valid_until`, `order.delivery_date`, `order.payment_terms`. There are also two
distinct `order` entries both labelled "Order Date" (`order_date` and `date`).

Therefore: maintain an explicit whitelist in `src/lib/automations/field-catalog.ts` mapping
each allowed `system_key` to its real column, and **intersect** the `custom_fields` rows
against it. Anything registered but not whitelisted is omitted from the dropdown. Log a
one-line warning listing omissions so the mismatch stays visible rather than silently
mysterious.

Custom (non-system) fields — `custom_fields.source_type = 'module'` — are exposed as
`custom:<custom_field_id>` and resolved from `contact_custom_values` /
`order_custom_values` / `dispatch_custom_values`.

**Related-record fields are required, not optional.** The founder's own example filters an
Order event on the customer's state. So for `module=order` the catalog returns both an
`order` group and a `customer` group; for `module=dispatch`, `dispatch` + `order` +
`customer`. For `module=customer`, just `customer`.

### 5.2 `GET /api/automations/events?module=&status=&limit=`

Admin-only. Recent rows from `automation_events` with their delivery outcomes — the "why
didn't my customer get a message?" screen.

**Response:** `{ events: AutomationEventRow[] }`
**Errors:** 401 unauthenticated · 403 not Owner/Admin.

### 5.3 `POST /api/automations/[id]/preview` — Test mode

**Request**
```ts
{ record_id: string }   // a real customer / order / dispatch id
```

**Response**
```ts
{
  event_type: string,
  record_label: string,             // "ORD-0019 — Shree Traders"
  conditions: {
    passed: boolean,
    expression: string,             // "1 AND (2 OR 3)"
    rules: Array<{
      id: number, field: string, operator: string,
      value: unknown, actual: unknown, passed: boolean
    }>
  },
  recipients: Array<{
    type: 'customer'|'creator'|'creator_manager'|'fixed_number',
    label: string,                  // "Shree Traders" / "Ramesh (Sales)"
    phone: string | null,
    reachable: boolean,
    reason?: string                 // "no phone number saved on this employee"
  }>,
  rendered: {
    template_name: string,
    language: string,
    body_preview: string,           // variables substituted
    variables: Record<string, string>
  },
  would_send: boolean,
  blockers: string[]                // e.g. ["automations are switched off for this account"]
}
```

**Sends nothing. Calls no Meta endpoint. Writes no `messages` row.** Reads only.
**Errors:** 400 invalid body · 401 · 403 · 404 automation or record not found ·
422 record does not match the automation's module.

### 5.4 `GET /api/automations/events/cron` — the worker

Follows the security pattern already established in
`src/app/api/automations/cron/route.ts`: requires header `x-cron-secret` matching
`AUTOMATION_CRON_SECRET`; returns 503 if the secret is unset, 401 if it does not match.
There is no `vercel.json` in this repo — cron is an external pinger, so the new endpoint must
be documented for whoever configures the schedule. **Recommended interval: every 1 minute.**

**Algorithm**
1. Select up to 50 `automation_events` where `status = 'pending'`, **ordered by `occurred_at`
   ascending**. Ascending order is what keeps a customer's order confirmation ahead of its
   dispatch notification.
2. Claim each row with `UPDATE … SET status='processing' WHERE id=$1 AND status='pending'
   RETURNING id`. A null result means another invocation already claimed it — skip. Same
   two-step claim lock the existing cron uses.
3. **Kill switch:** if `accounts.settings->'automation_settings'->>'enabled'` is exactly
   `'false'`, mark `skipped` with `skip_reason='kill_switch'`. A missing key means enabled.
4. **Staleness:** if `now() - occurred_at > stale_event_hours` (default 12), mark `skipped`
   with `skip_reason='stale'`. Recorded, never silently dropped.
5. Load active automations: `account_id` matches, `trigger_type = event_type`,
   `is_active = true`. None → `done`, `skip_reason='no_matching_automation'`.
6. Assemble the evaluation context (§5.5).
7. Evaluate conditions (§5.6). Fail → record the outcome and continue to the next automation.
8. Resolve recipients (§5.7).
9. For each recipient: insert into `automation_event_deliveries` first (unique constraint =
   the idempotency guard), then send, then update that row's status.
10. Mark the event `done`. On an unexpected throw, increment `attempts`, store `last_error`,
    and return it to `pending` — **unless `attempts >= 3`, in which case mark `failed`.**

    This deliberately does not repeat the `RetryHandler` defect already tracked in the
    backlog, where an operation that exceeded max retries was `continue`d and left in the
    queue forever, invisible. Failed events here are terminal, visible in the events screen,
    and never retried silently.

**Response:** `{ processed: number, skipped: number, failed: number }`

### 5.5 Evaluation context

```ts
interface EventContext {
  customer?: Record<string, unknown>   // the contacts row
  order?: Record<string, unknown>      // the orders row
  dispatch?: Record<string, unknown>   // the order_dispatches row
  creator?: { user_id, full_name, phone, manager_id }
  previous?: Record<string, unknown>   // OLD row on change events
  changed_fields?: string[]
}
```

Built from `record_snapshot` plus **at most one** additional query per related record. No
N+1: for a batch of 50 events, gather the distinct related ids and fetch them in a single
`in()` query per table.

### 5.6 Condition evaluation

Stored on the automation row inside `trigger_config`:

```ts
{
  module: 'order',
  conditions: {
    rules: [
      { id: 1, field: 'customer.state', operator: 'equals',   value: 'Gujarat' },
      { id: 2, field: 'customer.city',  operator: 'exist_in', value: ['Rajkot','Morbi'] },
      { id: 3, field: 'order.total_amount', operator: 'greater_than', value: 50000 }
    ],
    expression: '1 AND (2 OR 3)'
  }
}
```

**Operators**

| Operator | Meaning | Value shape |
|---|---|---|
| `is_null` | field is empty or not set | none |
| `is_not_null` | field has any value | none |
| `exist_in` | field matches one of a list | `string[]` |
| `not_exist_in` | field matches none of a list | `string[]` |
| `equals` | exact match | scalar |
| `not_equals` | not an exact match | scalar |
| `greater_than` | numeric/date comparison | number or ISO date |
| `less_than` | numeric/date comparison | number or ISO date |
| `contains` | substring, case-insensitive | string |

Text comparison for `equals` / `not_equals` / `exist_in` / `not_exist_in` is
**case-insensitive and trimmed**. "gujarat", "Gujarat " and "Gujarat" must all match — real
data is entered by field reps on phones. `greater_than` / `less_than` coerce both sides to
number, or to Date when the catalog says the field type is `date`; a failed coercion makes
the rule evaluate `false` and appends a note to the log, never throws.

**The expression parser.** `expression` is a string like `1 AND (2 OR 3)`. Implement a small
recursive-descent parser in `src/lib/automations/condition-expression.ts`.

- Grammar: `expr := term (OR term)*` · `term := factor (AND factor)*` ·
  `factor := NUMBER | '(' expr ')'`
- Tokens permitted: integers, `AND`, `OR`, `(`, `)`. Case-insensitive keywords.
- **Never use `eval()`, `new Function()`, or any dynamic code execution.** This string is
  admin-supplied and reaches a service-role code path. A parser that only understands four
  token types cannot be turned into code execution.
- Reject at save time, with a specific message: unknown tokens, unbalanced parentheses, a
  rule number that has no matching rule, or a rule that exists but is unreferenced.
- If `expression` is empty or absent, fall back to evaluating the rules left-to-right using
  each rule's `relation_with_next` (`AND`/`OR`), matching the simple builder rows. **AND
  binds tighter than OR**, as in the parser, so the two paths never disagree.
- Zero rules = the automation always fires. That is legitimate ("welcome every new customer")
  and must not be treated as a validation error.

Unit tests are mandatory for this file (see §11).

### 5.7 Recipient resolution

| Type | Resolution | Fails when |
|---|---|---|
| `customer` | `contacts.phone` of the customer on the record | no customer linked, or phone invalid |
| `creator` | `profiles.phone` where `user_id = record.user_id` | employee has no phone saved |
| `creator_manager` | follow `profiles.manager_id`, then that profile's `phone` | no manager set, or manager has no phone |
| `fixed_number` | the E.164 number typed by the admin | never (validated at save time) |

**Employee phone field:** use `profiles.phone`. Verified in production: of 13 profiles, 3
have `phone` populated and **`profiles.mobile` is empty for all 13** — it is a dead column.
Do not read `mobile`, and do not write to it.

**Consequence the UI must surface:** picking `creator` today silently reaches nobody for 10
of 13 employees. Both the builder and Preview must warn explicitly when a selected recipient
type has unreachable members, naming them. Silent non-delivery is the worst failure mode this
feature can have.

Every resolved number passes through the existing `sanitizePhoneForMeta` / `isValidE164`
helpers in `src/lib/whatsapp/phone-utils.ts`. Duplicate numbers within one event are
de-duplicated before sending — if the creator *is* the customer's saved contact number, that
is one message, not two.

### 5.8 Sending

Extend, do not replace, `src/lib/automations/meta-send.ts`.

**Customer recipients** keep the existing behaviour: send the template, insert a `messages`
row with `sender_type='bot'`, update `conversations.last_message_*`. The message belongs in
the customer's inbox thread.

**Non-customer recipients (`creator`, `creator_manager`, `fixed_number`)** need a new function
`engineSendTemplateToPhone({ accountId, phone, templateName, language, params })` that sends
via Meta and **does not create a conversation or a `messages` row**.

Rationale: conversations are keyed to `contacts`, and employees are not contacts. Creating
contact rows for staff would pollute the customer list, corrupt customer counts, and put
internal alerts into the customer inbox. Internal notifications are recorded in
`automation_event_deliveries` and `automation_logs` instead — which is where an admin looks
for them anyway.

**Template variables.** Meta templates use positional `{{1}}`, `{{2}}`, … placeholders. The
existing engine already sorts these numerically rather than lexicographically
(`engine.ts:369-382`) — a real bug fix that stops `{{10}}` landing between `{{1}}` and
`{{2}}`. **Reuse that code path; do not write a new sort.**

The admin maps each variable to a field key from the catalog, or types a literal. At send
time, unresolvable variables become an empty string and add a warning line to the log — Meta
rejects a template call with a missing positional parameter, so an empty string is safer than
a gap.

### 5.9 Changes to existing API routes

`POST /api/automations` and `PUT /api/automations/[id]` accept the new trigger types and
validate the new `trigger_config` shape (module, event, conditions, recipients, template,
variables). Extend `validateTriggerForActivation` in `src/lib/automations/validate.ts`,
following its existing `ValidationIssue { path, message }` shape so the builder can highlight
the offending row. Activation must be refused when:

- the account has no `whatsapp_config` row
- the chosen template is missing, or its `message_templates.status` is not approved
- a condition references a field not in the catalog for that module
- the condition expression is malformed
- no recipients are selected
- a `fixed_number` recipient is not valid E.164

---

## 6. Mobile Behavior

**No mobile UI is built in this spec.** Automations are configured on web by Owner/Admin, and
the WhatsApp module has no mobile presence today.

Mobile matters here as an **event source**, and it is precisely why the database-trigger
design was chosen: an order created offline on a rep's phone is replayed later by
`SyncEngine` as an ordinary insert, so the trigger fires with no mobile-side automation code
at all. Nothing needs wiring into `SyncEngine.enqueueMutation` for events to be captured.

**The one mobile change required** is the `client_created_at` stamp from §4.4:

- In the mobile create paths for contacts and orders, set `client_created_at` from the device
  clock at the moment the user taps Save — **before** the mutation enters the `SyncEngine`
  queue, not at flush time. Stamping at flush would record the sync time and defeat the
  purpose.
- Order creation goes through the `create_order` RPC, so it travels as an RPC parameter, not
  a column write.
- Handbook check completed: mobile has no local database (no SQLite, no WatermelonDB —
  WatermelonDB is installed on the *web* repo only). `SyncEngine` covers `site_visits`,
  `activities`, `tracking_sessions`, `location_pings`, and contact create/edit. No local
  schema change is needed — `client_created_at` is one more field in an existing payload.
- Verify this against the live repo before coding. The handbook's offline section has been
  substantively wrong twice.

**Airplane-mode behaviour:** unchanged and correct by construction. The rep saves offline,
the record queues, and when it syncs the trigger fires. If it syncs within 12 hours the
customer is messaged; beyond that the event is recorded as `skipped/stale` and visible in the
events screen. No mobile-side failure path exists because mobile never talks to the
automation engine.

**Battery / network:** no new polling, no new background work, no new permissions.

---

## 7. UI States

All screens are web, dark-mode-first, Shadcn components only, no raw `<button>`/`<input>`.

### 7.1 `/automations` (extend the existing page)

| State | Behaviour |
|---|---|
| Loading | Skeleton rows, matching the current page's existing loading treatment |
| Empty (no automations) | Existing starter-template cards remain, plus a "Create your first automation" call to action |
| Populated | Existing list, plus a **Module filter** (All · Customer · Order · Dispatch · WhatsApp) and a module pill on each row alongside the existing trigger pill |
| No WhatsApp configured | Module automations section disabled, with: "Connect WhatsApp Business API in Settings to use automations." Link to the settings page. Never a silent empty list |
| No approved templates | "Add Automation" stays enabled but the form blocks at the template field with: "You need at least one Meta-approved WhatsApp template. Create one in Settings → Templates." Deep link provided |
| Permission denied (Agent/Viewer) | Nav entry hidden; direct URL access returns the standard not-authorised treatment |
| Kill switch on | Persistent amber banner: "Automation sending is switched off for this account. Automations will not send." with a link to the toggle |

New trigger pills in `src/lib/automations/trigger-meta.ts` (matching the existing
`{ label, pillClass }` shape): Customer Created · Order Created · Order Status Changed ·
Dispatch Created.

### 7.2 The Add / Edit Automation form

Layout follows the founder's reference screenshot exactly, in this order:

1. **Name** (required, text)
2. **Module** (required, select: Customer · Order · Dispatch)
3. **Event** (required, select — **options depend on Module**; disabled with "Select a module
   first" until Module is chosen)
   - Customer → Customer created
   - Order → Order created · Order status changed
   - Dispatch → Dispatch created
4. **Action** (required, select — only "Send WhatsApp message" in v1; rendered as a select,
   not hardcoded text, so v2 actions slot in without a redesign)
5. **WhatsApp template** (required, select from approved `message_templates`) — selecting one
   reveals a **variable mapper**, one row per `{{n}}` in the template body, each mapping to a
   catalog field or a literal
6. **Send to** (required, multi-select chips exactly as in the screenshot) — options depend on
   Module + Event. Choosing `fixed_number` reveals a phone input validated as E.164.
   An inline warning appears immediately when a chosen type has unreachable members:
   "3 of 13 employees have no phone number saved — they will not receive this."
7. **Condition(s)** — a table with columns Field · Operator · Value · Relation with next rule
   · Rule (number) · delete. "ADD RULE" button beneath. Draggable row handles for reordering,
   matching the screenshot.
   - Field: grouped select from `/api/automations/field-catalog`
   - Operator: the nine operators; `is_null`/`is_not_null` hide the Value input
   - Value: input type follows the field type — free text, number, date picker, or a
     multi-value chip input for `exist_in`/`not_exist_in`
   - Rule numbers renumber automatically on delete or reorder, **and the expression box is
     rewritten in step** so it can never reference a rule that no longer exists
8. **Condition format** — the boxed summary with an edit (pencil) affordance from the
   screenshot. Read-only by default showing the derived expression; the pencil makes it
   editable for grouping like `1 AND (2 OR 3)`. Invalid input shows an inline error and
   blocks save-as-active — but still allows save as draft
9. **Preview (Test mode)** button — opens a dialog, admin picks a real record, sees the §5.3
   result. Prominent, next to Save
10. **Save as draft** / **Save & activate**

| Form state | Behaviour |
|---|---|
| Loading catalog/templates | Fields disabled with a spinner; never an empty dropdown that looks like "no options exist" |
| Validation errors | Inline, on the specific row, driven by `ValidationIssue.path` |
| Save in progress | Button spinner, form locked |
| Save failed | Toast with a sanitised message; entered values preserved |
| Draft (incomplete) | Allowed to save incomplete, consistent with existing behaviour |
| Offline / network error | Toast; nothing silently lost |

### 7.3 Events screen (`/automations/events`)

Admin-only. A `DataTable` (reuse `src/components/ui/data-table/`) with columns: When ·
Module · Event · Record · Status · Automations matched · Recipients reached · Reason. Filter
by status and module. Row expands to show each delivery and its outcome.

Empty state: "No automation events yet. Events appear here when a customer, order or dispatch
is created." — not a bare empty grid.

This screen exists because the first question after "why didn't my customer get a message?"
must be answerable in ten seconds without database access.

### 7.4 Settings toggle

Settings → Workspace → a new **Automations** card holding the master kill switch, following
the existing Expense Policies card pattern. Copy: "Pause all automation sending. Automations
stay configured but send nothing until switched back on."

---

## 8. Edge Cases & Failure Scenarios

| # | Scenario | Expected behaviour | Severity |
|---|---|---|---|
| 1 | Customer created who has never messaged in (no `conversations` row) | Conversation created on demand, template sent. **This is the founder's primary use case and fails today** at `engine.ts:577` | **Blocker** |
| 2 | Customer has no phone, or an invalid one | Delivery recorded `skipped` with the reason; other recipients still receive | Warning |
| 3 | Employee recipient has no `profiles.phone` (10 of 13 today) | `skipped` with reason; admin warned at build time and in Preview | Warning |
| 4 | Offline order syncs 6 hours later | Sends, `occurred_at` from `client_created_at` | Info |
| 5 | Offline order syncs 20 hours later | `skipped`, `skip_reason='stale'`, visible in the events screen | Info |
| 6 | Order edited 5 times (notes, quantity, discount) | **Zero** events — the trigger fires only on a status change | Info |
| 7 | Order status changed twice quickly (Placed→Packed→Dispatched) | Two events, processed in `occurred_at` order, two messages | Info |
| 8 | Worker crashes mid-event | Event stays `processing`; a sweeper returns rows stuck >10 min to `pending`; `automation_event_deliveries` prevents re-sending anyone already sent | **Blocker** |
| 9 | Two cron invocations overlap | Claim-by-update lock plus the delivery unique constraint make a double-send impossible | **Blocker** |
| 10 | Meta API returns an error | Delivery `failed` with the message; event retried up to 3 attempts, then terminal `failed` — never an invisible zombie | Warning |
| 11 | Meta rate limit hit | Treated as retryable; event returns to `pending` with `attempts+1` | Warning |
| 12 | Template deleted or un-approved at Meta after the automation was activated | Send fails, delivery `failed`, automation flagged in the list with a "template unavailable" badge | Warning |
| 13 | Condition references a field later deleted from `custom_fields` | Rule evaluates `false`, log notes the missing field; automation is not deleted | Warning |
| 14 | Condition expression references a nonexistent rule number | Rejected at save; cannot be activated | Warning |
| 15 | Admin types `1 AND (2 OR` (unbalanced) | Inline parse error, save-as-active blocked, draft still allowed | Warning |
| 16 | Zero condition rules | Automation always fires — legitimate, not an error | Info |
| 17 | Kill switch on | Events `skipped`, `skip_reason='kill_switch'`, banner shown. Events are not lost — but note they are **not** replayed when switched back on | Info |
| 18 | Account has no `whatsapp_config` | Module disabled with an explanatory message; no events processed | Info |
| 19 | Customer deleted between event emission and processing | Delivery `skipped`, reason "record no longer exists"; no throw | Warning |
| 20 | Device clock set to the future | `LEAST(..., now())` clamp prevents a permanently-unexpiring event | Warning |
| 21 | Same phone resolves for two recipient types | De-duplicated — one message | Info |
| 22 | Trigger's INSERT into `automation_events` fails | Warning raised, `RETURN NEW` — **the order still saves** | **Blocker** |
| 23 | Cross-tenant: forged `record_id` in a Preview request | Preview loads the record scoped by `account_id`; foreign id returns 404 | **Blocker** |
| 24 | Agent calls the automations API directly with Postman | 403 — enforced server-side, not just hidden in the UI | **Blocker** |
| 25 | Bulk import creates 500 customers at once | 500 events queued; worker drains 50/min; kill switch is the escape hatch. **Flag to the founder before any bulk import** | Warning |
| 26 | Dispatch created for an order with no customer | Customer recipient `skipped` with reason; employee recipients still receive | Warning |
| 27 | Automation deleted while its events are queued | `ON DELETE CASCADE` on deliveries; the event completes with no matching automation | Info |

---

## 9. Reuse Check

**Antigravity must read these files before writing any new code:**

*Automation engine (extend — do not rebuild)*
- `src/lib/automations/engine.ts` — dispatch, step execution, `resolveConversationId` (the
  §8.1 fix), the positional-variable sort at lines 369-382
- `src/lib/automations/meta-send.ts` — extend for phone-only sends
- `src/lib/automations/validate.ts` — extend `validateTriggerForActivation`
- `src/lib/automations/trigger-meta.ts` — add the four new pills
- `src/lib/automations/steps-tree.ts`, `templates.ts`, `admin-client.ts`
- `src/components/automations/automation-builder.tsx` (1,499 lines — extend it)
- `src/app/api/automations/route.ts`, `[id]/route.ts`, `cron/route.ts` (the cron-secret
  pattern to copy), `engine/route.ts`
- `src/app/(dashboard)/automations/page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx`,
  `[id]/logs/page.tsx`

*WhatsApp*
- `src/lib/whatsapp/meta-api.ts` — `sendTemplateMessage`
- `src/lib/whatsapp/phone-utils.ts` — `sanitizePhoneForMeta`, `isValidE164`,
  `phoneVariants`, `isRecipientNotAllowedError`
- `src/lib/whatsapp/encryption.ts` — `decrypt` for the access token
- `src/app/api/whatsapp/webhook/route.ts` — how conversations are created for a new inbound
  contact; **extract that into a shared helper rather than copying it**
- `src/app/api/whatsapp/templates/{submit,sync}/route.ts` and
  `src/components/settings/template-manager.tsx` — template creation and Meta submission
  **already exist**. Do not rebuild them

*UI primitives*
- `src/components/ui/data-table/` · `gated-button.tsx` · Shadcn Select, Dialog, Sheet,
  Switch, Form
- `src/components/settings/` — for the kill-switch card pattern

*Permissions*
- `src/hooks/use-can.ts` · `src/lib/auth/roles.ts` · the `is_account_member` SQL helper

*Patterns to copy from elsewhere in the repo*
- `src/lib/pricing/` — the TS-mirror-of-SQL approach with a fixtures file and a parity
  document; the condition evaluator should be tested the same way
- `src/lib/territories/` — `parent_id` tree handling, useful when the customer parent link is
  built
- `supabase/migrations/ROLLBACK-*.md` — rollback note convention

**Do not create:** a second automation engine, a second logging table, a new field registry,
a new template manager, a new phone-normalisation utility, or a new permission system.

---

## 10. Open Questions

Only two remain; everything else was decided during the scoping conversation on 2026-08-10.

1. **Customer parent link — prerequisite, being built separately.** Approved as its own task:
   add `parent_customer_id uuid REFERENCES contacts(id)` to `contacts`, a picker on the
   customer form restricted to customers exactly one `hierarchy_level` above, a cycle guard
   (a trigger, following the pattern already used for the reporting-hierarchy cycle check),
   and parent assignment for the 27 existing customers. Once it lands, `parent_customer` joins
   the recipient list in §5.7 with no other change to this spec.
   Note for whoever builds it: `order_settings.hierarchy_enabled` is currently **`false`** on
   the production account, so order classification is `direct` for everything today.

2. **Loop guard — a hard prerequisite for the "update field" action, not for v1.** v1 actions
   cannot modify records, so no automation can re-trigger itself. The day an update-field
   action is specced, this must be built first: a depth/origin marker on `automation_events`
   so a trigger fired by an automation-caused write is either suppressed or capped.
   **Do not add an update-field action without it.**

Decisions already locked (recorded so they are not re-litigated):
event capture via DB triggers · v1 modules Customer/Order/Dispatch · watched-field-only
re-fire · 12-hour stale cutoff · the nine operators · expression grouping in v1 · one central
Automations page with a module filter · test mode · kill switch in · Outstanding and
parent-recipient out.

---

## 11. Acceptance Criteria

### Functional
- [ ] Creating a customer on web emits exactly one `customer_created` event
- [ ] Creating a customer on mobile (online) emits exactly one event
- [ ] Creating a customer on mobile in **Airplane Mode** emits exactly one event on sync, with
      `occurred_at` equal to the device save time, not the sync time
- [ ] Creating an order via the `create_order` RPC emits exactly one `order_created` event
- [ ] Editing an order's notes, quantity or discount emits **zero** events
- [ ] Changing an order's status emits exactly one `order_status_changed` event carrying
      `previous_snapshot` and `changed_fields = ['status']`
- [ ] Creating a dispatch emits one `dispatch_created` event with the customer resolved
- [ ] An automation with condition `customer.state equals Gujarat` fires for a Gujarat
      customer and does not fire for a Maharashtra customer (the founder's example, tested
      both ways)
- [ ] Expression `1 AND (2 OR 3)` evaluates correctly across all 8 truth combinations
- [ ] A customer who has never messaged in receives the template — the `no conversation for
      contact` failure is gone
- [ ] Employee, manager and fixed-number recipients receive their message with **no**
      `conversations` or `messages` row created
- [ ] Preview shows resolved recipients, phone numbers, rendered template and per-rule
      pass/fail, and provably sends nothing (verified by Meta call count = 0 and no new
      `messages` row)
- [ ] Kill switch on → events marked `skipped`, zero Meta calls
- [ ] An event older than 12 hours is `skipped` with `skip_reason='stale'`
- [ ] All nine operators verified against real production-shaped data
- [ ] Text comparison is case-insensitive and trimmed ("gujarat " matches "Gujarat")

### Code Quality
- [ ] `npx tsc --noEmit` run **and shown**, with zero errors in touched files. The current
      baseline must be re-measured, not assumed from any document — stale numeric baselines
      have caused real errors to be dismissed before
- [ ] Zero `any`, or a code comment justifying each unavoidable instance
- [ ] `zod` validates every new route's input
- [ ] No raw Postgres errors returned to the client
- [ ] Existing components extended, not duplicated (§9)
- [ ] Comments explain *why* (e.g. why `LEAST(..., now())` clamps the clock), not *what*

### Architecture
- [ ] Business logic lives in `src/lib/automations/`, not inside React components
- [ ] No UI component calls `supabase.from()` directly
- [ ] Triggers do one INSERT, no network I/O, and never raise
- [ ] Related records fetched in batch — no N+1 across a 50-event drain
- [ ] The engine is extended, not forked

### Testing
- [ ] Unit tests for the expression parser: valid grouping, unbalanced parens, unknown tokens,
      missing rule reference, empty expression fallback, AND-binds-tighter-than-OR
- [ ] Unit tests for all nine operators including null, empty string, type-mismatch and
      case-difference cases
- [ ] Unit tests for recipient resolution including every "unreachable" path
- [ ] Idempotency test: process the same event twice, assert exactly one Meta call and one
      delivery row
- [ ] Staleness test at 11h59m (sends) and 12h01m (skips)
- [ ] Existing `engine.test.ts` and `validate.test.ts` still pass
- [ ] Whole web suite still passes (559 tests at last count — re-measure)

### Security
- [ ] RLS enabled on both new tables, with SELECT policies via `is_account_member`
- [ ] No client INSERT/UPDATE/DELETE policy on either new table
- [ ] `automation_pending_executions` missing policies fixed
- [ ] Cross-tenant test: an admin of account A cannot Preview, read events for, or send to a
      record in account B — returns 404/empty, never data
- [ ] Agent and Viewer roles get 403 from every new API route, verified by direct call, not
      just by the UI hiding a button
- [ ] **No `eval()`, `new Function()`, or dynamic execution anywhere in the expression parser**
- [ ] The cron endpoint rejects a missing or wrong `x-cron-secret`
- [ ] Service-role key never reaches the client

### Performance
- [ ] Trigger overhead on an order insert measured and under 5ms
- [ ] A 50-event drain completes within the cron interval
- [ ] Partial index used by the drain query (verify with `EXPLAIN`)
- [ ] Field catalog cached per module per session, not refetched per keystroke

### Documentation
- [ ] `wacrm-web/CLAUDE.md` updated with the new tables, the trigger list and the field-catalog
      whitelist trap
- [ ] `ROLLBACK-automation-module-events.md` written alongside the migration
- [ ] The cron schedule requirement documented for whoever configures the pinger
- [ ] An ADR filed for the outbox-and-trigger choice — it is hard to reverse and shapes every
      future automation trigger

### Production Readiness
- [ ] Migration applied to production and verified: tables exist, RLS on, policies present,
      triggers installed, `create_order` has exactly one signature (no ambiguous overload —
      this exact trap was hit and caught during migration 076)
- [ ] Verified **no** events were generated for the 27 existing customers, 19 orders or 2
      dispatches
- [ ] Kill switch tested in production before any automation is activated
- [ ] At least one real end-to-end send verified on a real phone
- [ ] Core loop regression check: WhatsApp inbound → CRM → Field Tracking → Expense still
      works, and existing WhatsApp-triggered automations are unaffected

---

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip
steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything

1. Read the full Engineering Handbook for the current tech stack, architecture principles and
   code standards. Also read `wacrm-web/CLAUDE.md` for the live-code vs dead-code map — this
   repo contains a fabricated "DDD" layer and an unwired `src/lib/runtime` subsystem that look
   real and are not. Do not extend dead code.
2. Read this entire specification, including §10 Open Questions.
3. Search the existing codebase before writing new code. Specifically read every file listed
   in §9 Reuse Check. At minimum: `src/lib/automations/engine.ts`,
   `src/lib/automations/meta-send.ts`, `src/lib/automations/validate.ts`,
   `src/components/automations/automation-builder.tsx`,
   `src/app/api/automations/cron/route.ts`, `src/lib/whatsapp/phone-utils.ts`, and
   `src/app/api/whatsapp/webhook/route.ts`.
4. Identify the actual naming conventions used in this codebase by inspecting real files —
   do not assume. Components PascalCase `.tsx`; hooks camelCase `use*.ts`; services and
   repositories PascalCase `.ts`; Server Actions camelCase suffixed `Action`; migrations
   `YYYYMMDDHHMMSS_name.sql`.
5. **Do not assume offline support exists for this feature.** Mobile has no local database
   (no SQLite, no WatermelonDB — WatermelonDB is installed on the *web* repo only).
   `SyncEngine` covers `site_visits`, `activities`, `tracking_sessions`, `location_pings` and
   contact create/edit. This spec needs no new `SyncEngine` wiring for event capture — that is
   the point of using database triggers — but the `client_created_at` stamp (§4.4, §6) must be
   set at user-save time, before queueing, not at flush time. **Verify the offline state
   against the live repo before coding; this handbook section has been substantively wrong
   twice.**
6. **Verify the production facts this spec depends on** rather than trusting this document:
   `contacts` has no `parent_customer_id`; `profiles.mobile` is empty for all 13 rows;
   `message_templates` has 0 rows; `automations` has 0 rows; `custom_fields` contains
   `system_key` values with no matching column. If any of these has changed, that is a
   STOP AND ASK.

### Step 2 — STOP AND ASK triggers

Do not guess or silently choose a default in any of these situations. Stop and ask a
specific, answerable question:

- Anything in §10 Open Questions touches the code you are about to write.
- You find existing code that conflicts with this spec — for example, a parent-customer link
  that now exists, or an automation trigger already firing from application code.
- The spec does not specify behaviour for a case you hit — an error state, a permission edge,
  a data-type ambiguity.
- You are about to add a library, dependency or pattern not already used in this repo.
  **Specifically: do not add an expression-parser library.** Write the small recursive-descent
  parser described in §5.6.
- You are about to change a shared component, service or table in a way that could affect
  another feature — in particular `engine.ts`, `meta-send.ts`, `automation-builder.tsx`, or
  the `create_order` RPC signature.
- Adding `p_client_created_at` to `create_order` changes its signature. Before applying,
  enumerate every caller on web and mobile and confirm each one. If any caller cannot be
  updated in the same change, stop and ask. **A near-identical trap was hit during migration
  076, when the web lead-conversion button would have broken the moment the migration landed.**
- The `custom_fields` whitelist intersection omits a field you believe an admin needs.

Ask a specific question — not "should I proceed?" but e.g. "The spec says employee recipients
should not create a `conversations` row, but `engineSendTemplate` requires a `conversationId`.
Should I refactor `sendViaMeta` to make conversation persistence optional, or add a separate
send path?"

### Step 3 — Implementation rules

- TypeScript strict: zero errors, no `any` unless justified in a code comment explaining why
  a proper type is impossible.
- Reuse Before Create, Extend Before Replace. If you wrote new code where existing code could
  have been extended, undo it and extend instead.
- Match the data model and API contract in this spec exactly. A deviation is a STOP AND ASK,
  not a silent judgment call.
- Multi-tenant isolation on every new table and query. The worker uses the service-role client
  and therefore bypasses RLS — **every query it makes must filter by `account_id` explicitly**,
  following the defensive pattern already in `engine.ts` (the contact-ownership guard at lines
  68-83) and `meta-send.ts` (lines 63-79).
- Triggers must never raise. Wrap each body in an exception handler that warns and returns
  `NEW`. A failed automation event must never roll back a customer's order.
- Never use `eval()` or `new Function()` in the expression parser.
- Preserve offline-first behaviour on mobile: the `client_created_at` change must not break
  contact or order creation in Airplane Mode.
- No fake implementations. No stub that logs and returns. No file that claims to do something
  it does not. If something cannot be finished, say so plainly and leave it unbuilt rather
  than building a shell — this repo has been damaged by that pattern before.

### Step 4 — Self-verification before declaring done

Check every item in §11 against the real system and confirm category by category — Functional,
Code Quality, Architecture, Testing, Security, Performance, Documentation, Production
Readiness. Not "looks good."

Run `npx tsc --noEmit` and paste the real output. Run the test suite and paste the real
counts. If you cannot verify something (for example, no real phone available for the
end-to-end WhatsApp send), say so explicitly and list it as unverified. Do not mark it done.

### Step 5 — Report back

1. What was implemented, mapped to this spec's sections.
2. Any deviations from the spec, and why.
3. Any new conventions discovered or introduced, so they can be added to the handbook.
4. Any Acceptance Criteria items you could not fully verify, and why.
5. Anything you found broken in passing that is outside this spec's scope — report it, do not
   fix it silently.
