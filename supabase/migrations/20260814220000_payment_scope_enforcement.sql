-- BUG-12: "own records only" was not enforced on payments.
--
-- A Sales Executive with global_scope = 'own' could list every payment in the account,
-- including other reps' collections, because the RLS SELECT policy only checked account
-- membership. Hiding rows in the UI would not have been enough — the row was genuinely
-- readable, so a direct URL or an API key reached it just as easily.
--
-- This reuses the existing scope model (the `*_scope` keys already stored on
-- employee_roles.permissions, and get_all_reports() for the reporting hierarchy) rather
-- than inventing a payment-specific one. Resolution order matches the application's
-- getDataScope(): module scope, then global scope, then 'own'.

CREATE OR REPLACE FUNCTION payment_scope_allows(p_owner_user_id uuid, p_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_super boolean;
  v_perms jsonb;
  v_profile_id uuid;
  v_scope text;
BEGIN
  IF v_uid IS NULL THEN
    -- Service-role / trigger context. Table-level policies already gate these paths.
    RETURN true;
  END IF;

  SELECT p.account_role, COALESCE(p.is_superadmin, false), er.permissions, p.id
    INTO v_role, v_super, v_perms, v_profile_id
  FROM profiles p
  LEFT JOIN employee_roles er ON er.id = p.employee_role_id
  WHERE p.user_id = v_uid AND p.account_id = p_account_id;

  IF v_role IS NULL THEN
    RETURN false;                                    -- not a member of this account
  END IF;

  IF v_role IN ('owner', 'admin') OR v_super THEN
    RETURN true;
  END IF;

  IF (v_perms ->> 'all') = 'true' THEN
    RETURN true;
  END IF;

  v_scope := COALESCE(v_perms ->> 'payments_scope', v_perms ->> 'global_scope', 'own');

  IF v_scope IN ('all', 'company', 'department') THEN
    RETURN true;
  END IF;

  IF v_scope = 'team' THEN
    IF p_owner_user_id = v_uid THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM profiles p2
      WHERE p2.user_id = p_owner_user_id
        AND p2.id = ANY (get_all_reports(v_profile_id))
    );
  END IF;

  -- 'own'
  RETURN p_owner_user_id = v_uid;
END;
$$;

COMMENT ON FUNCTION payment_scope_allows(uuid, uuid) IS
  'Row visibility for payments under the account''s data-scope model. Used by RLS so scope is enforced at the data layer, not only in the UI.';


-- Replace the account-wide SELECT policy with a scope-aware one. Membership is still
-- required; scope narrows it further.
DROP POLICY IF EXISTS "Payments are viewable by account members" ON payments;

CREATE POLICY "Payments are viewable within the user's data scope"
  ON payments FOR SELECT
  USING (
    is_account_member(account_id)
    AND payment_scope_allows(user_id, account_id)
  );

-- Updating a payment (approve / reject / cancel) is already gated on the relevant
-- permission by enforce_payment_status_transition(). Narrow row access to the same
-- scope so a rep cannot act on a row they are not entitled to see.
DROP POLICY IF EXISTS "Payments can be updated by account members" ON payments;

CREATE POLICY "Payments can be updated within the user's data scope"
  ON payments FOR UPDATE
  USING (
    is_account_member(account_id)
    AND payment_scope_allows(user_id, account_id)
  )
  WITH CHECK (
    is_account_member(account_id)
    AND payment_scope_allows(user_id, account_id)
  );


-- Attachments inherit their payment's visibility.
DROP POLICY IF EXISTS "Payment attachments are viewable by account members" ON payment_attachments;

CREATE POLICY "Payment attachments follow their payment's scope"
  ON payment_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = payment_attachments.payment_id
        AND is_account_member(p.account_id)
        AND payment_scope_allows(p.user_id, p.account_id)
    )
  );
