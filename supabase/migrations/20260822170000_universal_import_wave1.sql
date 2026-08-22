-- ============================================================================
-- Universal Import Framework — Wave 1
--   Adds commit + undo support for the master-data modules:
--     product_categories, products, contacts (customers), leads, territories,
--     tasks, price_lists, and `outstanding` (updates contacts.opening_balance).
--   Orders/quotations/payments remain OUT of self-serve import by design
--   (transactional + pricing/approval logic — a separate guided migration).
--
-- Design notes:
--   • Lookups (product category/unit/tax, contact territory) are resolved
--     best-effort by name: the text column is always set, and the FK id is set
--     only when the name matches an existing master. Unknown names never fail a
--     row (guided "create missing" is a later enhancement).
--   • Dedupe uses each table's real identity (contacts.phone_normalized,
--     territories name-per-parent, price_lists name) with an existence check
--     before insert (idempotent) + unique-violation caught as a skip.
--   • `outstanding` is update-only (matches an existing customer by phone and
--     sets opening_balance); it creates no rows and is therefore not undoable.
--   • import_undo blocks (all-or-nothing) if any imported row already has a
--     dependent, per target.
-- Rewrites import_commit / import_undo (CREATE OR REPLACE, same signatures).
-- ============================================================================

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

  UPDATE public.import_jobs SET status = 'importing' WHERE id = p_job_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    BEGIN
      -- ================= product_units =================
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

      -- ================= product_categories (hierarchical, parent by name) =================
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

      -- ================= products (best-effort lookups) =================
      ELSIF v_target = 'products' THEN
        v_name := NULLIF(btrim(r->>'name'), '');
        IF v_name IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Missing product name'); CONTINUE; END IF;
        v_cat := NULLIF(btrim(r->>'category'),''); v_unit := NULLIF(btrim(r->>'unit'),''); v_tax := NULLIF(btrim(r->>'tax'),'');
        v_catid := NULL; v_unitid := NULL; v_taxid := NULL;
        IF v_cat IS NOT NULL THEN SELECT id INTO v_catid FROM product_categories WHERE account_id=v_account AND lower(name)=lower(v_cat) LIMIT 1; END IF;
        IF v_unit IS NOT NULL THEN SELECT id INTO v_unitid FROM product_units WHERE account_id=v_account AND lower(name)=lower(v_unit) LIMIT 1; END IF;
        IF v_tax IS NOT NULL THEN SELECT id INTO v_taxid FROM tax_slabs WHERE account_id=v_account AND (lower(name)=lower(v_tax) OR rate::text=regexp_replace(v_tax,'[^0-9.]','','g')) LIMIT 1; END IF;
        -- dedupe by SKU when present, else by name
        IF NULLIF(btrim(r->>'sku'),'') IS NOT NULL THEN
          SELECT id INTO v_existing FROM products WHERE account_id=v_account AND lower(sku)=lower(btrim(r->>'sku')) LIMIT 1;
        ELSE
          SELECT id INTO v_existing FROM products WHERE account_id=v_account AND lower(name)=lower(v_name) AND sku IS NULL LIMIT 1;
        END IF;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN
            UPDATE products SET
              name=v_name,
              description=COALESCE(NULLIF(btrim(r->>'description'),''),description),
              price=COALESCE(NULLIF(btrim(r->>'price'),'')::numeric,price),
              category=COALESCE(v_cat,category), category_id=COALESCE(v_catid,category_id),
              unit=COALESCE(v_unit,unit), unit_id=COALESCE(v_unitid,unit_id),
              tax_slab_id=COALESCE(v_taxid,tax_slab_id),
              hsn_code=COALESCE(NULLIF(btrim(r->>'hsn_code'),''),hsn_code),
              min_price=COALESCE(NULLIF(btrim(r->>'min_price'),'')::numeric,min_price)
            WHERE id=v_existing; v_updated:=v_updated+1;
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO products(user_id,account_id,name,sku,description,price,category,category_id,unit,unit_id,tax_slab_id,hsn_code,min_price,opening_stock,active)
          VALUES (v_uid,v_account,v_name,NULLIF(btrim(r->>'sku'),''),NULLIF(btrim(r->>'description'),''),
            NULLIF(btrim(r->>'price'),'')::numeric,v_cat,v_catid,v_unit,v_unitid,v_taxid,NULLIF(btrim(r->>'hsn_code'),''),
            NULLIF(btrim(r->>'min_price'),'')::numeric,NULLIF(btrim(r->>'opening_stock'),'')::numeric,true)
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      -- ================= contacts (customers) — phone dedupe + territory lookup =================
      ELSIF v_target = 'contacts' THEN
        v_phone := NULLIF(btrim(r->>'phone'),''); v_norm := regexp_replace(COALESCE(v_phone,''),'\D','','g');
        IF v_norm = '' THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','A valid phone number is required'); CONTINUE; END IF;
        v_terr := NULLIF(btrim(r->>'territory'),''); v_pid := NULL;
        IF v_terr IS NOT NULL THEN SELECT id INTO v_pid FROM territories WHERE account_id=v_account AND lower(name)=lower(v_terr) AND deleted_at IS NULL LIMIT 1; END IF;
        SELECT id INTO v_existing FROM contacts WHERE account_id=v_account AND phone_normalized=v_norm LIMIT 1;
        IF v_existing IS NOT NULL THEN
          IF v_mode='update' THEN
            UPDATE contacts SET
              name=COALESCE(NULLIF(btrim(r->>'name'),''),name),
              email=COALESCE(NULLIF(btrim(r->>'email'),''),email),
              company=COALESCE(NULLIF(btrim(r->>'company'),''),company),
              whatsapp=COALESCE(NULLIF(btrim(r->>'whatsapp'),''),whatsapp),
              address=COALESCE(NULLIF(btrim(r->>'address'),''),address),
              area=COALESCE(NULLIF(btrim(r->>'area'),''),area),
              city=COALESCE(NULLIF(btrim(r->>'city'),''),city),
              state=COALESCE(NULLIF(btrim(r->>'state'),''),state),
              country=COALESCE(NULLIF(btrim(r->>'country'),''),country),
              pincode=COALESCE(NULLIF(btrim(r->>'pincode'),''),pincode),
              credit_limit=COALESCE(NULLIF(btrim(r->>'credit_limit'),'')::numeric,credit_limit),
              credit_days=COALESCE(NULLIF(btrim(r->>'credit_days'),'')::int,credit_days),
              territory_id=COALESCE(v_pid,territory_id)
            WHERE id=v_existing; v_updated:=v_updated+1;
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO contacts(user_id,account_id,phone,name,email,company,whatsapp,address,area,city,state,country,pincode,
            latitude,longitude,credit_limit,credit_days,opening_balance,territory_id,needs_territory_review)
          VALUES (v_uid,v_account,v_phone,NULLIF(btrim(r->>'name'),''),NULLIF(btrim(r->>'email'),''),NULLIF(btrim(r->>'company'),''),
            NULLIF(btrim(r->>'whatsapp'),''),NULLIF(btrim(r->>'address'),''),NULLIF(btrim(r->>'area'),''),NULLIF(btrim(r->>'city'),''),
            NULLIF(btrim(r->>'state'),''),NULLIF(btrim(r->>'country'),''),NULLIF(btrim(r->>'pincode'),''),
            NULLIF(btrim(r->>'latitude'),'')::numeric,NULLIF(btrim(r->>'longitude'),'')::numeric,
            NULLIF(btrim(r->>'credit_limit'),'')::numeric,NULLIF(btrim(r->>'credit_days'),'')::int,
            NULLIF(btrim(r->>'opening_balance'),'')::numeric,v_pid,(v_terr IS NOT NULL AND v_pid IS NULL))
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      -- ================= leads (flat; source/status/industry stored as text) =================
      ELSIF v_target = 'leads' THEN
        v_name := NULLIF(btrim(r->>'name'),'');
        IF v_name IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Missing lead name'); CONTINUE; END IF;
        v_norm := regexp_replace(COALESCE(NULLIF(btrim(r->>'phone'),''),NULLIF(btrim(r->>'whatsapp'),''),''),'\D','','g');
        SELECT id INTO v_existing FROM leads WHERE account_id=v_account AND lower(name)=lower(v_name)
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
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO leads(account_id,user_id,name,phone,whatsapp,email,contact_person,company,source,status,industry,address,city,state,country)
          VALUES (v_account,v_uid,v_name,NULLIF(btrim(r->>'phone'),''),NULLIF(btrim(r->>'whatsapp'),''),NULLIF(btrim(r->>'email'),''),
            NULLIF(btrim(r->>'contact_person'),''),NULLIF(btrim(r->>'company'),''),NULLIF(btrim(r->>'source'),''),
            NULLIF(btrim(r->>'status'),''),NULLIF(btrim(r->>'industry'),''),NULLIF(btrim(r->>'address'),''),
            NULLIF(btrim(r->>'city'),''),NULLIF(btrim(r->>'state'),''),NULLIF(btrim(r->>'country'),''))
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      -- ================= territories (hierarchical, parent by name) =================
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
          IF v_mode='update' THEN UPDATE territories SET code=COALESCE(NULLIF(btrim(r->>'code'),''),code), notes=COALESCE(NULLIF(btrim(r->>'notes'),''),notes) WHERE id=v_existing; v_updated:=v_updated+1;
          ELSE v_skipped:=v_skipped+1; END IF;
        ELSE
          INSERT INTO territories(account_id,parent_id,level,name,code,notes) VALUES (v_account,v_pid,COALESCE(v_plevel,0)+1,v_name,NULLIF(btrim(r->>'code'),''),NULLIF(btrim(r->>'notes'),''))
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      -- ================= tasks (flat) =================
      ELSIF v_target = 'tasks' THEN
        v_name := NULLIF(btrim(r->>'title'),'');
        IF v_name IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Missing task title'); CONTINUE; END IF;
        -- No natural key; dedupe by title + due_date within the account to make re-import idempotent.
        SELECT id INTO v_existing FROM tasks WHERE account_id=v_account AND lower(COALESCE(title,''))=lower(v_name)
          AND COALESCE(due_date::text,'')=COALESCE(NULLIF(btrim(r->>'due_date'),''),'') LIMIT 1;
        IF v_existing IS NOT NULL AND v_mode<>'update' THEN v_skipped:=v_skipped+1;
        ELSE
          INSERT INTO tasks(account_id,user_id,title,description,priority,status,due_date,activity_type)
          VALUES (v_account,v_uid,v_name,NULLIF(btrim(r->>'description'),''),
            COALESCE(NULLIF(btrim(r->>'priority'),''),'Medium'),
            COALESCE(NULLIF(btrim(r->>'status'),''),'Pending'),
            NULLIF(btrim(r->>'due_date'),'')::date,
            NULLIF(btrim(r->>'activity_type'),''))
          RETURNING id INTO v_new;
          INSERT INTO import_row_map(account_id,import_job_id,target_table,record_id) VALUES (v_account,p_job_id,v_target,v_new); v_imported:=v_imported+1;
        END IF;

      -- ================= price_lists (master) =================
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

      -- ================= outstanding (update contacts.opening_balance by phone) =================
      ELSIF v_target = 'outstanding' THEN
        v_norm := regexp_replace(COALESCE(NULLIF(btrim(r->>'phone'),''),''),'\D','','g');
        IF v_norm = '' THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','A valid phone number is required'); CONTINUE; END IF;
        IF NULLIF(btrim(r->>'opening_balance'),'') IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','Opening balance is required'); CONTINUE; END IF;
        v_amount := NULLIF(btrim(r->>'opening_balance'),'')::numeric;
        SELECT id INTO v_existing FROM contacts WHERE account_id=v_account AND phone_normalized=v_norm LIMIT 1;
        IF v_existing IS NULL THEN v_failed:=v_failed+1; v_errors := v_errors || jsonb_build_object('row',i,'message','No customer found for this phone'); CONTINUE; END IF;
        UPDATE contacts SET opening_balance=v_amount WHERE id=v_existing; v_updated:=v_updated+1;

      ELSE
        RAISE EXCEPTION 'Import target "%" is not supported', v_target USING ERRCODE = 'feature_not_supported';
      END IF;

    EXCEPTION
      WHEN unique_violation THEN v_skipped := v_skipped + 1;
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


