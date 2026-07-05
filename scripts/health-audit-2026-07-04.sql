-- DEV-942: Directory health audit 2026-07-04
-- Fix PS BUBU purchase_website URL, flag 1 suspicious third-party + 1 broken + 8 unverified brands for manual review.
-- 1 URL corrected, 10 brands flagged (no automated change — manual spot-check required).

BEGIN;

-- ============================================================
-- 1. Data quality fix — broken purchase_website URL (1)
--    PS BUBU root domain (psbubu-pet.com) is unindexed; live store
--    confirmed at shop.psbubu-pet.com. Update to working URL.
-- ============================================================

UPDATE brands
SET purchase_website = 'https://shop.psbubu-pet.com'
WHERE slug = 'ps-bubu';

-- ============================================================
-- 2. URL health — 10 brands flagged for manual review
--    Note: some may be active but not indexed. Manual spot-check
--    recommended before hiding or nulling. Review each in the
--    admin panel and take action if confirmed dead/suspicious.
--
-- Suspicious — Third-party (1):
--   1973home.myshopify.com (1973 Furniture) — raw Shopify subdomain, no custom domain
--
-- Possible Broken (1):
--   journeyofsole.com (Journey of Sole) — zero search evidence; domain likely down or expired
--
-- Unknown / Unverified (8):
--   best-ti-shop.com (BEST Ti) — no results for domain
--   ccw-official.com (C.C.W.) — no results for domain
--   jswood.com.tw (JSwood 檜樂花) — no results; unrelated furniture company at similar domain
--   monocean.co (MONOCEAN) — .co domain unindexed; monocean.com listed for sale
--   shop.renroblab.com (Re:Nrob Lab) — zero web presence
--   robber925silver.com (Robber 925 Silver) — active on Pinkoi but standalone domain unindexed
--   sammm.store (Sammm._.Studio) — zero web presence
--   sleepy-nest.com (Sleepy Nest) — zero search results
-- ============================================================

COMMIT;

-- ============================================================
-- 3. DB maintenance — no VACUUM required
--    Dead tuples below 20% threshold:
--    brand_slug_redirects at 18.5%, brand_analytics at 12.8%.
--    Connections healthy (12 total, 1 active, 9 idle).
--    No application-level slow queries detected.
-- ============================================================
