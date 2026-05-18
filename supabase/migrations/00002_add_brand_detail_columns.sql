ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS founder jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS product_highlights jsonb DEFAULT '[]';

COMMENT ON COLUMN brands.founder IS 'Founder info: {name, title, avatar_url, quote}';
COMMENT ON COLUMN brands.product_highlights IS 'Product highlights: [{name, image_url, description}]';
