-- =============================================================================
-- Formoria Demo Brand Seed Data
-- 5 AI-generated demo brands for partner pitches
-- Safe to run multiple times (idempotent via ON CONFLICT DO NOTHING)
-- Remove all demo data: DELETE FROM brands WHERE is_demo = true;
--
-- NOTE: This file is ADDITIVE only — it inserts demo brands and populates
--       their detail fields. It does NOT hide or modify real brands.
--
-- To hide real brands for a clean demo environment, run separately:
--   psql $DATABASE_URL -f supabase/hide-real-brands.sql
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
  '山霧茶坊從阿里山一間老製茶廠旁的小茶席開始。創辦人林雅芳原本在都市做品牌企劃，回到嘉義照顧家人時，重新看見父執輩在清晨霧氣裡巡茶、採茶、等候萎凋的耐心，於是把茶園直送與日常茶飲結合成現在的山霧茶坊。

我們以海拔、季節與焙火度來整理茶款，不追求誇張香氣，而是保留高山烏龍乾淨的花香、金萱柔軟的奶香，以及冷泡茶在夏天入口時的清爽。茶菁以手採為主，小批次製作，從走水、揉捻到焙火都留下可回溯紀錄，讓每一批茶都能說清楚它來自哪一片坡地。

山霧茶坊相信好茶不需要被神祕化。林雅芳想做的是讓年輕人、旅人與長年喝茶的長輩都能在同一張桌上分享一壺茶；包裝減量、茶渣回收與穩定收購也是品牌對茶農和土地的承諾。',
  'https://placeholder.formoria.com/shan-wu-tea-house/logo.png',
  'https://placeholder.formoria.com/shan-wu-tea-house/hero.jpg',
  '["https://placeholder.formoria.com/shan-wu-tea-house/product-1.jpg", "https://placeholder.formoria.com/shan-wu-tea-house/product-2.jpg", "https://placeholder.formoria.com/shan-wu-tea-house/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.formoria.com/shan-wu-tea-house"}, {"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/shan-wu-tea-house"}]',
  '{"instagram": "https://www.instagram.com/shanwuteahouse/", "official_website": "https://placeholder.formoria.com/shan-wu-tea-house"}',
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
  '陶光工作室位在鶯歌一條安靜巷弄裡，前身是創辦人陳柏宇租下的半間窯邊倉庫。他曾在建築事務所工作，畫過很多漂亮立面，卻一直想做能被人每天端起、清洗、放回餐桌的物件，於是回到鶯歌學土、練坯，也把對比例與光影的敏感帶進陶器裡。

工作室使用台灣在地土料調配坯體，作品經過手拉坯、修坯、素燒、上釉與高溫燒成。每件杯碗都保留手作時細微的重量差與釉色流動，不把它們修成完全一致，因為我們相信日常器皿的美感來自手感、火痕與使用後慢慢形成的熟悉。

陳柏宇希望陶光不是只擺在櫃裡的工藝，而是陪人吃飯、泡茶、插一枝花的生活工具。品牌持續回收試釉資料、降低過度包裝，並和在地窯廠合作，讓鶯歌的技術與新一代的設計語彙能一起留下來。',
  'https://placeholder.formoria.com/claylight-studio/logo.png',
  'https://placeholder.formoria.com/claylight-studio/hero.jpg',
  '["https://placeholder.formoria.com/claylight-studio/product-1.jpg", "https://placeholder.formoria.com/claylight-studio/product-2.jpg", "https://placeholder.formoria.com/claylight-studio/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.formoria.com/claylight-studio"}, {"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/claylight-studio"}]',
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
  '織語由設計師張心怡創立。她在花東田野訪談中第一次跟著部落阿姨整經、挑線、聽圖紋背後的家族記憶，才發現織布不是裝飾，而是一種記錄身份、土地和遷徙的語言；品牌名稱也因此而來。

每一季開發都從合作工藝師的授權圖紋與色彩脈絡開始，再轉化為托特包、圍巾與日常上衣。織語不直接複製祭儀圖像，而是透過手織局部、天然纖維混紡、低量印花與可修補結構，把傳統工藝放進現代穿著的節奏裡。

張心怡想讓購買者知道一條線的來源，也讓工藝師在合作中被看見、被合理分潤。織語重視文化尊重、透明標示與慢量生產；衣物可以穿很久，故事也應該被好好說清楚。',
  'https://placeholder.formoria.com/woven-words/logo.png',
  'https://placeholder.formoria.com/woven-words/hero.jpg',
  '["https://placeholder.formoria.com/woven-words/product-1.jpg", "https://placeholder.formoria.com/woven-words/product-2.jpg", "https://placeholder.formoria.com/woven-words/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.formoria.com/woven-words"}, {"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/woven-words"}]',
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
  '島嶼食光從台南市場旁的一台小型乾燥機開始。創辦人王建志家裡曾做水果批發，他看過太多外表不夠漂亮、卻熟度正好的芒果、鳳梨與香蕉被低價處理，便想用更穩定的乾燥技術，把產季的甜味留下來。

