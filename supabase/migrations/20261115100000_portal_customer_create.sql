-- ============================================================
-- A distributor adds their own shop.
--
-- Founder, 2026-11-15: "Do you think we need to provide options to create new
-- customers? Currently Distributors can not do it."
--
-- Yes, and chiefly because PLACING AN ORDER DOES NOT WORK WITHOUT IT. The next
-- migration lets a distributor order for one of their own shops; a shop that is
-- not in the system cannot be ordered for, so the first new retailer becomes a
-- phone call to the company — the exact cost the DMS exists to remove.
--
-- WHAT THIS DELIBERATELY DOES NOT LET THEM SET. Credit limit, price list, area,
-- territory, customer code, buying status and hierarchy level are the company's
-- levers over its own risk, and none of them is a parameter here. parent_id is
-- not a parameter either — it is read from the caller's own row, so there is no
-- value a browser could send that would file the shop under somebody else.
--
-- OFF BY DEFAULT. accounts.settings->'dms_settings'->>'allow_customer_create'.
-- A company that wants its field team to own every customer record must not
-- find this switched on underneath them, the same reasoning as reporting
-- hierarchy and secondary sales.
--
-- THE DUPLICATE PROBLEM IS ALREADY SOLVED and not by this file:
-- idx_contacts_account_phone_normalized refuses a second customer on the same
-- phone number for every writer, this one included. Scenario V6 proves it still
-- does rather than assuming it.
--
-- WHO OWNS THE NEW ROW. contacts.user_id is NOT NULL and references an auth
-- user, and a portal customer is not an employee. It is inherited from the
-- PARENT's row, so the rep who owns the distributor also owns the shops the
-- distributor adds — otherwise the company's own data scoping would hide them
-- from the very person responsible for that beat.
--
-- THE LEVEL. enforce_customer_parent demands a parent strictly above the child
-- when both have a level, and migration 076 refuses every write to a level-less
-- customer while order hierarchy is on. One rule satisfies both: the new shop
-- sits one level below whoever created it, or has no level if they have none.
--
-- Blast radius: one new column with a default, two new functions. No existing
-- policy, trigger or function is edited.
-- ============================================================

-- ── 1. Where a customer came from ────────────────────────────
-- 'app' for everything that exists today, so no row changes meaning.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'app';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_created_via_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_created_via_check
      CHECK (created_via IN ('app', 'import', 'portal', 'api'));
  END IF;
END $$;

COMMENT ON COLUMN public.contacts.created_via IS
  'Who put this customer here. ''portal'' means a distributor added it themselves.';

-- ── 2. May this caller add one at all? ───────────────────────
CREATE OR REPLACE FUNCTION public.portal_can_create_customer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  select coalesce(
    (select (a.settings->'dms_settings'->>'allow_customer_create')::boolean
       from public.portal_caller() pc
       join public.accounts a on a.id = pc.account_id),
    false);
$$;

ALTER FUNCTION public.portal_can_create_customer() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_can_create_customer() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_can_create_customer() TO authenticated;

