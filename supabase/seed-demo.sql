-- =============================================================================
-- MIT Map Demo Brand Seed Data
-- 5 AI-generated demo brands for partner pitches
-- Safe to run multiple times (idempotent via ON CONFLICT DO NOTHING)
-- Remove all demo data: DELETE FROM brands WHERE is_demo = true;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Part 1: Insert 5 demo brands (is_demo = true, status = 'approved')
-- -----------------------------------------------------------------------------

-- 1. 山霧茶坊 (Shan Wu Tea House) — high-mountain oolong tea
INSERT INTO brands (
  id, name, slug, description,
  logo_url, hero_image_url, product_photos,
  purchase_links, social_links,
  category, founding_year,
  is_demo, status,
  approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '山霧茶坊 Shan Wu Tea House',
  'shan-wu-tea-house',
  '來自阿里山的高山烏龍茶品牌。堅持手採、傳統焙火，讓每一杯茶都能品味到台灣高山的雲霧韻味。',
  'https://placeholder.mitmap.tw/shan-wu-tea-house/logo.png',
  'https://placeholder.mitmap.tw/shan-wu-tea-house/hero.jpg',
  '["https://placeholder.mitmap.tw/shan-wu-tea-house/product-1.jpg", "https://placeholder.mitmap.tw/shan-wu-tea-house/product-2.jpg", "https://placeholder.mitmap.tw/shan-wu-tea-house/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.mitmap.tw/shan-wu-tea-house"}, {"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/shan-wu-tea-house"}]',
  '{"instagram": "https://www.instagram.com/shanwuteahouse/", "official_website": "https://placeholder.mitmap.tw/shan-wu-tea-house"}',
  '茶飲',
  2018,
  true, 'approved',
  now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 2. 陶光工作室 (Claylight Studio) — handmade ceramics
INSERT INTO brands (
  id, name, slug, description,
  logo_url, hero_image_url, product_photos,
  purchase_links, social_links,
  category, founding_year,
  is_demo, status,
  approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '陶光工作室 Claylight Studio',
  'claylight-studio',
  '結合台灣在地土料與現代設計的陶瓷品牌。每件作品都在鶯歌工作室手工拉坯、高溫燒製。',
  'https://placeholder.mitmap.tw/claylight-studio/logo.png',
  'https://placeholder.mitmap.tw/claylight-studio/hero.jpg',
  '["https://placeholder.mitmap.tw/claylight-studio/product-1.jpg", "https://placeholder.mitmap.tw/claylight-studio/product-2.jpg", "https://placeholder.mitmap.tw/claylight-studio/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.mitmap.tw/claylight-studio"}, {"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/claylight-studio"}]',
  '{"instagram": "https://www.instagram.com/claylightstudio/", "threads": "https://www.threads.net/@claylightstudio"}',
  '陶瓷家居',
  2020,
  true, 'approved',
  now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 3. 織語 (Woven Words) — indigenous-inspired fashion
INSERT INTO brands (
  id, name, slug, description,
  logo_url, hero_image_url, product_photos,
  purchase_links, social_links,
  category, founding_year,
  is_demo, status,
  approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '織語 Woven Words',
  'woven-words',
  '以台灣原住民織布工藝為靈感的時尚品牌。與部落工藝師合作，將傳統圖騰轉化為現代日常穿搭。',
  'https://placeholder.mitmap.tw/woven-words/logo.png',
  'https://placeholder.mitmap.tw/woven-words/hero.jpg',
  '["https://placeholder.mitmap.tw/woven-words/product-1.jpg", "https://placeholder.mitmap.tw/woven-words/product-2.jpg", "https://placeholder.mitmap.tw/woven-words/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.mitmap.tw/woven-words"}, {"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/woven-words"}]',
  '{"instagram": "https://www.instagram.com/wovenwords.tw/", "facebook": "https://www.facebook.com/wovenwords.tw"}',
  '織品服飾',
  2016,
  true, 'approved',
  now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 4. 島嶼食光 (Island Season) — dried fruits and snacks
INSERT INTO brands (
  id, name, slug, description,
  logo_url, hero_image_url, product_photos,
  purchase_links, social_links,
  category, founding_year,
  is_demo, status,
  approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '島嶼食光 Island Season',
  'island-season',
  '嚴選台灣在地食材，以低溫烘焙保留食物原味。從芒果乾到鳳梨酥，每一口都是島嶼的味道。',
  'https://placeholder.mitmap.tw/island-season/logo.png',
  'https://placeholder.mitmap.tw/island-season/hero.jpg',
  '["https://placeholder.mitmap.tw/island-season/product-1.jpg", "https://placeholder.mitmap.tw/island-season/product-2.jpg", "https://placeholder.mitmap.tw/island-season/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.mitmap.tw/island-season"}, {"platform": "shopee", "label": "蝦皮購物", "url": "https://shopee.tw/island-season"}]',
  '{"instagram": "https://www.instagram.com/islandseason.tw/", "threads": "https://www.threads.net/@islandseason.tw", "official_website": "https://placeholder.mitmap.tw/island-season"}',
  '食品零食',
  2019,
  true, 'approved',
  now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 5. 膚語 (Skin Verse) — plant-based skincare
INSERT INTO brands (
  id, name, slug, description,
  logo_url, hero_image_url, product_photos,
  purchase_links, social_links,
  category, founding_year,
  is_demo, status,
  approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '膚語 Skin Verse',
  'skin-verse',
  '以台灣原生植萃為核心的保養品牌。使用花蓮有機農場的植物原料，堅持無動物實驗、全素配方。',
  'https://placeholder.mitmap.tw/skin-verse/logo.png',
  'https://placeholder.mitmap.tw/skin-verse/hero.jpg',
  '["https://placeholder.mitmap.tw/skin-verse/product-1.jpg", "https://placeholder.mitmap.tw/skin-verse/product-2.jpg", "https://placeholder.mitmap.tw/skin-verse/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.mitmap.tw/skin-verse"}, {"platform": "momo", "label": "momo購物網", "url": "https://www.momoshop.com.tw/search/skin-verse"}]',
  '{"instagram": "https://www.instagram.com/skinverse.tw/", "official_website": "https://placeholder.mitmap.tw/skin-verse"}',
  '美妝保養',
  2021,
  true, 'approved',
  now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Part 2: Brand-taxonomy links (product_type + value tags)
-- -----------------------------------------------------------------------------

-- 山霧茶坊 → food, sustainability, handmade
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'shan-wu-tea-house' AND t.slug = 'food'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'shan-wu-tea-house' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'shan-wu-tea-house' AND t.slug = 'handmade'
ON CONFLICT DO NOTHING;

-- 陶光工作室 → home, handmade, sustainability
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'claylight-studio' AND t.slug = 'home'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'claylight-studio' AND t.slug = 'handmade'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'claylight-studio' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

-- 織語 → clothing, handmade, sustainability
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'clothing'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'handmade'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

-- 島嶼食光 → food, sustainability
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'island-season' AND t.slug = 'food'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'island-season' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

-- 膚語 → beauty, sustainability, handmade
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'skin-verse' AND t.slug = 'beauty'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'skin-verse' AND t.slug = 'sustainability'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'skin-verse' AND t.slug = 'handmade'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Part 3: Brand detail enrichment (founder, product_highlights, retail_locations)
-- -----------------------------------------------------------------------------

UPDATE brands SET
  founder = '{"name": "林雅芳", "title": "創辦人", "avatar_url": "https://placeholder.mitmap.tw/shan-wu-tea-house/founder.jpg", "quote": "茶是一種生活態度，不只是飲品。"}',
  brand_highlights = '阿里山金萱烏龍 / 日月潭紅茶 / 高山冷泡茶禮盒',
  retail_locations = '[{"name": "阿里山茶園直營店", "address": "嘉義縣番路鄉", "latitude": 23.4685, "longitude": 120.7011}]'
WHERE slug = 'shan-wu-tea-house';

UPDATE brands SET
  founder = '{"name": "陳柏宇", "title": "陶藝師", "avatar_url": "https://placeholder.mitmap.tw/claylight-studio/founder.jpg", "quote": "土地給我們的，我們用雙手還給生活。"}',
  brand_highlights = '手作茶器組 / 極簡花器 / 日常食器系列',
  retail_locations = '[{"name": "鶯歌陶光工作室", "address": "新北市鶯歌區", "latitude": 24.9536, "longitude": 121.3533}]'
WHERE slug = 'claylight-studio';

UPDATE brands SET
  founder = '{"name": "張心怡", "title": "設計總監", "avatar_url": "https://placeholder.mitmap.tw/woven-words/founder.jpg", "quote": "每一條線都是一個故事。"}',
  brand_highlights = '織紋托特包 / 手織圍巾 / 圖騰印花T恤',
  retail_locations = '[{"name": "織語概念店", "address": "台北市大安區", "latitude": 25.0265, "longitude": 121.5435}]'
WHERE slug = 'woven-words';

UPDATE brands SET
  founder = '{"name": "王建志", "title": "創辦人", "avatar_url": "https://placeholder.mitmap.tw/island-season/founder.jpg", "quote": "好的食物不需要過多加工。"}',
  brand_highlights = '日曬芒果乾 / 手工鳳梨酥 / 台灣茶果醬禮盒',
  retail_locations = '[{"name": "島嶼食光台南門市", "address": "台南市中西區", "latitude": 22.9908, "longitude": 120.2133}]'
WHERE slug = 'island-season';

UPDATE brands SET
  founder = '{"name": "蘇雨婷", "title": "品牌創辦人", "avatar_url": "https://placeholder.mitmap.tw/skin-verse/founder.jpg", "quote": "肌膚也需要回歸自然。"}',
  brand_highlights = '茶樹精華液 / 山茶花保濕霜 / 艾草舒緩面膜',
  retail_locations = '[{"name": "膚語花蓮旗艦店", "address": "花蓮縣花蓮市", "latitude": 23.9910, "longitude": 121.6011}]'
WHERE slug = 'skin-verse';

-- -----------------------------------------------------------------------------
-- Part 4: Hide existing real brands from public views
-- -----------------------------------------------------------------------------

UPDATE brands SET status = 'hidden'
WHERE is_demo = false AND status = 'approved';
