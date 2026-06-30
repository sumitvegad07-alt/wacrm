-- ============================================================
-- SEED DUMMY PRODUCTS
-- ============================================================

DO $$
DECLARE
  v_user_id UUID;
  v_account_id UUID;
  i INT;
  categories TEXT[] := ARRAY['Electronics', 'Furniture', 'Software', 'Services', 'Apparel', 'Office Supplies'];
  units TEXT[] := ARRAY['pcs', 'kg', 'hr', 'box', 'license'];
BEGIN
  -- Get the first user and account to attach these products to
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  SELECT id INTO v_account_id FROM accounts LIMIT 1;

  IF v_user_id IS NULL OR v_account_id IS NULL THEN
    RAISE NOTICE 'No user or account found. Skipping seed.';
    RETURN;
  END IF;

  FOR i IN 1..50 LOOP
    INSERT INTO products (
      user_id,
      account_id,
      name,
      description,
      sku,
      price,
      image,
      category,
      unit,
      active
    ) VALUES (
      v_user_id,
      v_account_id,
      'Dummy Product ' || i,
      'This is a generated description for dummy product ' || i || '.',
      'DUMMY-' || LPAD(i::text, 4, '0'),
      ROUND((RANDOM() * 500 + 10)::NUMERIC, 2), -- Random price between 10 and 510
      NULL,
      categories[1 + floor(random() * array_length(categories, 1))],
      units[1 + floor(random() * array_length(units, 1))],
      (RANDOM() > 0.2) -- 80% chance to be active
    );
  END LOOP;
  
  RAISE NOTICE '50 dummy products inserted successfully.';
END $$;
