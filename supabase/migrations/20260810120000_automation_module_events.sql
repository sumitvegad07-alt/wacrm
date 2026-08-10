-- Module Automations v1 — business-event capture foundation
-- Spec: docs/engineering/specifications/module-automations-v1.md
--
-- Adds a durable event outbox (automation_events) written by row triggers on contacts,
-- orders and order_dispatches, plus a delivery ledger (automation_event_deliveries) whose
-- unique constraint is the idempotency guard that makes a double WhatsApp send impossible.
--
-- WHY TRIGGERS AND NOT APPLICATION CODE: an order or customer can be created from the web
-- form, the mobile app, the create_order RPC, an offline mutation replayed hours later by
-- SyncEngine, or the public /api/v1 API. Hooking each path by hand means the day someone
-- adds a sixth path, customers silently stop being notified. A row trigger is the single
-- chokepoint every write must pass through.
--
-- Entirely additive. No column is dropped or renamed. No data is backfilled — triggers fire
-- only on writes made AFTER this migration is applied, so the existing customers, orders and
-- dispatches produce no events and nobody gets messaged about historic records.
--
-- Rollback: supabase/migrations/ROLLBACK-automation-module-events.md

-- ============================================================================
-- 1. Origin timestamps for offline-created records
-- ============================================================================
-- The agreed rule is "send on sync, but skip events older than 12 hours". That is
-- unenforceable today: contacts.created_at and orders.created_at both default to now(),
-- i.e. the moment the row reaches Postgres. An order written offline at 9am and synced at
-- 3pm is stamped 3pm and looks brand new, so the cutoff would never fire.
--
-- client_created_at is stamped by the device at the moment the user taps Save, before the
-- mutation enters the SyncEngine queue. Nullable: rows created on web leave it NULL and
-- fall back to created_at, which is correct there.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_created_at timestamptz;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS client_created_at timestamptz;

COMMENT ON COLUMN contacts.client_created_at IS
  'Device-clock time the user saved this record, stamped before offline queueing. NULL for '
  'web-created rows. Used by automation_events.occurred_at so the staleness cutoff measures '
  'real creation time rather than sync time.';
COMMENT ON COLUMN orders.client_created_at IS
  'Device-clock time the user saved this record, stamped before offline queueing. NULL for '
  'web-created rows. Used by automation_events.occurred_at so the staleness cutoff measures '
  'real creation time rather than sync time.';

-- ============================================================================
-- 2. The event outbox
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_events (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  module             text NOT NULL,   -- 'customer' | 'order' | 'dispatch'
  event_type         text NOT NULL,   -- matches automations.trigger_type
  record_id          uuid NOT NULL,
  -- Denormalised so the worker never re-reads a row that may have changed again since the
  -- event fired. An "order status changed to Packed" event must evaluate against the order
  -- as it was at that moment, not as it is when the worker gets round to it.
  record_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_snapshot  jsonb,
  changed_fields     text[],
  -- Business time, NOT insert time. Drives the staleness cutoff.
  occurred_at        timestamptz NOT NULL,
  enqueued_at        timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'pending',
  skip_reason        text,
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  processed_at       timestamptz,
  CONSTRAINT automation_events_status_chk
    CHECK (status IN ('pending', 'processing', 'done', 'skipped', 'failed')),
  CONSTRAINT automation_events_module_chk
    CHECK (module IN ('customer', 'order', 'dispatch'))
);

-- Partial index: the drain query only ever looks at pending rows, ordered oldest-first so a
-- customer's order confirmation is always processed before its dispatch notification.
CREATE INDEX IF NOT EXISTS automation_events_drain_idx
  ON automation_events (status, occurred_at)
  WHERE status = 'pending';

-- Backs the admin "why didn't my customer get a message?" screen.
CREATE INDEX IF NOT EXISTS automation_events_account_idx
  ON automation_events (account_id, enqueued_at DESC);

