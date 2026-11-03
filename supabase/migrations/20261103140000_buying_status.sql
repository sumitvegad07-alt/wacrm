-- ============================================================
-- Buying Status — Buyer / Yet to Buy.
--
-- Founder request: mark, by itself, which customers have ever placed an order
-- and which never have.
--
-- WHY IT IS NOT Active / Inactive. Every module already has Active / Inactive,
-- and it answers a filing question: "is this record still in use?" This is a
-- different question: "has this customer ever bought?" Reusing one for the
-- other would hide exactly the customers a rep is visiting — a dealer who has
-- never ordered is a perfectly current customer, and the rep is calling on him
-- BECAUSE he has not ordered yet. Marking him Inactive removes him from the
-- lists of the very people whose job it is to open him.
--
-- "Yet to Buy" is an instruction rather than a label: Inactive tells a rep to
-- ignore someone, Yet to Buy tells him to go and sell.
--
-- WHY NOT CUSTOM FIELDS, since the founder asked directly:
--   * A custom field is a value a human types. Automating it needs a trigger
--     writing into contact_custom_values — code either way, and code writing
--     into a field the admin can rename, deactivate or delete.
--   * It has to be filterable and sortable on the list, in Manage Column, in
--     the report engine, and readable by the mobile list without a join. A
--     real column gets all of that for nothing.
--   * The manual override needs a second stored fact — "a human decided this" —
--     so the automatic rule knows to stop. Two custom fields kept in step by a
--     trigger is strictly worse than two columns.
--
-- RECOUNT, NOT A COUNTER. A stored count would drift the first time anything
-- wrote to orders outside the trigger's assumptions, and this table is written
-- by the importer, the offline queue and the demo seeder as well as the order
-- form. The trigger asks the question again each time.
--
-- ───────────────────────────────────────────────────────────────
-- THE TRAP THIS MIGRATION HAD TO BE DESIGNED AROUND
--
-- `trg_enforce_contact_hierarchy_level` (migration 076) is BEFORE INSERT OR
-- UPDATE on contacts, and it RAISES whenever the account has order hierarchy
-- enabled and the row's hierarchy_level is NULL. Its own comment calls that
-- deliberate and self-healing: "every edit forces cleanup".
--
-- That is fine for a human edit. It is not fine for a system-maintained column:
-- a plain `UPDATE contacts SET buying_status = ...` fired from an order trigger
-- would be REJECTED for any level-less customer in a hierarchy account, and
-- because the trigger runs inside the order's own transaction, THE ORDER WOULD
-- FAIL TO SAVE. The accounts that would break are precisely the FMCG tenants
-- running primary/secondary hierarchy — the ones this whole batch is for.
--
-- Reproduced on a local PostgreSQL 17.6 before writing a line of this:
--   update contacts set is_active = true where <level-less customer>;
--   ERROR: Customer Level is required because order hierarchy is enabled ...
--
-- So a system write marks itself, and the enforcement trigger lets it through.
-- The flag is transaction-local and is cleared the moment the UPDATE is done,
-- so every human path — web form, mobile, importer, lead conversion — still
-- hits the enforcement exactly as before. Nothing about the rule for people
-- changes; it simply stops applying to a column no person typed.
--
-- The trigger also skips the write entirely when nothing would change, which
-- keeps it off the contacts row for the overwhelming majority of order saves.
-- ───────────────────────────────────────────────────────────────
--
-- Blast radius: two new columns with safe defaults, backfilled from existing
-- order history so the answer is right on day one rather than only for new
-- business. No list, form or report shows any of it until the module is
-- switched on in Organisation Settings.
-- ============================================================

-- ── 1. The columns ───────────────────────────────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS buying_status text NOT NULL DEFAULT 'yet_to_buy',
  ADD COLUMN IF NOT EXISTS buying_status_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS buying_status_set_by uuid NULL REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS buying_status_set_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS first_order_at timestamptz NULL;

