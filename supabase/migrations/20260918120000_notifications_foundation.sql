-- Notifications & Alarms — foundation (items 1-6)
-- Spec: docs/superpowers/specs/2026-09-18-notifications-alarms-design.md
--
-- Adds the isolated notification pipeline:
--   notification_outbox  — business-event queue, written by row triggers (Layer B)
--   notifications        — one row per recipient, read by web (Realtime) + mobile push
--   notification_preferences — per-user × category mute toggles
--   push_tokens          — Expo push tokens per user/device
--
-- WHY A SEPARATE OUTBOX (not automation_events): the WhatsApp event-worker
-- destructively CLAIMS each automation_events row (pending -> processing) before
-- it checks for a matching automation. A second consumer on that queue would race
-- it and lose events. Notifications therefore get their own outbox — same trigger
-- discipline, no shared claim state, no coupling to the WhatsApp kill-switch or
-- 12h staleness rule.
--
-- WHY TRIGGERS AND NOT APP CODE: an order/lead/task can be created from the web
-- form, the mobile app, an RPC, a replayed offline mutation, or the public API.
-- A row trigger is the single chokepoint every write passes through.
--
-- WHY TRIGGERS DON'T RESOLVE RECIPIENTS: the actor/assignee columns live in TWO
-- id spaces (tasks.assigned_user_id/deals.assigned_to/expenses.employee_id are
-- profiles.id; leads.owner_id/tasks.user_id/payments.user_id are auth user_id).
-- Normalising that, plus hierarchy + rights + mute resolution, is too much logic
-- for the caller's Save transaction. Triggers only capture to_jsonb(NEW); the
-- generator worker (testable app code) fans out to notifications rows.
--
-- Entirely additive. No column dropped/renamed. Triggers fire only on writes made
-- AFTER this migration, so historic rows produce no notifications.

-- ============================================================================
-- 1. notification_outbox — the Layer B event queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_outbox (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type       text NOT NULL,   -- order_created | lead_assigned | announcement_published | ...
  record_id        uuid NOT NULL,
  -- Denormalised so the generator evaluates the record as it was when the event
  -- fired, not as it is when the worker gets round to it.
  record_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Best-effort raw actor value (id space depends on event_type — the generator is
  -- authoritative and maps via record_snapshot). NULL where not trivially known.
  actor_user_id    uuid,
  occurred_at      timestamptz NOT NULL,
  enqueued_at      timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  processed_at     timestamptz,
  CONSTRAINT notification_outbox_status_chk
    CHECK (status IN ('pending', 'processing', 'done', 'skipped', 'failed'))
);

-- Drain query only looks at pending rows, oldest-first.
CREATE INDEX IF NOT EXISTS notification_outbox_drain_idx
  ON notification_outbox (status, occurred_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notification_outbox_account_idx
  ON notification_outbox (account_id, enqueued_at DESC);
CREATE INDEX IF NOT EXISTS notification_outbox_processing_idx
  ON notification_outbox (status, processed_at)
  WHERE status = 'processing';

ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
-- Read-only for account admins; written by SECURITY DEFINER triggers, drained by
-- the service-role worker. No client insert/update/delete: fails closed.
DROP POLICY IF EXISTS notification_outbox_select ON notification_outbox;
CREATE POLICY notification_outbox_select ON notification_outbox FOR SELECT
  USING (is_account_member(account_id, 'admin'::account_role_enum));

-- ============================================================================
-- 2. notifications — one row per recipient (canonical recipient = profiles.id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category          text NOT NULL,   -- task_reminder | assignment | announcement | team_activity | punch_alarm
  event_type        text,            -- source notification_outbox.event_type (NULL for on-device local)
  source_event_id   uuid REFERENCES notification_outbox(id) ON DELETE SET NULL,
  title             text NOT NULL,
  body              text,
  data              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { entity, id, deep_link }
  read_at           timestamptz,
  pushed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Generator idempotency: re-processing an outbox row must not duplicate a
  -- recipient's notification.
  CONSTRAINT notifications_source_recipient_uniq
    UNIQUE (source_event_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (recipient_user_id) WHERE read_at IS NULL;
-- Dispatcher finds rows not yet pushed.
CREATE INDEX IF NOT EXISTS notifications_unpushed_idx
  ON notifications (created_at) WHERE pushed_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- A recipient sees only their own notifications.
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = notifications.recipient_user_id AND p.user_id = auth.uid()
  ));
-- A recipient may mark their own notification read (app only sets read_at).
DROP POLICY IF EXISTS notifications_update_own ON notifications;
CREATE POLICY notifications_update_own ON notifications FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = notifications.recipient_user_id AND p.user_id = auth.uid()
  ));
