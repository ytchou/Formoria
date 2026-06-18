-- 1. Add product_type column (nullable initially)
ALTER TABLE brands ADD COLUMN product_type text;

-- 2. Populate from brand_taxonomy (first product_type tag alphabetically per brand)
WITH ranked AS (
  SELECT
    bt.brand_id,
    tt.slug,
    ROW_NUMBER() OVER (PARTITION BY bt.brand_id ORDER BY tt.slug) AS rn
  FROM brand_taxonomy bt
  JOIN taxonomy_tags tt ON tt.id = bt.tag_id
  WHERE tt.category = 'product_type'
)
UPDATE brands
SET product_type = ranked.slug
FROM ranked
WHERE brands.id = ranked.brand_id
  AND ranked.rn = 1;

-- 3. Log brands that had multiple product_type tags (for manual review)
DO $$
DECLARE
  multi_count integer;
BEGIN
  SELECT COUNT(DISTINCT bt.brand_id) INTO multi_count
  FROM brand_taxonomy bt
  JOIN taxonomy_tags tt ON tt.id = bt.tag_id
  WHERE tt.category = 'product_type'
  GROUP BY bt.brand_id
  HAVING COUNT(*) > 1;

  IF multi_count > 0 THEN
    RAISE NOTICE '% brands had multiple product_type tags — first alphabetically was kept', multi_count;
  END IF;
END $$;

-- 4. Set default for brands without any product_type tag
UPDATE brands SET product_type = 'crafts' WHERE product_type IS NULL;

-- 5. Make NOT NULL
ALTER TABLE brands ALTER COLUMN product_type SET NOT NULL;

-- 6. Add CHECK constraint
ALTER TABLE brands ADD CONSTRAINT brands_product_type_check
  CHECK (product_type IN ('fashion', 'bags-accessories', 'jewelry', 'beauty', 'home', 'food-drink', 'crafts', 'tech', 'outdoor', 'kids-pets'));

-- 7. Add index
CREATE INDEX idx_brands_product_type ON brands (product_type);

-- 8. Drop legacy category column
ALTER TABLE brands DROP COLUMN IF EXISTS category;

-- 9. Delete product_type rows from brand_taxonomy
DELETE FROM brand_taxonomy
WHERE tag_id IN (
  SELECT id FROM taxonomy_tags WHERE category = 'product_type'
);

-- 10. Update tag_slugs trigger to exclude product_type tags
CREATE OR REPLACE FUNCTION sync_brand_tag_slugs()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE brands
  SET tag_slugs = COALESCE(
    (
      SELECT ARRAY_AGG(DISTINCT tt.slug ORDER BY tt.slug)
      FROM brand_taxonomy bt
      JOIN taxonomy_tags tt ON tt.id = bt.tag_id
      WHERE bt.brand_id = COALESCE(NEW.brand_id, OLD.brand_id)
        AND tt.category != 'product_type'
    ),
    '{}'::text[]
  )
  WHERE id = COALESCE(NEW.brand_id, OLD.brand_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
