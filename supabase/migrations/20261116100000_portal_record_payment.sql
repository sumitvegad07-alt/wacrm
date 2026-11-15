-- ============================================================
-- A distributor records a payment, and the money's custody is tracked.
--
-- Founder, 2026-11-15, after the research on how FMCG collection works:
--   "Ok let them record a payment and allow them to convert statuses."
--   "some distributors collect payment them selves and some distributors send
--    salesman to collect payments... this option will be provided when admin
--    enable DMS access."
--   And, answering: a distributor may REJECT a salesman's receipt with a
--   reason; one distributor may use BOTH routes at once; and the company's own
--   salesman collecting from the distributor stays inside the CRM.
--
-- TWO THINGS ARE NOT ONE THING.
--   status   — is this receipt accepted? payments.status already answers that,
--              with a fixed transition table, permissions and an audit trail
--              read by the CRM, the mobile app and the ageing report. UNTOUCHED.
--   custody  — who is holding the money right now? That is the founder's chain
--              of arrows, and it is new: payment_handovers.
-- Squeezing the hops into status would make "Approved" mean two things and
-- every existing screen that reads it would become wrong.
--
-- AND THE CHAIN IS TWO LEDGERS, NOT ONE. The shop owes the DISTRIBUTOR
-- (secondary); the distributor owes the COMPANY (primary). The company never
-- receives the shop's money — it receives the distributor's, funded out of
-- collections. One pipeline would make a shop's receipt look like it reduced
-- the distributor's dues to the company, which would corrupt the ageing report.
--
-- WHOSE MONEY DECIDES WHO MAY APPROVE:
--   a shop pays the distributor  -> the distributor's own receivable, so the
--                                   distributor may approve, reject or cancel;
--   the distributor pays us      -> our receivable, so he may RECORD it ("paid,
--                                   here is the UTR") and nothing more. A
--                                   distributor approving his own dues is
--                                   marking his own homework.
--
-- Five questions (WORKING-AGREEMENT):
--   second FK between two tables? payment_handovers references payments once
--     and contacts once; no table gains a second FK to one it already has.
--   does a touched column appear in a .select() string? contacts gains a
--     column (additive, defaulted); payments gains none.
--   new trigger/policy/constraint on a written table? the existing portal
--     column guard gains a seventh column — see section 2, it is named one by
--     one and a column it does not name is unguarded.
--   can an existing row fail the new rule? no: the route defaults to 'direct'
--     and no existing payment is read by the new trigger path.
--   a tenant without the add-on? portal_caller() is empty for them, so every
--     function here refuses, and nothing else on the platform changes.
-- ============================================================

-- ── 1. How this distributor collects ─────────────────────────
-- 'direct'   the distributor collects from their shops themselves
-- 'salesman' a salesman collects and hands the money over
-- 'both'     both happen, which the founder confirmed is normal
--
-- THE SETTING DECIDES WHAT THE PORTAL OFFERS, NOT WHAT IS TRUE. A distributor
-- on 'salesman' whose man is off sick still collects a payment himself that
-- day, and the row records what actually happened. A rule that forbids the real
-- world loses; this one shapes the screen instead.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS portal_collection_route text NOT NULL DEFAULT 'direct';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_portal_collection_route_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_portal_collection_route_check
      CHECK (portal_collection_route IN ('direct', 'salesman', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN public.contacts.portal_collection_route IS
  'How this distributor collects from their shops: direct, salesman or both. '
  'Chosen by the admin on Provide DMS Access. Decides what the portal offers, '
  'never what a payment row is allowed to say.';

-- ── 2. The guard learns the seventh column ───────────────────
-- guard_contact_portal_columns names its columns ONE BY ONE, so a new one it
-- does not name can be changed by any API caller without the portal-access
-- route — silently, because nothing would raise. The whole body is restated
-- here (it is a CREATE OR REPLACE) with portal_collection_route in both lists.
CREATE OR REPLACE FUNCTION public.guard_contact_portal_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  -- Cheapest test first. Nothing about the login changed, so there is nothing
  -- to guard, and every ordinary write to this very busy table leaves here.
  IF TG_OP = 'UPDATE' AND NOT (
         NEW.portal_user_id           IS DISTINCT FROM OLD.portal_user_id
      OR NEW.portal_email             IS DISTINCT FROM OLD.portal_email
      OR NEW.portal_access            IS DISTINCT FROM OLD.portal_access
      OR NEW.portal_access_revoked_at IS DISTINCT FROM OLD.portal_access_revoked_at
      OR NEW.portal_access_set_by     IS DISTINCT FROM OLD.portal_access_set_by
      OR NEW.portal_access_set_at     IS DISTINCT FROM OLD.portal_access_set_at
      OR NEW.portal_collection_route  IS DISTINCT FROM OLD.portal_collection_route) THEN
    RETURN NEW;
  END IF;

  -- An INSERT that mentions none of them is an ordinary new customer.
  IF TG_OP = 'INSERT'
     AND NEW.portal_user_id IS NULL
     AND NEW.portal_email IS NULL
     AND NEW.portal_access IS NOT TRUE
     AND NEW.portal_access_revoked_at IS NULL
     AND NEW.portal_access_set_by IS NULL
     AND NEW.portal_access_set_at IS NULL
     AND coalesce(NEW.portal_collection_route, 'direct') = 'direct' THEN
    RETURN NEW;
  END IF;

  -- Not an end-user API role: the service role (which is what the
  -- portal-access route uses), the SQL editor, a migration, a DBA.
  IF coalesce(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A platform superadmin signed in as an ordinary user.
  IF to_regprocedure('public.is_superadmin()') IS NOT NULL
     AND public.is_superadmin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Portal logins are changed on the customer page, not directly. Use Provide DMS Access.'
    USING ERRCODE = 'insufficient_privilege';
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_contact_portal_columns() OWNER TO postgres;

-- AND THE TRIGGER ITSELF, which is the half that is easy to miss: it fires
-- `UPDATE OF` a list of six named columns, so an UPDATE touching only the new
-- seventh one never reached the function at all. Replacing the function left
-- the column wide open and nothing complained — scenario Q15 caught it.
DROP TRIGGER IF EXISTS trg_guard_contact_portal_columns ON public.contacts;
CREATE TRIGGER trg_guard_contact_portal_columns
  BEFORE INSERT OR UPDATE OF
    portal_user_id, portal_email, portal_access, portal_access_revoked_at,
    portal_access_set_by, portal_access_set_at, portal_collection_route
  ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_contact_portal_columns();

-- ── 3. Where the money has got to ────────────────────────────
-- A table and not columns on payments: the direct route has two hops and the
-- salesman route four, and the founder asked for a "logs view" — this is it.
CREATE TABLE IF NOT EXISTS public.payment_handovers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  payment_id  uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  -- The order of the hops. NOT a timestamp: two hops written by one statement
  -- share now() to the microsecond, so the log came out "salesman ->
  -- distributor" before "shop -> salesman". Scenario Q13b caught it.
  seq         smallint NOT NULL DEFAULT 1,
  -- 'shop' | 'salesman' | 'distributor' | 'company'
  from_party  text NOT NULL CHECK (from_party IN ('shop', 'salesman', 'distributor', 'company')),
  to_party    text NOT NULL CHECK (to_party   IN ('shop', 'salesman', 'distributor', 'company')),
  -- 'received' | 'rejected'. A rejection is a hop that did not complete, and it
  -- stays in the log: "the cheque bounced" is exactly what somebody needs to
  -- read later.
  outcome     text NOT NULL DEFAULT 'received' CHECK (outcome IN ('received', 'rejected')),
  reason      text,
  amount      numeric(15,2),
  happened_at timestamptz NOT NULL DEFAULT now(),
  -- Whoever recorded the hop: a member of staff, or a portal customer. Exactly
  -- one of the two, never both.
  by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  by_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_handovers_one_author CHECK (
    (by_profile_id IS NOT NULL) <> (by_contact_id IS NOT NULL)),
  CONSTRAINT payment_handovers_reason_on_reject CHECK (
    outcome <> 'rejected' OR coalesce(btrim(reason), '') <> ''),
  CONSTRAINT payment_handovers_not_to_itself CHECK (from_party <> to_party)
);

-- Before the indexes, not after: on a database that already has this table
-- from an earlier run of this file, an index naming `seq` fails if the column
-- is added afterwards. "Safe to run twice" has to be true on the second run.
ALTER TABLE public.payment_handovers
  ADD COLUMN IF NOT EXISTS seq smallint NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS payment_handovers_payment_idx
  ON public.payment_handovers (payment_id, seq);
CREATE INDEX IF NOT EXISTS payment_handovers_account_idx
  ON public.payment_handovers (account_id, happened_at DESC);

COMMENT ON TABLE public.payment_handovers IS
  'Who is holding this money. One row per hop: shop -> salesman -> distributor '
  '-> company. Separate from payments.status, which is whether the receipt is '
  'accepted, not where the cash is.';

ALTER TABLE public.payment_handovers ENABLE ROW LEVEL SECURITY;

-- Staff read and write their own account's rows; the portal reaches this table
-- only through the functions below, never directly.
DROP POLICY IF EXISTS payment_handovers_select ON public.payment_handovers;
CREATE POLICY payment_handovers_select ON public.payment_handovers
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS payment_handovers_insert ON public.payment_handovers;
CREATE POLICY payment_handovers_insert ON public.payment_handovers
  FOR INSERT WITH CHECK (public.is_account_member(account_id));

-- ── 4. The portal may write a payment ────────────────────────
-- enforce_payment_status_transition() refuses an Approved write unless
-- has_permission(auth.uid(), ...) says so, and a portal customer has no
-- profiles row, so it refuses them. Three ways through and only one is
-- acceptable: not a profiles row for outsiders (107 web files and 56 DB
-- functions read that table — the thing Plan 2 exists to avoid), not bypassing
-- the trigger (it also enforces the future-date ban, the backdating limit and
-- the mandatory cancellation reason, all of which must apply to a distributor),
-- but ONE MORE RECOGNISED CALLER: a transaction-local flag, set only inside
-- these definer functions, which have already checked that the payment belongs
-- to one of the caller's own shops. set_buying_status() uses the same pattern.
CREATE OR REPLACE FUNCTION public.portal_payment_flag_on()
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT set_config('ozzo.portal_write', 'on', true);
$$;
REVOKE ALL ON FUNCTION public.portal_payment_flag_on() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_payment_flag_off()
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT set_config('ozzo.portal_write', '', true);
$$;
REVOKE ALL ON FUNCTION public.portal_payment_flag_off() FROM public, anon, authenticated;

-- Record a receipt. Idempotent on p_payment_id, like portal_place_order, so a
-- retried submit on a slow connection replays instead of taking the money twice.
CREATE OR REPLACE FUNCTION public.portal_record_payment(
  p_payment_id   uuid,
  p_contact_id   uuid,
  p_amount       numeric,
  p_payment_type text DEFAULT 'Cash',
  p_date         date DEFAULT NULL,
  p_reference    text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_from_salesman boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller   uuid;
  v_acct     uuid;
  v_ids      uuid[];
  v_existing record;
  v_today    date;
  v_number   text;
  v_owner    uuid;
BEGIN
  SELECT contact_id, account_id INTO v_caller, v_acct FROM public.portal_caller();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'You cannot record payments. Ask your company.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'This receipt has no id.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_ids := public.portal_visible_contact_ids();
  IF p_contact_id IS NULL OR NOT (p_contact_id = any(v_ids)) THEN
    RAISE EXCEPTION 'That customer is not one of yours.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A replay must not become a way to read somebody else's receipt.
  SELECT id, payment_number, contact_id, status INTO v_existing
    FROM public.payments WHERE id = p_payment_id;
  IF v_existing.id IS NOT NULL THEN
    IF NOT (v_existing.contact_id = any(v_ids)) THEN
      RAISE EXCEPTION 'That receipt is not yours.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN jsonb_build_object('payment_id', v_existing.id,
                              'payment_number', v_existing.payment_number,
                              'status', v_existing.status,
                              'idempotent_replay', true);
  END IF;

  IF coalesce(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Enter an amount.' USING ERRCODE = 'check_violation';
  END IF;

  v_today := (now() AT TIME ZONE public.account_timezone(v_acct))::date;

  -- The owner is inherited from the customer's own row, so the rep responsible
  -- for that beat still sees the receipt. A portal login has no profiles row,
  -- and payments.user_id is NOT NULL.
  SELECT user_id INTO v_owner FROM public.contacts WHERE id = p_contact_id;

  PERFORM public.portal_payment_flag_on();
  -- payment_number is left NULL on purpose: trg_set_payment_number fills it
  -- BEFORE INSERT, which is also before NOT NULL is checked. A second
  -- generator here is how an account ends up with two receipt series.
  INSERT INTO public.payments (
    id, account_id, user_id, contact_id, amount,
    payment_type, payment_date, reference_number, notes, source, status
  ) VALUES (
    p_payment_id, v_acct, v_owner, p_contact_id, round(p_amount, 2),
    coalesce(nullif(btrim(p_payment_type), ''), 'Cash'),
    coalesce(p_date, v_today), nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), 'customer', 'Pending'
  );

  -- The first hop. A receipt the distributor took himself goes shop ->
  -- distributor; one his salesman brought in goes shop -> salesman first, so
  -- the log reads the way the money actually moved.
  IF p_from_salesman THEN
    INSERT INTO public.payment_handovers
      (account_id, payment_id, seq, from_party, to_party, amount, by_contact_id)
    VALUES (v_acct, p_payment_id, 1, 'shop', 'salesman', round(p_amount, 2), v_caller);
  END IF;
  INSERT INTO public.payment_handovers
    (account_id, payment_id, seq, from_party, to_party, amount, by_contact_id)
  VALUES (v_acct, p_payment_id,
          CASE WHEN p_from_salesman THEN 2 ELSE 1 END,
          CASE WHEN p_from_salesman THEN 'salesman' ELSE 'shop' END,
          'distributor', round(p_amount, 2), v_caller);
  PERFORM public.portal_payment_flag_off();

  SELECT payment_number INTO v_number FROM public.payments WHERE id = p_payment_id;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'payment_number', v_number,
                            'status', 'Pending', 'idempotent_replay', false);
END;
$fn$;

ALTER FUNCTION public.portal_record_payment(uuid, uuid, numeric, text, date, text, text, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_record_payment(uuid, uuid, numeric, text, date, text, text, boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_record_payment(uuid, uuid, numeric, text, date, text, text, boolean)
  TO authenticated, service_role;

-- ── 5. The portal may move a receipt's status — but only its own ──
-- A receipt from one of their shops is the distributor's own receivable, so
-- Approved / Rejected / Cancelled is his to set. A payment whose customer is
-- the distributor HIMSELF is money owed to the company, and only the company
-- says it has arrived.
CREATE OR REPLACE FUNCTION public.portal_set_payment_status(
  p_payment_id uuid,
  p_status     text,
  p_reason     text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_caller uuid;
  v_ids    uuid[];
  v_row    record;
  v_hit    int;
BEGIN
  SELECT contact_id INTO v_caller FROM public.portal_caller();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'You cannot change a receipt. Ask your company.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_status NOT IN ('Approved', 'Rejected', 'Cancelled') THEN
    RAISE EXCEPTION 'A receipt can be Approved, Rejected or Cancelled.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_ids := public.portal_visible_contact_ids();
  SELECT id, contact_id, status INTO v_row FROM public.payments WHERE id = p_payment_id;
  IF v_row.id IS NULL OR NOT (v_row.contact_id = any(v_ids)) THEN
    RAISE EXCEPTION 'That receipt is not yours.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The line the money draws: his shops' money is his, his own dues are ours.
  IF v_row.contact_id = v_caller THEN
    RAISE EXCEPTION 'Your company confirms this one.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public.portal_payment_flag_on();
  UPDATE public.payments
     SET status = p_status,
         rejection_reason = CASE WHEN p_status = 'Rejected'
                                 THEN nullif(btrim(coalesce(p_reason, '')), '')
                                 ELSE rejection_reason END,
         cancellation_reason = CASE WHEN p_status = 'Cancelled'
                                    THEN nullif(btrim(coalesce(p_reason, '')), '')
                                    ELSE cancellation_reason END
   WHERE id = p_payment_id;
  GET DIAGNOSTICS v_hit = ROW_COUNT;

  -- A rejection is a hop that did not complete: the money went back.
  IF p_status = 'Rejected' THEN
    INSERT INTO public.payment_handovers
      (account_id, payment_id, seq, from_party, to_party, outcome, reason, by_contact_id)
    SELECT p.account_id, p.id,
           (SELECT coalesce(max(h.seq), 0) + 1 FROM public.payment_handovers h
             WHERE h.payment_id = p.id),
           'distributor', 'salesman', 'rejected',
           nullif(btrim(coalesce(p_reason, '')), ''), v_caller
      FROM public.payments p WHERE p.id = p_payment_id;
  END IF;
  PERFORM public.portal_payment_flag_off();

  RETURN v_hit = 1;
END;
$fn$;

ALTER FUNCTION public.portal_set_payment_status(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_set_payment_status(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_set_payment_status(uuid, text, text)
  TO authenticated, service_role;

-- ── 6. The trigger learns the portal caller ──────────────────
-- Every other rule in enforce_payment_status_transition still runs: the future
-- date ban, the backdating limit, the transition table, the mandatory
-- cancellation reason, the audit stamps. What changes is that the three
-- permission branches also accept a caller the portal functions above have
-- already vouched for — and that flag is transaction-local and cleared by the
-- function that set it, so it cannot leak into the next statement.
CREATE OR REPLACE FUNCTION public.portal_payment_write_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(current_setting('ozzo.portal_write', true), '') = 'on';
$$;
GRANT EXECUTE ON FUNCTION public.portal_payment_write_allowed() TO authenticated, service_role;

-- The whole body is restated (CREATE OR REPLACE) with one clause added to each
-- of the five permission branches. Nothing else changes: compare it against
-- migration 20260814210000 and the only new text is
-- `AND NOT public.portal_payment_write_allowed()`.
CREATE OR REPLACE FUNCTION enforce_payment_status_transition()
RETURNS trigger AS $trg$
DECLARE
  v_approval_required boolean;
  v_settings jsonb;
  v_backdate_days int;
  v_age_days int;
BEGIN
  SELECT COALESCE(a.settings, '{}'::jsonb) INTO v_settings FROM accounts a WHERE a.id = NEW.account_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'Payment date cannot be in the future' USING ERRCODE = 'check_violation';
    END IF;

    v_backdate_days := COALESCE((v_settings->'payment_settings'->>'allow_backdate_days')::int, 30);
    v_age_days := CURRENT_DATE - NEW.payment_date;

    -- Deliberately NOT relaxed for the portal: a distributor backdating a
    -- collection past the account's limit is the same risk as a rep doing it.
    IF v_age_days > v_backdate_days THEN
      IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), NEW.account_id, 'backdate_payments'::text) THEN
        RAISE EXCEPTION 'Payment date is % days old; limit is % days. backdate_payments permission required.',
          v_age_days, v_backdate_days USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    v_approval_required := COALESCE((v_settings->'payment_settings'->>'approval_required')::boolean, true);

    IF NEW.status = 'Approved' AND COALESCE(v_approval_required, true) THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text)
         AND NOT public.portal_payment_write_allowed() THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;

    IF NEW.status = 'Rejected' THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text)
         AND NOT public.portal_payment_write_allowed() THEN
        RAISE EXCEPTION 'Permission denied: approve_payments required';
      END IF;
    END IF;

    IF NEW.status = 'Cancelled' THEN
      IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'cancel_payments'::text)
         AND NOT public.portal_payment_write_allowed() THEN
        RAISE EXCEPTION 'Permission denied: cancel_payments required';
      END IF;
      IF NEW.cancellation_reason IS NULL OR btrim(NEW.cancellation_reason) = '' THEN
        RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = 'check_violation';
      END IF;
      NEW.cancelled_by := COALESCE(NEW.cancelled_by, auth.uid());
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'Approved' AND NEW.status <> 'Cancelled' THEN
      RAISE EXCEPTION 'Approved payments are read-only. They can only be cancelled.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT payment_status_transition_allowed(OLD.status, NEW.status) THEN
        RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status;
      END IF;

      IF NEW.status IN ('Approved', 'Rejected') THEN
        IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'approve_payments'::text)
           AND NOT public.portal_payment_write_allowed() THEN
          RAISE EXCEPTION 'Permission denied: approve_payments required';
        END IF;
      END IF;

      IF NEW.status = 'Cancelled' THEN
        IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), NEW.account_id, 'cancel_payments'::text)
           AND NOT public.portal_payment_write_allowed() THEN
          RAISE EXCEPTION 'Permission denied: cancel_payments required';
        END IF;
        IF NEW.cancellation_reason IS NULL OR btrim(NEW.cancellation_reason) = '' THEN
          RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = 'check_violation';
        END IF;
        NEW.cancelled_by := COALESCE(NEW.cancelled_by, auth.uid());
        NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$trg$ LANGUAGE plpgsql;
