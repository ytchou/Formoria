-- =============================================================================
-- Formoria Seed Data
-- Sample Taiwan brands
-- Sourced from: https://github.com/kun1225/taiwan-brands
-- Safe to run multiple times (idempotent via ON CONFLICT DO NOTHING)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Part 1: Sample Taiwan brands (~10 real brands)
-- -----------------------------------------------------------------------------

-- BANGSTREE 瀏海樹 — bags/accessories brand from Pinkoi
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'BANGSTREE 瀏海樹',
  'bangstree',
  '包袋',
  'https://cdn01.pinkoi.com/product/42bbieHG/0/2/500x0.jpg',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/bangstree"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 慢慢瓷 Slow White Ceramics — handmade ceramics / home goods
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '慢慢瓷 Slow White Ceramics',
  'slow-white-ceramics',
  '居家生活用品',
  'https://cdn01.pinkoi.com/product/CUgMM2CB/0/1/500x0.jpg',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/slow2hite"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 尾八 — stationery and design goods
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '尾八',
  'wei-ba',
  '文具設計、設計商品',
  'https://cdn01.pinkoi.com/product/jhaWrNxa/0/1/500x0.jpg',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/livinzoo"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- FEBBI — jewelry / accessories
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'FEBBI',
  'febbi',
  '飾品',
  'https://cdn01.pinkoi.com/product/RHUfKiVh/0/6/500x0.jpg',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/febbi"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- yunski — clothing / fashion brand
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'yunski',
  'yunski',
  '服飾',
  'https://cdn01.pinkoi.com/product/bjGfun4v/0/1/500x0.jpg',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/yunski"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- Life n Soul — accessories and tech accessories
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'Life n Soul',
  'life-n-soul',
  '飾品、3C 配件',
  'https://cdn01.pinkoi.com/product/8tkDEf6P/0/1/500x0.jpg',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/life-n-soul"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- Cicala Pu 喜樂鋪手工鞋 — handmade shoes
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'Cicala Pu 喜樂鋪手工鞋',
  'cicala-pu',
  '鞋履',
  'https://cdn01.pinkoi.com/product/NhMxt5RT/0/1/500x0.jpg',
  '[{"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/cicalapu"}]',
  '{}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- Onelife玩生活 — outdoor sports gear (Nantou county)
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'Onelife玩生活',
  'onelife',
  '戶外運動用品',
  'https://twrr.org.tw/uploads/partner/611982834835652661.jpg',
  '[]',
  '{"official_website": "https://onelife.com.tw/"}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 鮮乳坊 — fresh dairy / food brand (Yunlin county)
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '鮮乳坊',
  'xian-ru-fang',
  '茶飲食品、農產與加工食品',
  'https://twrr.org.tw/uploads/partner/495301611028742402.jpg',
  '[]',
  '{"official_website": "https://maac.io/1DwtV"}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- 萬源製麵舖 — traditional noodle maker (Yunlin county)
INSERT INTO brands (
  id, name, slug, description,
  hero_image_url,
  purchase_links, social_links,
  status, approved_at, submitted_at, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '萬源製麵舖',
  'wan-yuan-noodles',
  '農產與加工食品',
  'https://twrr.org.tw/uploads/partner/596246476846531142.jpg',
  '[]',
  '{"official_website": "http://www.1931.com.tw/"}',
  'approved', now(), now(), now(), now()
)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Part 2: Brand detail enrichment (founder + product_highlights)
-- -----------------------------------------------------------------------------

UPDATE brands SET
  founder = '{"name": "林小姐", "title": "Founder & Designer", "avatar_url": null, "quote": "每一個包都承載著對生活的想像"}',
  product_highlights = '[{"name": "方塊水桶包", "image_url": "https://cdn01.pinkoi.com/product/42bbieHG/0/2/500x0.jpg", "description": "經典方形剪裁搭配柔軟皮革"}, {"name": "迷你托特包", "image_url": "https://cdn01.pinkoi.com/product/42bbieHG/0/2/500x0.jpg", "description": "輕巧實用的日常好夥伴"}]',
  description = 'BANGSTREE 瀏海樹是來自台灣的包袋品牌，以簡約設計和優質皮革打造日常包款。每一件作品都融入了對生活美學的追求，希望陪伴使用者度過每一天的精彩時刻。',
  category = 'Accessories',
  founding_year = 2018,
  social_links = '{"instagram": "https://www.instagram.com/bangstree_bag/", "official_website": "https://www.pinkoi.com/store/bangstree"}',
  retail_locations = '[{"name": "Pinkoi Design Store", "address": "台北市大安區", "latitude": 25.0339, "longitude": 121.5434}]'
WHERE slug = 'bangstree';

