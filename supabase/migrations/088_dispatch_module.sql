-- 088_dispatch_module.sql
-- Promote dispatches to a first-class module (standalone create/edit/detail +
-- timeline/tasks/logs/print). Two additive changes:
--
-- 1) order_dispatches gains the header fields the dispatch screen needs
--    (dispatch code, invoice no/date, LR no/date, transport contact). Pricing
--    stays inherited from the order line (decided), so dispatch_items is
--    unchanged — it still just records which order item shipped and how much.
--
-- 2) tasks.dispatch_id so activities/tasks can link to a dispatch, exactly like
--    tasks.order_id (migration 087). ON DELETE SET NULL keeps the task.

ALTER TABLE order_dispatches
  ADD COLUMN IF NOT EXISTS dispatch_code        text,
  ADD COLUMN IF NOT EXISTS invoice_no           text,
  ADD COLUMN IF NOT EXISTS invoice_date         date,
  ADD COLUMN IF NOT EXISTS lr_no                text,
  ADD COLUMN IF NOT EXISTS lr_date              date,
  ADD COLUMN IF NOT EXISTS transport_contact_no text;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS dispatch_id uuid REFERENCES order_dispatches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_dispatch_id ON tasks(dispatch_id);
