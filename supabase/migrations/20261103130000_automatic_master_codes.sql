-- ============================================================
-- Automatic codes for the master records — Customer, Employee, Product.
--
-- Founder, 2026-11-03: "Customer code, employee code ... all the codes should be
-- generated automatically, but we need to provide an option in organisation
-- settings. If they enable it they can generate those codes automatically. By
-- default it must be disabled."
--
-- Lead code was dropped on his instruction the same day ("We Don't need lead
-- code so leave it"), so `leads` gains no column here — the module ships with
-- three record types, not four.
--
-- WHAT ALREADY EXISTS. OZZO numbers its DOCUMENTS this way already:
-- account_sequences holds nine counters and each has a get_next_*_number()
-- function plus a BEFORE INSERT trigger (the shape set by set_quotation_number
-- in migration 032). The MASTER records were never numbered —
-- contacts.customer_code, profiles.employee_code and products.sku are all
-- typed by hand today.
--
-- ONE DIFFERENCE from that existing numbering, and it is the whole point: the
-- document numbering is UNCONDITIONAL. This is per account, per record type,
-- and OFF until an admin turns it on, so no live tenant's data moves until they
-- ask. The trigger therefore reads a setting before it does anything, which
-- get_next_quotation_number never had to.
--
-- ONE GENERATOR, not three. The three record types differ only in which
-- counter they bump and which column they must stay unique within, so they are
-- parameters rather than copies. The column and table names come from a fixed
-- CASE whitelist and go through format(%I) — never from the caller — so the
-- dynamic SQL cannot be steered from outside.
--
-- NO UNIQUE INDEX IS FORCED ONTO LIVE DATA. contacts.customer_code has never
-- had one: duplicate protection is an opt-in trigger
-- (20261005150000_lead_dedupe_and_unique_keys), so an account that never
-- enabled 'code' may well be holding duplicates right now, and products.sku is
-- only checked in app code (CreateProductCommandHandler). A plain CREATE UNIQUE
-- INDEX would therefore abort this whole migration on prod. So each index is
-- attempted only when that account's data is actually clean, and where it is
-- not, the migration says so and carries on. Correctness does not depend on the
-- index either way: the generator checks the target column before it hands a
-- code back, and advances if the code is already taken.
--
-- Blast radius: nothing happens to any tenant until an admin switches a record
-- type on. Three nullable counters, three triggers that return immediately when
-- the setting is off, and a backfill that only ever runs when a human presses
-- the button.
-- ============================================================

-- ── 1. Counters, in the table that already holds the other nine ──
ALTER TABLE public.account_sequences
  ADD COLUMN IF NOT EXISTS customer_code_seq bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employee_code_seq bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_code_seq  bigint DEFAULT 0;

COMMENT ON COLUMN public.account_sequences.customer_code_seq IS
  'Last customer code number minted for this account. Advanced by next_generated_code(), never by hand.';

-- ── 2. The generator ─────────────────────────────────────────
-- Returns NULL when the record type is switched off, which is what makes the
-- triggers no-ops for every tenant that has not opted in.
CREATE OR REPLACE FUNCTION public.next_generated_code(p_account_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule    jsonb;
  v_prefix  text;
  v_digits  int;
  v_start   bigint;
  v_col     text;
  v_table   text;
  v_field   text;
  v_seq     bigint;
  v_code    text;
  v_taken   boolean;
  v_tries   int := 0;
BEGIN
  IF p_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fixed whitelist. Anything not named here returns NULL rather than guessing.
  v_col := CASE p_kind
             WHEN 'customer' THEN 'customer_code_seq'
             WHEN 'employee' THEN 'employee_code_seq'
             WHEN 'product'  THEN 'product_code_seq'
           END;
  v_table := CASE p_kind
             WHEN 'customer' THEN 'contacts'
             WHEN 'employee' THEN 'profiles'
             WHEN 'product'  THEN 'products'
           END;
  v_field := CASE p_kind
             WHEN 'customer' THEN 'customer_code'
             WHEN 'employee' THEN 'employee_code'
             WHEN 'product'  THEN 'sku'
           END;
  IF v_col IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(settings -> 'code_settings' -> p_kind, '{}'::jsonb)
    INTO v_rule
    FROM public.accounts
   WHERE id = p_account_id;

  -- Off, or never configured. Note the explicit `IS NOT TRUE`: a missing key, a
  -- JSON null and the string "false" must all mean off.
  IF COALESCE((v_rule ->> 'enabled')::boolean, false) IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  v_prefix := COALESCE(v_rule ->> 'prefix', '');
  v_digits := LEAST(10, GREATEST(1, COALESCE((v_rule ->> 'digits')::int, 4)));
  -- 'next' is where the admin wants numbering to START. Never below 1, so
  -- nobody is handed "CUST-0000", which reads like a missing value.
  v_start  := GREATEST(1, COALESCE((v_rule ->> 'next')::bigint, 1));

  LOOP
    v_tries := v_tries + 1;

    -- The counter is taken inside the one INSERT ... ON CONFLICT ... RETURNING
    -- statement the existing get_next_*_number functions use, so two people
    -- saving at the same moment cannot be handed the same number. GREATEST
    -- lets the admin jump the sequence forward by raising 'next' and quietly
    -- refuses to wind it backwards into codes already issued.
    EXECUTE format(
      'INSERT INTO public.account_sequences (account_id, %1$I)
            VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE
            SET %1$I = GREATEST(COALESCE(public.account_sequences.%1$I, 0) + 1, $2)
         RETURNING %1$I', v_col)
      INTO v_seq USING p_account_id, v_start;

    -- NOT a plain lpad: Postgres's lpad TRUNCATES when the string is longer
    -- than the width, so lpad('1234', 1, '0') is '1'. On a 4-digit setting the
    -- ten-thousandth customer would be handed '0001' again — a duplicate, at
    -- the worst possible moment to discover one. A number wider than the
    -- configured width simply grows, which is also what the Settings preview
    -- (formatCode in src/lib/codes/auto-codes.ts, padStart) shows.
    v_code := v_prefix || CASE
                WHEN length(v_seq::text) >= v_digits THEN v_seq::text
                ELSE lpad(v_seq::text, v_digits, '0')
              END;

    -- Someone may have typed this code by hand years ago. Matched the way the
    -- existing duplicate-prevention trigger matches: case- and space-insensitive.
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%1$I t
                       WHERE t.account_id = $1
                         AND lower(btrim(t.%2$I)) = lower(btrim($2)))', v_table, v_field)
      INTO v_taken USING p_account_id, v_code;

    EXIT WHEN NOT v_taken;

    IF v_tries >= 100 THEN
      RAISE EXCEPTION
        'Could not find a free % code after 100 tries (last tried %). Raise the "Start from" number in Organisation Settings → Automatic codes.',
        p_kind, v_code
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.next_generated_code(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.next_generated_code(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.next_generated_code(uuid, text) IS
  'Next automatic code for a master record (kind: customer | employee | product), or NULL when '
  'that record type is switched off in accounts.settings.code_settings. Advances the matching '
  'account_sequences counter atomically and skips any code already taken by a hand-typed value.';

-- ── 3. Triggers: fill an empty code, never touch a supplied one ──
-- INSERT only, exactly like set_quotation_number. An admin who deliberately
-- clears a code is not second-guessed; the Backfill button is how blanks get
-- filled on purpose.
CREATE OR REPLACE FUNCTION public.set_customer_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(btrim(NEW.customer_code), '') = '' THEN
    NEW.customer_code := COALESCE(next_generated_code(NEW.account_id, 'customer'), NEW.customer_code);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_employee_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A profile is also created by handle_new_user during signup, before the
  -- account exists in some paths. No account, no code — and no error either.
  IF NEW.account_id IS NOT NULL AND COALESCE(btrim(NEW.employee_code), '') = '' THEN
    NEW.employee_code := COALESCE(next_generated_code(NEW.account_id, 'employee'), NEW.employee_code);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(btrim(NEW.sku), '') = '' THEN
    NEW.sku := COALESCE(next_generated_code(NEW.account_id, 'product'), NEW.sku);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_customer_code ON public.contacts;
CREATE TRIGGER trg_set_customer_code
  BEFORE INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_code();

DROP TRIGGER IF EXISTS trg_set_employee_code ON public.profiles;
CREATE TRIGGER trg_set_employee_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_employee_code();

DROP TRIGGER IF EXISTS trg_set_product_code ON public.products;
CREATE TRIGGER trg_set_product_code
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_product_code();

-- ── 4. Backfill, for records that already exist ──────────────
-- Switching the setting on changes nothing already saved; this is the separate
-- button that does. Dry run first so the admin is told how many rows will be
-- given a code before anything is written.
CREATE OR REPLACE FUNCTION public.backfill_generated_codes(
  p_account_id uuid,
  p_kind text,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table   text;
  v_field   text;
  v_pending bigint;
  v_filled  bigint := 0;
  v_first   text;
  v_last    text;
  v_id      uuid;
  v_code    text;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'Only an admin may backfill codes' USING ERRCODE = '42501';
  END IF;

  v_table := CASE p_kind
             WHEN 'customer' THEN 'contacts'
             WHEN 'employee' THEN 'profiles'
             WHEN 'product'  THEN 'products'
           END;
  v_field := CASE p_kind
             WHEN 'customer' THEN 'customer_code'
             WHEN 'employee' THEN 'employee_code'
             WHEN 'product'  THEN 'sku'
           END;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'Unknown record type %', p_kind USING ERRCODE = '22023';
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM public.%1$I t
      WHERE t.account_id = $1 AND COALESCE(btrim(t.%2$I), '''') = ''''', v_table, v_field)
    INTO v_pending USING p_account_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object('kind', p_kind, 'pending', v_pending, 'filled', 0, 'dry_run', true);
  END IF;

  -- Oldest record gets the lowest number, which is what anybody would expect of
  -- a list numbered after the fact.
  FOR v_id IN EXECUTE format(
    'SELECT t.id FROM public.%1$I t
      WHERE t.account_id = $1 AND COALESCE(btrim(t.%2$I), '''') = ''''
      ORDER BY t.created_at NULLS LAST, t.id', v_table, v_field)
    USING p_account_id
  LOOP
    v_code := next_generated_code(p_account_id, p_kind);
    EXIT WHEN v_code IS NULL;          -- switched off mid-run; stop cleanly
    EXECUTE format('UPDATE public.%1$I SET %2$I = $1 WHERE id = $2', v_table, v_field)
      USING v_code, v_id;
    v_filled := v_filled + 1;
    IF v_first IS NULL THEN v_first := v_code; END IF;
    v_last := v_code;
  END LOOP;

  RETURN jsonb_build_object(
    'kind', p_kind, 'pending', v_pending, 'filled', v_filled,
    'dry_run', false, 'first', v_first, 'last', v_last);
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_generated_codes(uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.backfill_generated_codes(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.backfill_generated_codes(uuid, text, boolean) IS
  'Gives a code to the records of one account that have none. Admin only. Dry run returns the '
  'count without writing. Oldest record first, so numbering follows the order they were created.';

-- ── 5. Unique indexes, only where the data already allows one ──
DO $do$
DECLARE
  v_spec record;
  v_dupes bigint;
BEGIN
  FOR v_spec IN
    SELECT * FROM (VALUES
      ('contacts', 'customer_code', 'contacts_customer_code_uniq'),
      ('profiles', 'employee_code', 'profiles_employee_code_uniq'),
      ('products', 'sku',           'products_sku_uniq')
    ) AS s(tbl, col, idx)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM (
         SELECT account_id, lower(btrim(%2$I))
           FROM public.%1$I
          WHERE COALESCE(btrim(%2$I), '''') <> ''''
          GROUP BY 1, 2 HAVING count(*) > 1) d', v_spec.tbl, v_spec.col)
      INTO v_dupes;

    IF v_dupes > 0 THEN
      RAISE NOTICE
        'Skipped unique index % — %.% already holds % duplicated value(s) on live data. Automatic codes still work (the generator checks before it issues one); clear the duplicates and re-run this file to add the index.',
        v_spec.idx, v_spec.tbl, v_spec.col, v_dupes;
    ELSE
      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS %3$I
           ON public.%1$I (account_id, lower(btrim(%2$I)))
         WHERE COALESCE(btrim(%2$I), '''') <> ''''',
        v_spec.tbl, v_spec.col, v_spec.idx);
      RAISE NOTICE 'Created unique index % on %.%', v_spec.idx, v_spec.tbl, v_spec.col;
    END IF;
  END LOOP;
END
$do$;
