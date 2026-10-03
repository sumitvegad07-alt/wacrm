-- ============================================================
-- 20260929155000_fsm_import_customer_assets.sql
-- OZZO FSM Phase 1, Task 11: Service Assets import in the Universal Import Framework.
-- Adds a `customer_assets` branch to import_commit and import_undo, plus one helper
-- (import_parse_service_date). Descriptor: src/lib/import/descriptors/customer-assets.ts.
--
-- WHAT THE COMMIT BRANCH DOES (see the branch comments for the reasoning)
--   * Insert-only. Customer, product and asset type are RESOLVED, never invented: a customer
--     is matched by customer code, then phone digits, then exact name; a product by code then
--     name; an asset type by name (created ONLY when the rows carry opt_create_asset_types).
--     There is no territory input: the customer_assets_defaults() trigger owns asset_code, both
--     customer snapshots and territory inheritance, and the INSERT never mentions them.
--   * Every rejected row is a NAMED reason (customer_not_found, customer_ambiguous,
--     asset_type_not_found, product_not_found, duplicate_serial (with the existing asset's code),
--     invalid_date, invalid_status, warranty_end_before_start, installation_date_in_future ...).
--
-- HOW THE PER-ROW EXCEPTION HANDLING CHANGED (and why other targets cannot be affected)
--   1. The outer handler gains ONE new clause, WHEN foreign_key_violation. Before, a 23503 from
--      any branch was not caught there and ABORTED THE WHOLE CHUNK (up to 500 rows). It now fails
--      just that row. The only behaviour that changes for any other target is a case that used to
--      abort the entire call; no row that imported or was skipped before is treated differently.
--   2. unique_violation is deliberately NOT touched: it stays "skip silently" for every existing
--      target. The Service Assets branch runs each row inside its own nested BEGIN ... EXCEPTION
--      block, which catches its own unique / FK / check / date errors FIRST, so the outer
--      unique_violation clause is never reached for customer_assets.
--
-- BASE VERSION. import_commit / import_undo below are the LIVE bodies as captured in
-- tools/migration/01-schema.sql (pg_dump of 2026-09-27), NOT the newest file in this directory:
-- the live function has diverged from supabase/migrations/20260823140000 (customer_code matching,
-- optional phone/name rules on Customers, Products, Leads and Tasks imports). Re-creating from the
-- repo file would silently REGRESS those. The guard below refuses to run if the live function does
-- not carry those later changes, so a stale base can never overwrite a newer live body.
--
-- Everything is CREATE OR REPLACE, so applying twice is a no-op. The functions are SECURITY
-- INVOKER (as live), so RLS applies to every write; both declare SET search_path.
-- Do NOT apply from the editor blindly: diff first (see verify check 37).
-- ============================================================

-- ── Guard: refuse to overwrite a live body this file was not built on ──────────
DO $guard$
DECLARE
  v_commit text := pg_get_functiondef('public.import_commit(uuid,jsonb,boolean)'::regprocedure);
  v_undo   text := pg_get_functiondef('public.import_undo(uuid)'::regprocedure);
BEGIN
  IF position('Row needs a phone number, a name, or a customer code' IN v_commit) = 0
     OR position('Row needs a product name or product code' IN v_commit) = 0
     OR position('Row needs a lead name or a phone/WhatsApp number' IN v_commit) = 0
     OR position('Row needs a task title or description' IN v_commit) = 0
     OR position('Opening stock is required' IN v_commit) = 0
  THEN
    RAISE EXCEPTION 'import_commit on this database does not carry the customer_code / optional-field changes this migration was built on. Do not apply. Export the live body (pg_get_functiondef) and rebase this file on it.';
  END IF;
  IF position('some imported price lists are already assigned or have items' IN v_undo) = 0 THEN
    RAISE EXCEPTION 'import_undo on this database differs from the version this migration was built on. Do not apply. Export the live body (pg_get_functiondef) and rebase this file on it.';
  END IF;
END
$guard$;

-- ── Strict date reader (server mirror of parseDmyDate in src/lib/import/dates.ts) ──
-- dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd. A two-digit year, month-first order and free text all RAISE
-- (22007); an impossible calendar date (31-02-2026) raises 22008 from make_date(). Blank -> NULL.
-- The two must change together.
CREATE OR REPLACE FUNCTION public.import_parse_service_date(p_text text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
DECLARE
  v text := NULLIF(btrim(p_text), '');
  m text[];
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  m := regexp_match(v, '^(\d{4})-(\d{2})-(\d{2})$');
  IF m IS NOT NULL THEN RETURN make_date(m[1]::int, m[2]::int, m[3]::int); END IF;
  m := regexp_match(v, '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$');
  IF m IS NOT NULL THEN RETURN make_date(m[3]::int, m[2]::int, m[1]::int); END IF;
  RAISE EXCEPTION 'unrecognised date: %', v USING ERRCODE = 'invalid_datetime_format';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_parse_service_date(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.import_parse_service_date(text) TO authenticated, service_role;

-- ── import_commit ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_commit(
  p_job_id uuid,
  p_rows   jsonb,
  p_final  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  ZERO constant uuid := '00000000-0000-0000-0000-000000000000';
  v_account uuid; v_target text; v_mode text; v_status text; v_uid uuid := auth.uid();
  r jsonb; i int := 0;
  v_imported int := 0; v_updated int := 0; v_skipped int := 0; v_failed int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_new uuid; v_existing uuid;
  v_name text; v_short text; v_parent text; v_pid uuid; v_plevel int;
  v_phone text; v_norm text; v_terr text; v_cat text; v_unit text; v_tax text;
  v_catid uuid; v_unitid uuid; v_taxid uuid; v_amount numeric;
  v_profile uuid;  -- customer_assets only: the caller's profiles.id (created_by is a profiles FK, not auth.users)
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be a JSON array' USING ERRCODE = 'check_violation';
  END IF;
  SELECT account_id, target_table, mode, status INTO v_account, v_target, v_mode, v_status
  FROM public.import_jobs WHERE id = p_job_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Import job not found or not accessible' USING ERRCODE = 'no_data_found'; END IF;
  IF v_status = 'undone' THEN
    RAISE EXCEPTION 'This import has been undone' USING ERRCODE = 'check_violation'; END IF;
  IF NOT public.has_permission(v_uid, v_account, 'import_data') THEN
    RAISE EXCEPTION 'You do not have permission to import' USING ERRCODE = 'insufficient_privilege'; END IF;

  -- Service Assets: the caller needs the import right (above), the asset create right AND the
  -- FSM line. Checked once, up front, so a person without them gets one clear error instead of an
  -- RLS refusal that would abort the whole chunk. (RLS still enforces both on every INSERT.)
  IF v_target = 'customer_assets' THEN
    IF NOT public.has_permission(v_uid, v_account, 'import_service_assets') THEN
      RAISE EXCEPTION 'You do not have permission to import assets' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF NOT public.has_permission(v_uid, v_account, 'create_service_assets') THEN
      RAISE EXCEPTION 'You do not have permission to create assets' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF NOT public.account_has_line(v_account, 'fsm') THEN
      RAISE EXCEPTION 'Your plan does not include Service Assets' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT id INTO v_profile FROM public.profiles WHERE user_id = v_uid AND account_id = v_account LIMIT 1;
  END IF;

  UPDATE public.import_jobs SET status = 'importing' WHERE id = p_job_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    BEGIN
      IF v_target = 'product_units' THEN
        v_name := NULLIF(btrim(r->>'name'), ''); v_short := NULLIF(btrim(r->>'short_name'), '');
        IF v_name IS NULL THEN v_failed := v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Missing unit name'); CONTINUE; END IF;
        SELECT id INTO v_existing FROM product_units WHERE account_id=v_account AND lower(name)=lower(v_name) LIMIT 1;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN UPDATE product_units SET short_name=COALESCE(v_short,short_name), active=true WHERE id=v_existing; v_updated:=v_updated+1;
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO product_units(account_id,name,short_name) VALUES (v_account,v_name,v_short) RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      ELSIF v_target = 'product_categories' THEN
        v_name := NULLIF(btrim(r->>'name'), ''); v_parent := NULLIF(btrim(r->>'parent'), '');
        IF v_name IS NULL THEN v_failed := v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Missing category name'); CONTINUE; END IF;
        v_pid := NULL; v_plevel := 0;
        IF v_parent IS NOT NULL THEN
          SELECT id, level INTO v_pid, v_plevel FROM product_categories WHERE account_id=v_account AND lower(name)=lower(v_parent) LIMIT 1;
          IF v_pid IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('Parent category not found: "%s"',v_parent)); CONTINUE; END IF;
        END IF;
        SELECT id INTO v_existing FROM product_categories WHERE account_id=v_account AND lower(name)=lower(v_name) AND COALESCE(parent_id,ZERO)=COALESCE(v_pid,ZERO) LIMIT 1;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN UPDATE product_categories SET active=true WHERE id=v_existing; v_updated:=v_updated+1; ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO product_categories(account_id,name,level,parent_id,active) VALUES (v_account,v_name,COALESCE(v_plevel,0)+1,v_pid,true) RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      ELSIF v_target = 'products' THEN
        v_name := NULLIF(btrim(r->>'name'), '');
        -- Name is required per the account's field config, enforced client-side.
        -- Reject here only when the row has no identity at all (no name AND no code).
        IF v_name IS NULL AND NULLIF(btrim(r->>'sku'),'') IS NULL THEN
          v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Row needs a product name or product code'); CONTINUE; END IF;
        v_cat := NULLIF(btrim(r->>'category'),''); v_unit := NULLIF(btrim(r->>'unit'),''); v_tax := NULLIF(btrim(r->>'tax'),'');
        v_catid := NULL; v_unitid := NULL; v_taxid := NULL;
        IF v_cat IS NOT NULL THEN SELECT id INTO v_catid FROM product_categories WHERE account_id=v_account AND lower(name)=lower(v_cat) LIMIT 1; END IF;
        IF v_unit IS NOT NULL THEN SELECT id INTO v_unitid FROM product_units WHERE account_id=v_account AND lower(name)=lower(v_unit) LIMIT 1; END IF;
        IF v_tax IS NOT NULL THEN SELECT id INTO v_taxid FROM tax_slabs WHERE account_id=v_account AND (lower(name)=lower(v_tax) OR rate::text=regexp_replace(v_tax,'[^0-9.]','','g')) LIMIT 1; END IF;
        IF NULLIF(btrim(r->>'sku'),'') IS NOT NULL THEN
          SELECT id INTO v_existing FROM products WHERE account_id=v_account AND lower(sku)=lower(btrim(r->>'sku')) LIMIT 1;
        ELSE
          SELECT id INTO v_existing FROM products WHERE account_id=v_account AND lower(name)=lower(v_name) AND sku IS NULL LIMIT 1;
        END IF;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN
            UPDATE products SET
              name=COALESCE(v_name,name),
              description=COALESCE(NULLIF(btrim(r->>'description'),''),description),
              price=COALESCE(NULLIF(btrim(r->>'price'),'')::numeric,price),
              category=COALESCE(v_cat,category), category_id=COALESCE(v_catid,category_id),
              unit=COALESCE(v_unit,unit), unit_id=COALESCE(v_unitid,unit_id),
              tax_slab_id=COALESCE(v_taxid,tax_slab_id),
              hsn_code=COALESCE(NULLIF(btrim(r->>'hsn_code'),''),hsn_code),
              min_price=COALESCE(NULLIF(btrim(r->>'min_price'),'')::numeric,min_price)
            WHERE id=v_existing; v_updated:=v_updated+1;
            PERFORM import_write_custom('product_custom_values','product_id',v_existing,r->'__custom',true);
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO products(user_id,account_id,name,sku,description,price,category,category_id,unit,unit_id,tax_slab_id,hsn_code,min_price,opening_stock,active)
          VALUES (v_uid,v_account,COALESCE(v_name,''),NULLIF(btrim(r->>'sku'),''),NULLIF(btrim(r->>'description'),''),
            NULLIF(btrim(r->>'price'),'')::numeric,v_cat,v_catid,v_unit,v_unitid,v_taxid,NULLIF(btrim(r->>'hsn_code'),''),
            NULLIF(btrim(r->>'min_price'),'')::numeric,NULLIF(btrim(r->>'opening_stock'),'')::numeric,true)
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
          PERFORM import_write_custom('product_custom_values','product_id',v_new,r->'__custom',false);
        END IF;

      ELSIF v_target = 'contacts' THEN
        v_phone := NULLIF(btrim(r->>'phone'),''); v_norm := regexp_replace(COALESCE(v_phone,''),'\D','','g');
        v_name := NULLIF(btrim(r->>'name'),'');
        -- v_short holds the customer_code for this branch.
        v_short := NULLIF(btrim(r->>'customer_code'),'');
        -- Phone is OPTIONAL at import (per-account required rules are enforced
        -- client-side). Reject only when the row has no identity at all.
        IF v_norm = '' AND v_name IS NULL AND v_short IS NULL THEN
          v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Row needs a phone number, a name, or a customer code'); CONTINUE;
        END IF;
        v_terr := NULLIF(btrim(r->>'territory'),''); v_pid := NULL;
        IF v_terr IS NOT NULL THEN SELECT id INTO v_pid FROM territories WHERE account_id=v_account AND lower(name)=lower(v_terr) AND deleted_at IS NULL LIMIT 1; END IF;
        v_existing := NULL;
        IF v_norm <> '' THEN
          SELECT id INTO v_existing FROM contacts WHERE account_id=v_account AND phone_normalized=v_norm LIMIT 1;
        ELSIF v_short IS NOT NULL THEN
          SELECT id INTO v_existing FROM contacts WHERE account_id=v_account AND lower(COALESCE(customer_code,''))=lower(v_short) LIMIT 1;
        ELSIF v_name IS NOT NULL THEN
          SELECT id INTO v_existing FROM contacts WHERE account_id=v_account AND lower(COALESCE(name,''))=lower(v_name) AND COALESCE(phone_normalized,'')='' LIMIT 1;
        END IF;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN
            UPDATE contacts SET
              name=COALESCE(v_name,name),
              email=COALESCE(NULLIF(btrim(r->>'email'),''),email),
              company=COALESCE(NULLIF(btrim(r->>'company'),''),company),
              whatsapp=COALESCE(NULLIF(btrim(r->>'whatsapp'),''),whatsapp),
              customer_code=COALESCE(v_short,customer_code),
              address=COALESCE(NULLIF(btrim(r->>'address'),''),address),
              area=COALESCE(NULLIF(btrim(r->>'area'),''),area),
              city=COALESCE(NULLIF(btrim(r->>'city'),''),city),
              state=COALESCE(NULLIF(btrim(r->>'state'),''),state),
              country=COALESCE(NULLIF(btrim(r->>'country'),''),country),
              pincode=COALESCE(NULLIF(btrim(r->>'pincode'),''),pincode),
              credit_limit=COALESCE(NULLIF(btrim(r->>'credit_limit'),'')::numeric,credit_limit),
              credit_days=COALESCE(NULLIF(btrim(r->>'credit_days'),'')::int,credit_days),
              opening_balance=COALESCE(NULLIF(btrim(r->>'opening_balance'),'')::numeric,opening_balance),
              latitude=COALESCE(NULLIF(btrim(r->>'latitude'),'')::numeric,latitude),
              longitude=COALESCE(NULLIF(btrim(r->>'longitude'),'')::numeric,longitude),
              territory_id=COALESCE(v_pid,territory_id)
            WHERE id=v_existing; v_updated:=v_updated+1;
            PERFORM import_write_custom('contact_custom_values','contact_id',v_existing,r->'__custom',true);
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO contacts(user_id,account_id,phone,name,email,company,whatsapp,customer_code,address,area,city,state,country,pincode,
            latitude,longitude,credit_limit,credit_days,opening_balance,territory_id,needs_territory_review)
          VALUES (v_uid,v_account,COALESCE(v_phone,''),v_name,NULLIF(btrim(r->>'email'),''),NULLIF(btrim(r->>'company'),''),
            NULLIF(btrim(r->>'whatsapp'),''),v_short,NULLIF(btrim(r->>'address'),''),NULLIF(btrim(r->>'area'),''),NULLIF(btrim(r->>'city'),''),
            NULLIF(btrim(r->>'state'),''),NULLIF(btrim(r->>'country'),''),NULLIF(btrim(r->>'pincode'),''),
            NULLIF(btrim(r->>'latitude'),'')::numeric,NULLIF(btrim(r->>'longitude'),'')::numeric,
            NULLIF(btrim(r->>'credit_limit'),'')::numeric,NULLIF(btrim(r->>'credit_days'),'')::int,
            NULLIF(btrim(r->>'opening_balance'),'')::numeric,v_pid,(v_terr IS NOT NULL AND v_pid IS NULL))
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
          PERFORM import_write_custom('contact_custom_values','contact_id',v_new,r->'__custom',false);
        END IF;

      ELSIF v_target = 'leads' THEN
        v_name := NULLIF(btrim(r->>'name'),'');
        v_norm := regexp_replace(COALESCE(NULLIF(btrim(r->>'phone'),''),NULLIF(btrim(r->>'whatsapp'),''),''),'\D','','g');
        -- Name required per account config (client-enforced). Reject only when the
        -- row has no identity at all (no name AND no phone/WhatsApp).
        IF v_name IS NULL AND v_norm = '' THEN
          v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Row needs a lead name or a phone/WhatsApp number'); CONTINUE; END IF;
        SELECT id INTO v_existing FROM leads WHERE account_id=v_account AND lower(COALESCE(name,''))=lower(COALESCE(v_name,''))
          AND regexp_replace(COALESCE(phone,whatsapp,''),'\D','','g')=v_norm LIMIT 1;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN
            UPDATE leads SET
              email=COALESCE(NULLIF(btrim(r->>'email'),''),email),
              company=COALESCE(NULLIF(btrim(r->>'company'),''),company),
              contact_person=COALESCE(NULLIF(btrim(r->>'contact_person'),''),contact_person),
              source=COALESCE(NULLIF(btrim(r->>'source'),''),source),
              status=COALESCE(NULLIF(btrim(r->>'status'),''),status),
              industry=COALESCE(NULLIF(btrim(r->>'industry'),''),industry),
              city=COALESCE(NULLIF(btrim(r->>'city'),''),city),
              state=COALESCE(NULLIF(btrim(r->>'state'),''),state),
              country=COALESCE(NULLIF(btrim(r->>'country'),''),country),
              address=COALESCE(NULLIF(btrim(r->>'address'),''),address)
            WHERE id=v_existing; v_updated:=v_updated+1;
            PERFORM import_write_custom('lead_custom_values','lead_id',v_existing,r->'__custom',true);
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO leads(account_id,user_id,name,phone,whatsapp,email,contact_person,company,source,status,industry,address,city,state,country)
          VALUES (v_account,v_uid,COALESCE(v_name,''),NULLIF(btrim(r->>'phone'),''),NULLIF(btrim(r->>'whatsapp'),''),NULLIF(btrim(r->>'email'),''),
            NULLIF(btrim(r->>'contact_person'),''),NULLIF(btrim(r->>'company'),''),NULLIF(btrim(r->>'source'),''),
            NULLIF(btrim(r->>'status'),''),NULLIF(btrim(r->>'industry'),''),NULLIF(btrim(r->>'address'),''),
            NULLIF(btrim(r->>'city'),''),NULLIF(btrim(r->>'state'),''),NULLIF(btrim(r->>'country'),''))
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
          PERFORM import_write_custom('lead_custom_values','lead_id',v_new,r->'__custom',false);
        END IF;

      ELSIF v_target = 'territories' THEN
        v_name := NULLIF(btrim(r->>'name'),''); v_parent := NULLIF(btrim(r->>'parent'),'');
        IF v_name IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Missing territory name'); CONTINUE; END IF;
        v_pid := NULL; v_plevel := 0;
        IF v_parent IS NOT NULL THEN
          SELECT id, level INTO v_pid, v_plevel FROM territories WHERE account_id=v_account AND lower(name)=lower(v_parent) AND deleted_at IS NULL LIMIT 1;
          IF v_pid IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('Parent territory not found: "%s"',v_parent)); CONTINUE; END IF;
        END IF;
        SELECT id INTO v_existing FROM territories WHERE account_id=v_account AND lower(name)=lower(v_name) AND COALESCE(parent_id,ZERO)=COALESCE(v_pid,ZERO) AND deleted_at IS NULL LIMIT 1;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN
            UPDATE territories SET code=COALESCE(NULLIF(btrim(r->>'code'),''),code), notes=COALESCE(NULLIF(btrim(r->>'notes'),''),notes),
              status=CASE WHEN lower(COALESCE(NULLIF(btrim(r->>'status'),''),'')) IN ('active','inactive','archived') THEN lower(btrim(r->>'status'))::territory_status ELSE status END
            WHERE id=v_existing; v_updated:=v_updated+1;
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO territories(account_id,parent_id,level,name,code,notes,status)
          VALUES (v_account,v_pid,COALESCE(v_plevel,0)+1,v_name,NULLIF(btrim(r->>'code'),''),NULLIF(btrim(r->>'notes'),''),
            CASE WHEN lower(COALESCE(NULLIF(btrim(r->>'status'),''),'active')) IN ('active','inactive','archived')
                 THEN lower(COALESCE(NULLIF(btrim(r->>'status'),''),'active'))::territory_status ELSE 'active'::territory_status END)
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      ELSIF v_target = 'tasks' THEN
        v_name := NULLIF(btrim(r->>'title'),'');
        -- Title required per account config (client-enforced). Reject only when the
        -- row has no content at all (no title AND no description).
        IF v_name IS NULL AND NULLIF(btrim(r->>'description'),'') IS NULL THEN
          v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Row needs a task title or description'); CONTINUE; END IF;
        v_terr := NULLIF(btrim(r->>'assignee'),''); v_pid := NULL;
        IF v_terr IS NOT NULL THEN
          SELECT id INTO v_pid FROM profiles WHERE account_id=v_account
            AND (lower(full_name)=lower(v_terr) OR lower(email)=lower(v_terr) OR lower(COALESCE(employee_code,''))=lower(v_terr)) LIMIT 1;
        END IF;
        SELECT id INTO v_existing FROM tasks WHERE account_id=v_account AND lower(COALESCE(title,''))=lower(COALESCE(v_name,''))
          AND COALESCE(due_date::text,'')=COALESCE(NULLIF(btrim(r->>'due_date'),''),'') LIMIT 1;
        IF v_existing IS NOT NULL AND v_mode <> 'update' THEN
          v_skipped:=v_skipped+1;
        ELSIF v_existing IS NOT NULL AND v_mode = 'update' THEN
          UPDATE tasks SET
            description=COALESCE(NULLIF(btrim(r->>'description'),''),description),
            priority=COALESCE(NULLIF(btrim(r->>'priority'),''),priority),
            status=COALESCE(NULLIF(btrim(r->>'status'),''),status),
            due_date=COALESCE(NULLIF(btrim(r->>'due_date'),'')::date,due_date),
            due_time=COALESCE(NULLIF(btrim(r->>'due_time'),'')::time,due_time),
            activity_type=COALESCE(NULLIF(btrim(r->>'activity_type'),''),activity_type),
            assigned_user_id=COALESCE(v_pid,assigned_user_id)
          WHERE id=v_existing; v_updated:=v_updated+1;
          PERFORM import_write_custom('task_custom_values','task_id',v_existing,r->'__custom',true);
        ELSE
          INSERT INTO tasks(account_id,user_id,title,description,priority,status,due_date,due_time,activity_type,assigned_user_id)
          VALUES (v_account,v_uid,v_name,NULLIF(btrim(r->>'description'),''),
            COALESCE(NULLIF(btrim(r->>'priority'),''),'Medium'),
            COALESCE(NULLIF(btrim(r->>'status'),''),'Pending'),
            NULLIF(btrim(r->>'due_date'),'')::date,
            NULLIF(btrim(r->>'due_time'),'')::time,
            NULLIF(btrim(r->>'activity_type'),''),
            v_pid)
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
          PERFORM import_write_custom('task_custom_values','task_id',v_new,r->'__custom',false);
        END IF;

      ELSIF v_target = 'price_lists' THEN
        v_name := NULLIF(btrim(r->>'name'),'');
        IF v_name IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Missing price list name'); CONTINUE; END IF;
        SELECT id INTO v_existing FROM price_lists WHERE account_id=v_account AND name=v_name LIMIT 1;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN UPDATE price_lists SET blanket_discount_percent=COALESCE(NULLIF(btrim(r->>'blanket_discount_percent'),'')::numeric,blanket_discount_percent) WHERE id=v_existing; v_updated:=v_updated+1;
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO price_lists(account_id,name,blanket_discount_percent,active) VALUES (v_account,v_name,COALESCE(NULLIF(btrim(r->>'blanket_discount_percent'),'')::numeric,0),true)
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      ELSIF v_target = 'outstanding' THEN
        v_norm := regexp_replace(COALESCE(NULLIF(btrim(r->>'phone'),''),''),'\D','','g');
        IF v_norm = '' THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','A valid phone number is required'); CONTINUE; END IF;
        IF NULLIF(btrim(r->>'opening_balance'),'') IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Opening balance is required'); CONTINUE; END IF;
        v_amount := NULLIF(btrim(r->>'opening_balance'),'')::numeric;
        SELECT id INTO v_existing FROM contacts WHERE account_id=v_account AND phone_normalized=v_norm LIMIT 1;
        IF v_existing IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','No customer found for this phone'); CONTINUE; END IF;
        UPDATE contacts SET opening_balance=v_amount WHERE id=v_existing; v_updated:=v_updated+1;

      ELSIF v_target = 'stock' THEN
        v_name := NULLIF(btrim(r->>'name'),'');
        IF v_name IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Missing product name'); CONTINUE; END IF;
        IF NULLIF(btrim(r->>'opening_stock'),'') IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Opening stock is required'); CONTINUE; END IF;
        v_amount := NULLIF(btrim(r->>'opening_stock'),'')::numeric;
        v_existing := NULL;
        IF NULLIF(btrim(r->>'sku'),'') IS NOT NULL THEN
          SELECT id INTO v_existing FROM products WHERE account_id=v_account AND lower(sku)=lower(btrim(r->>'sku')) LIMIT 1;
        END IF;
        IF v_existing IS NULL THEN
          SELECT id INTO v_existing FROM products WHERE account_id=v_account AND lower(name)=lower(v_name) LIMIT 1;
        END IF;
        IF v_existing IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','No matching product found'); CONTINUE; END IF;
        IF NOT public.has_permission(v_uid, v_account, 'manage_stock') THEN
          RAISE EXCEPTION 'You do not have permission to manage stock' USING ERRCODE='insufficient_privilege'; END IF;
        UPDATE products SET opening_stock=v_amount WHERE id=v_existing; v_updated:=v_updated+1;

      ELSIF v_target = 'customer_assets' THEN
        -- Service Assets (FSM Phase 1). INSERT-ONLY, with STRICT lookups: a customer and a product
        -- are resolved, never created; an asset type is created only when the file's rows carry
        -- opt_create_asset_types = 'true'. There is no territory input at all: customer_assets_defaults()
        -- assigns asset_code and the customer snapshots and inherits the territory from the contact,
        -- so none of those four columns appears in the INSERT below.
        --
        -- Each row runs in its OWN nested block so that (a) everything the row did (a created asset
        -- type, the asset, the row-map entry) is undone together if the row is rejected, and (b) this
        -- target's constraint errors get their own NAMED reasons without touching the outer handler,
        -- where unique_violation = a silent skip that the other import targets rely on.
        -- Every rejected row is counted in v_failed with a message that starts with a stable code.
        DECLARE
          v_cust text; v_digits text; v_ids uuid[]; v_contact uuid;
          v_tname text; v_type uuid; v_tstatus text;
          v_pcode text; v_prod uuid;
          v_astatus text; v_serial text;
          v_install date; v_wstart date; v_wend date;
          v_dfield text := ''; v_draw text := '';
          v_asset uuid; v_con text; v_dupcode text;
        BEGIN
          v_name := NULLIF(btrim(r->>'name'),'');
          IF v_name IS NULL THEN
            v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','name_required: the asset name is empty'); CONTINUE; END IF;

          -- Customer: an EXISTING, active customer by customer code, then phone (digits only), then
          -- exact name. Two matches at any step is a failure, never a guess.
          v_cust := NULLIF(btrim(r->>'customer'),'');
          IF v_cust IS NULL THEN
            v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','customer_not_found: this row has no customer'); CONTINUE; END IF;
          v_contact := NULL;

          SELECT array_agg(id) INTO v_ids FROM (
            SELECT id FROM contacts WHERE account_id=v_account AND is_active
              AND customer_code IS NOT NULL AND lower(btrim(customer_code))=lower(v_cust) LIMIT 2) s;
          IF v_ids IS NOT NULL THEN
            IF cardinality(v_ids) > 1 THEN
              v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('customer_ambiguous: "%s" matches more than one customer code', v_cust)); CONTINUE; END IF;
            v_contact := v_ids[1];
          END IF;

          IF v_contact IS NULL AND v_cust ~ '^[0-9+()\s.-]+$' THEN
            v_digits := regexp_replace(v_cust,'\D','','g');
            IF length(v_digits) >= 6 THEN
              SELECT array_agg(id) INTO v_ids FROM (
                SELECT id FROM contacts WHERE account_id=v_account AND is_active AND phone_normalized=v_digits LIMIT 2) s;
              IF v_ids IS NOT NULL THEN
                IF cardinality(v_ids) > 1 THEN
                  v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('customer_ambiguous: "%s" matches more than one customer phone', v_cust)); CONTINUE; END IF;
                v_contact := v_ids[1];
              END IF;
            END IF;
          END IF;

          IF v_contact IS NULL THEN
            SELECT array_agg(id) INTO v_ids FROM (
              SELECT id FROM contacts WHERE account_id=v_account AND is_active
                AND name IS NOT NULL AND lower(btrim(name))=lower(v_cust) LIMIT 2) s;
            IF v_ids IS NOT NULL THEN
              IF cardinality(v_ids) > 1 THEN
                v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('customer_ambiguous: "%s" matches more than one customer name; use the customer code or phone number', v_cust)); CONTINUE; END IF;
              v_contact := v_ids[1];
            END IF;
          END IF;

          IF v_contact IS NULL THEN
            v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('customer_not_found: no active customer matches "%s" by customer code, phone number or exact name', v_cust)); CONTINUE; END IF;

          -- Asset type: by name, case-insensitive. Created only on an explicit opt-in.
          v_tname := NULLIF(btrim(r->>'asset_type'),''); v_type := NULL;
          IF v_tname IS NOT NULL THEN
            SELECT id, status::text INTO v_type, v_tstatus FROM asset_types
             WHERE account_id=v_account AND deleted_at IS NULL AND lower(btrim(name))=lower(v_tname) LIMIT 1;
            IF v_type IS NOT NULL AND v_tstatus <> 'active' THEN
              v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('asset_type_inactive: asset type "%s" exists but is %s', v_tname, v_tstatus)); CONTINUE;
            ELSIF v_type IS NULL THEN
              IF COALESCE(r->>'opt_create_asset_types','') <> 'true' THEN
                v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('asset_type_not_found: asset type "%s" does not exist (tick "Create missing asset types" to add it)', v_tname)); CONTINUE; END IF;
              IF NOT public.has_permission(v_uid, v_account, 'manage_service_settings') THEN
                v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('asset_type_not_found: asset type "%s" does not exist and you do not have permission to add asset types', v_tname)); CONTINUE; END IF;
              INSERT INTO asset_types(account_id, name) VALUES (v_account, v_tname) RETURNING id INTO v_type;
              INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,'asset_types',v_type);
            END IF;
          END IF;

          -- Product: by product code (sku), then name. Never created. Any status: a discontinued
          -- product is exactly what an old installed machine points at.
          v_pcode := NULLIF(btrim(r->>'product'),''); v_prod := NULL;
          IF v_pcode IS NOT NULL THEN
            SELECT array_agg(id) INTO v_ids FROM (
              SELECT id FROM products WHERE account_id=v_account AND sku IS NOT NULL AND lower(btrim(sku))=lower(v_pcode) LIMIT 2) s;
            IF v_ids IS NOT NULL THEN
              IF cardinality(v_ids) > 1 THEN
                v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('product_ambiguous: "%s" matches more than one product code', v_pcode)); CONTINUE; END IF;
              v_prod := v_ids[1];
            END IF;
            IF v_prod IS NULL THEN
              SELECT array_agg(id) INTO v_ids FROM (
                SELECT id FROM products WHERE account_id=v_account AND lower(btrim(name))=lower(v_pcode) LIMIT 2) s;
              IF v_ids IS NOT NULL THEN
                IF cardinality(v_ids) > 1 THEN
                  v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('product_ambiguous: "%s" matches more than one product name; use the product code', v_pcode)); CONTINUE; END IF;
                v_prod := v_ids[1];
              END IF;
            END IF;
            IF v_prod IS NULL THEN
              v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('product_not_found: no product matches "%s" by product code or name', v_pcode)); CONTINUE; END IF;
          END IF;

          v_astatus := lower(NULLIF(btrim(r->>'status'),''));
          IF v_astatus IS NOT NULL AND v_astatus NOT IN ('active','under_repair','replaced','scrapped','inactive') THEN
            v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('invalid_status: "%s" is not one of active, under_repair, replaced, scrapped, inactive', v_astatus)); CONTINUE; END IF;

          -- Dates: dd-mm-yyyy, dd/mm/yyyy or ISO. Anything else (a two-digit year included) raises,
          -- and the nested handler below turns it into invalid_date naming the field and the value.
          v_dfield := 'Installation Date'; v_draw := COALESCE(r->>'installation_date','');
          v_install := public.import_parse_service_date(r->>'installation_date');
          v_dfield := 'Warranty Start';    v_draw := COALESCE(r->>'warranty_start','');
          v_wstart  := public.import_parse_service_date(r->>'warranty_start');
          v_dfield := 'Warranty End';      v_draw := COALESCE(r->>'warranty_end','');
          v_wend    := public.import_parse_service_date(r->>'warranty_end');

          -- A serial already on a LIVE asset is a named failure carrying the existing asset's code,
          -- never a silent skip. (customer_assets_uniq_serial is the backstop for a race; the handler
          -- below words it the same way.) This also catches a repeat inside the same file: the first
          -- row has already been inserted by the time the second one is checked.
          v_serial := NULLIF(btrim(r->>'serial_no'),'');
          IF v_serial IS NOT NULL THEN
            SELECT asset_code INTO v_dupcode FROM customer_assets
             WHERE account_id=v_account AND deleted_at IS NULL AND lower(serial_no)=lower(v_serial) LIMIT 1;
            IF v_dupcode IS NOT NULL THEN
              v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message',format('duplicate_serial: serial number "%s" is already used by asset %s', v_serial, v_dupcode)); CONTINUE; END IF;
          END IF;

          INSERT INTO customer_assets(account_id,contact_id,asset_type_id,product_id,name,make,model_no,serial_no,
            installation_date,warranty_start,warranty_end,status,site_label,notes,created_by)
          VALUES (v_account,v_contact,v_type,v_prod,v_name,NULLIF(btrim(r->>'make'),''),NULLIF(btrim(r->>'model_no'),''),v_serial,
            v_install,v_wstart,v_wend,COALESCE(v_astatus,'active')::asset_status,NULLIF(btrim(r->>'site_label'),''),NULLIF(btrim(r->>'notes'),''),v_profile)
          RETURNING id INTO v_asset;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_asset);
          v_imported := v_imported + 1;

        EXCEPTION
          WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
            v_failed := v_failed + 1;
            IF v_con = 'customer_assets_uniq_serial' THEN
              SELECT asset_code INTO v_dupcode FROM customer_assets
               WHERE account_id=v_account AND deleted_at IS NULL
                 AND lower(serial_no)=lower(NULLIF(btrim(r->>'serial_no'),'')) LIMIT 1;
              v_errors := v_errors || jsonb_build_object('row',i,'message',format('duplicate_serial: serial number "%s" is already used by asset %s', NULLIF(btrim(r->>'serial_no'),''), COALESCE(v_dupcode,'(another asset)')));
            ELSIF v_con = 'customer_assets_uniq_code' THEN
              v_errors := v_errors || jsonb_build_object('row',i,'message','duplicate_code: the next asset code is already in use; run the import again');
            ELSE
              v_errors := v_errors || jsonb_build_object('row',i,'message',format('duplicate_value: a value must be unique (%s)', COALESCE(v_con,'unknown constraint')));
            END IF;
          WHEN foreign_key_violation THEN
            v_failed := v_failed + 1; v_errors := v_errors || jsonb_build_object('row',i,'message','reference_invalid: the customer, asset type or product no longer exists in your account');
          WHEN check_violation THEN
            GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
            v_failed := v_failed + 1;
            IF v_con = 'customer_assets_warranty_order_chk' THEN
              v_errors := v_errors || jsonb_build_object('row',i,'message',format('warranty_end_before_start: Warranty End %s is earlier than Warranty Start %s', COALESCE(r->>'warranty_end',''), COALESCE(r->>'warranty_start','')));
            ELSIF v_con = 'customer_assets_install_date_chk' THEN
              v_errors := v_errors || jsonb_build_object('row',i,'message',format('installation_date_in_future: Installation Date %s is more than one day in the future', COALESCE(r->>'installation_date','')));
            ELSIF v_con = 'customer_assets_name_not_blank' THEN
              v_errors := v_errors || jsonb_build_object('row',i,'message','name_required: the asset name is empty');
            ELSE
              v_errors := v_errors || jsonb_build_object('row',i,'message',format('invalid_value: a value was rejected by the database (%s)', COALESCE(v_con,'unknown constraint')));
            END IF;
          WHEN invalid_datetime_format OR datetime_field_overflow THEN
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_object('row',i,'message',format('invalid_date: %s "%s" is not a real date (use dd-mm-yyyy, dd/mm/yyyy or yyyy-mm-dd; a two-digit year is not accepted)', v_dfield, v_draw));
        END;

      ELSE
        RAISE EXCEPTION 'Import target "%" is not supported', v_target USING ERRCODE = 'feature_not_supported';
      END IF;

    EXCEPTION
      WHEN unique_violation THEN v_skipped := v_skipped + 1;
      -- A reference that points at nothing (or at another tenant) used to escape this handler
      -- and abort the WHOLE chunk (up to 500 rows). It now fails just that row. customer_assets
      -- never reaches here: its own nested handler names the reason first.
      WHEN foreign_key_violation THEN
        v_failed := v_failed + 1; v_errors := v_errors || jsonb_build_object('row',i,'message','A value refers to a record that does not exist in your account');
      WHEN invalid_text_representation THEN
        v_failed := v_failed + 1; v_errors := v_errors || jsonb_build_object('row',i,'message','A number/date field has an invalid value');
      WHEN check_violation THEN
        v_failed := v_failed + 1; v_errors := v_errors || jsonb_build_object('row',i,'message','A value is not allowed (check priority/status)');
    END;
  END LOOP;

  UPDATE public.import_jobs SET
    imported_rows = imported_rows + v_imported,
    updated_rows  = updated_rows  + v_updated,
    skipped_rows  = skipped_rows  + v_skipped,
    failed_rows   = failed_rows   + v_failed,
    error_sample  = CASE WHEN jsonb_array_length(v_errors) > 0 THEN COALESCE(error_sample,'[]'::jsonb) || v_errors ELSE error_sample END
  WHERE id = p_job_id;

  IF p_final THEN
    UPDATE public.import_jobs SET status='completed', completed_at=now(),
      undoable=(imported_rows > 0), undo_deadline=now()+interval '30 minutes'
    WHERE id = p_job_id;
  END IF;

  RETURN jsonb_build_object('imported',v_imported,'updated',v_updated,'skipped',v_skipped,'failed',v_failed,'errors',v_errors);