CREATE OR REPLACE FUNCTION public.import_undo(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_account uuid; v_target text; v_module text; v_undoable boolean;
  v_deadline timestamptz; v_status text; v_created timestamptz;
  v_removed int := 0; v_blocked int := 0; v_reason text;
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

  -- Dependent-blocking: refuse (all-or-nothing) if any created row is already referenced.
  IF v_target='product_units' THEN
    NULL; -- no inbound FK today
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
  ELSE
    RAISE EXCEPTION 'Undo for target "%" is not supported' , v_target USING ERRCODE='feature_not_supported';
  END IF;

  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Undo blocked: %', v_reason USING ERRCODE='check_violation';
  END IF;

  -- All clear: delete exactly the rows this job created (dynamic over a whitelisted target).
  EXECUTE format('DELETE FROM public.%I WHERE account_id=$1 AND id IN (SELECT record_id FROM public.import_row_map WHERE import_job_id=$2)', v_target)
    USING v_account, p_job_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  DELETE FROM public.import_row_map WHERE import_job_id=p_job_id;
  UPDATE public.import_jobs SET status='undone', undone_at=now(), undone_by=auth.uid() WHERE id=p_job_id;
  RETURN jsonb_build_object('removed',v_removed,'blocked',v_blocked);
END;
$$;
GRANT EXECUTE ON FUNCTION public.import_undo(uuid) TO authenticated;
