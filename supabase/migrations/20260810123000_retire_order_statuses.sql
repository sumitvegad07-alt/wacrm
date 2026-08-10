-- Retire the configurable order-status feature
--
-- `order_statuses` was built to let each account define its own order status
-- list. That turned out to be unworkable: transitions are enforced in the
-- database by `order_status_transition_allowed()`, which hardcodes six status
-- names. A per-account list could rename a status the state machine has never
-- heard of, silently stranding every order on an unreachable value.
--
-- The consequence was live and visible before this migration: the account's
-- configured list read (Placed, Accepted, Dispatched, Cancelled, Rejected)
-- while the enforced machine used (Pending, Approved, Part Dispatch,
-- Dispatched, Rejected, Cancelled), and all 19 real orders used the second
-- set. The settings screen was showing statuses that governed nothing.
--
-- The editable UI was already removed in an earlier pass; this migration
-- removes the now-dead table. Founder decision, 2026-08-10: keep the six
-- enforced statuses exactly as they are, and delete the configurable feature so
-- it cannot mislead a future build.
--
-- SAFETY — verified before writing this migration:
--   * `orders.status` is free text, NOT a foreign key to this table, so no
--     order row references it and none is affected.
--   * No foreign key anywhere points at order_statuses.
--   * No function, trigger or view mentions order_statuses.
--   * The only dependants were its own four RLS policies, dropped with it.
--   * The five discarded rows are recorded in
--     ROLLBACK-automation-module-events.md should they ever be wanted back.
--
-- Rollback: see ROLLBACK-automation-module-events.md, "Retiring order_statuses".

DROP TABLE IF EXISTS order_statuses;

COMMENT ON FUNCTION order_status_transition_allowed(text, text) IS
  'Authoritative order status state machine. The six status names here are the '
  'ONLY valid values for orders.status; they are not configurable per account. '
  'Mirrored in TypeScript at src/lib/orders/statuses.ts — change both together.';