我們和南部小農合作，依水果含水量與酸甜度調整切片厚度、糖漬比例和低溫烘乾時間。芒果乾保留果肉纖維，鳳梨酥餡用慢火收乾，茶果醬則用台灣茶湯拉出尾韻；加工不求濃重，只求吃得到原料本身的成熟度。

王建志相信零食可以更誠實：清楚標示產地、減少香精與多餘添加，也讓格外品有更好的去處。島嶼食光想做的是能帶上旅途、送給朋友，也能讓人想起台灣季節感的乾食與點心。',
  'https://placeholder.formoria.com/island-season/logo.png',
  'https://placeholder.formoria.com/island-season/hero.jpg',
  '["https://placeholder.formoria.com/island-season/product-1.jpg", "https://placeholder.formoria.com/island-season/product-2.jpg", "https://placeholder.formoria.com/island-season/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.formoria.com/island-season"}, {"platform": "shopee", "label": "蝦皮購物", "url": "https://shopee.tw/island-season"}]',
  '{"instagram": "https://www.instagram.com/islandseason.tw/", "threads": "https://www.threads.net/@islandseason.tw", "official_website": "https://placeholder.formoria.com/island-season"}',
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
  '膚語誕生在花蓮海岸山脈旁的一座有機農場。創辦人蘇雨婷曾是配方研發助理，長期敏感肌讓她對成分表格外在意；回到花蓮後，她開始和農友一起研究茶樹、山茶花、艾草等植物在保養配方中的穩定性與膚感。

品牌以小批次萃取與溫和配方為核心，不把植物成分神化，也不追求過度複雜的瓶罐儀式。每一款產品都從基礎需求出發：保濕要清爽不悶，舒緩要降低刺激，精華液要讓肌膚在潮濕炎熱的氣候裡也能舒服使用。

蘇雨婷希望膚語像一段寫給肌膚的短句，清楚、克制、能被每天理解。品牌堅持無動物實驗、全素配方與可追溯原料，並持續簡化包材，讓照顧自己和照顧土地不是兩件分開的事。',
  'https://placeholder.formoria.com/skin-verse/logo.png',
  'https://placeholder.formoria.com/skin-verse/hero.jpg',
  '["https://placeholder.formoria.com/skin-verse/product-1.jpg", "https://placeholder.formoria.com/skin-verse/product-2.jpg", "https://placeholder.formoria.com/skin-verse/product-3.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://placeholder.formoria.com/skin-verse"}, {"platform": "momo", "label": "momo購物網", "url": "https://www.momoshop.com.tw/search/skin-verse"}]',
  '{"instagram": "https://www.instagram.com/skinverse.tw/", "official_website": "https://placeholder.formoria.com/skin-verse"}',
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

-- Extended value-tag mapping (DEV-691) — ensures all 8 value tags have ≥1 brand
INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'shan-wu-tea-house' AND t.slug = 'local-revitalization'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'claylight-studio' AND t.slug = 'local-culture'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'local-culture'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'social-enterprise'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'woven-words' AND t.slug = 'fair-trade'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'island-season' AND t.slug = 'local-revitalization'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'skin-verse' AND t.slug = 'organic'
ON CONFLICT DO NOTHING;

INSERT INTO brand_taxonomy (brand_id, tag_id)
SELECT b.id, t.id FROM brands b, taxonomy_tags t
WHERE b.slug = 'skin-verse' AND t.slug = 'eco-friendly'
ON CONFLICT DO NOTHING;


-- -----------------------------------------------------------------------------
-- Part 3: Brand detail enrichment (brand_highlights, retail_locations)
-- -----------------------------------------------------------------------------

UPDATE brands SET
  brand_highlights = '阿里山金萱烏龍 / 日月潭紅茶 / 高山冷泡茶禮盒',
  retail_locations = '[{"name": "阿里山茶園直營店", "address": "嘉義縣番路鄉", "latitude": 23.4685, "longitude": 120.7011}]'
WHERE slug = 'shan-wu-tea-house';

UPDATE brands SET
  brand_highlights = '手作茶器組 / 極簡花器 / 日常食器系列',
  retail_locations = '[{"name": "鶯歌陶光工作室", "address": "新北市鶯歌區", "latitude": 24.9536, "longitude": 121.3533}]'
WHERE slug = 'claylight-studio';

UPDATE brands SET
  brand_highlights = '織紋托特包 / 手織圍巾 / 圖騰印花T恤',
  retail_locations = '[{"name": "織語概念店", "address": "台北市大安區", "latitude": 25.0265, "longitude": 121.5435}]'
WHERE slug = 'woven-words';

UPDATE brands SET
  brand_highlights = '日曬芒果乾 / 手工鳳梨酥 / 台灣茶果醬禮盒',
  retail_locations = '[{"name": "島嶼食光台南門市", "address": "台南市中西區", "latitude": 22.9908, "longitude": 120.2133}]'
WHERE slug = 'island-season';

UPDATE brands SET
  brand_highlights = '茶樹精華液 / 山茶花保濕霜 / 艾草舒緩面膜',
  retail_locations = '[{"name": "膚語花蓮旗艦店", "address": "花蓮縣花蓮市", "latitude": 23.9910, "longitude": 121.6011}]'
WHERE slug = 'skin-verse';
