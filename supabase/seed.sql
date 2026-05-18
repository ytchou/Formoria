-- =============================================================================
-- MIT Map Seed Data
-- Taxonomy categories + sample Taiwan brands
-- Sourced from: https://github.com/kun1225/taiwan-brands
-- Safe to run multiple times (idempotent via ON CONFLICT DO NOTHING)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Part 1: Taxonomy tags (product_type category)
-- -----------------------------------------------------------------------------
INSERT INTO taxonomy_tags (id, name, name_zh, slug, category, is_active, created_at)
VALUES
  (gen_random_uuid(), 'Food',             '食品',   'food',             'product_type', true, now()),
  (gen_random_uuid(), 'Beverages',        '飲品',   'beverages',        'product_type', true, now()),
  (gen_random_uuid(), 'Clothing',         '服飾',   'clothing',         'product_type', true, now()),
  (gen_random_uuid(), 'Accessories',      '配件',   'accessories',      'product_type', true, now()),
  (gen_random_uuid(), 'Beauty',           '美妝',   'beauty',           'product_type', true, now()),
  (gen_random_uuid(), 'Home',             '家居',   'home',             'product_type', true, now()),
  (gen_random_uuid(), 'Furniture',        '家具',   'furniture',        'product_type', true, now()),
  (gen_random_uuid(), 'Stationery',       '文具',   'stationery',       'product_type', true, now()),
  (gen_random_uuid(), 'Tech Accessories', '3C周邊', 'tech-accessories', 'product_type', true, now()),
  (gen_random_uuid(), 'Pets',             '寵物',   'pets',             'product_type', true, now()),
  (gen_random_uuid(), 'Outdoor',          '戶外',   'outdoor',          'product_type', true, now()),
  (gen_random_uuid(), 'Crafts',           '手工藝', 'crafts',           'product_type', true, now()),
  (gen_random_uuid(), 'Baby & Kids',      '母嬰',   'baby-kids',        'product_type', true, now()),
  (gen_random_uuid(), 'Cleaning',         '清潔',   'cleaning',         'product_type', true, now())
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Part 2: Sample Taiwan brands (~10 real brands)
-- -----------------------------------------------------------------------------