-- Separate so it is added even on a database where the column already existed.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_buying_status_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_buying_status_check
      CHECK (buying_status IN ('buyer', 'yet_to_buy'));
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS contacts_buying_status_idx
  ON public.contacts (account_id, buying_status);

COMMENT ON COLUMN public.contacts.buying_status IS
  'Has this customer ever placed an order that was not Cancelled or Rejected? buyer | yet_to_buy. '
  'Maintained by trg_sync_buying_status unless buying_status_locked is true. NOT the same question '
  'as is_active, which asks whether the record is still in use.';
COMMENT ON COLUMN public.contacts.buying_status_locked IS
  'True once a human set the status by hand. The automatic rule then leaves this row alone until an admin clears the lock.';
COMMENT ON COLUMN public.contacts.first_order_at IS
  'Date of the earliest order that counts, taken from orders.date (so a backdated order counts on its own date). '
  'Only the date part is meaningful — it is stored at midnight.';

-- ── 2. The system-write marker ───────────────────────────────
CREATE OR REPLACE FUNCTION public.is_ozzo_system_write()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(current_setting('ozzo.system_write', true), '') = 'on';
$$;

COMMENT ON FUNCTION public.is_ozzo_system_write() IS
  'True only inside a trigger that has marked itself as maintaining a derived column. Set with '
  'set_config(''ozzo.system_write'', ''on'', true) immediately before the write and cleared '
  'immediately after, so it can never cover a human edit.';

-- Enforcement trigger, carried over verbatim from migration 076 except for the
-- one new guard. A derived column is not an edit, and blocking an order save
-- over a missing Customer Level would be far worse than the missing level.
CREATE OR REPLACE FUNCTION public.enforce_contact_hierarchy_level()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_hierarchy_enabled BOOLEAN;
BEGIN
  IF public.is_ozzo_system_write() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((settings -> 'order_settings' ->> 'hierarchy_enabled')::boolean, false)
    INTO v_hierarchy_enabled
  FROM accounts
  WHERE id = NEW.account_id;

  IF COALESCE(v_hierarchy_enabled, false) AND NEW.hierarchy_level IS NULL THEN
    RAISE EXCEPTION
      'Customer Level is required because order hierarchy is enabled for this account. Set the customer''s level and save again.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. One customer's status, recounted from order history ───
