-- ============================================================
-- Payment parity: the proof photo, the full record, and the log.
--
-- Founder, 2026-11-15: "our New payment entry is not a new screen it's just a
-- new pop-up box ... make it similar to our web admin with photo proof and all
-- all the fields ... including payment view screen must be the similar with
-- proper logs and all."
--
-- Three things, in the order the screen needs them:
--   1. portal_record_payment takes a DATE and a PROOF, like the admin form.
--   2. portal_payment_detail returns one receipt in full, with its log.
--   3. a portal customer may put a file in the proof bucket, and read back
--      only the ones they put there.
--
-- WHY THE PROOF NEEDS A POLICY AT ALL. payment_attachments was privatised and
-- scoped by is_account_member(first path segment) in 20260814190000 — correct,
-- and false for a portal customer, who has no profiles row by design. So the
-- portal cannot upload today. Rather than loosen the staff policy, this adds a
-- second, narrower one: the caller's OWN account, under a path segment that
-- names them, and nothing else in the bucket.
--
-- Five questions (WORKING-AGREEMENT):
--   second FK between two tables? no table is altered.
--   does a touched column appear in a .select() string? none is touched.
--   new trigger/policy/constraint on a written table? two storage policies,
--     both ADDITIVE and both narrower than the staff ones beside them. No
--     existing policy is changed, so no member of staff gains or loses access.
--   can an existing row fail a new rule? no rule is applied to existing rows.
--   a tenant without the add-on? portal_caller() is empty, so the functions
--     answer nothing and the policies match nobody.
-- ============================================================

-- ── 1. Record a payment, with the date and the proof ─────────
-- The signature grows, so the previous one is dropped at the end: two
-- overloads and PostgREST answers "function is not unique".
CREATE OR REPLACE FUNCTION public.portal_record_payment(
  p_payment_id    uuid,
  p_contact_id    uuid,
  p_amount        numeric,
  p_payment_type  text DEFAULT 'Cash',
  p_date          date DEFAULT NULL,
  p_reference     text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_from_salesman boolean DEFAULT false,
  -- The object path in the payment_attachments bucket, uploaded by the browser
  -- just before this call. A PATH, never a URL: the bucket is private and the
  -- app mints a short-lived signed URL to read it back, exactly as the admin
  -- app does.
  p_proof_path    text DEFAULT NULL,
  p_proof_name    text DEFAULT NULL,
  p_proof_size    bigint DEFAULT NULL,
  p_proof_type    text DEFAULT NULL
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
  SELECT user_id INTO v_owner FROM public.contacts WHERE id = p_contact_id;

  PERFORM public.portal_payment_flag_on();
  -- The date is the reader's now, not just today: the admin form has a date
  -- field and so does this one. What keeps it honest is the trigger, which
  -- still refuses a future date and still enforces the account's backdating
  -- limit — for a distributor exactly as for a rep.
  INSERT INTO public.payments (
    id, account_id, user_id, contact_id, amount,
    payment_type, payment_date, reference_number, notes, source, status
  ) VALUES (
    p_payment_id, v_acct, v_owner, p_contact_id, round(p_amount, 2),
    coalesce(nullif(btrim(p_payment_type), ''), 'Cash'),
    coalesce(p_date, v_today), nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), 'customer', 'Pending'
  );

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

  -- The proof, if the browser managed to upload one. payment_attachments.user_id
  -- is NOT NULL and references an auth user; the portal login IS one, so the
  -- row records who really attached it.
  IF nullif(btrim(coalesce(p_proof_path, '')), '') IS NOT NULL THEN
    INSERT INTO public.payment_attachments
      (payment_id, user_id, file_name, file_url, file_size, content_type)
    VALUES (p_payment_id, (SELECT auth.uid()),
            coalesce(nullif(btrim(p_proof_name), ''), 'proof'),
            btrim(p_proof_path), p_proof_size, p_proof_type);
  END IF;
  PERFORM public.portal_payment_flag_off();

  SELECT payment_number INTO v_number FROM public.payments WHERE id = p_payment_id;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'payment_number', v_number,
                            'status', 'Pending', 'idempotent_replay', false);
END;
$fn$;