-- Lets the stuck-row sweeper find rows a crashed worker left mid-flight.
CREATE INDEX IF NOT EXISTS automation_events_processing_idx
  ON automation_events (status, processed_at)
  WHERE status = 'processing';

ALTER TABLE automation_events ENABLE ROW LEVEL SECURITY;

-- Read-only for account admins. Deliberately NO insert/update/delete policy: rows are
-- written solely by SECURITY DEFINER triggers and mutated solely by the service-role
-- worker. This fails closed — a compromised client session cannot forge an event that would
-- make the system send WhatsApp messages on its behalf.
DROP POLICY IF EXISTS automation_events_select ON automation_events;
CREATE POLICY automation_events_select ON automation_events FOR SELECT
  USING (is_account_member(account_id, 'admin'::account_role_enum));

-- ============================================================================
-- 3. The delivery ledger (idempotency)
-- ============================================================================
-- The worker inserts here BEFORE calling Meta. A unique violation means another invocation
-- already handled this recipient, so the send is skipped. Without this, an overlapping cron
-- run or a retry after a timeout sends a customer the same order confirmation twice — a
-- trust problem and a billed Meta message.

CREATE TABLE IF NOT EXISTS automation_event_deliveries (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES automation_events(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  -- 'customer:<uuid>' | 'creator:<uuid>' | 'creator_manager:<uuid>' | 'phone:<e164>'
  recipient_key text NOT NULL,
  recipient_type text NOT NULL,
  recipient_phone text,
  status        text NOT NULL,
  detail        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_event_deliveries_status_chk
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT automation_event_deliveries_uniq
    UNIQUE (event_id, automation_id, recipient_key)
);

CREATE INDEX IF NOT EXISTS automation_event_deliveries_event_idx
  ON automation_event_deliveries (event_id);

ALTER TABLE automation_event_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_event_deliveries_select ON automation_event_deliveries;
CREATE POLICY automation_event_deliveries_select ON automation_event_deliveries FOR SELECT
  USING (is_account_member(account_id, 'admin'::account_role_enum));

-- ============================================================================
-- 4. Link logs back to the business event that caused them
-- ============================================================================
-- Nullable so every existing WhatsApp-triggered log row stays valid.

ALTER TABLE automation_logs
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES automation_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS automation_logs_event_idx
  ON automation_logs (event_id) WHERE event_id IS NOT NULL;

-- ============================================================================
-- 5. Fix: automation_pending_executions had RLS enabled with ZERO policies
-- ============================================================================
-- Independently confirmed before this migration. RLS-on-with-no-policies fails closed, so
-- this was never a security hole — but it made the delayed-step queue completely unreadable
-- from the app, which is why nobody could ever inspect a parked automation run.

ALTER TABLE automation_pending_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_pending_executions_select ON automation_pending_executions;
CREATE POLICY automation_pending_executions_select ON automation_pending_executions FOR SELECT
  USING (is_account_member(account_id, 'admin'::account_role_enum));

-- ============================================================================
-- 6. Trigger functions
-- ============================================================================
-- Discipline these functions must hold to, without exception:
--   * Never raise. A failure to record an automation event must NEVER roll back a
--     customer's order. Every body is wrapped so it warns and returns instead.
--   * One INSERT, no network I/O, no heavy computation — they run inside the caller's
--     transaction and every millisecond is paid by the user pressing Save.

-- Clamp guard used by all four: a device with a clock set to next year must not produce an
-- event whose occurred_at is permanently in the future and therefore never expires as stale.
CREATE OR REPLACE FUNCTION automation_event_occurred_at(
  p_client_created_at timestamptz,
  p_created_at        timestamptz
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(COALESCE(p_client_created_at, p_created_at, now()), now());
$$;

-- ---- customer_created -------------------------------------------------------
CREATE OR REPLACE FUNCTION emit_customer_created_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO automation_events (
      account_id, module, event_type, record_id, record_snapshot, occurred_at
    ) VALUES (
      NEW.account_id, 'customer', 'customer_created', NEW.id, to_jsonb(NEW),
      automation_event_occurred_at(NEW.client_created_at, NEW.created_at)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'automation_events: customer_created emit failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emit_customer_created ON contacts;
CREATE TRIGGER trg_emit_customer_created
  AFTER INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION emit_customer_created_event();

-- ---- order_created ----------------------------------------------------------
CREATE OR REPLACE FUNCTION emit_order_created_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO automation_events (
      account_id, module, event_type, record_id, record_snapshot, occurred_at
    ) VALUES (
      NEW.account_id, 'order', 'order_created', NEW.id, to_jsonb(NEW),
      automation_event_occurred_at(NEW.client_created_at, NEW.created_at)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'automation_events: order_created emit failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emit_order_created ON orders;
CREATE TRIGGER trg_emit_order_created
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION emit_order_created_event();

-- ---- order_status_changed ---------------------------------------------------
-- The founder's "only fire when a watched field changes" rule, enforced at the lowest
-- possible level. An order edited five times for notes, quantities or discounts emits ZERO
-- events; only a genuine status transition emits one. The WHEN clause below means the
-- function is not even called for other updates.
CREATE OR REPLACE FUNCTION emit_order_status_changed_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO automation_events (
      account_id, module, event_type, record_id,
      record_snapshot, previous_snapshot, changed_fields, occurred_at
    ) VALUES (
      NEW.account_id, 'order', 'order_status_changed', NEW.id,
      to_jsonb(NEW), to_jsonb(OLD), ARRAY['status'],
      -- A status change is a back-office action happening now; the record's original
      -- creation time is irrelevant to whether this notification is still timely.
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'automation_events: order_status_changed emit failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emit_order_status_changed ON orders;
CREATE TRIGGER trg_emit_order_status_changed
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION emit_order_status_changed_event();

-- ---- dispatch_created -------------------------------------------------------
-- order_dispatches has no contact_id of its own, so resolve it here and stash it in the
-- snapshot under _resolved_contact_id. Doing it once at emit time saves the worker a query
-- per event and, more importantly, records who the customer WAS at dispatch time.
CREATE OR REPLACE FUNCTION emit_dispatch_created_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contact_id uuid;
  v_order_number text;
BEGIN
  BEGIN
    SELECT o.contact_id, o.order_number INTO v_contact_id, v_order_number
    FROM orders o WHERE o.id = NEW.order_id;

    INSERT INTO automation_events (
      account_id, module, event_type, record_id, record_snapshot, occurred_at
    ) VALUES (
      NEW.account_id, 'dispatch', 'dispatch_created', NEW.id,
      to_jsonb(NEW)
        || jsonb_build_object('_resolved_contact_id', v_contact_id)
        || jsonb_build_object('_resolved_order_number', v_order_number),
      -- Dispatches are recorded from the web back office, online, so created_at is the
      -- real event time. There is no client_created_at on this table by design.
      automation_event_occurred_at(NULL, NEW.created_at)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'automation_events: dispatch_created emit failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emit_dispatch_created ON order_dispatches;
CREATE TRIGGER trg_emit_dispatch_created
  AFTER INSERT ON order_dispatches
  FOR EACH ROW EXECUTE FUNCTION emit_dispatch_created_event();

-- ============================================================================
-- 7. Table comments
-- ============================================================================

COMMENT ON TABLE automation_events IS
  'Outbox of business events (customer/order/dispatch) awaiting automation dispatch. '
  'Written only by SECURITY DEFINER triggers; drained by /api/automations/events/cron.';
COMMENT ON TABLE automation_event_deliveries IS
  'One row per (event, automation, recipient). The UNIQUE constraint is the idempotency '
  'guard that makes a duplicate WhatsApp send impossible across worker retries.';
