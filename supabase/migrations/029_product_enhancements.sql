-- ============================================================
-- PRODUCT ENHANCEMENTS (IMAGE, CATEGORY, UNIT)
-- ============================================================

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS image TEXT,
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS unit TEXT;
