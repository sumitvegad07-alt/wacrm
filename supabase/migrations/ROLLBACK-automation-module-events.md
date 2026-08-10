# Rollback — `20260810120000_automation_module_events.sql`

Module Automations v1 event-capture foundation.
Spec: `docs/engineering/specifications/module-automations-v1.md`

## Risk assessment

The migration is **entirely additive**: two new tables, two new nullable columns, one new
nullable column on `automation_logs`, four triggers, and RLS policies. Nothing is dropped,
renamed or backfilled. No existing row is modified.

The only behavioural change to existing paths is that inserts into `contacts`, `orders` and
`order_dispatches`, and status updates on `orders`, now also write one row to
`automation_events`. Each trigger body is wrapped in an exception handler that warns and
returns `NEW`, so a failure in the automation layer cannot roll back a customer's order.

## Fastest safe mitigation (prefer this over a full rollback)

If automations misbehave in production, **do not drop anything**. Two cheaper options, in
order:

1. **Master kill switch.** Set `enabled` to `false` in the account's automation settings:
   ```sql
   UPDATE accounts
     SET settings = jsonb_set(
       COALESCE(settings, '{}'::jsonb),
       '{automation_settings,enabled}', 'false'::jsonb, true)
     WHERE id = '<account_id>';
   ```
   Events continue to be recorded but nothing is sent. Reversible instantly.

2. **Stop the worker.** Unset `AUTOMATION_CRON_SECRET` or disable the external cron pinger.
   The endpoint then returns 503 and events accumulate harmlessly as `pending`.

Both leave the audit trail intact, which a rollback does not.

## Full rollback

Only if the triggers themselves are causing a problem on the write path.

```sql
BEGIN;

-- 1. Triggers first — this stops all event capture immediately.
DROP TRIGGER IF EXISTS trg_emit_customer_created      ON contacts;
DROP TRIGGER IF EXISTS trg_emit_order_created         ON orders;
DROP TRIGGER IF EXISTS trg_emit_order_status_changed  ON orders;
DROP TRIGGER IF EXISTS trg_emit_dispatch_created      ON order_dispatches;

DROP FUNCTION IF EXISTS emit_customer_created_event();
DROP FUNCTION IF EXISTS emit_order_created_event();
DROP FUNCTION IF EXISTS emit_order_status_changed_event();
DROP FUNCTION IF EXISTS emit_dispatch_created_event();
DROP FUNCTION IF EXISTS automation_event_occurred_at(timestamptz, timestamptz);

-- 2. The log link. Drops the column, not the logs.
DROP INDEX IF EXISTS automation_logs_event_idx;
ALTER TABLE automation_logs DROP COLUMN IF EXISTS event_id;

-- 3. The new tables. NOTE: this destroys the delivery ledger, which is the only record of
--    which customers were messaged by which automation. Export it first if there is any
--    chance of a billing or customer-complaint question later:
--      \copy (SELECT * FROM automation_event_deliveries) TO 'deliveries.csv' CSV HEADER
DROP TABLE IF EXISTS automation_event_deliveries;
DROP TABLE IF EXISTS automation_events;

COMMIT;
```

## Deliberately NOT rolled back

**`contacts.client_created_at` and `orders.client_created_at` should be left in place.**

Per the handbook rule, never drop a column with live data. By the time a rollback is
considered, the mobile app in the field will already be writing these columns, and dropping
them makes every offline order insert from an installed APK fail — turning an automation
problem into an order-loss problem. They are nullable and harmless when unused.

Same reasoning for the `automation_pending_executions` SELECT policy added in section 5: it
fixes a pre-existing defect (RLS enabled with zero policies) and is unrelated to automations.
Leave it.

## Retiring `order_statuses` — `20260810123000_retire_order_statuses.sql`

Separate migration, separate rollback. It drops the dead `order_statuses` table.

Verified safe before dropping: `orders.status` is free text and not a foreign key to
it; no FK, function, trigger or view referenced it; only its own four RLS policies
depended on it.

The five discarded rows, recorded here so nothing is lost:

| account_id | name | position |
|---|---|---|
| 30501611-869f-4a59-8cec-a9763d73ced8 | Placed | 0 |
| 30501611-869f-4a59-8cec-a9763d73ced8 | Accepted | 1 |
| 30501611-869f-4a59-8cec-a9763d73ced8 | Dispatched | 2 |
| 30501611-869f-4a59-8cec-a9763d73ced8 | Cancelled | 4 |
| 30501611-869f-4a59-8cec-a9763d73ced8 | Rejected | 5 |

Note that four of these five names (`Placed`, `Accepted`, and the ordering) never
matched the enforced state machine, which is the defect that prompted the removal.
Restoring them would restore the inconsistency, so this is recorded for reference
rather than as a recommended action.

```sql
-- Only if the configurable-status feature is genuinely being revived.
CREATE TABLE IF NOT EXISTS order_statuses (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE order_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_statuses_select ON order_statuses FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY order_statuses_insert ON order_statuses FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));
CREATE POLICY order_statuses_update ON order_statuses FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum));
CREATE POLICY order_statuses_delete ON order_statuses FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));
```

## Verification after rollback

```sql
-- Expect 0 rows
SELECT tgname FROM pg_trigger
 WHERE tgname LIKE 'trg_emit_%_event' OR tgname LIKE 'trg_emit_%';

-- Expect 0 rows
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('automation_events', 'automation_event_deliveries');

-- Expect the pre-migration counts, unchanged
SELECT (SELECT count(*) FROM contacts)         AS contacts,
       (SELECT count(*) FROM orders)           AS orders,
       (SELECT count(*) FROM order_dispatches) AS dispatches;
```

Then confirm on the live app that creating a customer and creating an order both still work.