-- An order counts unless it was Cancelled or Rejected: it was placed, but it
-- did not happen. Matched case-insensitively because orders.status is free text
-- (its own default is 'Placed', which is not even in the canonical list).
CREATE OR REPLACE FUNCTION public.recount_buying_status(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_first  timestamptz;
  v_row    public.contacts;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND OR v_row.buying_status_locked THEN
    RETURN;                       -- a human has decided this one
  END IF;

  SELECT min(o.date)::timestamptz
    INTO v_first
    FROM public.orders o
   WHERE o.contact_id = p_contact_id
     AND lower(btrim(coalesce(o.status, ''))) NOT IN ('cancelled', 'rejected');

  v_status := CASE WHEN v_first IS NULL THEN 'yet_to_buy' ELSE 'buyer' END;

  -- Nothing to do is the common case. Skipping the write keeps this off the
  -- contacts row for almost every order save, which matters because contacts
  -- carries several BEFORE-write triggers of its own.
  IF v_row.buying_status = v_status AND v_row.first_order_at IS NOT DISTINCT FROM v_first THEN
    RETURN;
  END IF;

  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE public.contacts
     SET buying_status = v_status,
         first_order_at = v_first
   WHERE id = p_contact_id;
  PERFORM set_config('ozzo.system_write', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_buying_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Both sides, because an order can be moved from one customer to another and
  -- the customer it LEFT may no longer have any order at all.
  IF TG_OP <> 'INSERT' AND OLD.contact_id IS NOT NULL THEN
    PERFORM recount_buying_status(OLD.contact_id);
  END IF;
  -- On an UPDATE that did not move the order, the line above has already
  -- recounted this customer, so only a genuine move needs the second call.
  IF TG_OP <> 'DELETE' AND NEW.contact_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.contact_id IS DISTINCT FROM OLD.contact_id) THEN
    PERFORM recount_buying_status(NEW.contact_id);
  END IF;
  RETURN NULL;                     -- AFTER trigger
END;
$$;

-- UPDATE OF status, contact_id and date only: an order's amount or notes
-- changing cannot alter the answer, so it must not cost a recount.
DROP TRIGGER IF EXISTS trg_sync_buying_status ON public.orders;
CREATE TRIGGER trg_sync_buying_status
  AFTER INSERT OR DELETE OR UPDATE OF status, contact_id, date ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_buying_status();

-- ── 4. Manual override ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_buying_status(
  p_contact_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_account uuid;
  v_profile uuid;
BEGIN
  IF p_status NOT IN ('buyer', 'yet_to_buy') THEN
    RAISE EXCEPTION 'Buying Status must be buyer or yet_to_buy' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account FROM public.contacts WHERE id = p_contact_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_profile
    FROM public.profiles WHERE user_id = v_uid AND account_id = v_account;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not a member of this account' USING ERRCODE = '42501';
  END IF;

  IF NOT (is_account_member(v_account, 'admin'::account_role_enum)
          OR has_permission(v_uid, v_account, 'manage_buying_status')) THEN
    RAISE EXCEPTION 'Not allowed to set Buying Status' USING ERRCODE = '42501';
  END IF;

  -- Setting it by hand locks it, so the automatic rule stops arguing.
  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE public.contacts
     SET buying_status = p_status,
         buying_status_locked = true,
         buying_status_set_by = v_profile,
         buying_status_set_at = now()
   WHERE id = p_contact_id;
  PERFORM set_config('ozzo.system_write', '', true);
END;
$$;

-- Clearing the lock hands the customer back to the automatic rule and re-runs
-- it at once, so the admin sees the real answer immediately. Admin only.
CREATE OR REPLACE FUNCTION public.clear_buying_status_lock(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
BEGIN
  SELECT account_id INTO v_account FROM public.contacts WHERE id = p_contact_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = '42501';
  END IF;
  IF NOT is_account_member(v_account, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'Only an admin may release a Buying Status set by hand' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('ozzo.system_write', 'on', true);
  UPDATE public.contacts
     SET buying_status_locked = false,
         buying_status_set_by = NULL,
         buying_status_set_at = NULL
   WHERE id = p_contact_id;
  PERFORM set_config('ozzo.system_write', '', true);

  PERFORM recount_buying_status(p_contact_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_buying_status(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.clear_buying_status_lock(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.set_buying_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_buying_status_lock(uuid) TO authenticated;

-- ── 5. Backfill, every account, from real order history ──────
-- One statement rather than a loop over recount_buying_status, so this is quick
-- on a table with a few hundred thousand contacts. Locked rows are left alone
-- (there are none the first time this runs, and that matters if it is re-run).
DO $do$
BEGIN
  PERFORM set_config('ozzo.system_write', 'on', true);

  WITH firsts AS (
    SELECT o.contact_id, min(o.date)::timestamptz AS first_at
      FROM public.orders o
     WHERE o.contact_id IS NOT NULL
       AND lower(btrim(coalesce(o.status, ''))) NOT IN ('cancelled', 'rejected')
     GROUP BY o.contact_id
  )
  UPDATE public.contacts c
     SET buying_status = CASE WHEN f.first_at IS NULL THEN 'yet_to_buy' ELSE 'buyer' END,
         first_order_at = f.first_at
    FROM firsts f
   WHERE c.id = f.contact_id
     AND NOT c.buying_status_locked
     AND (c.buying_status IS DISTINCT FROM 'buyer'
          OR c.first_order_at IS DISTINCT FROM f.first_at);

  PERFORM set_config('ozzo.system_write', '', true);
END
$do$;
