BEGIN;

-- ============================================================
-- Step 1: Rename slugs in-place (1:1 mappings)
-- ============================================================
UPDATE taxonomy_tags SET slug = 'fashion',          name = 'Fashion & Apparel',        name_zh = '服飾鞋履'  WHERE slug = 'clothing'    AND category = 'product_type';
UPDATE taxonomy_tags SET slug = 'bags-accessories', name = 'Bags & Accessories',       name_zh = '包袋配件'  WHERE slug = 'bags'        AND category = 'product_type';
UPDATE taxonomy_tags SET slug = 'food-drink',       name = 'Food & Beverage',          name_zh = '食品飲料'  WHERE slug = 'food'        AND category = 'product_type';
-- Keep as-is (just update display names/zh):
UPDATE taxonomy_tags SET name = 'Jewelry',                    name_zh = '飾品珠寶'       WHERE slug = 'jewelry'    AND category = 'product_type';
UPDATE taxonomy_tags SET name = 'Beauty & Personal Care',     name_zh = '美妝保養'       WHERE slug = 'beauty'     AND category = 'product_type';
UPDATE taxonomy_tags SET name = 'Home & Living',              name_zh = '居家生活'       WHERE slug = 'home'       AND category = 'product_type';
UPDATE taxonomy_tags SET name = 'Crafts, Art & Stationery',   name_zh = '工藝文創'       WHERE slug = 'crafts'     AND category = 'product_type';
UPDATE taxonomy_tags SET name = 'Tech & Electronics',         name_zh = '3C科技'         WHERE slug = 'tech'       AND category = 'product_type';
UPDATE taxonomy_tags SET name = 'Outdoor, Sports & Health',   name_zh = '戶外運動保健'   WHERE slug = 'outdoor'    AND category = 'product_type';

-- ============================================================
-- Step 2: Create kids-pets tag, migrate baby-kids + pets records
-- ============================================================
INSERT INTO taxonomy_tags (slug, name, name_zh, category)
VALUES ('kids-pets', 'Kids, Baby & Pets', '母嬰寵物', 'product_type')
ON CONFLICT (slug) DO NOTHING;

UPDATE brand_taxonomy
SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'kids-pets')
WHERE tag_id IN (
  SELECT id FROM taxonomy_tags WHERE slug IN ('baby-kids', 'pets') AND category = 'product_type'
)
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- ============================================================
-- Step 3: Migrate absorbed sub-tags → new parent slugs
-- ============================================================
-- footwear → fashion
UPDATE brand_taxonomy SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'fashion')
WHERE tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'footwear' AND category = 'product_type')
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- accessories → bags-accessories
UPDATE brand_taxonomy SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'bags-accessories')
WHERE tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'accessories' AND category = 'product_type')
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- beverages, agriculture → food-drink
UPDATE brand_taxonomy SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'food-drink')
WHERE tag_id IN (SELECT id FROM taxonomy_tags WHERE slug IN ('beverages', 'agriculture') AND category = 'product_type')
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- bath-body, fragrance, cleaning → beauty
UPDATE brand_taxonomy SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'beauty')
WHERE tag_id IN (SELECT id FROM taxonomy_tags WHERE slug IN ('bath-body', 'fragrance', 'cleaning') AND category = 'product_type')
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- kitchen, furniture, gardening, tools-hardware → home
UPDATE brand_taxonomy SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'home')
WHERE tag_id IN (SELECT id FROM taxonomy_tags WHERE slug IN ('kitchen', 'furniture', 'gardening', 'tools-hardware') AND category = 'product_type')
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- art, stationery → crafts
UPDATE brand_taxonomy SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'crafts')
WHERE tag_id IN (SELECT id FROM taxonomy_tags WHERE slug IN ('art', 'stationery') AND category = 'product_type')
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- tech-accessories → tech
UPDATE brand_taxonomy SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'tech')
WHERE tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'tech-accessories' AND category = 'product_type')
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- health-wellness → outdoor
UPDATE brand_taxonomy SET tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'outdoor')
WHERE tag_id = (SELECT id FROM taxonomy_tags WHERE slug = 'health-wellness' AND category = 'product_type')
ON CONFLICT (brand_id, tag_id) DO NOTHING;

-- others, experiences → delete brand_taxonomy records (no replacement)
DELETE FROM brand_taxonomy
WHERE tag_id IN (SELECT id FROM taxonomy_tags WHERE slug IN ('others', 'experiences') AND category = 'product_type');

-- ============================================================
-- Step 4: Delete orphaned tags
-- ============================================================
DELETE FROM taxonomy_tags
WHERE category = 'product_type'
AND slug IN (
  'footwear', 'accessories', 'beverages', 'health-wellness', 'tools-hardware',
  'baby-kids', 'pets', 'others', 'agriculture', 'art', 'bath-body', 'cleaning',
  'experiences', 'fragrance', 'furniture', 'gardening', 'kitchen', 'stationery',
  'tech-accessories'
);

-- ============================================================
-- Step 5: Add product_type_note column to brand_submissions
-- ============================================================
ALTER TABLE brand_submissions ADD COLUMN IF NOT EXISTS product_type_note TEXT;

COMMIT;
