-- =============================================================================
-- Formoria Seed Data
-- Sample Taiwan brands (minimal columns that survive the full migration chain)
-- Safe to run multiple times (idempotent via ON CONFLICT DO NOTHING)
-- =============================================================================

INSERT INTO brands (id, name, slug, description, hero_image_url, status, approved_at, submitted_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'BANGSTREE 瀏海樹', 'bangstree', '包袋', 'https://cdn01.pinkoi.com/product/42bbieHG/0/2/500x0.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), '慢慢瓷 Slow White Ceramics', 'slow-white-ceramics', '居家生活用品', 'https://cdn01.pinkoi.com/product/CUgMM2CB/0/1/500x0.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), '尾八', 'wei-ba', '文具設計、設計商品', 'https://cdn01.pinkoi.com/product/jhaWrNxa/0/1/500x0.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), 'FEBBI', 'febbi', '飾品', 'https://cdn01.pinkoi.com/product/RHUfKiVh/0/6/500x0.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), 'yunski', 'yunski', '服飾', 'https://cdn01.pinkoi.com/product/bjGfun4v/0/1/500x0.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), 'Life n Soul', 'life-n-soul', '飾品、3C 配件', 'https://cdn01.pinkoi.com/product/8tkDEf6P/0/1/500x0.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), 'Cicala Pu 喜樂鋪手工鞋', 'cicala-pu', '鞋履', 'https://cdn01.pinkoi.com/product/NhMxt5RT/0/1/500x0.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), 'Onelife玩生活', 'onelife', '戶外運動用品', 'https://twrr.org.tw/uploads/partner/611982834835652661.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), '鮮乳坊', 'xian-ru-fang', '茶飲食品、農產與加工食品', 'https://twrr.org.tw/uploads/partner/495301611028742402.jpg', 'approved', now(), now(), now(), now()),
  (gen_random_uuid(), '萬源製麵舖', 'wan-yuan-noodles', '農產與加工食品', 'https://twrr.org.tw/uploads/partner/596246476846531142.jpg', 'approved', now(), now(), now(), now())
ON CONFLICT (slug) DO NOTHING;
