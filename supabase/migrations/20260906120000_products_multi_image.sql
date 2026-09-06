-- Multi-image support for products. Additive + nullable: existing rows and the
-- single `image` column are untouched. `image` continues to mirror images[0] for
-- backward compatibility (mobile/web read images ?? [image]).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS images text[] NULL;
COMMENT ON COLUMN public.products.images IS 'Ordered list of product image URLs. products.image mirrors images[0] for backward compatibility.';
