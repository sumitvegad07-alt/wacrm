-- WhatsApp number field for customers and leads
--
-- Adds a dedicated WhatsApp number, separate from the general phone number,
-- because they are genuinely different in practice: a business landline is a
-- fine contact number and useless for WhatsApp.
--
-- WHY A COUNTRY-CODE SETTING RATHER THAN A HARDCODED '+91':
-- admins type only the local number, so the country code has to come from
-- somewhere. Hardcoding it works today and becomes a migration plus a data
-- cleanup the first time a customer outside India signs up. It lives in
-- accounts.settings.whatsapp_settings.default_country_code instead, defaulting
-- to '+91'. Admins still cannot edit it per record — the behaviour is
-- identical, the ceiling is not.
--
-- DELIBERATELY NOT ADDED TO `deals`: a deal has no phone number of its own,
-- it belongs to a customer or a lead (verified: all 3 production deals are
-- linked, none orphaned). A copied number on the deal would silently keep
-- messaging a dead line the day the customer updates theirs. The deal screen
-- reads its customer's or lead's number instead.
--
-- Storage format: '+<cc><national>', e.g. '+919876543210'.
--
-- Rollback: supabase/migrations/ROLLBACK-whatsapp-number-field.md

-- ============================================================================
-- 1. The column (leads already has one — verified before writing this)
-- ============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp text;

COMMENT ON COLUMN contacts.whatsapp IS
  'WhatsApp number in +<cc><national> form. Distinct from `phone`, which may be a landline. Normalised via src/lib/whatsapp/number-format.ts.';
COMMENT ON COLUMN leads.whatsapp IS
  'WhatsApp number in +<cc><national> form. Normalised via src/lib/whatsapp/number-format.ts.';

-- ============================================================================
-- 2. Normalisation helper
-- ============================================================================
-- Mirrors normalizeWhatsAppNumber() in src/lib/whatsapp/number-format.ts.
-- Both must change together.
--
-- The length rule is the important part. Testing "starts with 91" would corrupt
-- real data: 9199887766 is a valid 10-digit Indian mobile, and stripping its
-- leading 91 leaves 8 digits and a silently broken number. The country code is
-- only removed when the number is longer than any plausible national number.

CREATE OR REPLACE FUNCTION normalize_whatsapp_number(
  p_raw          text,
  p_country_code text DEFAULT '+91'
) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cc_digits text := regexp_replace(COALESCE(p_country_code, '+91'), '\D', '', 'g');
  v_digits    text := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
  v_national  text;
BEGIN
  IF v_cc_digits = '' THEN v_cc_digits := '91'; END IF;
  IF v_digits = '' THEN RETURN NULL; END IF;

  IF btrim(COALESCE(p_raw, '')) LIKE '+%' THEN
    -- An explicit '+' means the country code is genuinely present.
    IF position(v_cc_digits in v_digits) = 1 THEN
      v_national := substr(v_digits, length(v_cc_digits) + 1);
    ELSE
      -- Another country's number: keep it exactly as given.
      RETURN '+' || v_digits;
    END IF;
  ELSIF position(v_cc_digits in v_digits) = 1
        AND length(v_digits) > 10
        AND length(v_digits) - length(v_cc_digits) >= 6 THEN
    v_national := substr(v_digits, length(v_cc_digits) + 1);
  ELSE
    v_national := v_digits;
  END IF;

  -- Never store a bare country code — it reads as a number and is unreachable.
  IF v_national IS NULL OR v_national = '' THEN RETURN NULL; END IF;

  RETURN '+' || v_cc_digits || v_national;
END $$;

-- ============================================================================
-- 3. Backfill
-- ============================================================================
-- Copies each customer's existing phone into the new WhatsApp field so admins
-- don't retype numbers they already entered, normalising to the account's
-- country code on the way. This is what makes the 9 production customers
-- stored as bare 10-digit mobiles reachable by automation.
--
-- Only fills rows where whatsapp IS NULL, so re-running changes nothing and no
-- admin's deliberate edit is ever overwritten.

UPDATE contacts c
   SET whatsapp = normalize_whatsapp_number(
         c.phone,
         COALESCE(a.settings -> 'whatsapp_settings' ->> 'default_country_code', '+91'))
  FROM accounts a
 WHERE a.id = c.account_id
   AND c.whatsapp IS NULL
   AND c.phone IS NOT NULL
   AND btrim(c.phone) <> '';

-- Leads already had the column, but its values were free text and never
-- normalised. Rewrite only where normalisation actually changes something.
UPDATE leads l
   SET whatsapp = normalize_whatsapp_number(
         l.whatsapp,
         COALESCE(a.settings -> 'whatsapp_settings' ->> 'default_country_code', '+91'))
  FROM accounts a
 WHERE a.id = l.account_id
   AND l.whatsapp IS NOT NULL
   AND btrim(l.whatsapp) <> ''
   AND l.whatsapp IS DISTINCT FROM normalize_whatsapp_number(
         l.whatsapp,
         COALESCE(a.settings -> 'whatsapp_settings' ->> 'default_country_code', '+91'));

-- And seed a lead's WhatsApp number from its phone where it has one but no
-- WhatsApp number, matching the customer behaviour.
UPDATE leads l
   SET whatsapp = normalize_whatsapp_number(
         l.phone,
         COALESCE(a.settings -> 'whatsapp_settings' ->> 'default_country_code', '+91'))
  FROM accounts a
 WHERE a.id = l.account_id
   AND (l.whatsapp IS NULL OR btrim(l.whatsapp) = '')
   AND l.phone IS NOT NULL
   AND btrim(l.phone) <> '';

-- ============================================================================
-- 4. Default country code setting
-- ============================================================================
-- Written explicitly so the setting is discoverable in the settings JSON rather
-- than existing only as a code default. jsonb_set with create_missing keeps any
-- other settings on the account untouched.

UPDATE accounts
   SET settings = jsonb_set(
         COALESCE(settings, '{}'::jsonb),
         '{whatsapp_settings,default_country_code}',
         '"+91"'::jsonb,
         true)
 WHERE settings -> 'whatsapp_settings' ->> 'default_country_code' IS NULL;

-- ============================================================================
-- CORRECTION — applied as migration `whatsapp_number_field_fixup`
-- ============================================================================
-- The jsonb_set above did NOT write the setting. jsonb_set with
-- create_missing=true only creates the LAST key in the path; it does not create
-- a missing intermediate object. No account had a `whatsapp_settings` object,
-- so the write silently affected zero rows and every account fell back to the
-- code-level '+91' default.
--
-- Anyone reusing this file must use the merge form below, not jsonb_set:
--
--   UPDATE accounts
--      SET settings = COALESCE(settings, '{}'::jsonb)
--        || jsonb_build_object(
--             'whatsapp_settings',
--             COALESCE(settings -> 'whatsapp_settings', '{}'::jsonb)
--               || jsonb_build_object('default_country_code', '+91'))
--    WHERE settings -> 'whatsapp_settings' ->> 'default_country_code' IS NULL;
--
-- The fixup also normalises empty-string whatsapp values to NULL, so "is empty"
-- checks and the UI agree on what "not set" means.
