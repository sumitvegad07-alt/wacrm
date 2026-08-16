-- Make the three "Require ..." payment settings real.
--
-- ROOT CAUSE
-- `payments-settings.tsx` writes `payment_settings.require_attachment`,
-- `require_notes` and `require_reference` into `accounts.settings`. Nothing anywhere
-- reads them. The switches render, flip, persist and are consumed by no code path —
-- web, mobile, RPC or trigger. Account "sumit vegad" has all three set to true, so the
-- founder has been operating under three controls that do not exist.
--
-- WHY THE RULES LIVE HERE
-- The mobile app writes the `payments` table directly through its offline sync queue and
-- never calls an RPC. A rule enforced only in a client does not exist for the field. Same
-- reasoning that put the mandatory cancellation reason in a trigger.
--
-- TWO DELIBERATE DEPARTURES FROM A LITERAL READING OF THE TOGGLES
--
-- 1. `require_reference` applies only to payment types that actually carry a reference.
--    Production types are Cash, Cheque, UPI, NEFT, RTGS, Bank Transfer, Credit Note,
--    Other. A cash collection has no cheque number and no UTR, so a literal rule would
--    either block cash entirely — the most common field collection — or train reps to
--    type junk into a mandatory box. Junk in a financial reference field is worse than an
--    empty one, because it looks like reconciliation data.
--
--    Which types carry a reference is stored as a column rather than matched on the type
--    name in SQL. Name matching would silently disable the rule the first time somebody
--    renames "Cheque" to "Check", and the failure would be invisible.
--
-- 2. `require_attachment` is enforced at approval, not at insert.
--    At insert time the proof image does not exist yet: the client inserts the payment,
--    uploads to storage, then inserts `payment_attachments` — three separate statements in
--    separate transactions. A BEFORE INSERT trigger cannot see a row that has not been
--    written, and a deferred constraint trigger would not help because the attachment
--    arrives in a later transaction. So the capture-time rule is enforced in the clients
--    (web and mobile both refuse to submit without a chosen photo) and the database
--    enforces the part it can actually verify: a payment cannot become Approved while its
--    proof is missing. Finance never signs off unproven money, and a rep never loses a
--    collection they are physically holding to a failed upload.
--
-- EXISTING DATA
-- 6 payments live (4 Approved, 1 Cancelled, 1 Pending). All 6 have blank notes and blank
-- reference. The insert-time rules therefore apply to new payments only — enforcing them
-- on UPDATE would make every historical payment uneditable and unapprovable. The single
-- Pending payment already has an attachment, so the approval rule strands nothing.


-- ===========================================================================
-- 1. Which payment types carry a reference number
-- ===========================================================================
ALTER TABLE payment_types
  ADD COLUMN IF NOT EXISTS requires_reference boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN payment_types.requires_reference IS
  'Whether this instrument carries a reference number (cheque no., UPI txn id, NEFT/RTGS '
  'UTR). Consulted only when payment_settings.require_reference is on. Defaults to false '
  'for new custom types so that adding a type can never silently start blocking saves.';

-- Seed the system types. Scoped to is_system so an account that renamed a type into one of
-- these words does not get a rule it did not ask for.
UPDATE payment_types
   SET requires_reference = true
 WHERE is_system = true
   AND name IN ('Cheque', 'UPI', 'NEFT', 'RTGS', 'Bank Transfer')
   AND requires_reference = false;


-- ===========================================================================
-- 2. Required-field enforcement
-- ===========================================================================
-- Kept as its own trigger function rather than folded into
-- enforce_payment_status_transition(). That function owns the status machine; this owns
-- data completeness. Separate concerns stay separately reviewable and separately
-- revertable.
CREATE OR REPLACE FUNCTION enforce_payment_required_fields()
RETURNS trigger AS $$
DECLARE
  v_settings          jsonb;
  v_require_notes     boolean;
  v_require_reference boolean;
  v_type_needs_ref    boolean;
BEGIN
  SELECT COALESCE(a.settings, '{}'::jsonb) INTO v_settings
    FROM accounts a WHERE a.id = NEW.account_id;

  v_require_notes     := COALESCE((v_settings->'payment_settings'->>'require_notes')::boolean, false);
  v_require_reference := COALESCE((v_settings->'payment_settings'->>'require_reference')::boolean, false);

  -- Applies to new payments, and to an edit that would blank a field that is required.
  -- It deliberately does NOT fire on an unrelated update (an approval, a cancellation) of
  -- a payment created before the rule was switched on — retroactive enforcement would
  -- freeze historical rows rather than improve them.
  IF v_require_notes
     AND (TG_OP = 'INSERT' OR NEW.notes IS DISTINCT FROM OLD.notes)
     AND (NEW.notes IS NULL OR btrim(NEW.notes) = '')
  THEN
    RAISE EXCEPTION 'A note is required on every payment (Settings -> Payments -> Require Notes).'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_require_reference
     AND (TG_OP = 'INSERT'
          OR NEW.reference_number IS DISTINCT FROM OLD.reference_number
          OR NEW.payment_type_id  IS DISTINCT FROM OLD.payment_type_id)
     AND (NEW.reference_number IS NULL OR btrim(NEW.reference_number) = '')
  THEN
    SELECT COALESCE(pt.requires_reference, false) INTO v_type_needs_ref
      FROM payment_types pt WHERE pt.id = NEW.payment_type_id;

    IF COALESCE(v_type_needs_ref, false) THEN
      RAISE EXCEPTION
        'A reference number is required for % payments (cheque number, transaction id or UTR).',
        COALESCE(NEW.payment_type, 'this type')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_required_fields ON payments;
CREATE TRIGGER trg_payment_required_fields
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_required_fields();


-- ===========================================================================
-- 3. Proof of payment must exist before approval
-- ===========================================================================
-- Separate trigger for the same reason as above, and BEFORE UPDATE only: the insert path
-- cannot see an attachment that has not been written yet (see header).
--
-- Note the honest limit of this rule: when an account turns approval_required OFF, a
-- payment is born Approved on insert and never passes through this transition, so the
-- database cannot check its proof. In that configuration the capture-time client rule is
-- the only guard. Documented rather than silently unenforced.
CREATE OR REPLACE FUNCTION enforce_payment_attachment_on_approval()
RETURNS trigger AS $$
DECLARE
  v_require_attachment boolean;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((COALESCE(a.settings, '{}'::jsonb)->'payment_settings'->>'require_attachment')::boolean, false)
    INTO v_require_attachment
    FROM accounts a WHERE a.id = NEW.account_id;

  IF v_require_attachment
     AND NOT EXISTS (SELECT 1 FROM payment_attachments pa WHERE pa.payment_id = NEW.id)
  THEN
    RAISE EXCEPTION
      'This payment has no proof attached, so it cannot be approved. Ask the collector to upload the receipt.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_attachment_on_approval ON payments;
CREATE TRIGGER trg_payment_attachment_on_approval
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_attachment_on_approval();


-- ===========================================================================
-- 4. Let the clients read the rules they have to mirror
-- ===========================================================================
-- The web form and the mobile form both need to know which types demand a reference so
-- they can mark the field required before the user hits save. Reading the column directly
-- is enough; no RPC is needed. Existing SELECT policies on payment_types already cover it.