ALTER FUNCTION public.portal_record_payment(uuid, uuid, numeric, text, date, text, text, boolean, text, text, bigint, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_record_payment(uuid, uuid, numeric, text, date, text, text, boolean, text, text, bigint, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_record_payment(uuid, uuid, numeric, text, date, text, text, boolean, text, text, bigint, text)
  TO authenticated, service_role;

-- The eight-argument version from 20261116100000 must not survive beside this
-- one: PostgREST answers "function is not unique" when two overloads match.
DROP FUNCTION IF EXISTS public.portal_record_payment(uuid, uuid, numeric, text, date, text, text, boolean);

-- ── 2. One receipt, in full, with its log ────────────────────
CREATE OR REPLACE FUNCTION public.portal_payment_detail(p_payment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  select jsonb_build_object(
           'id',               p.id,
           'payment_number',   p.payment_number,
           'payment_date',     p.payment_date,
           'customer_id',      p.contact_id,
           'customer_name',    coalesce(c.company, c.name),
           'amount',           p.amount,
           'verified_amount',  p.verified_amount,
           'payment_type',     p.payment_type,
           'reference_number', p.reference_number,
           'notes',            p.notes,
           'status',           p.status,
           -- Whose money this is, answered once here so no screen has to work
           -- it out again: 'mine' is the distributor's own dues to the company.
           'is_my_own_due',    (p.contact_id = (select contact_id from public.portal_caller())),
           'approved_at',      p.approved_at,
           'rejected_at',      p.rejected_at,
           'rejection_reason', p.rejection_reason,
           'cancelled_at',     p.cancelled_at,
           'cancellation_reason', p.cancellation_reason,
           -- The log the founder asked for: every hop the money made, in order,
           -- plus the rejections, which are hops that did not complete.
           'handovers', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'seq',         h.seq,
                      'from_party',  h.from_party,
                      'to_party',    h.to_party,
                      'outcome',     h.outcome,
                      'reason',      h.reason,
                      'amount',      h.amount,
                      'happened_at', h.happened_at
                    ) order by h.seq, h.happened_at), '[]'::jsonb)
               from public.payment_handovers h where h.payment_id = p.id),
           -- The object PATH only. The app mints a short-lived signed URL to
           -- show it, because the bucket is private and a cheque image must
           -- not be reachable by guessing a URL.
           'attachments', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'file_name',    pa.file_name,
                      'path',         pa.file_url,
                      'content_type', pa.content_type,
                      'created_at',   pa.created_at
                    ) order by pa.created_at), '[]'::jsonb)
               from public.payment_attachments pa where pa.payment_id = p.id)
         )
    from public.payments p
    left join public.contacts c on c.id = p.contact_id
   where p.id = p_payment_id
     and p.contact_id = any(public.portal_visible_contact_ids());
$fn$;

ALTER FUNCTION public.portal_payment_detail(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_payment_detail(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_payment_detail(uuid) TO authenticated, service_role;

-- ── 3. A portal customer may attach a proof ──────────────────
-- Additive: the two staff policies from 20260814190000 are untouched, so no
-- member of staff gains or loses anything. These two are narrower — the
-- caller's own account, and a path that names the caller:
--     <account_id>/portal/<contact_id>/<uuid>.<ext>
-- Segment 1 stays the account id so the existing staff SELECT keeps working
-- over portal uploads too, which is what lets the company see the proof.
DROP POLICY IF EXISTS "payment_attachments_portal_insert" ON storage.objects;
CREATE POLICY "payment_attachments_portal_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment_attachments'
    AND (storage.foldername(name))[2] = 'portal'
    AND ((storage.foldername(name))[1])::uuid
        = (SELECT account_id FROM public.portal_caller())
    AND ((storage.foldername(name))[3])::uuid
        = (SELECT contact_id FROM public.portal_caller())
  );

DROP POLICY IF EXISTS "payment_attachments_portal_select" ON storage.objects;
CREATE POLICY "payment_attachments_portal_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment_attachments'
    AND (storage.foldername(name))[2] = 'portal'
    AND ((storage.foldername(name))[1])::uuid
        = (SELECT account_id FROM public.portal_caller())
    AND ((storage.foldername(name))[3])::uuid
        = (SELECT contact_id FROM public.portal_caller())
  );