-- WHY search_path IS public AND NOT '' HERE.
-- Every read-only portal function pins search_path to the empty string and
-- qualifies every name itself, which is the strictest setting. A function that
-- WRITES cannot: the triggers on contacts (the customer-code generator, the
-- territory denormaliser, enforce_customer_parent) and the engines this gate
-- calls (create_order, calculate_order_pricing, detect_eligible_schemes) are
-- older plpgsql that names its tables unqualified, and a function it is called
-- from with an empty search_path makes every one of those fail with
-- `relation "accounts" does not exist` — which is exactly how the first run of
-- 71 and 72 aborted. `= public` is still a pin: the caller cannot change it,
-- and it is what every other SECURITY DEFINER function in this schema uses.
-- ── 3. Add the shop ──────────────────────────────────────────
-- Returns the new id, or NULL when the caller may not. NULL rather than an
-- exception because the screen asks portal_can_create_customer() first and only
-- shows the form when it is true — a refusal here means somebody called the
-- function directly, and that caller is owed nothing but a no.
CREATE OR REPLACE FUNCTION public.portal_create_customer(
  p_name    text,
  p_company text DEFAULT NULL,
  p_phone   text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city    text DEFAULT NULL,
  p_gstin   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid;
  v_account uuid;
  v_owner   uuid;
  v_level   int;
  v_new     uuid;
BEGIN
  SELECT contact_id, account_id INTO v_caller, v_account FROM public.portal_caller();
  IF v_caller IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT public.portal_can_create_customer() THEN
    RETURN NULL;
  END IF;

  IF coalesce(btrim(p_name), '') = '' OR coalesce(btrim(p_phone), '') = '' THEN
    RAISE EXCEPTION 'A name and a phone number are needed.' USING ERRCODE = '23514';
  END IF;

  -- The owner and the level both come from the caller's own row. Neither is a
  -- parameter, so neither can be supplied by a browser.
  SELECT user_id, hierarchy_level INTO v_owner, v_level
    FROM public.contacts WHERE id = v_caller;

  -- parent_locked, and this is not a detail. In AREA mapping mode
  -- trg_area_parent_sync owns parent_id: it fires BEFORE INSERT and replaces
  -- whatever was passed with the parent its area/level table resolves — which
  -- for a brand-new shop with no territory is NULL. The shop would then belong
  -- to nobody, and portal_visible_contact_ids walks parent_id, so the
  -- distributor who had just added it could not see it. parent_locked is that
  -- trigger's own documented escape hatch ("deliberately overridden, leave
  -- it"), and a shop a distributor adds IS a deliberate override: they supply
  -- it. Scenario V3b proves it with the account in area mode.
  INSERT INTO public.contacts (
    account_id, user_id, name, company, phone, address, city, gst_number,
    parent_id, parent_locked, hierarchy_level, created_via
  ) VALUES (
    v_account, v_owner, btrim(p_name), nullif(btrim(coalesce(p_company, '')), ''),
    btrim(p_phone), nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''), nullif(btrim(upper(coalesce(p_gstin, ''))), ''),
    v_caller,
    true,
    CASE WHEN v_level IS NULL THEN NULL ELSE v_level + 1 END,
    'portal'
  )
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;

ALTER FUNCTION public.portal_create_customer(text, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_create_customer(text, text, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_create_customer(text, text, text, text, text, text) TO authenticated;

-- ── 4. Correct a shop they added themselves ──────────────────
-- Only a row they created, and only these six fields. A customer the COMPANY
-- created is never editable here: the company owns that record, and a
-- distributor quietly changing a name or a GSTIN on it would be invisible.
CREATE OR REPLACE FUNCTION public.portal_update_my_customer(
  p_contact_id uuid,
  p_name       text,
  p_company    text DEFAULT NULL,
  p_phone      text DEFAULT NULL,
  p_address    text DEFAULT NULL,
  p_city       text DEFAULT NULL,
  p_gstin      text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_hit    int;
BEGIN
  SELECT contact_id INTO v_caller FROM public.portal_caller();
  IF v_caller IS NULL OR p_contact_id IS NULL THEN
    RETURN false;
  END IF;

  IF coalesce(btrim(p_name), '') = '' OR coalesce(btrim(p_phone), '') = '' THEN
    RAISE EXCEPTION 'A name and a phone number are needed.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.contacts c
     SET name    = btrim(p_name),
         company = nullif(btrim(coalesce(p_company, '')), ''),
         phone   = btrim(p_phone),
         address = nullif(btrim(coalesce(p_address, '')), ''),
         city    = nullif(btrim(coalesce(p_city, '')), ''),
         gst_number = nullif(btrim(upper(coalesce(p_gstin, ''))), '')
   WHERE c.id = p_contact_id
     -- Three conditions, and every one of them matters: their own creation,
     -- still filed under them, and not somebody else's tenant.
     AND c.created_via = 'portal'
     AND c.parent_id = v_caller
     AND c.account_id = (SELECT account_id FROM public.portal_caller());

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit = 1;
END;
$$;

ALTER FUNCTION public.portal_update_my_customer(uuid, text, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.portal_update_my_customer(uuid, text, text, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_update_my_customer(uuid, text, text, text, text, text, text) TO authenticated;