UPDATE brands SET
  founder = '{"name": "陳慢慢", "title": "陶藝師", "avatar_url": null, "quote": "慢下來，才能感受泥土的溫度"}',
  product_highlights = '[{"name": "手捏花器", "image_url": "https://cdn01.pinkoi.com/product/CUgMM2CB/0/1/500x0.jpg", "description": "每件都是獨一無二的手工花器"}, {"name": "日式茶杯組", "image_url": "https://cdn01.pinkoi.com/product/VC2Q6trS/0/2/500x0.jpg", "description": "溫潤質感的日常茶具"}]',
  category = 'Home',
  founding_year = 2019
WHERE slug = 'slow-white-ceramics';

UPDATE brands SET
  founder = '{"name": "龔建嘉", "title": "創辦人暨獸醫師", "avatar_url": null, "quote": "讓每一口鮮乳，都喝得到對土地的善意"}',
  product_highlights = '[{"name": "小農鮮乳", "image_url": "https://cdn01.pinkoi.com/product/42bbieHG/0/2/500x0.jpg", "description": "嚴選在地小農牧場直送鮮乳"}]',
  category = 'Food & Beverage',
  founding_year = 2015
WHERE slug = 'xian-ru-fang';

UPDATE brands SET
  founder = '{"name": "王小明", "title": "創辦人", "avatar_url": null, "quote": "每個毛孩都值得最好的陪伴"}',
  product_highlights = '[{"name": "帆布寵物背包", "image_url": null, "description": "透氣輕量的外出背包，讓毛孩安心同行"}, {"name": "手工皮革項圈", "image_url": null, "description": "植鞣皮革手工打造，耐用且質感出眾"}]',
  category = 'Pet Accessories',
  founding_year = 2017
WHERE slug = 'wei-ba';

UPDATE brands SET
  founder = '{"name": "陳芳怡", "title": "設計總監", "avatar_url": null, "quote": "穿上 FEBBI，展現屬於你的自信風格"}',
  product_highlights = '[{"name": "經典棉麻寬版上衣", "image_url": null, "description": "柔軟棉麻面料，寬鬆剪裁適合各種體型"}, {"name": "時尚格紋外套", "image_url": null, "description": "台灣製造，精工縫製的秋冬必備單品"}]',
  category = 'Clothing',
  founding_year = 2019
WHERE slug = 'febbi';

UPDATE brands SET
  founder = '{"name": "李志遠", "title": "創辦人暨戶外愛好者", "avatar_url": null, "quote": "台灣山林是我們的靈感，也是我們保護的責任"}',
  product_highlights = '[{"name": "輕量化登山背包", "image_url": null, "description": "台灣設計製造，符合亞洲體型的人體工學背包"}, {"name": "防水機能雨衣", "image_url": null, "description": "高防水係數，兼顧透氣與輕量"}]',
  category = 'Outdoor Gear',
  founding_year = 2016
WHERE slug = 'yunski';

UPDATE brands SET
  founder = '{"name": "吳雅婷", "title": "品牌創辦人", "avatar_url": null, "quote": "生活中的每個細節，都值得用心對待"}',
  product_highlights = '[{"name": "手工蠟燭禮盒", "image_url": null, "description": "天然大豆蠟調製，香氣溫潤舒適"}, {"name": "亞麻桌墊組", "image_url": null, "description": "天然亞麻材質，簡約北歐風格"}]',
  category = 'Home',
  founding_year = 2018
WHERE slug = 'life-n-soul';

UPDATE brands SET
  founder = '{"name": "蔡文政", "title": "皮革工藝師", "avatar_url": null, "quote": "好的皮件應該越用越有味道，陪伴一輩子"}',
  product_highlights = '[{"name": "植鞣皮革長夾", "image_url": null, "description": "義大利植鞣皮革手縫，紋路自然獨特"}, {"name": "A5 皮革筆記本套", "image_url": null, "description": "可替換內頁設計，經年使用更顯風韻"}]',
  category = 'Crafts',
  founding_year = 2015
WHERE slug = 'cicala-pu';

UPDATE brands SET
  founder = '{"name": "黃一生", "title": "創辦人", "avatar_url": null, "quote": "文具是思想與紙張之間最美好的橋樑"}',
  product_highlights = '[{"name": "限定款筆記本", "image_url": null, "description": "台灣在地紙廠供紙，書寫滑順不透墨"}, {"name": "多色鋼筆組", "image_url": null, "description": "入門款鋼筆，適合初次嘗試手寫的朋友"}]',
  category = 'Stationery',
  founding_year = 2020
WHERE slug = 'onelife';

UPDATE brands SET
  founder = '{"name": "萬老闆", "title": "第三代傳承者", "avatar_url": null, "quote": "三代人守著這鍋湯，是對老滋味的承諾"}',
  product_highlights = '[{"name": "傳統陽春麵", "image_url": null, "description": "手工製作，Q彈有勁的純正台灣麵條"}, {"name": "意麵禮盒", "image_url": null, "description": "伴手禮首選，傳統工法製作的手工意麵"}]',
  category = 'Food & Beverage',
  founding_year = 1985
WHERE slug = 'wan-yuan-noodles';