-- BANGSTREE 瀏海樹 — bags/accessories brand from Pinkoi
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'BANGSTREE 瀏海樹',
  'bangstree',
  '包袋',
  'https://cdn01.pinkoi.com/product/42bbieHG/0/2/500x0.jpg',
  '["https://cdn01.pinkoi.com/product/42bbieHG/0/2/500x0.jpg"]',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/bangstree"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 慢慢瓷 Slow White Ceramics — handmade ceramics / home goods
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '慢慢瓷 Slow White Ceramics',
  'slow-white-ceramics',
  '居家生活用品',
  'https://cdn01.pinkoi.com/product/CUgMM2CB/0/1/500x0.jpg',
  '["https://cdn01.pinkoi.com/product/CUgMM2CB/0/1/500x0.jpg", "https://cdn01.pinkoi.com/product/VC2Q6trS/0/2/500x0.jpg"]',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/slow2hite"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 尾八 — stationery and design goods
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '尾八',
  'wei-ba',
  '文具設計、設計商品',
  'https://cdn01.pinkoi.com/product/jhaWrNxa/0/1/500x0.jpg',
  '["https://cdn01.pinkoi.com/product/jhaWrNxa/0/1/500x0.jpg", "https://cdn01.pinkoi.com/product/hTVcWs2p/0/1/500x0.jpg"]',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/livinzoo"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- FEBBI — jewelry / accessories
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'FEBBI',
  'febbi',
  '飾品',
  'https://cdn01.pinkoi.com/product/RHUfKiVh/0/6/500x0.jpg',
  '["https://cdn01.pinkoi.com/product/RHUfKiVh/0/6/500x0.jpg", "https://cdn01.pinkoi.com/product/TdR5crNs/0/3/500x0.jpg"]',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/febbi"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- yunski — clothing / fashion brand
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'yunski',
  'yunski',
  '服飾',
  'https://cdn01.pinkoi.com/product/bjGfun4v/0/1/500x0.jpg',
  '["https://cdn01.pinkoi.com/product/bjGfun4v/0/1/500x0.jpg"]',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/yunski"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- Life n Soul — accessories and tech accessories
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'Life n Soul',
  'life-n-soul',
  '飾品、3C 配件',
  'https://cdn01.pinkoi.com/product/8tkDEf6P/0/1/500x0.jpg',
  '["https://cdn01.pinkoi.com/product/8tkDEf6P/0/1/500x0.jpg"]',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/life-n-soul"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- Cicala Pu 喜樂鋪手工鞋 — handmade shoes
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'Cicala Pu 喜樂鋪手工鞋',
  'cicala-pu',
  '鞋履',
  'https://cdn01.pinkoi.com/product/NhMxt5RT/0/1/500x0.jpg',
  '["https://cdn01.pinkoi.com/product/NhMxt5RT/0/1/500x0.jpg", "https://cdn01.pinkoi.com/product/ZhCgUS6j/0/1/500x0.jpg"]',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/cicalapu"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- Onelife玩生活 — outdoor sports gear (Nantou county)
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'Onelife玩生活',
  'onelife',
  '戶外運動用品',
  'https://twrr.org.tw/uploads/partner/611982834835652661.jpg',
  '["https://twrr.org.tw/uploads/partner/611982834835652661.jpg", "https://twrr.org.tw/uploads/partner/611989436754035119.jpg"]',
  '[]',
  '{"official_website": "https://onelife.com.tw/"}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 鮮乳坊 — fresh dairy / food brand (Yunlin county)
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '鮮乳坊',
  'xian-ru-fang',
  '茶飲食品、農產與加工食品',
  'https://twrr.org.tw/uploads/partner/495301611028742402.jpg',
  '["https://twrr.org.tw/uploads/partner/495301611028742402.jpg"]',
  '[]',
  '{"official_website": "https://maac.io/1DwtV"}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 萬源製麵舖 — traditional noodle maker (Yunlin county)
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url, product_photos,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '萬源製麵舖',
  'wan-yuan-noodles',
  '農產與加工食品',
  'https://twrr.org.tw/uploads/partner/596246476846531142.jpg',
  '["https://twrr.org.tw/uploads/partner/596246476846531142.jpg", "https://twrr.org.tw/uploads/partner/498788851725107297.jpg"]',
  '[]',
  '{"official_website": "http://www.1931.com.tw/"}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Part 3: Brand-taxonomy links
-- -----------------------------------------------------------------------------

-- BANGSTREE 瀏海樹 → accessories
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'bangstree' AND t.slug = 'accessories'
ON CONFLICT DO NOTHING;

-- 慢慢瓷 Slow White Ceramics → home
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'slow-white-ceramics' AND t.slug = 'home'
ON CONFLICT DO NOTHING;

-- 尾八 → stationery
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'wei-ba' AND t.slug = 'stationery'
ON CONFLICT DO NOTHING;

-- FEBBI → accessories
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'febbi' AND t.slug = 'accessories'
ON CONFLICT DO NOTHING;

-- yunski → clothing
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'yunski' AND t.slug = 'clothing'
ON CONFLICT DO NOTHING;

-- Life n Soul → accessories
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'life-n-soul' AND t.slug = 'accessories'
ON CONFLICT DO NOTHING;

-- Life n Soul → tech-accessories
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'life-n-soul' AND t.slug = 'tech-accessories'
ON CONFLICT DO NOTHING;

-- Cicala Pu → accessories (shoes are wearable accessories)
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'cicala-pu' AND t.slug = 'accessories'
ON CONFLICT DO NOTHING;

-- Onelife玩生活 → outdoor
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'onelife' AND t.slug = 'outdoor'
ON CONFLICT DO NOTHING;

-- 鮮乳坊 → food
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'xian-ru-fang' AND t.slug = 'food'
ON CONFLICT DO NOTHING;

-- 鮮乳坊 → beverages
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'xian-ru-fang' AND t.slug = 'beverages'
ON CONFLICT DO NOTHING;

-- 萬源製麵舖 → food
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id
FROM brands b, taxonomy_tags t
WHERE b.slug = 'wan-yuan-noodles' AND t.slug = 'food'
ON CONFLICT DO NOTHING;