END;
$$;
GRANT EXECUTE ON FUNCTION public.import_commit(uuid, jsonb, boolean) TO authenticated;

-- ── import_undo ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_undo(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_account uuid; v_target text; v_module text; v_undoable boolean;
  v_deadline timestamptz; v_status text; v_created timestamptz;
  v_removed int := 0; v_blocked int := 0; v_reason text; v_types int := 0;
BEGIN
  SELECT account_id,target_table,module,undoable,undo_deadline,status,created_at
    INTO v_account,v_target,v_module,v_undoable,v_deadline,v_status,v_created
  FROM public.import_jobs WHERE id = p_job_id;
  IF v_account IS NULL THEN RAISE EXCEPTION 'Import job not found or not accessible' USING ERRCODE='no_data_found'; END IF;
  IF NOT public.has_permission(auth.uid(), v_account, 'import_manage') THEN
    RAISE EXCEPTION 'You do not have permission to undo an import' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_status='undone' THEN RAISE EXCEPTION 'This import has already been undone' USING ERRCODE='check_violation'; END IF;
  IF NOT v_undoable THEN RAISE EXCEPTION 'This import cannot be undone' USING ERRCODE='check_violation'; END IF;
  IF v_deadline IS NULL OR now() > v_deadline THEN RAISE EXCEPTION 'The undo window for this import has closed' USING ERRCODE='check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM public.import_jobs j WHERE j.account_id=v_account AND j.module=v_module AND j.status='completed' AND j.created_at>v_created) THEN
    RAISE EXCEPTION 'A newer import exists for this module; undo is no longer available' USING ERRCODE='check_violation'; END IF;

  IF v_target='product_units' THEN
    NULL;
  ELSIF v_target='product_categories' THEN
    IF EXISTS (SELECT 1 FROM products p JOIN import_row_map m ON m.record_id=p.category_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM product_categories c JOIN import_row_map m ON m.record_id=c.parent_id WHERE m.import_job_id=p_job_id)
    THEN v_reason:='some imported categories are already used by products or sub-categories'; END IF;
  ELSIF v_target='products' THEN
    IF EXISTS (SELECT 1 FROM order_items x JOIN import_row_map m ON m.record_id=x.product_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM price_list_items x JOIN import_row_map m ON m.record_id=x.product_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM stock_ledger x JOIN import_row_map m ON m.record_id=x.product_id WHERE m.import_job_id=p_job_id)
    THEN v_reason:='some imported products are already used in orders, price lists or stock'; END IF;
  ELSIF v_target='contacts' THEN
    IF EXISTS (SELECT 1 FROM orders x JOIN import_row_map m ON m.record_id=x.contact_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM tasks x JOIN import_row_map m ON m.record_id=x.contact_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM site_visits x JOIN import_row_map m ON m.record_id=x.contact_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM payments x JOIN import_row_map m ON m.record_id=x.contact_id WHERE m.import_job_id=p_job_id)
    THEN v_reason:='some imported customers already have orders, tasks, visits or payments'; END IF;
  ELSIF v_target='leads' THEN
    IF EXISTS (SELECT 1 FROM tasks x JOIN import_row_map m ON m.record_id=x.lead_id WHERE m.import_job_id=p_job_id)
    THEN v_reason:='some imported leads already have tasks'; END IF;
  ELSIF v_target='territories' THEN
    IF EXISTS (SELECT 1 FROM contacts x JOIN import_row_map m ON m.record_id=x.territory_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM leads x JOIN import_row_map m ON m.record_id=x.territory_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM territories x JOIN import_row_map m ON m.record_id=x.parent_id WHERE m.import_job_id=p_job_id)
    THEN v_reason:='some imported territories are already used by customers, leads or sub-territories'; END IF;
  ELSIF v_target='price_lists' THEN
    IF EXISTS (SELECT 1 FROM contacts x JOIN import_row_map m ON m.record_id=x.price_list_id WHERE m.import_job_id=p_job_id)
       OR EXISTS (SELECT 1 FROM price_list_items x JOIN import_row_map m ON m.record_id=x.price_list_id WHERE m.import_job_id=p_job_id)
    THEN v_reason:='some imported price lists are already assigned or have items'; END IF;
  ELSIF v_target='tasks' THEN
    NULL;
  ELSIF v_target='customer_assets' THEN
    -- INVOKER + RLS means the DELETE below silently removes ZERO rows for someone without the delete
    -- right or the FSM line, and the job would still be marked undone. Refuse up front instead.
    IF NOT public.has_permission(auth.uid(), v_account, 'delete_service_assets') THEN
      RAISE EXCEPTION 'You do not have permission to remove assets, so this import cannot be undone by you' USING ERRCODE='insufficient_privilege'; END IF;
    IF NOT public.account_has_line(v_account, 'fsm') THEN
      RAISE EXCEPTION 'Your plan does not include Service Assets' USING ERRCODE='insufficient_privilege'; END IF;
    -- No inbound foreign key to customer_assets exists yet (Phase 2 jobs/visits will add one: extend
    -- this block with the same "already used" refusal the other targets have).
    NULL;
  ELSE
    RAISE EXCEPTION 'Undo for target "%" is not supported' , v_target USING ERRCODE='feature_not_supported';
  END IF;

  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Undo blocked: %', v_reason USING ERRCODE='check_violation';
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE account_id=$1 AND id IN (SELECT record_id FROM public.import_row_map WHERE import_job_id=$2)', v_target)
    USING v_account, p_job_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Asset types THIS job created (only possible when "create missing asset types" was ticked) go too,
  -- but only if nothing uses them any more. customer_assets.asset_type_id is ON DELETE SET NULL, so
  -- deleting a type that is still in use would silently blank other assets: never do that.
  IF v_target='customer_assets' THEN
    DELETE FROM public.asset_types t
     WHERE t.account_id=v_account
       AND t.id IN (SELECT record_id FROM public.import_row_map WHERE import_job_id=p_job_id AND target_table='asset_types')
       AND NOT EXISTS (SELECT 1 FROM public.customer_assets a WHERE a.asset_type_id=t.id);
    GET DIAGNOSTICS v_types = ROW_COUNT;
  END IF;

  DELETE FROM public.import_row_map WHERE import_job_id=p_job_id;
  UPDATE public.import_jobs SET status='undone', undone_at=now(), undone_by=auth.uid() WHERE id=p_job_id;
  RETURN jsonb_build_object('removed',v_removed,'blocked',v_blocked,'asset_types_removed',v_types);
END;
$$;
GRANT EXECUTE ON FUNCTION public.import_undo(uuid) TO authenticated;
