-- Payment module production hardening.
--
-- 1. Private attachment bucket  — cheque images / bank receipts were world-readable.
-- 2. Approval-setting deadlock  — accounts that switch approval OFF could not collect at all.
-- 3. Duplicate status trigger   — the same validation function was wired up twice.


-- ---------------------------------------------------------------------------
-- 1. Lock down payment attachments
-- ---------------------------------------------------------------------------
-- The bucket shipped public with a "Allow public view" policy granted to the
-- `public` role, so anyone holding (or guessing) an object URL could read another
-- tenant's proof-of-payment images. Attachments are now private and reachable only
-- through short-lived signed URLs minted for members of the owning account.

UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,                     -- 10 MB
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
WHERE id = 'payment_attachments';

DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public view" ON storage.objects;

-- Object paths are `<account_id>/<user_id>/<uuid>.<ext>`, so the first path segment
-- is the tenant boundary we authorise against.
CREATE POLICY "payment_attachments_select_own_account"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment_attachments'
    AND is_account_member(((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "payment_attachments_insert_own_account"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment_attachments'
    AND is_account_member(((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "payment_attachments_delete_own_account"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'payment_attachments'
    AND is_account_member(((storage.foldername(name))[1])::uuid)
  );


-- ---------------------------------------------------------------------------
-- 2. Honour the per-account "approval required" setting
-- ---------------------------------------------------------------------------
-- When `payment_settings.approval_required` is false the client creates payments
-- already marked Approved. The INSERT guard demanded `approve_payments` for that
-- status, so switching the setting off silently made collection impossible for
-- every field rep. An account that has opted out of the approval workflow may
-- create pre-approved payments; `Rejected` still always requires the permission,
-- and every Pending -> Approved transition remains gated as before.

CREATE OR REPLACE FUNCTION enforce_payment_status_transition()
RETURNS trigger AS $$
DECLARE
  v_approval_required boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE((a.settings->'payment_settings'->>'approval_required')::boolean, true)
      INTO v_approval_required
    FROM accounts a WHERE a.id = NEW.account_id;

    IF NEW.status = 'Approved' AND COALESCE(v_approval_required, true) THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text) THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;

    IF NEW.status = 'Rejected' THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text) THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;

    IF NEW.status = 'Cancelled' THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'cancel_payments'::text) THEN
        RAISE EXCEPTION 'Permission denied: cancel_payments required';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Approved payments are read-only, except for cancellation
    IF OLD.status = 'Approved' AND NEW.status != 'Cancelled' THEN
      RAISE EXCEPTION 'Approved payments are read-only. They can only be cancelled.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT payment_status_transition_allowed(OLD.status, NEW.status) THEN
        RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
      END IF;

      IF NEW.status IN ('Approved', 'Rejected') THEN
        IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text) THEN
          RAISE EXCEPTION 'Permission denied: approve_payments required';
        END IF;
      END IF;

      IF NEW.status = 'Cancelled' THEN
        IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'cancel_payments'::text) THEN
          RAISE EXCEPTION 'Permission denied: cancel_payments required';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 3. Remove the duplicate status trigger
-- ---------------------------------------------------------------------------
-- `trg_payment_status_transition` (INSERT OR UPDATE) and
-- `trg_enforce_payment_status_transition` (UPDATE) both executed the function
-- above, so every UPDATE validated twice. Keep one covering both operations.

DROP TRIGGER IF EXISTS trg_enforce_payment_status_transition ON payments;
DROP TRIGGER IF EXISTS trg_payment_status_transition ON payments;

CREATE TRIGGER trg_payment_status_transition
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payment_status_transition();
