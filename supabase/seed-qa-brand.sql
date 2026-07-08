-- ============================================================================
-- QA TEST BRAND FIXTURE  (DEV-734)
-- ----------------------------------------------------------------------------
-- A single, fully-populated, CLAIMABLE community-tier brand for hands-on QA of:
--   claim flow -> ownership link -> dashboard -> analytics cards -> edit form
-- It has status='approved' and NO brand_owners row, so it is claimable.
-- Every column the dashboard/edit-form reads is filled. mit_status='unverified'
-- with a pre-filled mit_evidence candidate so the MIT 微笑認證 path is testable.
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE restores ALL mutable fields, so
-- re-running this after an owner has edited the brand returns it to a pristine
-- state. (It preserves id + created/approved/submitted timestamps.)
--
-- Run:
--   make seed-qa-brand
--   # or directly:
--   npx supabase db query --linked --file supabase/seed-qa-brand.sql
--   # or with psql:
--   psql $DATABASE_URL -f supabase/seed-qa-brand.sql
--
-- To make it claimable again after a test run (removes owner + claim history
-- AND restores fields):  make reset-qa-brand
--
-- ⚠ This is a TEST fixture (name is prefixed 【QA 測試】, source='qa-fixture').
--   Delete or hide it before go-live (DEV-717).
-- ============================================================================

INSERT INTO brands (
  id, name, slug, description,
  logo_url, hero_image_url, product_photos,
  purchase_links, social_links, retail_locations,
  category, founding_year, brand_highlights,
  founder, tag_slugs, contact_email,
  source, is_demo, status,
  mit_status, mit_evidence,
  approved_at, submitted_at, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  '【QA 測試】Test Brand 測試品牌',
  'test-brand-qa',
  '這是一個 QA 測試用的範例品牌，所有欄位皆以假資料填滿，供創辦人手動測試「認領 → 擁有者連結 → 後台儀表板 → 分析卡片 → 編輯表單」的完整流程。請勿在正式行銷頁面使用本品牌。This is a QA fixture brand with every field populated with fake data, used to manually exercise the full owner experience: claim → ownership link → dashboard → analytics cards → edit form. Do not use on production marketing surfaces.',
  'https://cdn01.pinkoi.com/product/42bbieHG/0/2/500x0.jpg',
  'https://cdn01.pinkoi.com/product/CUgMM2CB/0/1/500x0.jpg',
  '["https://cdn01.pinkoi.com/product/8tkDEf6P/0/1/500x0.jpg", "https://cdn01.pinkoi.com/product/bjGfun4v/0/1/500x0.jpg", "https://cdn01.pinkoi.com/product/hTVcWs2p/0/1/500x0.jpg", "https://cdn01.pinkoi.com/product/jhaWrNxa/0/1/500x0.jpg", "https://cdn01.pinkoi.com/product/NhMxt5RT/0/1/500x0.jpg", "https://cdn01.pinkoi.com/product/RHUfKiVh/0/6/500x0.jpg"]',
  '[{"platform": "official", "label": "官方網站", "url": "https://example.com/test-brand-qa"}, {"platform": "pinkoi", "label": "Pinkoi", "url": "https://www.pinkoi.com/store/test-brand-qa"}, {"platform": "shopee", "label": "蝦皮商城", "url": "https://shopee.tw/test-brand-qa"}]',
  '{"instagram": "https://www.instagram.com/test_brand_qa/", "threads": "https://www.threads.net/@test_brand_qa", "facebook": "https://www.facebook.com/testbrandqa", "official_website": "https://example.com/test-brand-qa"}',
  '[{"name": "測試門市・台北旗艦店", "address": "台北市信義區市府路45號", "latitude": 25.0359, "longitude": 121.5670}, {"name": "測試門市・台中地點", "address": "台中市西區公益路68號", "latitude": 24.1517, "longitude": 120.6605}]',
  '生活雜貨',
  2021,
  E'• 100% MIT 台灣製造（測試資料）\n• 手工製作、小批量生產\n• 採用環保回收材質\n• 通過 QA 測試驗證',
  '{"name": "測試創辦人 QA Founder", "title": "創辦人暨設計師", "avatar_url": null, "quote": "這是測試品牌，用來驗證後台每一個區塊都正確顯示。"}',
  ARRAY['accessories', 'handmade', 'eco-friendly'],
  'qa-owner@formoria.test',
  'qa-fixture',
  false,
  'approved',
  'unverified',
  '{"mit_smile_listed": true, "mit_smile_cert": "SMILE-TEST-0001", "notes": "QA fixture — pre-filled so the MIT 微笑認證 claim/verify path is testable end-to-end."}',
  now(), now(), now(), now()
)
ON CONFLICT (slug) DO UPDATE SET
  name             = EXCLUDED.name,
  description      = EXCLUDED.description,
  logo_url         = EXCLUDED.logo_url,
  hero_image_url   = EXCLUDED.hero_image_url,
  product_photos   = EXCLUDED.product_photos,
  purchase_links   = EXCLUDED.purchase_links,
  social_links     = EXCLUDED.social_links,
  retail_locations = EXCLUDED.retail_locations,
  category         = EXCLUDED.category,
  founding_year    = EXCLUDED.founding_year,
  brand_highlights = EXCLUDED.brand_highlights,
  founder          = EXCLUDED.founder,
  tag_slugs        = EXCLUDED.tag_slugs,
  contact_email    = EXCLUDED.contact_email,
  source           = EXCLUDED.source,
  is_demo          = EXCLUDED.is_demo,
  status           = EXCLUDED.status,
  mit_status       = EXCLUDED.mit_status,
  mit_evidence     = EXCLUDED.mit_evidence,
  updated_at       = now();
