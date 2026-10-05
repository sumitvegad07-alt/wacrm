-- ============================================================
-- 20261005150000_lead_dedupe_and_unique_keys.sql
--
-- Founder (2026-10-05), on learning customer phones are already hard-blocked:
--   "if we already have phone number is hard blocked then no need to develop it.
--    But yes this functionality also belongs to leads as well, if not then build it."
--
-- Leads had NO duplicate protection of any kind. Checked against the live
-- database: `leads` carried only its primary key, while `contacts` has had a
-- unique index on (account_id, phone_normalized) since migration 022.
--
-- This migration gives leads the same phone guarantee, and adds the database
-- backstop for the fields an admin ticks (name / customer code on customers,
-- name / email on leads) which until now were only checked in the browser — so
-- two reps saving the same name at the same moment, an import, or a direct API
-- call could all slip a duplicate through.
--
-- Safe to apply: checked on 2026-10-05 and the live data has ZERO duplicate lead
-- phones, lead names, lead emails, customer names or customer codes.
--
-- Mirrors src/lib/dedupe/unique-keys.ts. Products are deliberately untouched.
-- ============================================================

-- ── 1. Leads get the customer phone guarantee ────────────────
-- Same expression as contacts (migration 022) and the same as normalizePhone()
-- in src/lib/whatsapp/phone-utils.ts: strip every non-digit.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT
  GENERATED ALWAYS AS (regexp_replace(phone, '\D', '', 'g')) STORED;

-- Partial, so leads without a phone are still allowed — and there may be many of
-- them, which a plain unique index would reject after the first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_account_phone_normalized
  ON public.leads (account_id, phone_normalized)
  WHERE phone_normalized <> '';

-- ── 2. The admin's ticked keys, enforced in the database ─────
-- The browser already checks these and gives a good message with a link to the
-- existing record; this is the backstop that a race, an import or a direct API
-- call cannot get past.
--
-- Comparison is case-insensitive on the trimmed value, matching the `ilike`
-- the forms use. Only ACTIVE records collide: a soft-deleted customer is
-- history, and its name should not block a new one.

CREATE OR REPLACE FUNCTION public.enforce_unique_keys()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_keys jsonb;
  v_setting text;
  v_exists boolean;
BEGIN
  IF TG_TABLE_NAME = 'contacts' THEN
    SELECT COALESCE(settings->'extra_settings'->'customer_unique_keys', 'null'::jsonb)
      INTO v_keys FROM accounts WHERE id = NEW.account_id;

    -- No list saved yet: fall back to the single-choice setting, which has
    -- defaulted to "name" since duplicate prevention shipped.
    IF v_keys IS NULL OR jsonb_typeof(v_keys) <> 'array' THEN
      SELECT COALESCE(settings->'extra_settings'->>'customer_unique_key', 'name')
        INTO v_setting FROM accounts WHERE id = NEW.account_id;
      v_keys := jsonb_build_array(v_setting);
    END IF;

    IF v_keys ? 'name' AND COALESCE(btrim(NEW.name), '') <> '' THEN
      SELECT EXISTS (
        SELECT 1 FROM contacts x
         WHERE x.account_id = NEW.account_id AND x.id <> NEW.id
           AND COALESCE(x.is_active, true) IS TRUE
           AND lower(btrim(x.name)) = lower(btrim(NEW.name))
      ) INTO v_exists;
      IF v_exists THEN
        RAISE EXCEPTION 'A customer with this name already exists.' USING ERRCODE = '23505';
      END IF;
    END IF;

    IF v_keys ? 'code' AND COALESCE(btrim(NEW.customer_code), '') <> '' THEN
      SELECT EXISTS (
        SELECT 1 FROM contacts x
         WHERE x.account_id = NEW.account_id AND x.id <> NEW.id
           AND COALESCE(x.is_active, true) IS TRUE
           AND lower(btrim(x.customer_code)) = lower(btrim(NEW.customer_code))
      ) INTO v_exists;
      IF v_exists THEN
        RAISE EXCEPTION 'A customer with this Customer Code already exists.' USING ERRCODE = '23505';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'leads' THEN
    -- Leads had no protection before today, so an account with nothing saved
    -- gets nothing enforced. The admin opts in.
    SELECT COALESCE(settings->'extra_settings'->'lead_unique_keys', '[]'::jsonb)
      INTO v_keys FROM accounts WHERE id = NEW.account_id;
    IF jsonb_typeof(v_keys) <> 'array' THEN
      v_keys := '[]'::jsonb;
    END IF;

    IF v_keys ? 'name' AND COALESCE(btrim(NEW.name), '') <> '' THEN
      SELECT EXISTS (
        SELECT 1 FROM leads x
         WHERE x.account_id = NEW.account_id AND x.id <> NEW.id
           AND COALESCE(x.is_active, true) IS TRUE
           AND lower(btrim(x.name)) = lower(btrim(NEW.name))
      ) INTO v_exists;
      IF v_exists THEN
        RAISE EXCEPTION 'A lead with this name already exists.' USING ERRCODE = '23505';
      END IF;
    END IF;

    IF v_keys ? 'email' AND COALESCE(btrim(NEW.email), '') <> '' THEN
      SELECT EXISTS (
        SELECT 1 FROM leads x
         WHERE x.account_id = NEW.account_id AND x.id <> NEW.id
           AND COALESCE(x.is_active, true) IS TRUE
           AND lower(btrim(x.email)) = lower(btrim(NEW.email))
      ) INTO v_exists;
      IF v_exists THEN
        RAISE EXCEPTION 'A lead with this email already exists.' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_unique_keys() IS
  'Database backstop for the per-account duplicate keys ticked in Settings. Mirrors src/lib/dedupe/unique-keys.ts; raises 23505 so existing client handling treats it as a duplicate.';

DROP TRIGGER IF EXISTS enforce_unique_keys ON public.contacts;
CREATE TRIGGER enforce_unique_keys
  BEFORE INSERT OR UPDATE OF name, customer_code ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_keys();

DROP TRIGGER IF EXISTS enforce_unique_keys ON public.leads;
CREATE TRIGGER enforce_unique_keys
  BEFORE INSERT OR UPDATE OF name, email ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_keys();
