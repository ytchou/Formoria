-- DEV-915: Directory health audit 2026-06-30
-- Fixes suspicious purchase_website URLs, data quality issues, and DB maintenance.
-- 16 brands corrected, 5 flagged for manual verification.

BEGIN;

-- ============================================================
-- 1. Threads.com social profiles used as purchase_website (15)
--    Threads is a social platform — not a shop URL. Clear them.
-- ============================================================

UPDATE brands SET purchase_website = NULL WHERE slug = '4-nuts';
UPDATE brands SET purchase_website = NULL WHERE slug = '404-oligo';
UPDATE brands SET purchase_website = NULL WHERE slug = 'ailin-handcrafted-jewelry';
UPDATE brands SET purchase_website = NULL WHERE slug = 'allite';
UPDATE brands SET purchase_website = NULL WHERE slug = 'build-light-candle';
UPDATE brands SET purchase_website = NULL WHERE slug = 'change-tone';
UPDATE brands SET purchase_website = NULL WHERE slug = 'dasuit大適坐墊';
UPDATE brands SET purchase_website = NULL WHERE slug = 'fumi-towel';
UPDATE brands SET purchase_website = NULL WHERE slug = 'fumor';
UPDATE brands SET purchase_website = NULL WHERE slug = 'fusoap-台南手工皂-訂製-小禮-代製專屬皂';
UPDATE brands SET purchase_website = NULL WHERE slug = 'tw-shoesmaker';
UPDATE brands SET purchase_website = NULL WHERE slug = '2026-居家與醫療電動床';
UPDATE brands SET purchase_website = NULL WHERE slug = 'yogasana';
UPDATE brands SET purchase_website = NULL WHERE slug = 'yi-fan-canvas-bags';
UPDATE brands SET purchase_website = NULL WHERE slug = 'coconut-pie';

-- ============================================================
-- 2. Linktree used as purchase_website (1)
--    Linktree is a link aggregator — not a shop URL.
-- ============================================================

UPDATE brands SET purchase_website = NULL WHERE slug = 'evies-drawing-daily';

-- ============================================================
-- 3. Data quality fixes
-- ============================================================

-- JUN616XTEEN: slug is "首頁" (homepage placeholder) — fix to meaningful slug
UPDATE brands SET slug = 'jun616xteen' WHERE slug = '首頁';

-- SMOK 製甜所: trailing "?" in purchase_website — trim
UPDATE brands SET purchase_website = 'https://www.smokcafe.com/' WHERE slug = 'smok-製甜所';

-- ============================================================
-- 4. Flagged for manual verification (NO auto-fix)
-- ============================================================

-- 1973 Furniture (1973-furniture): https://1973home.myshopify.com
--   Shopify native subdomain — functional but no custom domain configured.
--   Action: verify if brand has a custom domain; update if so.

-- YUMOR Original (yumor-original): https://yumor-original.framer.website
--   Framer subdomain, not indexed — needs manual check.

-- S Pantyhose (s-pantyhose): https://majimeowcutiesportsday.com.tw
--   Domain doesn't match brand name — possible data entry error.

-- MONOCEAN (monocean): https://monocean.co
--   No Taiwan brand found at this domain — possible conflict with French brand.

-- Sammm._.Studio (sammm-studio): https://sammm.store
--   Not indexed by search — needs manual verification.

COMMIT;

-- ============================================================
-- 5. DB maintenance — VACUUM ANALYZE for tables with high dead tuples
--    Must run outside transaction block.
-- ============================================================

VACUUM ANALYZE brand_search_results;
VACUUM ANALYZE brand_analytics;
VACUUM ANALYZE brand_owners;
VACUUM ANALYZE brand_submissions;
VACUUM ANALYZE newsletter_subscribers;
VACUUM ANALYZE moderation_flags;
VACUUM ANALYZE brand_reports;
VACUUM ANALYZE pending_brand_edits;
VACUUM ANALYZE curation_jobs;
VACUUM ANALYZE brand_link_clicks;
VACUUM ANALYZE profiles;
