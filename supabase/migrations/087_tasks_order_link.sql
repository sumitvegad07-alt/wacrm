-- 087_tasks_order_link.sql
-- Let tasks/activities link to an order, so the Timeline "Add Activity" from an
-- order detail page maps to the Order module (like Contact/Lead/Quotation do).
--
-- Adds tasks.order_id (nullable FK → orders). ON DELETE SET NULL keeps the task
-- if the order is ever removed (orders lock on dispatch and are rarely deleted;
-- we prefer preserving the task over cascading it away).

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_order_id ON tasks(order_id);