-- No client INSERT: rows are written solely by the service-role generator.

-- ============================================================================
-- 3. notification_preferences — per-user × category mute toggles
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category    text NOT NULL,
  muted       boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
-- Owner manages their own toggles.
DROP POLICY IF EXISTS notification_preferences_all ON notification_preferences;
CREATE POLICY notification_preferences_all ON notification_preferences FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = notification_preferences.user_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = notification_preferences.user_id AND p.user_id = auth.uid()
  ));

-- ============================================================================
-- 4. push_tokens — Expo push tokens per user/device
-- ============================================================================
CREATE TABLE IF NOT EXISTS push_tokens (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expo_token  text NOT NULL UNIQUE,
  platform    text NOT NULL DEFAULT 'android',
  last_seen   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_platform_chk CHECK (platform IN ('android', 'ios'))
);

CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON push_tokens (user_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
-- Owner registers/refreshes/removes their own device token.
DROP POLICY IF EXISTS push_tokens_all ON push_tokens;
CREATE POLICY push_tokens_all ON push_tokens FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = push_tokens.user_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = push_tokens.user_id AND p.user_id = auth.uid()
  ));

-- ============================================================================
-- 5. Capture triggers -> notification_outbox
-- ============================================================================
-- Discipline (identical to automation_events triggers): never raise, one INSERT,
-- no network I/O, no recipient resolution. Reuses the existing clamp helper
-- automation_event_occurred_at(client_created_at, created_at).

-- Generic INSERT capture: event_type + optional actor column name.
CREATE OR REPLACE FUNCTION notif_emit_outbox(
  p_account_id  uuid,
  p_event_type  text,
  p_record_id   uuid,
  p_snapshot    jsonb,
  p_actor       uuid,
  p_occurred_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notification_outbox (
    account_id, event_type, record_id, record_snapshot, actor_user_id, occurred_at
  ) VALUES (
    p_account_id, p_event_type, p_record_id, p_snapshot, p_actor,
    LEAST(COALESCE(p_occurred_at, now()), now())
  );
END $$;

-- ---- created events (team-activity) ----------------------------------------
CREATE OR REPLACE FUNCTION notif_lead_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'lead_created', NEW.id, to_jsonb(NEW),
    NEW.user_id, NEW.created_at);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif lead_created % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_lead_created ON leads;
CREATE TRIGGER trg_notif_lead_created AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION notif_lead_created();

CREATE OR REPLACE FUNCTION notif_deal_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'deal_created', NEW.id, to_jsonb(NEW),
    NEW.user_id, NEW.created_at);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif deal_created % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_deal_created ON deals;
CREATE TRIGGER trg_notif_deal_created AFTER INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION notif_deal_created();

CREATE OR REPLACE FUNCTION notif_expense_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'expense_created', NEW.id, to_jsonb(NEW),
    NEW.employee_id, NEW.created_at);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif expense_created % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_expense_created ON expenses;
CREATE TRIGGER trg_notif_expense_created AFTER INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION notif_expense_created();

CREATE OR REPLACE FUNCTION notif_payment_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'payment_created', NEW.id, to_jsonb(NEW),
    NEW.user_id, NEW.created_at);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif payment_created % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_payment_created ON payments;
CREATE TRIGGER trg_notif_payment_created AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION notif_payment_created();

-- order_created + customer_created reuse the same team-activity path. contacts &
-- orders carry client_created_at; use the clamp helper for offline-synced rows.
CREATE OR REPLACE FUNCTION notif_order_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'order_created', NEW.id, to_jsonb(NEW),
    NULL, automation_event_occurred_at(NEW.client_created_at, NEW.created_at));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif order_created % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_order_created ON orders;
CREATE TRIGGER trg_notif_order_created AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION notif_order_created();

CREATE OR REPLACE FUNCTION notif_customer_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'customer_created', NEW.id, to_jsonb(NEW),
    NEW.user_id, automation_event_occurred_at(NEW.client_created_at, NEW.created_at));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif customer_created % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_customer_created ON contacts;
CREATE TRIGGER trg_notif_customer_created AFTER INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION notif_customer_created();

-- ---- task_completed (team-activity) ----------------------------------------
CREATE OR REPLACE FUNCTION notif_task_completed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'task_completed', NEW.id, to_jsonb(NEW),
    NEW.assigned_user_id, now());
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif task_completed % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_task_completed ON tasks;
CREATE TRIGGER trg_notif_task_completed AFTER UPDATE OF status ON tasks
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status
        AND lower(NEW.status) IN ('completed', 'complete', 'done'))
  EXECUTE FUNCTION notif_task_completed();

