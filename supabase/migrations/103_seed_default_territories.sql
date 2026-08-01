-- ============================================================
-- 103_seed_default_territories.sql — generic, idempotent seed RPC
--
-- Territory seed data is large (ISO 3166-1 countries + India states/UTs + ~762
-- LGD districts = 1047 rows). Rather than embed 1047 literals in this migration,
-- the data is the pinned supabase/seed-data/territory-seed.json (see its README
-- for provenance), shipped to the client as a dynamically-imported generated TS
-- module (src/lib/territories/seed-data.generated.ts, produced by
-- scripts/generate-territory-seed.mjs). The Territory Master empty-state
-- "Load default India data" CTA passes it to this RPC in one call.
--
-- The RPC is admin-only and idempotent (a second run is a no-op). It hard-codes
-- the country/state/district level meanings (1/2/3) and the India parent linkage,
-- so the client only supplies data, never structure.
-- ============================================================

CREATE OR REPLACE FUNCTION public.territory_bulk_seed(
  p_account_id uuid,
  p_countries jsonb,   -- [{ "n": name, "c": code }]
  p_states jsonb,      -- [{ "n": name, "c": code }] (India states/UTs)
  p_districts jsonb    -- [{ "s": state_name, "n": district_name }]
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_india uuid;
  v_countries int; v_states int; v_districts int;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: seeding again is a no-op.
  IF EXISTS (SELECT 1 FROM territories WHERE account_id = p_account_id AND is_seed_data) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  INSERT INTO territories (account_id, parent_id, level, name, code, is_seed_data)
  SELECT p_account_id, NULL, 1, e->>'n', e->>'c', true
    FROM jsonb_array_elements(p_countries) e;
  GET DIAGNOSTICS v_countries = ROW_COUNT;

  SELECT id INTO v_india FROM territories
   WHERE account_id = p_account_id AND parent_id IS NULL AND is_seed_data AND lower(name) = 'india' LIMIT 1;

  INSERT INTO territories (account_id, parent_id, level, name, code, is_seed_data)
  SELECT p_account_id, v_india, 2, e->>'n', e->>'c', true
    FROM jsonb_array_elements(p_states) e;
  GET DIAGNOSTICS v_states = ROW_COUNT;

  INSERT INTO territories (account_id, parent_id, level, name, is_seed_data)
  SELECT p_account_id, st.id, 3, e->>'n', true
    FROM jsonb_array_elements(p_districts) e
    JOIN territories st ON st.account_id = p_account_id AND st.parent_id = v_india
     AND st.is_seed_data AND lower(st.name) = lower(e->>'s');
  GET DIAGNOSTICS v_districts = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'countries', v_countries, 'states', v_states, 'districts', v_districts);
END;
$$;

REVOKE ALL ON FUNCTION public.territory_bulk_seed(uuid, jsonb, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.territory_bulk_seed(uuid, jsonb, jsonb, jsonb) TO authenticated;
