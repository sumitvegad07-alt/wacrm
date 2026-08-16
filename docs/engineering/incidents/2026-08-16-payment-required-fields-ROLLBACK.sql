-- ROLLBACK for 20260816120000_payment_required_fields.sql
--
-- Run this if the required-field rules turn out to block a legitimate collection in the
-- field. Reverting restores the previous behaviour exactly: the three "Require ..."
-- settings go back to being decorative, so nothing that was saveable before becomes
-- unsaveable, and nothing that was blocked stays blocked.
--
-- Safe to run at any time. It removes rules; it does not touch a single payment row.

BEGIN;

DROP TRIGGER  IF EXISTS trg_payment_required_fields       ON payments;
DROP TRIGGER  IF EXISTS trg_payment_attachment_on_approval ON payments;

DROP FUNCTION IF EXISTS enforce_payment_required_fields();
DROP FUNCTION IF EXISTS enforce_payment_attachment_on_approval();

-- The column is left in place on purpose. Dropping it would discard which instruments
-- carry a reference number — information that is correct regardless of whether the rule
-- is switched on, and that the clients read to decide whether to mark the field required.
-- Uncomment only if you are removing the feature permanently.
-- ALTER TABLE payment_types DROP COLUMN IF EXISTS requires_reference;

COMMIT;