-- ---- assignment events (notify the assignee) -------------------------------
-- Fire on initial assignment (INSERT with assignee) and reassignment (UPDATE of
-- the assignee column). Generator skips notifying the actor about themselves.
CREATE OR REPLACE FUNCTION notif_task_assigned() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'task_assigned', NEW.id, to_jsonb(NEW),
    NEW.assigned_user_id, now());
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif task_assigned % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_task_assigned_ins ON tasks;
CREATE TRIGGER trg_notif_task_assigned_ins AFTER INSERT ON tasks
  FOR EACH ROW WHEN (NEW.assigned_user_id IS NOT NULL)
  EXECUTE FUNCTION notif_task_assigned();
DROP TRIGGER IF EXISTS trg_notif_task_assigned_upd ON tasks;
CREATE TRIGGER trg_notif_task_assigned_upd AFTER UPDATE OF assigned_user_id ON tasks
  FOR EACH ROW WHEN (NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id
                     AND NEW.assigned_user_id IS NOT NULL)
  EXECUTE FUNCTION notif_task_assigned();

CREATE OR REPLACE FUNCTION notif_lead_assigned() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'lead_assigned', NEW.id, to_jsonb(NEW),
    NEW.owner_id, now());
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif lead_assigned % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_lead_assigned_ins ON leads;
CREATE TRIGGER trg_notif_lead_assigned_ins AFTER INSERT ON leads
  FOR EACH ROW WHEN (NEW.owner_id IS NOT NULL)
  EXECUTE FUNCTION notif_lead_assigned();
DROP TRIGGER IF EXISTS trg_notif_lead_assigned_upd ON leads;
CREATE TRIGGER trg_notif_lead_assigned_upd AFTER UPDATE OF owner_id ON leads
  FOR EACH ROW WHEN (NEW.owner_id IS DISTINCT FROM OLD.owner_id
                     AND NEW.owner_id IS NOT NULL)
  EXECUTE FUNCTION notif_lead_assigned();

CREATE OR REPLACE FUNCTION notif_deal_assigned() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'deal_assigned', NEW.id, to_jsonb(NEW),
    NEW.assigned_to, now());
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif deal_assigned % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_deal_assigned_ins ON deals;
CREATE TRIGGER trg_notif_deal_assigned_ins AFTER INSERT ON deals
  FOR EACH ROW WHEN (NEW.assigned_to IS NOT NULL)
  EXECUTE FUNCTION notif_deal_assigned();
DROP TRIGGER IF EXISTS trg_notif_deal_assigned_upd ON deals;
CREATE TRIGGER trg_notif_deal_assigned_upd AFTER UPDATE OF assigned_to ON deals
  FOR EACH ROW WHEN (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
                     AND NEW.assigned_to IS NOT NULL)
  EXECUTE FUNCTION notif_deal_assigned();

-- ---- announcement_published ------------------------------------------------
CREATE OR REPLACE FUNCTION notif_announcement_published() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN PERFORM notif_emit_outbox(NEW.account_id, 'announcement_published', NEW.id, to_jsonb(NEW),
    NEW.created_by, now());
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notif announcement_published % : %', NEW.id, SQLERRM; END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notif_announcement_published ON tenant_announcements;
CREATE TRIGGER trg_notif_announcement_published AFTER INSERT ON tenant_announcements
  FOR EACH ROW EXECUTE FUNCTION notif_announcement_published();

-- ============================================================================
-- 6. Realtime — the web bell subscribes to INSERTs on notifications
-- ============================================================================
-- RLS still applies to Realtime, so a browser only receives its own rows.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 7. Comments
-- ============================================================================
COMMENT ON TABLE notification_outbox IS
  'Isolated business-event queue for the Notifications subsystem. Written only by '
  'SECURITY DEFINER triggers; drained by the notification generator. Separate from '
  'automation_events to avoid claim races with the WhatsApp worker.';
COMMENT ON TABLE notifications IS
  'One row per recipient (recipient_user_id = profiles.id). Read by web (Realtime) '
  'and delivered to mobile via Expo push. UNIQUE(source_event_id, recipient_user_id) '
  'is the generator idempotency guard.';
COMMENT ON TABLE notification_preferences IS
  'Per-user x category mute toggles. A muted category is suppressed even when the '
  'user holds the right that would otherwise generate it.';
COMMENT ON TABLE push_tokens IS 'Expo push tokens per user/device, upserted on mobile login.';
