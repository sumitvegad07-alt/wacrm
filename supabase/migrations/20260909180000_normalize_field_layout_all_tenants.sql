-- Step 5: normalize every existing tenant's form layout to the canonical
-- sections + field order (mirror of DEFAULT_MODULE_SECTIONS_AND_FIELDS in
-- src/lib/custom-fields.ts), so create/edit forms look identical across all
-- tenants and match new signups. Only SYSTEM fields are repositioned; custom
-- (admin-added) fields are left in place. Missing system fields (e.g. lead
-- phone/area newly added to the canonical config) are filled in on next form
-- load by ensureDefaultSectionsAndFields — this migration positions the ones
-- that already exist, leaving their canonical slots open.
--
-- Idempotent: safe to re-run. Never deletes anything.

DO $$
BEGIN
  -- ── Canonical sections (module, name, position) ──
  CREATE TEMP TABLE _sec(module text, name text, position int) ON COMMIT DROP;
  INSERT INTO _sec VALUES
    ('contact','Primary Details',0), ('contact','Address Details',10),
    ('lead','Primary Details',0), ('lead','Lead Status & Source',10), ('lead','Address Details',20),
    ('product','Primary Details',0), ('product','Pricing & Inventory',10),
    ('deal','Primary Details',0), ('deal','Timeline & Stage',10),
    ('order','Primary Details',0),
    ('dispatch','Primary Details',0),
    ('quotation','Primary Details',0),
    ('task','Schedule & Priority',0),
    ('user','Profile',0), ('user','Login Details',10), ('user','Contact Details',20),
    ('expense','Primary Details',0);

  -- ── Canonical system fields (module, system_key, section_name, position) ──
  CREATE TEMP TABLE _fld(module text, system_key text, section_name text, position int) ON COMMIT DROP;
  INSERT INTO _fld VALUES
    -- contact
    ('contact','company','Primary Details',0),('contact','name','Primary Details',1),
    ('contact','phone','Primary Details',2),('contact','whatsapp','Primary Details',3),
    ('contact','email','Primary Details',4),('contact','hierarchy_level','Primary Details',5),
    ('contact','address','Address Details',0),('contact','area','Address Details',1),
    ('contact','city','Address Details',2),('contact','state','Address Details',3),
    ('contact','country','Address Details',4),('contact','pincode','Address Details',5),
    -- lead
    ('lead','name','Primary Details',0),('lead','contact_person','Primary Details',1),
    ('lead','phone','Primary Details',2),('lead','whatsapp','Primary Details',3),
    ('lead','email','Primary Details',4),
    ('lead','status','Lead Status & Source',0),('lead','source','Lead Status & Source',1),
    ('lead','industry','Lead Status & Source',2),
    ('lead','address','Address Details',0),('lead','area','Address Details',1),
    ('lead','city','Address Details',2),('lead','state','Address Details',3),
    ('lead','country','Address Details',4),('lead','pincode','Address Details',5),
    -- product
    ('product','name','Primary Details',0),('product','sku','Primary Details',1),
    ('product','category','Primary Details',2),('product','unit','Primary Details',3),
    ('product','price','Pricing & Inventory',0),
    -- deal
    ('deal','title','Primary Details',0),('deal','value','Primary Details',1),
    ('deal','expected_close_date','Timeline & Stage',0),
    -- order / dispatch / quotation
    ('order','date','Primary Details',0),
    ('dispatch','dispatch_date','Primary Details',0),
    ('quotation','date','Primary Details',0),('quotation','valid_until','Primary Details',1),
    -- task
    ('task','due_date','Schedule & Priority',0),('task','priority','Schedule & Priority',1),
    -- user
    ('user','full_name','Profile',0),('user','employee_code','Profile',1),
    ('user','employee_role_id','Profile',2),('user','status','Profile',3),
    ('user','email','Login Details',0),('user','password','Login Details',1),
    ('user','repassword','Login Details',2),
    ('user','address','Contact Details',0),('user','pincode','Contact Details',1),
    ('user','country','Contact Details',2),('user','state','Contact Details',3),
    ('user','city','Contact Details',4),('user','area','Contact Details',5),
    ('user','mobile','Contact Details',6),
    -- expense
    ('expense','expense_date','Primary Details',0),('expense','amount','Primary Details',1);

  -- account+module pairs that are initialized (have at least one field)
  CREATE TEMP TABLE _acctmod ON COMMIT DROP AS
    SELECT DISTINCT account_id, module_name FROM public.custom_fields;

  -- 1. Create any missing canonical section for an initialized account+module.
  INSERT INTO public.custom_field_sections(account_id, module_name, name, position, is_active)
  SELECT am.account_id, cs.module, cs.name, cs.position, true
  FROM _acctmod am
  JOIN _sec cs ON cs.module = am.module_name
  WHERE NOT EXISTS (
    SELECT 1 FROM public.custom_field_sections x
    WHERE x.account_id = am.account_id AND x.module_name = cs.module
      AND lower(x.name) = lower(cs.name)
  );

  -- 2. Normalize canonical section positions (and re-activate).
  UPDATE public.custom_field_sections x
  SET position = cs.position, is_active = true
  FROM _sec cs
  WHERE x.module_name = cs.module AND lower(x.name) = lower(cs.name);

  -- 3. Move each existing SYSTEM field to its canonical section + position.
  UPDATE public.custom_fields f
  SET section_id = sec.id, position = cf.position
  FROM _fld cf
  JOIN public.custom_field_sections sec
    ON sec.account_id = f.account_id
   AND sec.module_name = cf.module
   AND lower(sec.name) = lower(cf.section_name)
  WHERE f.module_name = cf.module
    AND f.system_key = cf.system_key;
END $$;
